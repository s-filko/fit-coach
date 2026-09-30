import { withContextLocation } from '@infra/ai/prompts/phases/context-location';

import { SESSION_PLANNING_V3, type SessionPlanningPromptContextV3 } from './v3';

/**
 * Prompt-caching plan (BUG-051) D2: v3 plus the CONTEXT LOCATION note — the per-turn context (data blocks, NOW,
 * gap note) now arrives in a `<context>` part of the latest user message instead of system messages.
 */
export type SessionPlanningPromptContextV4 = SessionPlanningPromptContextV3;

export const SESSION_PLANNING_V4 = withContextLocation(SESSION_PLANNING_V3, 'v4');
