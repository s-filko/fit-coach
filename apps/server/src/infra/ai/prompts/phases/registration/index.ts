import type { PhasePromptEntry } from '@infra/ai/prompts/types';

import { REGISTRATION_V1, type RegistrationPromptContext } from './v1';
import { REGISTRATION_V2, type RegistrationPromptContextV2 } from './v2';

export type { RegistrationPromptContext, RegistrationPromptContextV2 };
export { REGISTRATION_V1, REGISTRATION_V2 };

/** Section contract — a future version must still emit these ids (L0 required-sections check). */
export const REGISTRATION_PROMPT: PhasePromptEntry<RegistrationPromptContextV2> = {
  current: REGISTRATION_V2,
  requiredSections: [
    'name_context',
    'collected',
    'missing',
    'behavior_rules',
    'tools',
    'directive.identity',
    'directive.tool-reply',
  ],
};
