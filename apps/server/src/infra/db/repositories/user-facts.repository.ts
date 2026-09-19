import { and, asc, desc, eq, sql } from 'drizzle-orm';

import type { FactCategory, IUserFactsService, UpsertFactInput, UserFact } from '@domain/user/ports';

import { db } from '@infra/db/drizzle';
import { userFacts } from '@infra/db/schema';

/**
 * Normalises fact text into the D-C idempotency key: lowercase, trim, collapse
 * whitespace, strip terminal punctuation. Deterministic and testable without a model.
 */
export function computeFactKey(fact: string): string {
  return fact
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[.!?,;:]+$/, '');
}

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
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
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

  async getForPrompt(userId: string, cap = 50): Promise<UserFact[]> {
    const rows = await db
      .select()
      .from(userFacts)
      .where(eq(userFacts.userId, userId))
      .orderBy(asc(userFacts.category), desc(userFacts.createdAt))
      .limit(cap);
    return rows.map(toUserFact);
  }

  async getConstraints(userId: string): Promise<UserFact[]> {
    const rows = await db
      .select()
      .from(userFacts)
      .where(and(eq(userFacts.userId, userId), eq(userFacts.category, 'physical_constraint')));
    return rows.filter(row => row.muscleGroup !== null).map(toUserFact);
  }
}
