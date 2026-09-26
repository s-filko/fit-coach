import type { DirectiveModule } from '@infra/ai/prompts/types';

import { formatInUserTz } from '@shared/date-utils';

/**
 * BUG-032 (transition-handoff plan Task 7): the model had no "now" to
 * reference — `TIMEZONE_V1` names the zone but never a current time, so
 * "который час?" was unanswerable and the model had to guess the weekday
 * for "this week" statements. One line, every phase, from `ctx.now` +
 * `ctx.timezone` — never `Date.now()` (BR-LLM-007, pure render).
 *
 * Placement (now-line-last plan, D1/D2): NO LONGER a directive — it left
 * `DEFAULT_DIRECTIVES_V2` because a line that changes every minute inside
 * block 1 broke provider prompt caching for everything after it. agent.node.ts
 * renders this same module into its own SystemMessage immediately before
 * `current`'s HumanMessage (after the gap note), so the stable prefix ahead
 * of it stays cacheable. `CURRENT_TIME_PREFIX` is what cache-attribution
 * labels the message by (D4), like the blocks' headers.
 */
export const CURRENT_TIME_PREFIX = 'NOW (';

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
