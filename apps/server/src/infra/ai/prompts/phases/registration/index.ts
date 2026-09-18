import type { PhasePromptEntry } from '@infra/ai/prompts/types';

import { REGISTRATION_V1, type RegistrationPromptContext } from './v1';

export type { RegistrationPromptContext };

/** Section contract — a future version must still emit these ids (L0 required-sections check). */
export const REGISTRATION_PROMPT: PhasePromptEntry<RegistrationPromptContext> = {
  current: REGISTRATION_V1,
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
