import type { PhasePromptEntry } from '@infra/ai/prompts/types';

import { TRAINING_COACH, type TrainingCoachContext } from './coach';

export { TRAINING_COACH };

/**
 * Section contract — a future version must still emit these ids (L0
 * required-sections check).
 */
export const TRAINING_PROMPT: PhasePromptEntry<TrainingCoachContext> = {
  current: TRAINING_COACH,
  requiredSections: ['coach', 'profile'],
};
