import type { PhasePromptEntry } from '@infra/ai/prompts/types';

import { type TrainingCoachContext } from './coach';
import { TRAINING_COACH_V15 } from './coach.v15';

/**
 * The default training coach prompt is v15 (coach-quality-proof T4, owner-accepted 2026-10-08 after the live
 * v13 / v14 / v15 measurement). `coach.ts` (v13) and `coach.v14.ts` stay as the derivation chain v15 is built
 * from (BR-LLM-008) and as the baseline the version tests compare against.
 */
export const TRAINING_COACH = TRAINING_COACH_V15;

/**
 * Section contract — a future version must still emit these ids (L0
 * required-sections check).
 */
export const TRAINING_PROMPT: PhasePromptEntry<TrainingCoachContext> = {
  current: TRAINING_COACH,
  requiredSections: ['coach', 'profile'],
};
