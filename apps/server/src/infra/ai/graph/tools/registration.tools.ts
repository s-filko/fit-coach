import { tool } from '@langchain/core/tools';
import { z } from 'zod';

import type { TransitionRequest } from '@domain/conversation/graph/conversation.state';
import type { ConversationPhase } from '@domain/conversation/ports';
import type { IUserService } from '@domain/user/ports';
import { FIELD_LABELS, type ProfileDataKey, validateExtractedFields } from '@domain/user/services/registration.validation';

export interface RegistrationToolsDeps {
  userService: IUserService;
  /** Mutable ref — tools write here, extractNode reads it to update parent state */
  pendingTransition: { value: TransitionRequest | null };
}

const REQUIRED_FIELDS: ProfileDataKey[] = ['age', 'gender', 'height', 'weight', 'fitnessLevel', 'fitnessGoal'];

const SAVE_PROFILE_FIELDS_DESCRIPTION = [
  'Save one or more profile fields the user has provided.',
  'Extract and save age, gender, height (cm), weight (kg), fitness level, or goal from what the user said.',
  'Only include fields explicitly mentioned in this message.',
  'Can be called multiple times as the user provides info across the conversation.',
].join(' ');

const COMPLETE_REGISTRATION_DESCRIPTION = [
  'Mark registration as complete and transition the user to the next phase.',
  'Call this ONLY when all 6 profile fields are collected AND the user has explicitly confirmed the summary.',
  'The user must say something like "yes", "correct", "looks good", "ok", etc.',
  'Pass toPhase="plan_creation" if user wants to start training, "chat" if they want to ask questions first.',
].join(' ');

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export function buildRegistrationTools(deps: RegistrationToolsDeps) {
  const { userService, pendingTransition } = deps;

  const saveProfileFields = tool(
    // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
    async(input, config) => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const userId = (config?.configurable as Record<string, unknown>)?.['userId'] as string | undefined;
      if (!userId) {
        return 'Error: could not identify user. Please try again.';
      }

      // Reuse strict validators from registration.validation.ts
      const validated = validateExtractedFields(input as Record<string, unknown>);
      const fieldsToSave = Object.fromEntries(
        Object.entries(validated).filter(([, v]) => v !== undefined),
      );

      // Save firstName separately if provided
      if (typeof input.firstName === 'string' && input.firstName.trim()) {
        fieldsToSave.firstName = input.firstName.trim();
      }

      if (Object.keys(fieldsToSave).length === 0) {
        return 'No valid fields to save. Please provide at least one profile field.';
      }

      await userService.updateProfileData(userId, fieldsToSave);

      const saved = Object.keys(fieldsToSave)
        .map((k) => FIELD_LABELS[k as ProfileDataKey] ?? k)
        .join(', ');

      return `Saved: ${saved}`;
    },
    {
      name: 'save_profile_fields',
      description: SAVE_PROFILE_FIELDS_DESCRIPTION,
      schema: z.object({
        age: z.number().optional().describe('Age in years (10–120)'),
        gender: z.enum(['male', 'female']).optional().describe('Biological gender'),
        height: z.number().optional().describe('Height in cm (100–250)'),
        weight: z.number().optional().describe('Weight in kg (20–300)'),
        fitnessLevel: z.enum(['beginner', 'intermediate', 'advanced']).optional().describe('Self-assessed fitness level'),
        fitnessGoal: z.string().optional().describe('Fitness goal in their own words'),
        firstName: z.string().optional().describe('Preferred name if user provides one'),
      }),
    },
  );

  const completeRegistration = tool(
    // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
    async(input, config) => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const userId = (config?.configurable as Record<string, unknown>)?.['userId'] as string | undefined;
      if (!userId) {
        return 'Error: could not identify user. Please try again.';
      }

      const currentUser = await userService.getUser(userId);
      if (!currentUser) {
        return 'Error: user not found.';
      }

      const missingFields = REQUIRED_FIELDS.filter((k) => {
        const v = currentUser[k as keyof typeof currentUser];
        return v === undefined || v === null || v === '';
      });

      if (missingFields.length > 0) {
        const missing = missingFields.map((k) => FIELD_LABELS[k]).join(', ');
        return `Cannot complete registration — still missing: ${missing}. Please collect these fields first.`;
      }

      await userService.updateProfileData(userId, { profileStatus: 'complete' });

      // Signal transition via closure ref — extractNode will pick this up
      pendingTransition.value = {
        toPhase: input.toPhase as ConversationPhase,
        reason: 'registration_complete',
      };

      return 'Registration complete! Profile saved successfully.';
    },
    {
      name: 'complete_registration',
      description: COMPLETE_REGISTRATION_DESCRIPTION,
      schema: z.object({
        toPhase: z.enum(['plan_creation', 'chat']).describe(
          'Next phase: "plan_creation" if user wants to build a plan, "chat" if they want to talk first',
        ),
      }),
    },
  );

  return [saveProfileFields, completeRegistration];
}
