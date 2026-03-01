import { eq, sql } from 'drizzle-orm';

import type { ISessionSetRepository } from '@domain/training/ports';
import type { CreateSessionSetDto, SessionSet } from '@domain/training/types';

import { db } from '@infra/db/drizzle';
import { sessionSets } from '@infra/db/schema';

export class SessionSetRepository implements ISessionSetRepository {
  async create(exerciseId: string, set: CreateSessionSetDto): Promise<SessionSet> {
    // setNumber is computed atomically in the database to prevent race conditions
    // when multiple sets are logged in parallel (e.g. batch tool_calls from LLM).
    const [created] = await db
      .insert(sessionSets)
      .values({
        sessionExerciseId: exerciseId,
        setNumber: sql<number>`
          COALESCE(
            (SELECT MAX(set_number) FROM session_sets WHERE session_exercise_id = ${exerciseId}),
            0
          ) + 1
        `,
        setData: set.setData,
        rpe: set.rpe ?? null,
        userFeedback: set.userFeedback ?? null,
      })
      .returning();

    return {
      ...created,
      setData: created.setData as SessionSet['setData'],
    };
  }

  async findById(setId: string): Promise<SessionSet | null> {
    const [set] = await db.select().from(sessionSets).where(eq(sessionSets.id, setId));

    if (!set) {
      return null;
    }

    return {
      ...set,
      setData: set.setData as SessionSet['setData'],
    };
  }

  async findByExerciseId(exerciseId: string): Promise<SessionSet[]> {
    const sets = await db
      .select()
      .from(sessionSets)
      .where(eq(sessionSets.sessionExerciseId, exerciseId))
      .orderBy(sessionSets.setNumber);

    return sets.map(s => ({
      ...s,
      setData: s.setData as SessionSet['setData'],
    }));
  }

  async update(setId: string, updates: Partial<SessionSet>): Promise<SessionSet> {
    const [updated] = await db.update(sessionSets).set(updates).where(eq(sessionSets.id, setId)).returning();

    return {
      ...updated,
      setData: updated.setData as SessionSet['setData'],
    };
  }
}
