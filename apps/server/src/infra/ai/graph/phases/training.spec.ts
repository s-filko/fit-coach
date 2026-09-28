/**
 * Training PhaseSpec (ADR-0013 §4.2) — moved verbatim from
 * training.subgraph.ts (refactor-p3-phase-spec Task 1). The policy keeps the
 * ADR-0011 protections: priority ordering, log_set batch dedup, error budget
 * 1 and dynamic tool filtering (BUG-008 Plan A).
 */
import type { StructuredToolInterface } from '@langchain/core/tools';

// set-kind plan Task 2 (D6): the ask-once window, named (close-out review advisory R1) — the
// threshold itself is applied by the block that renders the ask line, not the loader.
import { RECENT_PLACES_WINDOW } from '@domain/training/place';
// set-kind plan Task 2 (D7): the plan-id guard moved into the domain (plan-exercise-id.ts) so
// TrainingService's finish reconciliation reuses this one copy — a bad legacy `session_plan_json`
// row never reaches a DB query (close-out review advisory 6).
import { isValidExerciseId } from '@domain/training/plan-exercise-id';
import type { ExerciseWithMuscles, MuscleGroup, WorkoutSessionWithDetails } from '@domain/training/types';

import type {
  ConversationGraphDeps,
  LoadInput,
  LoadResult,
  PhasePromptEntry,
  PhaseSpec,
  PromptContextFor,
} from '@infra/ai/graph/phase-spec';
import { PHASE_PROMPTS } from '@infra/ai/prompts';
import {
  TRAINING_CLIENT_V1,
  TRAINING_EXERCISE_HISTORY_V1,
  TRAINING_RECENT_WORKOUTS_V1,
  TRAINING_STALE_SESSION_V1,
  TRAINING_WORKOUT_OVERVIEW_V1,
  type ExerciseHistoryEntry,
} from '@infra/ai/prompts/blocks';
import {
  buildCompleteCurrentExerciseTool,
  buildDeleteLastSetsTool,
  buildFinishTrainingTool,
  buildGetExerciseHistoryTool,
  buildLogSetTool,
  buildSearchExercisesTool,
  buildSetSessionPlaceTool,
  buildSharedTools,
  buildUpdateLastSetTool,
} from '@infra/ai/tools';

import { type AvailabilityInput, type ToolPolicy, TRAINING_TOOL_PRIORITY } from '../tool-policy';

/**
 * What the training prompt renders beyond the directive base (BUG-030 fix, training-exercise-
 * history plan D4): `exerciseHistory` replaces the single same-`session_key` `previousSession` —
 * one entry per today's exercise, anchored by exercise id (D2). `recentWorkouts` + `todayMuscles`
 * back the fatigue-context block (D3).
 */
export interface TrainingData {
  session: WorkoutSessionWithDetails;
  exerciseHistory: ExerciseHistoryEntry[];
  recentWorkouts: WorkoutSessionWithDetails[];
  todayMuscles: MuscleGroup[];
  /**
   * set-kind plan Task 2 (D6): distinct places among the last RECENT_PLACES_WINDOW real
   * workouts; 0 when today's session already states a place (short-circuits, never queries the
   * repository). The overview block renders its one-line ask once this crosses its threshold.
   */
  recentPlacesCount: number;
}

/** Mid-workout session shape the availability filter reads (BUG-008 Plan A). */
interface SessionLike {
  exercises?: Array<{ status?: string; sets?: unknown[] }>;
}

/**
 * The ADR-0011 policy over the phase's toolset. A function (not a constant)
 * because the availability filter derives the allowed names from the tools it
 * is given — same rule, whatever toolset the spec carries.
 */
export function buildTrainingToolPolicy(tools: StructuredToolInterface[]): ToolPolicy {
  return {
    ordering: TRAINING_TOOL_PRIORITY,
    batchDedup: ['log_set'],
    llmErrorBudget: 1,
    /**
     * Dynamic tool filtering (BUG-008 Plan A): names the model may call given
     * the loaded session; null = all. The policy owns the rule.
     */
    availability: (input: AvailabilityInput) => {
      const session = (input.data as TrainingData).session as SessionLike | null;
      const currentExercise = session?.exercises?.find(ex => ex.status === 'in_progress');
      const currentSetsCount = currentExercise?.sets?.length ?? 0;
      if (currentSetsCount !== 0) {
        return null;
      }
      return tools.filter(t => t.name !== 'delete_last_sets' && t.name !== 'update_last_set').map(t => t.name);
    },
  };
}

