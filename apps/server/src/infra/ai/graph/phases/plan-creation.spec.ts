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
import { PLAN_CREATION_CLIENT_PROFILE_V1 } from '@infra/ai/prompts/blocks';
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
  const entry = PHASE_PROMPTS.plan_creation;

  return {
    name: 'plan_creation',
    prompt: entry as PhasePromptEntry<PromptContextFor<PlanCreationData>>,
    tools: [
      buildSearchExercisesTool({ embeddingService, exerciseRepository }),
      buildSaveWorkoutPlanTool({
        workoutPlanRepository: deps.workoutPlanRepo,
        exerciseRepository,
        userFactsService: deps.userFacts,
      }),
      buildRequestTransitionTool('plan_creation'),
      ...buildSharedTools({ userService, userFacts: deps.userFacts }),
    ],
    toolPolicy: PLAN_CREATION_TOOL_POLICY,
    // ADR-0013 §3.4 table values (D-D — data; P4 reads only `history`).
    budget: { system: 4000, longTerm: 1500, domain: 2000, history: 12000, outputReserve: 4000 },
    loadContext: async (_input: LoadInput, _deps: ConversationGraphDeps) => ({
      ok: true as const,
      data: {},
    }),
    // D-B: the v1 `client_profile` section becomes this domain block (block 3).
    contextBlocks: [PLAN_CREATION_CLIENT_PROFILE_V1],
    modelProfile: 'default',
  };
}
