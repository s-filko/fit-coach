/**
 * load-plan plan Task 3 (D7): the recommendation log. The snapshot port renders today's v1 LOAD PLAN
 * entry through the shared loader and renderer (no second copy of either); the log composes it with the
 * repository and never throws — calibration data must not fail a logged set.
 */
import type {
  ILoadPlanSnapshotPort,
  ILoadRecommendationLog,
  ILoadRecommendationRepository,
  IWorkoutSessionRepository,
  LoadPlanSnapshot,
} from '@domain/training/ports';

import { renderLoadPlanEntry } from '@infra/ai/prompts/blocks/training-load-plan.v1';
import { LoadRecommendationRepository } from '@infra/db/repositories/load-recommendation.repository';

import { createLogger } from '@shared/logger';

import { type LoadFactsLoaderDeps, loadLoadPlanEntries, planTargetRepsOf } from './load-facts.loader';

const log = createLogger('load-recommendation-log');

export interface LoadRecommendationLogDeps {
  workoutSessionRepo: LoadFactsLoaderDeps['workoutSessionRepo'] &
    Pick<IWorkoutSessionRepository, 'findByIdWithDetails'>;
  exerciseRepository: LoadFactsLoaderDeps['exerciseRepository'];
  userFacts: LoadFactsLoaderDeps['userFacts'];
}

export class LoadPlanSnapshotPort implements ILoadPlanSnapshotPort {
  constructor(private deps: LoadRecommendationLogDeps) {}

  async snapshot(input: Parameters<ILoadPlanSnapshotPort['snapshot']>[0]): Promise<LoadPlanSnapshot | null> {
    const { workoutSessionRepo, exerciseRepository, userFacts } = this.deps;
    const [entry] = await loadLoadPlanEntries(
      {
        workoutSessionRepo,
        exerciseRepository,
        userFacts,
        trainingService: { getSessionDetails: id => workoutSessionRepo.findByIdWithDetails(id) },
      },
      {
        userId: input.userId,
        session: input.session,
        exerciseIds: [input.exerciseId],
        planTargetReps: planTargetRepsOf(input.session),
        now: input.now,
        timezone: input.timezone,
      },
    );
    if (!entry) {
      return null;
    }
    return {
      rendered: renderLoadPlanEntry(entry, { now: input.now, timezone: input.timezone, user: null }),
      fatigue: entry.facts.fatigueToday,
      // A3: the decision order (Task 2) fills these; until then they stay NULL.
      schemeId: null,
      schemeVersion: null,
      stage: null,
      row: null,
      candidate: null,
      conservative: null,
      confidence: null,
      gapTier: null,
    };
  }
}

export class LoadRecommendationLog implements ILoadRecommendationLog {
  constructor(
    private snapshots: ILoadPlanSnapshotPort,
    private repository: ILoadRecommendationRepository,
  ) {}

  async prepare(
    input: Parameters<ILoadRecommendationLog['prepare']>[0],
  ): ReturnType<ILoadRecommendationLog['prepare']> {
    try {
      const snap = await this.snapshots.snapshot({
        userId: input.userId,
        session: input.session,
        exerciseId: input.exerciseId,
        now: input.ctx.now,
        timezone: input.ctx.timezone,
      });
      if (!snap) {
        return null;
      }
      return {
        ...snap,
        userId: input.userId,
        sessionId: input.session.id,
        sessionExerciseId: input.sessionExerciseId,
        exerciseId: input.exerciseId,
        runId: input.ctx.runId,
        advised: input.ctx.advised ?? null,
      };
    } catch (err) {
      log.error({ err, sessionId: input.session.id }, 'load recommendation snapshot failed');
      return null;
    }
  }

  async commit(pending: Parameters<ILoadRecommendationLog['commit']>[0]): Promise<void> {
    try {
      await this.repository.insertFirstWorkingSet(pending);
    } catch (err) {
      log.error({ err, sessionExerciseId: pending.sessionExerciseId }, 'load recommendation insert failed');
    }
  }

  async recordOutcome(
    sessionExerciseId: string,
    outcome: Parameters<ILoadRecommendationLog['recordOutcome']>[1],
  ): Promise<void> {
    try {
      await this.repository.recordOutcome(sessionExerciseId, outcome, new Date());
    } catch (err) {
      log.error({ err, sessionExerciseId }, 'load recommendation outcome failed');
    }
  }
}

/** A5: the log exists only with `LOAD_PLAN_SUGGESTION` on; undefined = pre-plan behaviour exactly. */
export function buildLoadRecommendationLog(
  deps: LoadRecommendationLogDeps,
  flags: { LOAD_PLAN_SUGGESTION: boolean },
): ILoadRecommendationLog | undefined {
  if (!flags.LOAD_PLAN_SUGGESTION) {
    return undefined;
  }
  return new LoadRecommendationLog(new LoadPlanSnapshotPort(deps), new LoadRecommendationRepository());
}
