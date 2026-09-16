import type { PhasePromptEntry } from '@infra/ai/prompts/types';

import { PLAN_CREATION_V1, type PlanCreationPromptContext } from './v1';

export type { PlanCreationPromptContext };

/** Section contract — a future version must still emit these ids (L0 required-sections check). */
export const PLAN_CREATION_PROMPT: PhasePromptEntry<PlanCreationPromptContext> = {
  current: PLAN_CREATION_V1,
  requiredSections: [
    'date',
    'client_profile',
    'task',
    'conversation_flow',
    'rules',
    'tools',
    'directive.identity',
    'directive.tool-reply',
  ],
};
