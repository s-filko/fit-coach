import type { PhasePromptEntry } from '@infra/ai/prompts/types';

import { CHAT_V1, type ChatPromptContext } from './v1';

export type { ChatPromptContext };

/** Section contract — a future version must still emit these ids (L0 required-sections check). */
export const CHAT_PROMPT: PhasePromptEntry<ChatPromptContext> = {
  current: CHAT_V1,
  requiredSections: ['context', 'rules', 'tools', 'no_set_logging', 'directive.identity', 'directive.tool-reply'],
};
