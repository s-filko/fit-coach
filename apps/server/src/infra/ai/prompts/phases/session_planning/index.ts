import type { PhasePromptEntry } from '@infra/ai/prompts/types';

import { SESSION_PLANNING_V1, type SessionPlanningPromptContext } from './v1';

export type { SessionPlanningPromptContext };

/** Section contract — a future version must still emit these ids (L0 required-sections check). */
export const SESSION_PLANNING_PROMPT: PhasePromptEntry<SessionPlanningPromptContext> = {
  current: SESSION_PLANNING_V1,
  requiredSections: [
    'client_profile',
    'active_plan',
    'recent_history',
    'recovery_timeline',
    'task',
    'tools',
    'directive.identity',
    'directive.tool-reply',
  ],
};