export function buildTrainingSpec(deps: ConversationGraphDeps): PhaseSpec<TrainingData> {
  const { userService, trainingService, exerciseRepository, embeddingService, workoutSessionRepo } = deps;
  const entry = PHASE_PROMPTS.training;
  const tools = [
    buildSearchExercisesTool({ embeddingService, exerciseRepository }),
    buildGetExerciseHistoryTool({ trainingService, exerciseRepository, workoutSessionRepo }),
    buildLogSetTool({ trainingService }),
    buildCompleteCurrentExerciseTool({ trainingService }),
    buildFinishTrainingTool({ trainingService }),
    // set-kind plan Task 2 (D6): "я сегодня в другом зале" — after the start.
    buildSetSessionPlaceTool({ trainingService }),
    buildDeleteLastSetsTool({ trainingService }),
    buildUpdateLastSetTool({ trainingService }),
    ...buildSharedTools({ userService, userFacts: deps.userFacts }),
  ];

  return {
    name: 'training',
    prompt: entry as PhasePromptEntry<PromptContextFor<TrainingData>>,
    tools,
    toolPolicy: buildTrainingToolPolicy(tools),
    // ADR-0013 §3.4 table values (D-D — data; P4 reads only `history`).
    budget: { system: 5000, longTerm: 1500, domain: 6000, history: 8000, outputReserve: 2000 },
    loadContext: async (input: LoadInput, deps: ConversationGraphDeps): Promise<LoadResult<TrainingData>> => {
      if (!input.activeSessionId) {
        return { ok: false, reply: 'training_no_active_session' };
      }
      const session = await deps.trainingService.getSessionDetails(input.activeSessionId);
      if (!session) {
        return { ok: false, reply: 'training_session_not_found' };
      }

      const plan = session.sessionPlanJson;
      const startedById = new Map(session.exercises.map(ex => [ex.exerciseId, ex]));

      // Today's exercises (BUG-030 D2/step 3): plan order first, then off-plan exercises the user
      // actually started — an exercise that is only planned still gets its history (AC-EH-2). A
      // bad legacy plan row is filtered out here, before it reaches planExerciseIds/nameById or
      // any DB query.
      const validPlanExercises = (plan?.exercises ?? []).filter(p => isValidExerciseId(p.exerciseId));
      const planExerciseIds = validPlanExercises.map(p => p.exerciseId);
      const offPlanStartedIds = session.exercises
        .filter(ex => !planExerciseIds.includes(ex.exerciseId))
        .map(ex => ex.exerciseId);
      const todayExerciseIds = [...new Set([...planExerciseIds, ...offPlanStartedIds])];

      const nameById = new Map<string, string>();
      for (const p of validPlanExercises) {
        nameById.set(p.exerciseId, p.exerciseName ?? 'Exercise');
      }
      for (const ex of session.exercises) {
        nameById.set(ex.exerciseId, ex.exercise.name);
      }

      // Muscle groups for TODAY'S MUSCLES (fatigue overlap, D3): started exercises already carry
      // them (findByIdWithDetails); not-started plan exercises need their own lookup.
      const notStartedPlanIds = planExerciseIds.filter(id => !startedById.has(id));
      const notStartedMuscles: ExerciseWithMuscles[] =
        notStartedPlanIds.length > 0 ? await deps.exerciseRepository.findByIdsWithMuscles(notStartedPlanIds) : [];

      const todayMuscleSet = new Set<MuscleGroup>();
      for (const ex of session.exercises) {
        for (const mg of ex.exercise.muscleGroups ?? []) {
          todayMuscleSet.add(mg.muscleGroup);
        }
      }
      for (const ex of notStartedMuscles) {
        // The catalog name is the truth for an id (D19): a plan's exerciseName can disagree with its
        // exerciseId (live 2026-09-25: "Treadmill" carrying Rowing Machine's id).
        if (ex.name) {
          nameById.set(ex.id, ex.name);
        }
        for (const mg of ex.muscleGroups ?? []) {
          todayMuscleSet.add(mg.muscleGroup);
        }
      }

      // Exercise history (D2): last real performance per today's exercise, anchored by exercise
      // id — not by session_key.
      const performances =
        todayExerciseIds.length > 0
          ? await deps.workoutSessionRepo.findLastPerformancesByExercise(input.userId, todayExerciseIds, session.id)
          : [];
      const performanceById = new Map(performances.map(p => [p.exerciseId, p]));
      // set-kind plan Task 2 (D7): the newest skip per today's exercise — the history block's
      // `skipped <date>` line. Not a performance (no sets), so it never feeds the anchor above.
      const skips =
        todayExerciseIds.length > 0
          ? await deps.workoutSessionRepo.findLastSkipsByExercise(input.userId, todayExerciseIds, session.id)
          : [];
      const skipById = new Map(skips.map(sk => [sk.exerciseId, sk.skippedAt]));
      const exerciseHistory: ExerciseHistoryEntry[] = todayExerciseIds.map(exerciseId => {
        const performance = performanceById.get(exerciseId);
        return {
          exerciseId,
          exerciseName: nameById.get(exerciseId) ?? 'Exercise',
          performance: performance?.sessionExercise ?? null,
          completedAt: performance?.completedAt ?? null,
          lastSkippedAt: skipById.get(exerciseId) ?? null,
        };
      });

      // set-kind plan Task 2 (D6): the distinct places among the user's last RECENT_PLACES_WINDOW
      // real workouts, so the overview block can decide whether to ask (D6, once per session).
      // `session.place` short-circuits the ternary — a stated place never reaches the repository
      // (B3, close-out review).
      const recentPlacesCount = session.place
        ? 0
        : (await deps.workoutSessionRepo.distinctRecentPlaces(input.userId, RECENT_PLACES_WINDOW)).length;

      // Fatigue window (D3): up to 7 recent real workouts; the block applies the 7-day cut
      // against ctx.now (the loader never reads the clock). Today's own session is excluded.
      const recentWorkoutsRaw = await deps.workoutSessionRepo.findRecentByUserIdWithDetails(input.userId, 7, {
        realWorkoutsOnly: true,
      });
      const recentWorkouts = recentWorkoutsRaw.filter(s => s.id !== session.id);

      return {
        ok: true,
        data: { session, exerciseHistory, recentWorkouts, todayMuscles: [...todayMuscleSet], recentPlacesCount },
      };
    },
    // D-B/D4: v1's `client`, `workout_overview`, `stale_session` sections, plus `exercise_history`
    // and `recent_workouts` (BUG-030 fix) in place of the old same-key `previous_session`.
    contextBlocks: [
      TRAINING_CLIENT_V1,
      TRAINING_WORKOUT_OVERVIEW_V1,
      TRAINING_STALE_SESSION_V1,
      TRAINING_EXERCISE_HISTORY_V1,
      TRAINING_RECENT_WORKOUTS_V1,
    ],
    modelProfile: 'default',
  };
}
