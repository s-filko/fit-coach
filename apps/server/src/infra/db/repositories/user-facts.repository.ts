import { and, asc, desc, eq, gt, isNull, or, sql } from 'drizzle-orm';

import type {
  FactCategory,
  FactsListing,
  IUserFactsService,
  RememberFactInput,
  RememberFactOutcome,
  UpsertFactInput,
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
  async upsertMany(userId: string, facts: UpsertFactInput[], sourceTurnId?: string): Promise<number> {
    let count = 0;
    for (const input of facts) {
      const factKey = computeFactKey(input.fact);
      await db
        .insert(userFacts)
        .values({
          userId,
          category: input.category,
          fact: input.fact,
          factKey,
          muscleGroup: input.muscleGroup ?? null,
          sourceTurnId: sourceTurnId ?? null,
        })
        .onConflictDoUpdate({
          target: [userFacts.userId, userFacts.category, userFacts.factKey],
          // D-C: the stored `fact` text is never rewritten — only the counter and
          // timestamp move on a repeat.
          set: {
            confirmations: sql`${userFacts.confirmations} + 1`,
            updatedAt: sql`now()`,
          },
        });
      count += 1;
    }
    return count;
  }

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

  async rememberFact(userId: string, input: RememberFactInput, now: Date): Promise<RememberFactOutcome> {
    const factKey = computeFactKey(input.fact);
    // A correction references the row by id (the corrected text normalises to a
    // NEW key); without an id, the (userId, category, factKey) unique index is
    // the dedupe — a repeat of the same wording updates, not duplicates.
    const [existingRow] = input.factId
      ? await db
          .select()
          .from(userFacts)
          .where(and(eq(userFacts.id, input.factId), eq(userFacts.userId, userId)))
      : await db
          .select()
          .from(userFacts)
          .where(
            and(eq(userFacts.userId, userId), eq(userFacts.category, input.category), eq(userFacts.factKey, factKey)),
          );
    const existing = existingRow === undefined ? null : toUserFact(existingRow);

    // Code owns the bounds (fact-lifecycle plan): clamping per class, and the
    // `permanent` gate — the existing counter is the fact's confirmation history.
    const lifecycle = resolveLifecycle(input, now, {
      explicit: input.explicitPermanent,
      confirmations: existing?.confirmations ?? 0,
    });

    // AC-FL-3: the user's word wins — a closed fact key is only re-created from
    // evidence NEWER than the closure. The comparison uses the passed `now`
    // (the run clock / the evidence timestamp), never the DB clock.
    if (
      existing?.status === 'archived' &&
      existing.closedByUserAt !== null &&
      now.getTime() <= existing.closedByUserAt.getTime()
    ) {
      return { outcome: 'skipped_stale_evidence', fact: existing };
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
          // A genuinely new statement replacing a closed fact keeps the link (AC-FL-3).
          supersedesId: input.supersedesFactId ?? null,
          context: input.context ?? null,
          ...lifecycleValues,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      return { outcome: 'created', fact: toUserFact(row) };
    }

    // A conversational correction REWRITES the text (unlike the summariser's
    // confirm-only upsert, D-C) and bumps the counter.
    const [row] = await db
      .update(userFacts)
      .set({
        fact: input.fact,
        // A correction can change the normalised key too — the row moves with its text.
        factKey,
        muscleGroup: input.muscleGroup ?? null,
        confirmations: existing.confirmations + 1,
        context: input.context ?? existing.context,
        ...(existing.status === 'archived'
          ? // Reactivation: back to active, the user's closure cleared.
            { status: 'active' as const, archivedAt: null, archivedReason: null, closedByUserAt: null }
          : {}),
        ...lifecycleValues,
        updatedAt: now,
      })
      .where(eq(userFacts.id, existing.id))
      .returning();
    return {
      outcome: existing.status === 'archived' ? 'reactivated' : 'updated',
      fact: toUserFact(row),
    };
  }

  async retractFact(userId: string, input: { factId: string }, now: Date): Promise<UserFact | null> {
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
    const [row] = await db
      .update(userFacts)
      .set({
        status: 'archived',
        archivedAt: now,
        archivedReason: 'user_closed',
        closedByUserAt: now,
        updatedAt: now,
      })
      .where(eq(userFacts.id, existing.id))
      .returning();
    return toUserFact(row);
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
