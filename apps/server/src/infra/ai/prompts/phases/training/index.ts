import type { PhasePromptEntry } from '@infra/ai/prompts/types';

import { TRAINING_COACH, type TrainingCoachContext } from './coach';
import { TRAINING_COACH_V14 } from './coach.v14';
import { TRAINING_COACH_V15 } from './coach.v15';

export { TRAINING_COACH };

/**
 * The version switch (coach-quality-proof T4): `PROMPT_VERSION_TRAINING=v14` runs the first progression
 * candidate, `=v15` the second (load vs reps, owner 2026-10-08); anything else (or unset) keeps v13 — the
 * default and the baseline, byte-identical. Read once at module load (= graph composition), so one L3 run
 * is always a single version and prompt caching never sees it flip.
 */
const COACH_BY_VERSION: Record<string, typeof TRAINING_COACH> = { v14: TRAINING_COACH_V14, v15: TRAINING_COACH_V15 };
const SELECTED_COACH = COACH_BY_VERSION[process.env.PROMPT_VERSION_TRAINING ?? ''] ?? TRAINING_COACH;

/**
 * Section contract — a future version must still emit these ids (L0
 * required-sections check).
 */
export const TRAINING_PROMPT: PhasePromptEntry<TrainingCoachContext> = {
  current: SELECTED_COACH,
  requiredSections: ['coach', 'profile'],
};
