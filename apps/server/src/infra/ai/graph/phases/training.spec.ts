/**
 * Training PhaseSpec (ADR-0013 §4.2) — moved verbatim from
 * training.subgraph.ts (refactor-p3-phase-spec Task 1). The policy keeps the
 * ADR-0011 protections: priority ordering, log_set batch dedup, error budget
 * 1 and dynamic tool filtering (BUG-008 Plan A).
 */
import type { StructuredToolInterface } from '@langchain/core/tools';

import type { IWorkoutSessionRepository } from '@domain/training/ports';
import type { WorkoutSessionWithDetails } from '@domain/training/types';

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
  TRAINING_PREVIOUS_SESSION_V1,
  TRAINING_STALE_SESSION_V1,
  TRAINING_WORKOUT_OVERVIEW_V1,
} from '@infra/ai/prompts/blocks';
import {
  buildCompleteCurrentExerciseTool,
  buildDeleteLastSetsTool,
  buildFinishTrainingTool,
  buildLogSetTool,
  buildSearchExercisesTool,
  buildSharedTools,
  buildUpdateLastSetTool,
} from '@infra/ai/tools';

import { type AvailabilityInput, type ToolPolicy, TRAINING_TOOL_PRIORITY } from '../tool-policy';

/** What the training prompt renders beyond the directive base. */
export interface TrainingData {
  session: WorkoutSessionWithDetails;
  previousSession: WorkoutSessionWithDetails | null;
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
  const { userService, trainingService, exerciseRepository, embeddingService } = deps;
  const entry = PHASE_PROMPTS.training;
  const tools = [
    buildSearchExercisesTool({ embeddingService, exerciseRepository }),
    buildLogSetTool({ trainingService }),
    buildCompleteCurrentExerciseTool({ trainingService }),
    buildFinishTrainingTool({ trainingService }),
    buildDeleteLastSetsTool({ trainingService }),
    buildUpdateLastSetTool({ trainingService }),
    ...buildSharedTools({ userService }),
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
      const previousSession = session.sessionKey
        ? await (deps.workoutSessionRepo as IWorkoutSessionRepository).findLastCompletedByUserAndKey(
            input.userId,
            session.sessionKey,
          )
        : null;
      return { ok: true, data: { session, previousSession } };
    },
    // D-B: v1's `client`, `workout_overview`, `stale_session`, `previous_session` sections.
    contextBlocks: [
      TRAINING_CLIENT_V1,
      TRAINING_WORKOUT_OVERVIEW_V1,
      TRAINING_STALE_SESSION_V1,
      TRAINING_PREVIOUS_SESSION_V1,
    ],
    modelProfile: 'default',
  };
}
