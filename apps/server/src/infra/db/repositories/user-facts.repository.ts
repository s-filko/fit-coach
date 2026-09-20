import { and, asc, desc, eq, gt, isNull, or, sql } from 'drizzle-orm';

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
import { isActiveForPrompt, resolveLifecycle } from '@domain/user/services/fact-lifecycle';

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
 * passed in as data, never the DB clock or a fresh `new Date()`).
 */
function visibleAt(now: Date) {
  return and(eq(userFacts.status, 'active'), or(isNull(userFacts.expiresAt), gt(userFacts.expiresAt, now)));
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

  async getConstraints(userId: string, now: Date): Promise<UserFact[]> {
    const rows = await db
      .select()
      .from(userFacts)
      .where(and(eq(userFacts.userId, userId), eq(userFacts.category, 'physical_constraint'), visibleAt(now)));
    return rows.filter(row => row.muscleGroup !== null).map(toUserFact);
  }

  async rememberFact(
    userId: string,
    input: RememberFactInput,
    now: Date,
    sourceTurnId?: string,
  ): Promise<RememberFactOutcome> {
    const factKey = computeFactKey(input.fact);
    // A correction references the row by id (the corrected text normalises to a
    // NEW key); without an id, the (userId, category, factKey) unique index is
    // the dedupe — a repeat of the same wording updates, not duplicates.
    // With the partial unique index the same key can carry one ACTIVE row plus
    // closed history — the key lookup prefers the active row (the dedupe/update
    // target) and falls back to the newest closed row (the closure check / link).
    const rows = input.factId
      ? (
          await db
            .select()
            .from(userFacts)
            .where(and(eq(userFacts.id, input.factId), eq(userFacts.userId, userId)))
        ).map(toUserFact)
      : (
          await db
            .select()
            .from(userFacts)
            .where(
              and(eq(userFacts.userId, userId), eq(userFacts.category, input.category), eq(userFacts.factKey, factKey)),
            )
            .orderBy(desc(userFacts.createdAt))
        ).map(toUserFact);
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
      const closureAt = existing.closedByUserAt ?? existing.archivedAt;
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

    if (existing === null) {
      const [row] = await db
        .insert(userFacts)
        .values({
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
        })
        .returning();
      return { outcome: 'created', fact: toUserFact(row) };
    }

    // A genuinely new statement re-opening a CLOSED key creates a NEW row linked
    // via supersedes_id (AC-FL-3, review finding 1): the closed row keeps its
    // archive — wave B's recurrence promotion counts exactly that evidence — and
    // the partial unique index (active rows only) leaves room for both.
    if (existing.status === 'archived') {
      const [row] = await db
        .insert(userFacts)
        .values({
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
        })
        .returning();
      return { outcome: 'created', fact: toUserFact(row) };
    }

    // An ACTIVE fact, corrected in place: a conversational correction REWRITES
    // the text (unlike the summariser's confirm-only upsert, D-C) and bumps the
    // counter.
    const [row] = await db
      .update(userFacts)
      .set({
        fact: input.fact,
        // A correction can change the normalised key too — the row moves with its text.
        factKey,
        muscleGroup: input.muscleGroup ?? null,
        confirmations: existing.confirmations + 1,
        context: input.context ?? existing.context,
        ...lifecycleValues,
        updatedAt: now,
      })
      .where(eq(userFacts.id, existing.id))
      .returning();
    return { outcome: 'updated', fact: toUserFact(row) };
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
      const closureAt = existing.closedByUserAt ?? existing.archivedAt;
      if (closureAt !== null && evidenceAt.getTime() <= closureAt.getTime()) {
        return { outcome: 'skipped_stale_evidence', fact: existing };
      }
    }

    const lifecycle = resolveLifecycle(input, now, {
      explicit: false,
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
