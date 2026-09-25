import type { DirectiveModule } from '@infra/ai/prompts/types';

import { formatInUserTz } from '@shared/date-utils';

/**
 * BUG-032 (transition-handoff plan Task 7): the model had no "now" to
 * reference — `TIMEZONE_V1` names the zone but never a current time, so
 * "который час?" was unanswerable and the model had to guess the weekday
 * for "this week" statements. One line, every phase, from `ctx.now` +
 * `ctx.timezone` — never `Date.now()` (BR-LLM-007, pure render).
 *
 * Placement (DEFAULT_DIRECTIVES_V2 / DIRECTIVES_WITHOUT_IDENTITY_V2, both in
 * `./index.ts`): LAST of the directives, which `renderDirectives` spreads
 * last in every phase's section list — this line changes every minute, so it
 * must be the last system section, after the stable prefix, or an early
 * change would break provider prompt caching for everything that follows it.
 */
export const CURRENT_TIME_V1: DirectiveModule = {
  id: 'current-time',
  version: 'v1',
  render: ({ now, timezone }) => {
    const { weekday, dateOnly, time, label } = formatInUserTz(now, timezone);
    const text = timezone
      ? `NOW (user's local time): ${weekday} ${dateOnly} ${time} (${label})`
      : `NOW (${label} — user's timezone is unknown): ${weekday} ${dateOnly} ${time}`;
    return { id: 'directive.current-time', required: true, text };
  },
};
