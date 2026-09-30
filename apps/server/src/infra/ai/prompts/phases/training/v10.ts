import { withContextLocation } from '@infra/ai/prompts/phases/context-location';

import { TRAINING_V9, type TrainingPromptContextV9 } from './v9';

/**
 * Prompt-caching plan (BUG-051) D2: v9 plus the CONTEXT LOCATION note — the per-turn context (data blocks, NOW,
 * gap note) now arrives in a `<context>` part of the latest user message instead of system messages.
 */
export type TrainingPromptContextV10 = TrainingPromptContextV9;

export const TRAINING_V10 = withContextLocation(TRAINING_V9, 'v10');
