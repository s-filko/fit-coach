import type { PhasePromptEntry } from '@infra/ai/prompts/types';

import { CHAT_V1, type ChatPromptContext } from './v1';
import { CHAT_V2, type ChatPromptContextV2 } from './v2';
import { CHAT_V3, type ChatPromptContextV3 } from './v3';
import { CHAT_V4, type ChatPromptContextV4 } from './v4';

export type { ChatPromptContext, ChatPromptContextV2, ChatPromptContextV3, ChatPromptContextV4 };
export { CHAT_V1, CHAT_V2, CHAT_V3, CHAT_V4 };

/**
 * Section contract — a future version must still emit these ids (L0
 * required-sections check). `context` moved to the `chat.context` domain
 * block in v2 (P4 context-budget plan, Task 2, D-B) — it is no longer a
 * prompt section.
 */
export const CHAT_PROMPT: PhasePromptEntry<ChatPromptContextV4> = {
  current: CHAT_V4,
  requiredSections: ['rules', 'tools', 'no_set_logging', 'directive.identity', 'directive.tool-reply'],
};
