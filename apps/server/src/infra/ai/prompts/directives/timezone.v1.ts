import type { DirectiveModule } from '@infra/ai/prompts/types';

export const TIMEZONE_V1: DirectiveModule = {
  id: 'timezone',
  version: 'v1',
  render: ({ user }) => ({
    id: 'directive.timezone',
    required: true,
    text: user?.timezone
      ? `USER TIMEZONE: '${user.timezone}'. Use it for all date/time references.`
      : [
          'USER TIMEZONE: unknown.',
          'If the conversation involves scheduling, workout timing, or time-of-day context,',
          'ask the user for their city or timezone, then call save_timezone tool before continuing.',
          'Do not ask about timezone if it is not relevant to the current message.',
        ].join(' '),
  }),
};
