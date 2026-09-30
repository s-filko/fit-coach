/**
 * load-plan plan Task 3 (D7): the recommendation log. The snapshot port renders today's v2 LOAD PLAN entry
 * and stores the decision behind its numbers (A3), through the shared loader, the one decision call
 * (`decideLoadPlanEntry`) and the v2 renderer — no second copy of any; the log composes it with the
 * repository and never throws — calibration data must not fail a logged set. The log exists only with
 * `LOAD_PLAN_SUGGESTION` on, so the snapshot is always v2.
 */
import { defaultProgression } from '@domain/training/load-plan';
import type {
  ILoadPlanSnapshotPort,
  ILoadRecommendationLog,
  ILoadRecommendationRepository,
  IWorkoutSessionRepository,
  LoadPlanSnapshot,
} from '@domain/training/ports';
import { workingSets } from '@domain/training/sets';
import type { UserRepository } from '@domain/user/ports';

import { renderLoadPlanEntryV2 } from '@infra/ai/prompts/blocks/training-load-plan.v2';
import { LoadRecommendationRepository } from '@infra/db/repositories/load-recommendation.repository';

import { createLogger } from '@shared/logger';

import { decideLoadPlanEntry } from './load-decision';
import { type LoadFactsLoaderDeps, loadLoadPlanEntries, planTargetRepsOf } from './load-facts.loader';

const log = createLogger('load-recommendation-log');

export interface LoadRecommendationLogDeps {
  workoutSessionRepo: LoadFactsLoaderDeps['workoutSessionRepo'] &
    Pick<IWorkoutSessionRepository, 'findByIdWithDetails'>;
  exerciseRepository: LoadFactsLoaderDeps['exerciseRepository'];
  userFacts: LoadFactsLoaderDeps['userFacts'];
  /** For the D8 default scheme (profile level + goal); absent = the profile-less default. */
  userRepository?: Pick<UserRepository, 'getById'>;
  /** LOAD_PLAN_BREAKS: the snapshot's decision also reads the return ladder and the break reason. */
  breaks?: boolean;
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
        breaks: this.deps.breaks === true,
      },
    );
    if (!entry) {
      return null;
    }
    const progression = defaultProgression(await this.deps.userRepository?.getById(input.userId));
    const decision = decideLoadPlanEntry(entry, { progression });
    return {
      rendered: renderLoadPlanEntryV2(
        entry,
        { now: input.now, timezone: input.timezone, user: null },
        { progression, decision },
      ),
      fatigue: entry.facts.fatigueToday,
      schemeId: decision?.scheme.id ?? null,
      schemeVersion: decision ? String(decision.scheme.version) : null,
      stage: decision?.stage ?? null,
      row: decision?.row ?? null,
      candidate: decision?.candidate ?? null,
      conservative: decision?.conservative ?? null,
      confidence: decision?.confidence ?? null,
      gapTier: decision?.gap.tier ?? null,
    };
  }
}

export class LoadRecommendationLog implements ILoadRecommendationLog {
  constructor(
    private snapshots: ILoadPlanSnapshotPort,
    private repository: ILoadRecommendationRepository,
    private sessions: Pick<IWorkoutSessionRepository, 'findByIdWithDetails'>,
  ) {}

  async prepare(
    input: Parameters<ILoadRecommendationLog['prepare']>[0],
  ): ReturnType<ILoadRecommendationLog['prepare']> {
    try {
      // D7 trigger: only the first working set of the exercise writes a row (warm-ups and legacy NULL kinds as in
      // `workingSets`). The reads are inside the guard — a failed read skips the log, never the set.
      const session = await this.sessions.findByIdWithDetails(input.sessionId);
      const exercise = session?.exercises.find(e => e.id === input.sessionExerciseId);
      if (!session || !exercise || workingSets(exercise.sets).length > 0) {
        return null;
      }
      const snap = await this.snapshots.snapshot({
        userId: session.userId,
        session,
        exerciseId: input.exerciseId,
        now: input.ctx.now,
        timezone: input.ctx.timezone,
      });
      if (!snap) {
        return null;
      }
      return {
        ...snap,
        userId: session.userId,
        sessionId: session.id,
        sessionExerciseId: input.sessionExerciseId,
        exerciseId: input.exerciseId,
        runId: input.ctx.runId,
        advised: input.ctx.advised ?? null,
      };
    } catch (err) {
      log.error({ err, sessionId: input.sessionId }, 'load recommendation snapshot failed');
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
  flags: { LOAD_PLAN_SUGGESTION: boolean; LOAD_PLAN_BREAKS?: boolean },
): ILoadRecommendationLog | undefined {
  if (!flags.LOAD_PLAN_SUGGESTION) {
    return undefined;
  }
  return new LoadRecommendationLog(
    new LoadPlanSnapshotPort({ ...deps, breaks: flags.LOAD_PLAN_BREAKS === true }),
    new LoadRecommendationRepository(),
    deps.workoutSessionRepo,
  );
}
