import { withContextLocation } from '@infra/ai/prompts/phases/context-location';

import { PLAN_CREATION_V3, type PlanCreationPromptContextV3 } from './v3';

/**
 * Prompt-caching plan (BUG-051) D2: v3 plus the CONTEXT LOCATION note — the per-turn context (data blocks, NOW,
 * gap note) now arrives in a `<context>` part of the latest user message instead of system messages.
 */
export type PlanCreationPromptContextV4 = PlanCreationPromptContextV3;

export const PLAN_CREATION_V4 = withContextLocation(PLAN_CREATION_V3, 'v4');
