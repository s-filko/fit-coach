import type { PhasePromptEntry } from '@infra/ai/prompts/types';

import { SESSION_PLANNING_V1, type SessionPlanningPromptContext } from './v1';
import { SESSION_PLANNING_V2, type SessionPlanningPromptContextV2 } from './v2';

export type { SessionPlanningPromptContext, SessionPlanningPromptContextV2 };
export { SESSION_PLANNING_V1, SESSION_PLANNING_V2 };

/**
 * Section contract — a future version must still emit these ids (L0
 * required-sections check). `client_profile`, `active_plan`,
 * `recent_history`, `recovery_timeline` moved to `session_planning.*` domain
 * blocks in v2 (P4 context-budget plan, Task 2, D-B) — none is a prompt
 * section any more.
 */
export const SESSION_PLANNING_PROMPT: PhasePromptEntry<SessionPlanningPromptContextV2> = {
  current: SESSION_PLANNING_V2,
  requiredSections: ['date', 'task', 'tools', 'directive.identity', 'directive.tool-reply'],
};
