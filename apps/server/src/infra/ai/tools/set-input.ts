/**
 * Set-input helpers shared by every tool that logs a set (`log_set`, `edit_last_workout` add):
 * the flat-field → setData mapping (a weight of 0 is a bodyweight set, AC-PTF-7). One copy; the
 * weight rules proper (weight_mode) live in TrainingService, so a set added to a finished workout
 * is judged exactly like a live one.
 */
import type { z } from 'zod';

import type { SetDataSchema } from '@domain/training/set-data.types';

export type SetDataInput = z.infer<typeof SetDataSchema>;

/** The flat tool arguments a set is built from — avoids LLM confusion with nested object schemas. */
export interface FlatSetFields {
  reps?: number;
  weight?: number;
  durationSeconds?: number;
  distanceKm?: number;
  inclinePct?: number;
}

export function flatSetData(input: FlatSetFields): SetDataInput {
  if (input.distanceKm != null) {
    return {
      type: 'cardio_distance' as const,
      distance: input.distanceKm,
      distanceUnit: 'km' as const,
      duration: input.durationSeconds ?? 0,
      ...(input.inclinePct != null && { inclinePct: input.inclinePct }),
    };
  }
  if (input.durationSeconds != null) {
    return { type: 'cardio_duration' as const, duration: input.durationSeconds };
  }
  if (input.reps != null && input.weight != null && input.weight > 0) {
    return { type: 'strength' as const, reps: input.reps, weight: input.weight, weightUnit: 'kg' as const };
  }
  if (input.reps != null) {
    return { type: 'functional_reps' as const, reps: input.reps };
  }
  return { type: 'strength' as const, reps: 0, weight: 0, weightUnit: 'kg' as const };
}
