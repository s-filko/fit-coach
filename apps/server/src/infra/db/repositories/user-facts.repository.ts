import { and, asc, desc, eq, gt, isNull, lte, ne, or, sql } from 'drizzle-orm';

import type {
  FactCategory,
  FactsListing,
  IUserFactsService,
  RememberFactInput,
  RememberFactOutcome,
  SupersedeFactInput,
  UserFact,
} from '@domain/user/ports';
import { computeFactKey } from '@domain/user/services/fact-key';
import { closureMoment, isActiveForPrompt, resolveLifecycle } from '@domain/user/services/fact-lifecycle';

import { db } from '@infra/db/drizzle';
import { userFacts } from '@infra/db/schema';

function toUserFact(row: typeof userFacts.$inferSelect): UserFact {
  return {
    id: row.id,
    userId: row.userId,
    category: row.category as FactCategory,
    fact: row.fact,
    factKey: row.factKey,
    muscleGroup: row.muscleGroup,
    confirmations: row.confirmations,
    sourceTurnId: row.sourceTurnId,
    durability: row.durability,
    expiresAt: row.expiresAt,
    reviewAfter: row.reviewAfter,
    phaseNote: row.phaseNote,
    phaseAt: row.phaseAt,
    onExpiry: row.onExpiry,
    status: row.status,
    archivedAt: row.archivedAt,
    archivedReason: row.archivedReason,
    closedByUserAt: row.closedByUserAt,
    supersedesId: row.supersedesId,
    context: row.context,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * The AC-FL-1 read filter (the SQL twin of `isActiveForPrompt`): active rows
 * only, and nothing whose TTL is up at the caller's `now` (the run clock —
 * passed in as data, never the DB clock or a fresh `new Date()`). Expiry is a
 * SHORT-class property in the twin, so the SQL checks durability too — the two
 * cannot drift apart on a stray expires_at on a non-short row.
 */
function visibleAt(now: Date) {
  return and(
    eq(userFacts.status, 'active'),
    or(isNull(userFacts.expiresAt), ne(userFacts.durability, 'short'), gt(userFacts.expiresAt, now)),
  );
}

/**
 * The SQL twin of `isExpired`: an ACTIVE short fact whose TTL is up at the
 * caller's `now` (<=) — the exact complement of the expiry clause in
 * {@link visibleAt}. Kept next to it so the two cannot drift.
 */
function expiredAt(now: Date) {
  return and(eq(userFacts.status, 'active'), eq(userFacts.durability, 'short'), lte(userFacts.expiresAt, now));
}

/** Postgres unique-violation (the partial unique index) — matched by code, never message text. */
function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === '23505';
}

/** Drizzle implementation of {@link IUserFactsService} (ADR-0009 table shape, D-B/D-C). */
export class UserFactsRepository implements IUserFactsService {
  async getForPrompt(userId: string, now: Date, cap = 50): Promise<UserFact[]> {
    const rows = await db
      .select()
      .from(userFacts)
      .where(and(eq(userFacts.userId, userId), visibleAt(now)))
      .orderBy(asc(userFacts.category), desc(userFacts.createdAt))
      .limit(cap);
    return rows.map(toUserFact);
  }

  async getExpiredActive(userId: string, now: Date): Promise<UserFact[]> {
    const rows = await db
      .select()
      .from(userFacts)
      .where(and(eq(userFacts.userId, userId), expiredAt(now)))
      .orderBy(asc(userFacts.expiresAt));
    return rows.map(toUserFact);
  }

  async archiveExpired(userId: string, factId: string, now: Date): Promise<boolean> {
    const rows = await db
      .update(userFacts)
      .set({ status: 'archived', archivedAt: now, archivedReason: 'expired', updatedAt: now })
      // The guard lives in the write: a fact re-stated since (TTL renewed) or already archived is not touched.
      .where(and(eq(userFacts.id, factId), eq(userFacts.userId, userId), expiredAt(now)))
      .returning({ id: userFacts.id });
    return rows.length > 0;
  }

  async getConstraints(userId: string, now: Date): Promise<UserFact[]> {
    const rows = await db
      .select()
      .from(userFacts)
      .where(and(eq(userFacts.userId, userId), eq(userFacts.category, 'physical_constraint'), visibleAt(now)));
    return rows.filter(row => row.muscleGroup !== null).map(toUserFact);
  }

  /** The key lookup: prefer the ACTIVE row (the dedupe/update target), fall back to the newest closed row. */
  private async rowsForKey(userId: string, category: string, factKey: string): Promise<UserFact[]> {
    return (
      await db
        .select()
        .from(userFacts)
        .where(and(eq(userFacts.userId, userId), eq(userFacts.category, category), eq(userFacts.factKey, factKey)))
        .orderBy(desc(userFacts.createdAt))
    ).map(toUserFact);
  }

  private async rowById(userId: string, factId: string): Promise<UserFact | null> {
    const [row] = await db
      .select()
      .from(userFacts)
      .where(and(eq(userFacts.id, factId), eq(userFacts.userId, userId)));
    return row === undefined ? null : toUserFact(row);
  }

