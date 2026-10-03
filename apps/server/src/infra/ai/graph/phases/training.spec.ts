/**
 * Training PhaseSpec (ADR-0013 §4.2). The policy keeps the ADR-0011 protections: priority ordering, log_set batch
 * dedup, error budget 1. Since coach-simplification I1 (AC-CS1-2) the phase runs on `TRAINING_COACH` and the two
 * fact blocks `# Today` / `# History`, remembers this workout only (`memory: 'workout'`) and has no decision engine:
 * `get_load_plan` is unbound, the loader reads each exercise's last performances and the client's facts.
 */
import type { StructuredToolInterface } from '@langchain/core/tools';

// set-kind plan Task 2 (D7): the plan-id guard moved into the domain (plan-exercise-id.ts) so
// TrainingService's finish reconciliation reuses this one copy — a bad legacy `session_plan_json`
// row never reaches a DB query (close-out review advisory 6).
import { isValidExerciseId } from '@domain/training/plan-exercise-id';
import type { WorkoutSessionWithDetails } from '@domain/training/types';
import type { UserFact } from '@domain/user/ports';

import type {
  ConversationGraphDeps,
  LoadInput,
  LoadResult,
  PhasePromptEntry,
  PhaseSpec,
  PromptContextFor,
} from '@infra/ai/graph/phase-spec';
import { type ExerciseHistory, TRAINING_HISTORY_V1, TRAINING_TODAY_V1 } from '@infra/ai/prompts/blocks';
import { TRAINING_PROMPT } from '@infra/ai/prompts/phases/training';
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

import { type ToolPolicy, TRAINING_TOOL_PRIORITY } from '../tool-policy';

/** How many earlier performances of an exercise the History block shows. */
const PERFORMANCES_PER_EXERCISE = 3;

/**
 * What the training turn renders: today's session, per-exercise history (one entry per plan exercise — also the
 * not-started ones, the Today block takes their names from it), the previous real workout and the client's facts
 * for the system message's `# Profile`.
 */
export interface TrainingData {
  session: WorkoutSessionWithDetails;
  history: ExerciseHistory[];
  lastWorkout: { completedAt: Date; exerciseNames: string[] } | null;
  profileFacts: UserFact[];
}

/**
 * The ADR-0011 policy over the phase's toolset. Prompt-caching plan D4: no availability filter any more — the
 * tool list is part of the cached request prefix, so every training tool is always bound; the BUG-008 Plan A rule
 * (no delete/update before the current exercise has a set) is enforced by the tools themselves
 * (`rejectWithoutLoggedSet`, tools/set-preconditions.ts) and comes back as an `llm_error`.
 */
export function buildTrainingToolPolicy(_tools: StructuredToolInterface[]): ToolPolicy {
  return {
    ordering: TRAINING_TOOL_PRIORITY,
    batchDedup: ['log_set'],
    llmErrorBudget: 1,
  };
}

export function buildTrainingSpec(deps: ConversationGraphDeps): PhaseSpec<TrainingData> {
  const { userService, trainingService, exerciseRepository, embeddingService, workoutSessionRepo } = deps;
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
    prompt: TRAINING_PROMPT as PhasePromptEntry<PromptContextFor<TrainingData>>,
    tools,
    toolPolicy: buildTrainingToolPolicy(tools),
    // ADR-0013 §3.4 table values (D-D — data; P4 reads only `history`). History 16 000 (I1 § 7 Q2): summaries
    // are not rendered in training any more, so a mid-workout budget compaction must not hide early turns.
    budget: { system: 5000, longTerm: 1500, domain: 6000, history: 16000, outputReserve: 2000 },
    memory: 'workout',
    loadContext: async (input: LoadInput, deps: ConversationGraphDeps): Promise<LoadResult<TrainingData>> => {
      if (!input.activeSessionId) {
        return { ok: false, reply: 'training_no_active_session' };
      }
      const session = await deps.trainingService.getSessionDetails(input.activeSessionId);
      if (!session) {
        return { ok: false, reply: 'training_session_not_found' };
      }

      const plan = session.sessionPlanJson;

      // Today's exercises: plan order first, then off-plan exercises the user actually started — an exercise that
      // is only planned still gets its history. A bad legacy plan row is filtered out here, before it reaches a DB
      // query.
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
      // The catalog name is the truth for an id (D19): a plan's exerciseName can disagree with its exerciseId
      // (live 2026-09-25: "Treadmill" carrying Rowing Machine's id).
      const startedById = new Map(session.exercises.map(ex => [ex.exerciseId, ex]));
      for (const ex of session.exercises) {
        nameById.set(ex.exerciseId, ex.exercise.name);
      }
      const notStartedPlanIds = planExerciseIds.filter(id => !startedById.has(id));
      if (notStartedPlanIds.length > 0) {
        for (const ex of await deps.exerciseRepository.findByIdsWithMuscles(notStartedPlanIds)) {
          if (ex.name) {
            nameById.set(ex.id, ex.name);
          }
        }
      }
      const plannedTextById = new Map(validPlanExercises.map(p => [p.exerciseId, `${p.targetSets}×${p.targetReps}`]));

      const [performancesById, skips, recent, profileFacts] = await Promise.all([
        Promise.all(
          todayExerciseIds.map(id =>
            deps.workoutSessionRepo.findRecentPerformancesForExercise(
              input.userId,
              id,
              session.id,
              PERFORMANCES_PER_EXERCISE,
            ),
          ),
        ),
        todayExerciseIds.length > 0
          ? deps.workoutSessionRepo.findLastSkipsByExercise(input.userId, todayExerciseIds, session.id)
          : Promise.resolve([]),
        deps.workoutSessionRepo.findRecentByUserIdWithDetails(input.userId, 2, { realWorkoutsOnly: true }),
        deps.userFacts.getForPrompt(input.userId, input.now ?? new Date()),
      ]);
      const skipById = new Map(skips.map(sk => [sk.exerciseId, sk.skippedAt]));

      const history: ExerciseHistory[] = todayExerciseIds.map((exerciseId, i) => ({
        exerciseId,
        exerciseName: nameById.get(exerciseId) ?? 'Exercise',
        plannedText: plannedTextById.get(exerciseId) ?? null,
        performances: performancesById[i] ?? [],
        lastSkippedAt: skipById.get(exerciseId) ?? null,
      }));

      const previous = recent.find(s => s.id !== session.id && s.completedAt != null);
      const lastWorkout = previous?.completedAt
        ? { completedAt: previous.completedAt, exerciseNames: previous.exercises.map(ex => ex.exercise.name) }
        : null;

      return { ok: true, data: { session, history, lastWorkout, profileFacts } };
    },
    contextBlocks: [TRAINING_TODAY_V1, TRAINING_HISTORY_V1],
    modelProfile: 'default',
  };
}
