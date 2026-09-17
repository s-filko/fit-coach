import { tool } from '@langchain/core/tools';
import { z } from 'zod';

import { ok, userError } from '@domain/conversation/tool-outcome';
import type { IUserService } from '@domain/user/ports';
import { FIELD_LABELS, type ProfileDataKey } from '@domain/user/services/registration.validation';

export interface CompleteRegistrationToolDeps {
  userService: IUserService;
}

const REQUIRED_FIELDS: ProfileDataKey[] = ['age', 'gender', 'height', 'weight', 'fitnessLevel', 'fitnessGoal'];

const COMPLETE_REGISTRATION_DESCRIPTION = [
  'Mark registration as complete and transition the user to the next phase.',
  'Call this ONLY when all 6 profile fields are collected AND the user has explicitly confirmed the summary.',
  'The user must say something like "yes", "correct", "looks good", "ok", etc.',
  'Pass toPhase="plan_creation" if user wants to start training, "chat" if they want to ask questions first.',
].join(' ');

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export function buildCompleteRegistrationTool(deps: CompleteRegistrationToolDeps) {
  const { userService } = deps;

  return tool(
    async (input, config) => {
      const userId = (config?.configurable as Record<string, unknown>)?.['userId'] as string | undefined;
      if (!userId) {
        return userError('Error: could not identify user. Please try again.');
      }

      const currentUser = await userService.getUser(userId);
      if (!currentUser) {
        return userError('Error: user not found.');
      }

      const missingFields = REQUIRED_FIELDS.filter(k => {
        const v = currentUser[k as keyof typeof currentUser];
        return v === undefined || v === null || v === '';
      });

      if (missingFields.length > 0) {
        const missing = missingFields.map(k => FIELD_LABELS[k]).join(', ');
        return userError(
          `Cannot complete registration — still missing: ${missing}. Please collect these fields first.`,
        );
      }

      await userService.updateProfileData(userId, { profileStatus: 'complete' });

      // Signal transition — the executor propagates it as a state update
      return {
        outcome: ok('Registration complete! Profile saved successfully.'),
        update: {
          pendingTransition: {
            toPhase: input.toPhase,
            reason: 'registration_complete',
          },
        },
      };
    },
    {
      name: 'complete_registration',
      description: COMPLETE_REGISTRATION_DESCRIPTION,
      schema: z.object({
        toPhase: z
          .enum(['plan_creation', 'chat'])
          .describe('Next phase: "plan_creation" if user wants to build a plan, "chat" if they want to talk first'),
      }),
    },
  );
}
