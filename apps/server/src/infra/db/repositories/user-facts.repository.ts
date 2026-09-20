import { and, asc, desc, eq, gt, isNull, or, sql } from 'drizzle-orm';

import type { FactCategory, IUserFactsService, UpsertFactInput, UserFact } from '@domain/user/ports';
import { computeFactKey } from '@domain/user/services/fact-key';

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
}
