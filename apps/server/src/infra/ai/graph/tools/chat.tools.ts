import { tool } from '@langchain/core/tools';
import { z } from 'zod';

import type { TransitionRequest } from '@domain/conversation/graph/conversation.state';
import type { ConversationPhase } from '@domain/conversation/ports';
import type { IUserService } from '@domain/user/ports';

import type { IPendingRefMap } from '@infra/ai/graph/pending-ref-map';

export interface ChatToolsDeps {
  userService: IUserService;
  /** Per-user map — request_transition tool sets entry by userId, extractNode deletes it */
  pendingTransitions: IPendingRefMap<TransitionRequest | null>;
}

const UPDATE_PROFILE_DESCRIPTION = [
  "Update one or more fields of the user's fitness profile.",
  'Call this when the user explicitly tells you their name, age, gender, height, weight,',
  'fitness level, or goal — or when they want to change an existing value.',
  'Only include fields the user actually mentioned.',
].join(' ');

const REQUEST_TRANSITION_DESCRIPTION = [
  'Request a phase transition to another part of the app.',
  'Use "plan_creation" when user wants to create or update their workout plan.',
  'Use "session_planning" when user wants to plan or start a workout session.',
  'Do NOT call this for casual fitness questions — just respond with text.',
].join(' ');

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export function buildChatTools(deps: ChatToolsDeps) {
  const { userService, pendingTransitions } = deps;

  const updateProfile = tool(
    async (input, config) => {
      // configurable is typed as Record<string, unknown> in LangChain

      const userId = (config?.configurable as Record<string, unknown>)?.['userId'] as string | undefined;
      if (!userId) {
        return 'Error: could not identify user. Please try again.';
      }

      const updatedUser = await userService.updateProfileData(userId, input);
      if (!updatedUser) {
        return 'Failed to update profile. Please try again.';
      }

      const changed = Object.entries(input)
        .filter(([, v]) => v !== undefined && v !== null)
        .map(([k, v]) => `${k}: ${v}`)
        .join(', ');

      return `Profile updated: ${changed}`;
    },
    {
      name: 'update_profile',
      description: UPDATE_PROFILE_DESCRIPTION,
      schema: z.object({
        firstName: z.string().optional().describe('Preferred name or nickname'),
        age: z.number().int().optional().describe('Age in years'),
        gender: z.enum(['male', 'female']).optional().describe('Biological gender'),
        height: z.number().optional().describe('Height in cm'),
        weight: z.number().optional().describe('Weight in kg'),
        fitnessLevel: z
          .enum(['beginner', 'intermediate', 'advanced'])
          .optional()
          .describe('Self-assessed fitness level'),
        fitnessGoal: z.string().optional().describe('User fitness goal in their own words'),
      }),
    },
  );

  const requestTransition = tool(
    async (input, config) => {
      const userId = ((config?.configurable as Record<string, unknown>)?.['userId'] as string | undefined) ?? '';
      pendingTransitions.set(userId, {
        toPhase: input.toPhase as ConversationPhase,
        reason: input.reason,
      });

      return `Transition to ${input.toPhase} requested.`;
    },
    {
      name: 'request_transition',
      description: REQUEST_TRANSITION_DESCRIPTION,
      schema: z.object({
        toPhase: z.enum(['plan_creation', 'session_planning']).describe('Target phase'),
        reason: z.string().optional().describe('Brief reason for the transition'),
      }),
    },
  );

  return [updateProfile, requestTransition];
}
