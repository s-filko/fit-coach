import type { PhasePromptEntry } from '@infra/ai/prompts/types';

import { SESSION_PLANNING_V1, type SessionPlanningPromptContext } from './v1';
import { SESSION_PLANNING_V2, type SessionPlanningPromptContextV2 } from './v2';
import { SESSION_PLANNING_V3, type SessionPlanningPromptContextV3 } from './v3';
import { SESSION_PLANNING_V4, type SessionPlanningPromptContextV4 } from './v4';
import { SESSION_PLANNING_V5, type SessionPlanningPromptContextV5 } from './v5';

export type {
  SessionPlanningPromptContext,
  SessionPlanningPromptContextV2,
  SessionPlanningPromptContextV3,
  SessionPlanningPromptContextV4,
  SessionPlanningPromptContextV5,
};
export { SESSION_PLANNING_V1, SESSION_PLANNING_V2, SESSION_PLANNING_V3, SESSION_PLANNING_V4, SESSION_PLANNING_V5 };

/**
 * Section contract — a future version must still emit these ids (L0
 * required-sections check). `client_profile`, `active_plan`,
 * `recent_history`, `recovery_timeline` moved to `session_planning.*` domain
 * blocks in v2 (P4 context-budget plan, Task 2, D-B) — none is a prompt
 * section any more. `date` keeps its id in v3 (transition-handoff plan
 * Task 7, BUG-032) but drops the `Current Date` line — superseded by
 * the NOW line (`blocks/current-time.v1.ts`, its own message before
 * `current` since now-line-last).
 */
export const SESSION_PLANNING_PROMPT: PhasePromptEntry<SessionPlanningPromptContextV5> = {
  current: SESSION_PLANNING_V5,
  requiredSections: ['date', 'task', 'tools', 'directive.identity', 'directive.tool-reply'],
};
