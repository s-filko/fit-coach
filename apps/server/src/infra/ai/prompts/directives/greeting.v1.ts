import type { DirectiveModule } from '@infra/ai/prompts/types';

import { calendarDaysAgo } from '@shared/date-utils';

const MIN_HOURS_SINCE_LAST_MESSAGE = 4;

export const GREETING_V1: DirectiveModule = {
  id: 'greeting',
  version: 'v1',
  render: ({ now, user, lastMessageTime }) => {
    if (!lastMessageTime) {
      return null;
    }

    const daysSinceLastMsg = calendarDaysAgo(lastMessageTime, now, user?.timezone);
    if (daysSinceLastMsg < 1) {
      return null;
    }

    const hoursSince = (now.getTime() - lastMessageTime.getTime()) / (1000 * 60 * 60);
    if (hoursSince < MIN_HOURS_SINCE_LAST_MESSAGE) {
      return null;
    }

    return {
      id: 'directive.greeting',
      required: false,
      text: [
        "GREETING: This is the user's first message today (new day since last activity).",
        'Start your response with a brief, warm greeting appropriate to the time of day',
        '(e.g. "Доброе утро!", "Привет!", "Добрый вечер!").',
        "Then address the user's message as usual.",
      ].join(' '),
    };
  },
};
