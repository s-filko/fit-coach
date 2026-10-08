/**
 * The catalog's weight contract per exercise (plan-and-tool-fixes T7, AC-PTF-7). One rule in
 * code for fresh databases — `exercises.seed.ts` applies it on insert; the T7 migration
 * carries the same rule as SQL for rows that already exist. No counterweight value: assisted
 * machines (the Gravitron) are `required` — "Assisted …" in the name says what the number
 * means (checked live, plan coach-quality-proof).
 */
import type { Exercise, WeightMode } from './types';

export function deriveWeightMode(
  category: Exercise['category'],
  equipment: Exercise['equipment'],
  exerciseType: Exercise['exerciseType'],
): WeightMode {
  if (category === 'cardio' || equipment === 'none') {
    return 'none';
  }
  // A reps-only movement on a machine (an ab machine) is used without added load; the stack is optional.
  if (equipment === 'bodyweight' || (equipment === 'machine' && exerciseType === 'functional_reps')) {
    return 'optional';
  }
  return 'required';
}
