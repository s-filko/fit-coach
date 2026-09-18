import type { PhasePromptEntry } from '@infra/ai/prompts/types';

import { PLAN_CREATION_V1, type PlanCreationPromptContext } from './v1';
import { PLAN_CREATION_V2, type PlanCreationPromptContextV2 } from './v2';

export type { PlanCreationPromptContext, PlanCreationPromptContextV2 };
export { PLAN_CREATION_V1, PLAN_CREATION_V2 };

/**
 * Section contract — a future version must still emit these ids (L0
 * required-sections check). `client_profile` moved to the
 * `plan_creation.client_profile` domain block in v2 (P4 context-budget plan,
 * Task 2, D-B) — it is no longer a prompt section.
 */
export const PLAN_CREATION_PROMPT: PhasePromptEntry<PlanCreationPromptContextV2> = {
  current: PLAN_CREATION_V2,
  requiredSections: [
    'date',
    'task',
    'conversation_flow',
    'rules',
    'tools',
    'directive.identity',
    'directive.tool-reply',
  ],
};
