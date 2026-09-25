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
  type ContextBlock,
  SESSION_PLANNING_ACTIVE_PLAN_V1,
  SESSION_PLANNING_CLIENT_PROFILE_V1,
  SESSION_PLANNING_RECENT_HISTORY_V1,
  SESSION_PLANNING_RECOVERY_TIMELINE_V1,
} from '@infra/ai/prompts/blocks';
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

/**
 * The recent-history and recovery-timeline blocks are declared against
 * `{ recentSessions }` (D-B, reused by a future muscle-centric block too);
 * session_planning's loaded data nests them under `context`. Adapters keep
 * the block files phase-shape-agnostic.
 */
const RECENT_HISTORY_BLOCK: ContextBlock<SessionPlanningData> = {
  ...SESSION_PLANNING_RECENT_HISTORY_V1,
  render: (data, ctx, depth) =>
    SESSION_PLANNING_RECENT_HISTORY_V1.render({ recentSessions: data.context.recentSessions }, ctx, depth),
};

const RECOVERY_TIMELINE_BLOCK: ContextBlock<SessionPlanningData> = {
  ...SESSION_PLANNING_RECOVERY_TIMELINE_V1,
  render: (data, ctx, depth) =>
    SESSION_PLANNING_RECOVERY_TIMELINE_V1.render({ recentSessions: data.context.recentSessions }, ctx, depth),
};

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
        userFactsService: deps.userFacts,
        transitionHandoffTargets: deps.transitionHandoffTargets,
      }),
      buildRequestTransitionTool('session_planning'),
      ...buildSharedTools({ userService, userFacts: deps.userFacts }),
    ],
    toolPolicy: SESSION_PLANNING_TOOL_POLICY,
    // ADR-0013 §3.4 table values (D-D — data; P4 reads only `history`).
    budget: { system: 5000, longTerm: 1500, domain: 6000, history: 8000, outputReserve: 3000 },
    loadContext: async (input: LoadInput, deps: ConversationGraphDeps) => ({
      ok: true as const,
      data: {
        context: await new SessionPlanningContextBuilder(deps.workoutPlanRepo, deps.workoutSessionRepo).buildContext(
          input.userId,
        ),
      },
    }),
    // D-B: v1's `client_profile`, `active_plan`, `recent_history`, `recovery_timeline` sections.
    contextBlocks: [
      SESSION_PLANNING_CLIENT_PROFILE_V1,
      SESSION_PLANNING_ACTIVE_PLAN_V1,
      RECENT_HISTORY_BLOCK,
      RECOVERY_TIMELINE_BLOCK,
    ],
    modelProfile: 'default',
  };
}
