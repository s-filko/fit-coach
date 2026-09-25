import type { DirectiveModule } from '@infra/ai/prompts/types';

import { CURRENT_TIME_V1 } from './current-time.v1';
import { FORMATTING_TELEGRAM_V1 } from './formatting.telegram.v1';
import { GREETING_V1 } from './greeting.v1';
import { IDENTITY_V1 } from './identity.v1';
import { LANGUAGE_V1 } from './language.v1';
import { LANGUAGE_V2 } from './language.v2';
import { NAME_USAGE_V1 } from './name-usage.v1';
import { OUTPUT_V1 } from './output.v1';
import { TIME_REFERENCE_V1 } from './time-reference.v1';
import { TIMEZONE_V1 } from './timezone.v1';
import { TOOL_REPLY_V1 } from './tool-reply.v1';

export {
  CURRENT_TIME_V1,
  FORMATTING_TELEGRAM_V1,
  GREETING_V1,
  IDENTITY_V1,
  LANGUAGE_V1,
  LANGUAGE_V2,
  NAME_USAGE_V1,
  OUTPUT_V1,
  TIME_REFERENCE_V1,
  TIMEZONE_V1,
  TOOL_REPLY_V1,
};

/** Pre-refactor composeDirectives order (graph/prompt-directives.ts:116-137). Do not reorder in v1. */
export const DEFAULT_DIRECTIVES_V1: readonly DirectiveModule[] = [
  IDENTITY_V1,
  GREETING_V1,
  LANGUAGE_V1,
  TIMEZONE_V1,
  NAME_USAGE_V1,
  FORMATTING_TELEGRAM_V1,
  TIME_REFERENCE_V1,
  OUTPUT_V1,
  TOOL_REPLY_V1,
];

/** training passed includeIdentity: false. */
export const DIRECTIVES_WITHOUT_IDENTITY_V1: readonly DirectiveModule[] = DEFAULT_DIRECTIVES_V1.slice(1);

/**
 * BUG-032 (transition-handoff plan Task 7): V1 plus `CURRENT_TIME_V1`,
 * appended — never inserted — so it renders LAST (`renderDirectives` walks
 * the array in order and every phase spreads it last in its section list).
 * `DEFAULT_DIRECTIVES_V1` stays untouched: it backs the frozen v1 prompt
 * snapshots (AC-1321), which must never gain a line they did not render at
 * the time they were pinned.
 *
 * BUG-036 + owner language rule (R3): V2 also swaps `LANGUAGE_V1` for
 * `LANGUAGE_V2` in place (same position, same id `language`) — every live
 * phase (registration v2, chat v3, session_planning v3, plan_creation v3,
 * training v4) reaches `LANGUAGE_V2` through this one substitution, with no
 * change to any phase file. V1's directive and the frozen v1 snapshots that
 * depend on it are untouched.
 */
const DEFAULT_DIRECTIVES_V1_WITH_LANGUAGE_V2: readonly DirectiveModule[] = DEFAULT_DIRECTIVES_V1.map(d =>
  d.id === 'language' ? LANGUAGE_V2 : d,
);

export const DEFAULT_DIRECTIVES_V2: readonly DirectiveModule[] = [
  ...DEFAULT_DIRECTIVES_V1_WITH_LANGUAGE_V2,
  CURRENT_TIME_V1,
];

/** training's v4+ passed includeIdentity: false — same slice rule as V1. */
export const DIRECTIVES_WITHOUT_IDENTITY_V2: readonly DirectiveModule[] = DEFAULT_DIRECTIVES_V2.slice(1);
