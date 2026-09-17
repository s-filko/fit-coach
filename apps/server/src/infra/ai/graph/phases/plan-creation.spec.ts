/**
 * Plan-creation PhaseSpec (ADR-0013 §4.2) — moved verbatim from
 * plan-creation.subgraph.ts (refactor-p3-phase-spec Task 1).
 */
import type {
  ConversationGraphDeps,
  LoadInput,
  PhasePromptEntry,
  PhaseSpec,
  PromptContextFor,
} from '@infra/ai/graph/phase-spec';
import { PHASE_PROMPTS } from '@infra/ai/prompts';
import {
  buildRequestTransitionTool,
  buildSaveWorkoutPlanTool,
  buildSearchExercisesTool,
  buildSharedTools,
} from '@infra/ai/tools';

import { SEARCH_DEDUP_POLICY, type ToolPolicy } from '../tool-policy';

/** What the plan_creation prompt renders beyond the directive base: nothing. */
export type PlanCreationData = object;

/** search_exercises dedup runs once per identical args in a batch (was buildDedupToolNode). */
export const PLAN_CREATION_TOOL_POLICY: ToolPolicy = SEARCH_DEDUP_POLICY;

export function buildPlanCreationSpec(deps: ConversationGraphDeps): PhaseSpec<PlanCreationData> {
  const { userService, exerciseRepository, embeddingService } = deps;
  const { entry, layout } = PHASE_PROMPTS.plan_creation;

  return {
    name: 'plan_creation',
    prompt: entry as PhasePromptEntry<PromptContextFor<PlanCreationData>>,
    layout,
    tools: [
      buildSearchExercisesTool({ embeddingService, exerciseRepository }),
      buildSaveWorkoutPlanTool({ workoutPlanRepository: deps.workoutPlanRepo, exerciseRepository }),
      buildRequestTransitionTool('plan_creation'),
      ...buildSharedTools({ userService }),
    ],
    toolPolicy: PLAN_CREATION_TOOL_POLICY,
    loadContext: async (_input: LoadInput, _deps: ConversationGraphDeps) => ({
      ok: true as const,
      data: {},
    }),
    modelProfile: 'default',
  };
}
