import { tool } from '@langchain/core/tools';
import { z } from 'zod';

import type { IUserService } from '@domain/user/ports';

import { isValidTimezone } from '@shared/date-utils';

export interface TimezoneToolDeps {
  userService: IUserService;
}

/**
 * Shared tool available in all conversation phases.
 * LLM calls it when the user provides their city/timezone and it hasn't been saved yet.
 */
export function buildSaveTimezoneTool(deps: TimezoneToolDeps) {
  const { userService } = deps;

  return tool(
    async (input, config) => {
      const userId = (config?.configurable as Record<string, unknown>)?.['userId'] as string | undefined;
      if (!userId) {
        return 'Error: could not identify user. Please try again.';
      }

      if (!isValidTimezone(input.timezone)) {
        return `Invalid timezone: "${input.timezone}". Please provide a valid IANA timezone like "Europe/Berlin" or "America/New_York".`;
      }

      await userService.updateProfileData(userId, { timezone: input.timezone });
      return `Timezone saved: ${input.timezone}`;
    },
    {
      name: 'save_timezone',
      description:
        "Save the user's timezone. Call when the user provides their city or timezone. " +
        'Use IANA format, e.g. "Europe/Berlin", "America/New_York", "Asia/Tokyo".',
      schema: z.object({
        timezone: z.string().describe('IANA timezone string, e.g. "Europe/Berlin"'),
      }),
    },
  );
}
