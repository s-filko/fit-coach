/**
 * Chat PhaseSpec (ADR-0013 §4.2) — moved verbatim from chat.subgraph.ts
 * (refactor-p3-phase-spec Task 1).
 */
import type { WorkoutSessionWithDetails } from '@domain/training/types';

import type {
  ConversationGraphDeps,
  LoadInput,
  PhasePromptEntry,
  PhaseSpec,
  PromptContextFor,
} from '@infra/ai/graph/phase-spec';
import { PHASE_PROMPTS } from '@infra/ai/prompts';
import { buildRequestTransitionTool, buildSharedTools, buildUpdateProfileTool } from '@infra/ai/tools';

import { NO_POLICY, type ToolPolicy } from '../tool-policy';

/** What the chat prompt renders beyond the directive base. */
export interface ChatData {
  hasActivePlan: boolean;
  recentSessions: WorkoutSessionWithDetails[];
}

export const CHAT_TOOL_POLICY: ToolPolicy = NO_POLICY;

export function buildChatSpec(deps: ConversationGraphDeps): PhaseSpec<ChatData> {
  const { userService } = deps;
  const entry = PHASE_PROMPTS.chat;

  return {
    name: 'chat',
    prompt: entry as PhasePromptEntry<PromptContextFor<ChatData>>,
    tools: [
      buildUpdateProfileTool({ userService }),
      buildRequestTransitionTool('chat'),
      ...buildSharedTools({ userService }),
    ],
    toolPolicy: CHAT_TOOL_POLICY,
    // ADR-0013 §3.4 table values (D-D — data; P4 reads only `history`).
    budget: { system: 3000, longTerm: 1500, domain: 2000, history: 8000, outputReserve: 2000 },
    loadContext: async (input: LoadInput, deps: ConversationGraphDeps) => {
      const [activePlan, recentSessions] = await Promise.all([
        deps.workoutPlanRepo.findActiveByUserId(input.userId),
        deps.workoutSessionRepo.findRecentByUserIdWithDetails(input.userId, 5),
      ]);
      return {
        ok: true as const,
        data: { hasActivePlan: !!activePlan, recentSessions },
      };
    },
    modelProfile: 'default',
  };
}
