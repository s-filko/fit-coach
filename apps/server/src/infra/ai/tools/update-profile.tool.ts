import { tool } from '@langchain/core/tools';
import { z } from 'zod';

import { ok, userError } from '@domain/conversation/tool-outcome';
import type { IUserService } from '@domain/user/ports';

export interface UpdateProfileToolDeps {
  userService: IUserService;
}

const UPDATE_PROFILE_DESCRIPTION = [
  "Update one or more fields of the user's fitness profile.",
  'Call this when the user explicitly tells you their name, age, gender, height, weight,',
  'fitness level, or goal — or when they want to change an existing value.',
  'Only include fields the user actually mentioned.',
].join(' ');

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export function buildUpdateProfileTool(deps: UpdateProfileToolDeps) {
  const { userService } = deps;

  return tool(
    async (input, config) => {
      // configurable is typed as Record<string, unknown> in LangChain

      const userId = (config?.configurable as Record<string, unknown>)?.['userId'] as string | undefined;
      if (!userId) {
        return userError('Error: could not identify user. Please try again.');
      }

      const updatedUser = await userService.updateProfileData(userId, input);
      if (!updatedUser) {
        return userError('Failed to update profile. Please try again.');
      }

      const changed = Object.entries(input)
        .filter(([, v]) => v !== undefined && v !== null)
        .map(([k, v]) => `${k}: ${v}`)
        .join(', ');

      return ok(`Profile updated: ${changed}`);
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
}
