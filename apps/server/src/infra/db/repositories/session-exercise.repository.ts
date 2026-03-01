import { eq } from 'drizzle-orm';

import type { ISessionExerciseRepository } from '@domain/training/ports';
import type { CreateSessionExerciseDto, SessionExercise } from '@domain/training/types';

import { db } from '@infra/db/drizzle';
import { sessionExercises } from '@infra/db/schema';

export class SessionExerciseRepository implements ISessionExerciseRepository {
  async create(sessionId: string, exercise: CreateSessionExerciseDto): Promise<SessionExercise> {
    const [created] = await db
      .insert(sessionExercises)
      .values({
        sessionId,
        exerciseId: exercise.exerciseId,
        orderIndex: exercise.orderIndex,
        targetSets: exercise.targetSets ?? null,
        targetReps: exercise.targetReps ?? null,
        targetWeight: exercise.targetWeight?.toString() ?? null,
        status: 'pending',
      })
      .returning();

    return created;
  }

  async findById(exerciseId: string): Promise<SessionExercise | null> {
    const [exercise] = await db.select().from(sessionExercises).where(eq(sessionExercises.id, exerciseId));

    return exercise ?? null;
  }

  async findBySessionId(sessionId: string): Promise<SessionExercise[]> {
    return db
      .select()
      .from(sessionExercises)
      .where(eq(sessionExercises.sessionId, sessionId))
      .orderBy(sessionExercises.orderIndex);
  }

  async update(exerciseId: string, updates: Partial<SessionExercise>): Promise<SessionExercise> {
    const [updated] = await db
      .update(sessionExercises)
      .set(updates)
      .where(eq(sessionExercises.id, exerciseId))
      .returning();

    return updated;
  }
}
