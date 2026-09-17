/**
 * Session-planning PhaseSpec (ADR-0013 §4.2) — moved verbatim from
 * session-planning.subgraph.ts (refactor-p3-phase-spec Task 1).
 */
import {
  SessionPlanningContextBuilder,
  type SessionPlanningContextData,
} from '@domain/training/services/session-planning-context.builder';

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
  buildSearchExercisesTool,
  buildSharedTools,
  buildStartTrainingSessionTool,
} from '@infra/ai/tools';

import { SEARCH_DEDUP_POLICY, type ToolPolicy } from '../tool-policy';

/** What the session_planning prompt renders beyond the directive base. */
export interface SessionPlanningData {
  context: SessionPlanningContextData;
}

/** The shared "search dedup" policy (see tool-policy.ts). */
export const SESSION_PLANNING_TOOL_POLICY: ToolPolicy = SEARCH_DEDUP_POLICY;

export function buildSessionPlanningSpec(deps: ConversationGraphDeps): PhaseSpec<SessionPlanningData> {
  const { userService, exerciseRepository, embeddingService, trainingService } = deps;
  const entry = PHASE_PROMPTS.session_planning;

  return {
    name: 'session_planning',
    prompt: entry as PhasePromptEntry<PromptContextFor<SessionPlanningData>>,
    tools: [
      buildSearchExercisesTool({ embeddingService, exerciseRepository }),
      buildStartTrainingSessionTool({
        trainingService,
        workoutPlanRepository: deps.workoutPlanRepo,
        exerciseRepository,
      }),
      buildRequestTransitionTool('session_planning'),
      ...buildSharedTools({ userService }),
    ],
    toolPolicy: SESSION_PLANNING_TOOL_POLICY,
    loadContext: async (input: LoadInput, deps: ConversationGraphDeps) => ({
      ok: true as const,
      data: {
        context: await new SessionPlanningContextBuilder(deps.workoutPlanRepo, deps.workoutSessionRepo).buildContext(
          input.userId,
        ),
      },
    }),
    modelProfile: 'default',
  };
}
