import { and, eq, isNull } from 'drizzle-orm';

import type {
  ILoadRecommendationRepository,
  LoadRecommendationOutcome,
  NewLoadRecommendation,
} from '@domain/training/ports';

import { db } from '@infra/db/drizzle';
import { loadRecommendations } from '@infra/db/schema';

export class LoadRecommendationRepository implements ILoadRecommendationRepository {
  async insertFirstWorkingSet(row: NewLoadRecommendation): Promise<void> {
    await db
      .insert(loadRecommendations)
      .values({
        userId: row.userId,
        sessionId: row.sessionId,
        sessionExerciseId: row.sessionExerciseId,
        exerciseId: row.exerciseId,
        runId: row.runId,
        schemeId: row.schemeId,
        schemeVersion: row.schemeVersion,
        stage: row.stage,
        row: row.row,
        candidate: row.candidate ?? null,
        conservative: row.conservative ?? null,
        confidence: row.confidence,
        fatigue: row.fatigue ?? null,
        gapTier: row.gapTier,
        rendered: row.rendered,
        advised: row.advised,
      })
      .onConflictDoNothing({ target: loadRecommendations.sessionExerciseId });
  }

  async recordOutcome(sessionExerciseId: string, outcome: LoadRecommendationOutcome, completedAt: Date): Promise<void> {
    await db
      .update(loadRecommendations)
      .set({ outcome, completedAt })
      .where(
        and(eq(loadRecommendations.sessionExerciseId, sessionExerciseId), isNull(loadRecommendations.completedAt)),
      );
  }
}