  async rememberFact(
    userId: string,
    input: RememberFactInput,
    now: Date,
    sourceTurnId?: string,
  ): Promise<RememberFactOutcome> {
    const factKey = computeFactKey(input.fact);
    // A correction references the row by id (the corrected text normalises to a
    // NEW key); without an id, the key lookup is the dedupe.
    const rows = input.factId
      ? [await this.rowById(userId, input.factId)].filter((row): row is UserFact => row !== null)
      : await this.rowsForKey(userId, input.category, factKey);
    const existing = rows.find(row => row.status === 'active') ?? rows[0] ?? null;

    // Code owns the bounds (fact-lifecycle plan): clamping per class, and the
    // `permanent` gate — the existing counter is the fact's confirmation history.
    const lifecycle = resolveLifecycle(input, now, {
      explicit: input.explicitPermanent,
      confirmations: existing?.confirmations ?? 0,
    });

    // AC-FL-3 (review finding 2): the user's word wins — a closed fact key is
    // only re-created from evidence NEWER than the closure. The comparison uses
    // the EVIDENCE clock (input.evidenceAt, defaulting to `now` — a live
    // conversation is its own evidence), never the DB clock; `now` stays the
    // clock for every date written below.
    if (existing?.status === 'archived') {
      const closureAt = closureMoment(existing);
      const evidenceAt = input.evidenceAt ?? now;
      if (closureAt !== null && evidenceAt.getTime() <= closureAt.getTime()) {
        return { outcome: 'skipped_stale_evidence', fact: existing };
      }
    }

    const lifecycleValues = {
      durability: lifecycle.durability,
      expiresAt: lifecycle.expiresAt,
      reviewAfter: lifecycle.reviewAfter,
      onExpiry: lifecycle.onExpiry,
      phaseNote: input.phaseNote ?? null,
      phaseAt: input.phaseNote != null ? now : null,
    };

    // The ACTIVE-row correction, shared by the direct path and the race
    // recovery below: a conversational correction REWRITES the text (unlike a
    // confirm, D-C) and bumps the counter.
    const updateInPlace = async (row: UserFact): Promise<RememberFactOutcome> => {
      const [updated] = await db
        .update(userFacts)
        .set({
          fact: input.fact,
          // A correction can change the normalised key too — the row moves with its text.
          factKey,
          muscleGroup: input.muscleGroup ?? null,
          confirmations: row.confirmations + 1,
          context: input.context ?? row.context,
          ...lifecycleValues,
          updatedAt: now,
        })
        .where(eq(userFacts.id, row.id))
        .returning();
      return { outcome: 'updated', fact: toUserFact(updated) };
    };

    // Close-out finding 1: select-then-branch is not atomic — the partial
    // unique index is the only guard. If a concurrent writer wins the INSERT,
    // the loser's 23505 is caught, the row is re-read and the call falls
    // through to the same UPDATE path: the caller still gets a normal outcome,
    // never a raw DB error.
    const insertOr = async (values: typeof userFacts.$inferInsert): Promise<RememberFactOutcome | null> => {
      try {
        const [row] = await db.insert(userFacts).values(values).returning();
        return { outcome: 'created', fact: toUserFact(row) };
      } catch (err) {
        if (!isUniqueViolation(err)) {
          throw err;
        }
        return null; // lost the race — the caller re-reads and updates
      }
    };

    if (existing === null) {
      const created = await insertOr({
        userId,
        category: input.category,
        fact: input.fact,
        factKey,
        muscleGroup: input.muscleGroup ?? null,
        confirmations: 1,
        // A genuinely new statement replacing a KNOWN closed fact keeps the link (AC-FL-3).
        supersedesId: input.supersedesFactId ?? null,
        context: input.context ?? null,
        sourceTurnId: sourceTurnId ?? null,
        ...lifecycleValues,
        createdAt: now,
        updatedAt: now,
      });
      if (created !== null) {
        return created;
      }
      const raced = (await this.rowsForKey(userId, input.category, factKey)).find(row => row.status === 'active');
      if (raced === undefined) {
        throw new Error('unique violation on user_facts insert, but no active row found on re-read');
      }
      return updateInPlace(raced);
    }

    // A genuinely new statement re-opening a CLOSED key creates a NEW row linked
    // via supersedes_id (AC-FL-3, review finding 1): the closed row keeps its
    // archive — wave B's recurrence promotion counts exactly that evidence — and
    // the partial unique index (active rows only) leaves room for both.
    if (existing.status === 'archived') {
      const created = await insertOr({
        userId,
        category: input.category,
        fact: input.fact,
        factKey,
        muscleGroup: input.muscleGroup ?? null,
        confirmations: 1,
        supersedesId: input.supersedesFactId ?? existing.id,
        context: input.context ?? null,
        sourceTurnId: sourceTurnId ?? null,
        ...lifecycleValues,
        createdAt: now,
        updatedAt: now,
      });
      if (created !== null) {
        return created;
      }
      const raced = (await this.rowsForKey(userId, input.category, factKey)).find(row => row.status === 'active');
      if (raced === undefined) {
        throw new Error('unique violation on user_facts insert, but no active row found on re-read');
      }
      return updateInPlace(raced);
    }

    return updateInPlace(existing);
  }

