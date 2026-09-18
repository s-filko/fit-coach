import type { DirectiveModule } from '@infra/ai/prompts/types';

import { FORMATTING_TELEGRAM_V1 } from './formatting.telegram.v1';
import { GREETING_V1 } from './greeting.v1';
import { IDENTITY_V1 } from './identity.v1';
import { LANGUAGE_V1 } from './language.v1';
import { NAME_USAGE_V1 } from './name-usage.v1';
import { OUTPUT_V1 } from './output.v1';
import { TIME_REFERENCE_V1 } from './time-reference.v1';
import { TIMEZONE_V1 } from './timezone.v1';
import { TOOL_REPLY_V1 } from './tool-reply.v1';

export {
  FORMATTING_TELEGRAM_V1,
  GREETING_V1,
  IDENTITY_V1,
  LANGUAGE_V1,
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
