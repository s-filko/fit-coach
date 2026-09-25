/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { tool } from '@langchain/core/tools';
import { z } from 'zod';

import type { ConversationPhase } from '@domain/conversation/phases';
import { ok } from '@domain/conversation/tool-outcome';

/** The three phases that get a request_transition tool — one builder, three variants. */
export type RequestTransitionVariant = 'chat' | 'plan_creation' | 'session_planning';

const DESCRIPTIONS: Record<RequestTransitionVariant, string> = {
  chat: [
    'Request a phase transition to another part of the app.',
    'Use "plan_creation" when user wants to create or update their workout plan.',
    'Use "session_planning" when user wants to plan or start a workout session.',
    'Do NOT call this for casual fitness questions — just respond with text.',
  ].join(' '),
  plan_creation: [
    'Request a phase transition.',
    'Use "chat" if the user explicitly cancels plan creation and wants to go back to chat.',
  ].join(' '),
  session_planning: [
    'Request a phase transition.',
    'Use "chat" if the user explicitly cancels session planning and wants to go back to chat.',
  ].join(' '),
};

export function buildRequestTransitionTool(
  variant: RequestTransitionVariant,
  /**
   * transition-handoff plan Task 1 (D-5): only the chat variant's targets
   * (plan_creation, session_planning) can be hand-off targets in this plan —
   * the plan_creation/session_planning variants target only 'chat', which is
   * never one. Absent/empty = today's wording.
   */
  handoffTargets: ReadonlySet<ConversationPhase> = new Set(),
) {
  if (variant === 'chat') {
    return tool(
      async input => ({
        outcome: ok(
          handoffTargets.has(input.toPhase)
            ? 'Transition registered; the next phase answers the user.'
            : `Transition to ${input.toPhase} requested.`,
        ),
        update: {
          pendingTransition: {
            toPhase: input.toPhase,
            reason: input.reason,
          },
        },
      }),
      {
        name: 'request_transition',
        description: DESCRIPTIONS.chat,
        schema: z.object({
          toPhase: z.enum(['plan_creation', 'session_planning']).describe('Target phase'),
          reason: z.string().optional().describe('Brief reason for the transition'),
        }),
      },
    );
  }

  return tool(
    async input => ({
      outcome: ok(
        `Transition to ${input.toPhase} registered. Write a brief closing message to the user in their language.`,
      ),
      update: {
        pendingTransition: {
          toPhase: input.toPhase,
          reason: input.reason ?? 'user_cancelled',
        },
      },
    }),
    {
      name: 'request_transition',
      description: DESCRIPTIONS[variant],
      schema: z.object({
        toPhase: z.enum(['chat']).describe('Target phase'),
        reason: z.string().optional().describe('Brief reason for the transition'),
      }),
    },
  );
}