  async retractFact(
    userId: string,
    input: { factId: string; evidenceAt?: Date; reason?: string },
    now: Date,
  ): Promise<UserFact | null> {
    const [existingRow] = await db
      .select()
      .from(userFacts)
      .where(and(eq(userFacts.id, input.factId), eq(userFacts.userId, userId)));
    if (existingRow === undefined) {
      return null;
    }
    const existing = toUserFact(existingRow);
    if (existing.status === 'archived') {
      // Idempotent: the first closure is kept, never re-stamped.
      return existing;
    }
    // AC-FL-3/AC-FL-4: the closure is stamped WHEN THE RETRACTION WAS STATED —
    // the episode clock on the summariser path, `now` in live conversation —
    // so the stale-evidence guard compares against the right moment. `now`
    // stays the clock for updatedAt.
    const closureAt = input.evidenceAt ?? now;
    const [row] = await db
      .update(userFacts)
      .set({
        status: 'archived',
        archivedAt: now,
        archivedReason: 'user_closed',
        closedByUserAt: closureAt,
        // The summariser's rationale is "how we learned this" — the retraction.
        ...(input.reason != null ? { context: input.reason } : {}),
        updatedAt: now,
      })
      .where(eq(userFacts.id, existing.id))
      .returning();
    return toUserFact(row);
  }

  async confirmFact(userId: string, factId: string, now: Date): Promise<boolean> {
    const rows = await db
      .update(userFacts)
      .set({ confirmations: sql`${userFacts.confirmations} + 1`, updatedAt: now })
      // D-C: only the counter and timestamp move — the text is never rewritten.
      // Active rows only: a closed fact is never confirmed back to life.
      .where(and(eq(userFacts.id, factId), eq(userFacts.userId, userId), eq(userFacts.status, 'active')))
      .returning({ id: userFacts.id });
    return rows.length > 0;
  }

  async supersedeFact(
    userId: string,
    input: SupersedeFactInput,
    evidenceAt: Date,
    now: Date,
    sourceTurnId?: string,
  ): Promise<RememberFactOutcome | null> {
    const [existingRow] = await db
      .select()
      .from(userFacts)
      .where(and(eq(userFacts.id, input.factId), eq(userFacts.userId, userId)));
    if (existingRow === undefined) {
      return null;
    }
    const existing = toUserFact(existingRow);

    // A user-closed fact is never re-added (AC-FL-3): superseding it from an
    // episode no newer than the closure is stale evidence — skip.
    if (existing.status === 'archived') {
      const closureAt = closureMoment(existing);
      if (closureAt !== null && evidenceAt.getTime() <= closureAt.getTime()) {
        return { outcome: 'skipped_stale_evidence', fact: existing };
      }
    }

    const lifecycle = resolveLifecycle(input, now, {
      explicit: input.explicitPermanent,
      confirmations: 1, // a superseding statement starts its own history
    });

    // The old row is archived with its text and history intact — only its
    // status/reason move; the new row below carries the corrected statement.
    await db
      .update(userFacts)
      .set({
        status: 'archived',
        archivedAt: now,
        archivedReason: 'superseded',
        updatedAt: now,
      })
      .where(eq(userFacts.id, existing.id));

    const factKey = computeFactKey(input.fact);
    const [newRow] = await db
      .insert(userFacts)
      .values({
        userId,
        category: input.category,
        fact: input.fact,
        factKey,
        muscleGroup: input.muscleGroup ?? null,
        confirmations: 1,
        supersedesId: existing.id,
        context: input.context ?? null,
        sourceTurnId: sourceTurnId ?? null,
        durability: lifecycle.durability,
        expiresAt: lifecycle.expiresAt,
        reviewAfter: lifecycle.reviewAfter,
        onExpiry: lifecycle.onExpiry,
        phaseNote: input.phaseNote ?? null,
        phaseAt: input.phaseNote != null ? now : null,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    return { outcome: 'created', fact: toUserFact(newRow) };
  }

  async deleteFact(userId: string, factId: string): Promise<boolean> {
    const rows = await db
      .delete(userFacts)
      .where(and(eq(userFacts.id, factId), eq(userFacts.userId, userId)))
      .returning({ id: userFacts.id });
    return rows.length > 0;
  }

  async listFacts(userId: string, includeArchived: boolean, now: Date): Promise<FactsListing> {
    const rows = await db
      .select()
      .from(userFacts)
      .where(eq(userFacts.userId, userId))
      .orderBy(asc(userFacts.category), desc(userFacts.createdAt));
    const facts = rows.map(toUserFact);
    return {
      active: facts.filter(fact => isActiveForPrompt(fact, now)),
      archived: includeArchived ? facts.filter(fact => fact.status === 'archived') : [],
    };
  }
}
