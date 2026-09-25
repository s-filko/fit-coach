import type { PhasePromptEntry } from '@infra/ai/prompts/types';

import { PLAN_CREATION_V1, type PlanCreationPromptContext } from './v1';
import { PLAN_CREATION_V2, type PlanCreationPromptContextV2 } from './v2';
import { PLAN_CREATION_V3, type PlanCreationPromptContextV3 } from './v3';

export type { PlanCreationPromptContext, PlanCreationPromptContextV2, PlanCreationPromptContextV3 };
export { PLAN_CREATION_V1, PLAN_CREATION_V2, PLAN_CREATION_V3 };

/**
 * Section contract — a future version must still emit these ids (L0
 * required-sections check). `client_profile` moved to the
 * `plan_creation.client_profile` domain block in v2 (P4 context-budget plan,
 * Task 2, D-B) — it is no longer a prompt section. `date` dropped in v3
 * (transition-handoff plan Task 7, BUG-032) — superseded by
 * `directive.current-time`.
 */
export const PLAN_CREATION_PROMPT: PhasePromptEntry<PlanCreationPromptContextV3> = {
  current: PLAN_CREATION_V3,
  requiredSections: ['task', 'conversation_flow', 'rules', 'tools', 'directive.identity', 'directive.tool-reply'],
};
