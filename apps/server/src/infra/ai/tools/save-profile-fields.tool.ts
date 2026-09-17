import { tool } from '@langchain/core/tools';
import { z } from 'zod';

import { ok, userError } from '@domain/conversation/tool-outcome';
import type { IUserService } from '@domain/user/ports';
import {
  FIELD_LABELS,
  type ProfileDataKey,
  validateExtractedFields,
} from '@domain/user/services/registration.validation';

export interface SaveProfileFieldsToolDeps {
  userService: IUserService;
}

const SAVE_PROFILE_FIELDS_DESCRIPTION = [
  'Save one or more profile fields the user has provided.',
  'Extract and save age, gender, height (cm), weight (kg), fitness level, or goal from what the user said.',
  'Only include fields explicitly mentioned in this message.',
  'Can be called multiple times as the user provides info across the conversation.',
].join(' ');

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export function buildSaveProfileFieldsTool(deps: SaveProfileFieldsToolDeps) {
  const { userService } = deps;

  return tool(
    async (input, config) => {
      const userId = (config?.configurable as Record<string, unknown>)?.['userId'] as string | undefined;
      if (!userId) {
        return userError('Error: could not identify user. Please try again.');
      }

      // Reuse strict validators from registration.validation.ts
      const validated = validateExtractedFields(input as Record<string, unknown>);
      const fieldsToSave = Object.fromEntries(Object.entries(validated).filter(([, v]) => v !== undefined));

      // Save firstName separately if provided
      if (typeof input.firstName === 'string' && input.firstName.trim()) {
        fieldsToSave.firstName = input.firstName.trim();
      }

      if (Object.keys(fieldsToSave).length === 0) {
        return userError('No valid fields to save. Please provide at least one profile field.');
      }

      await userService.updateProfileData(userId, fieldsToSave);

      const saved = Object.keys(fieldsToSave)
        .map(k => FIELD_LABELS[k as ProfileDataKey] ?? k)
        .join(', ');

      return ok(`Saved: ${saved}`);
    },
    {
      name: 'save_profile_fields',
      description: SAVE_PROFILE_FIELDS_DESCRIPTION,
      schema: z.object({
        age: z.number().optional().describe('Age in years (10–120)'),
        gender: z.enum(['male', 'female']).optional().describe('Biological gender'),
        height: z.number().optional().describe('Height in cm (100–250)'),
        weight: z.number().optional().describe('Weight in kg (20–300)'),
        fitnessLevel: z
          .enum(['beginner', 'intermediate', 'advanced'])
          .optional()
          .describe('Self-assessed fitness level'),
        fitnessGoal: z.string().optional().describe('Fitness goal in their own words'),
        firstName: z.string().optional().describe('Preferred name if user provides one'),
      }),
    },
  );
}
