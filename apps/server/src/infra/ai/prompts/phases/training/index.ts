import type { PhasePromptEntry } from '@infra/ai/prompts/types';

import { TRAINING_V1, type TrainingPromptContext } from './v1';

export type { TrainingPromptContext };

/** Section contract — a future version must still emit these ids (L0 required-sections check). */
export const TRAINING_PROMPT: PhasePromptEntry<TrainingPromptContext> = {
  current: TRAINING_V1,
  requiredSections: ['client', 'workout_overview', 'tools', 'rules', 'directive.tool-reply'],
};
