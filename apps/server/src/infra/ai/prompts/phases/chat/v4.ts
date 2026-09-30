import { withContextLocation } from '@infra/ai/prompts/phases/context-location';

import { CHAT_V3, type ChatPromptContextV3 } from './v3';

/**
 * Prompt-caching plan (BUG-051) D2: v3 plus the CONTEXT LOCATION note — the per-turn context (data blocks, NOW,
 * gap note) now arrives in a `<context>` part of the latest user message instead of system messages.
 */
export type ChatPromptContextV4 = ChatPromptContextV3;

export const CHAT_V4 = withContextLocation(CHAT_V3, 'v4');
