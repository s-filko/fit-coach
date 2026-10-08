/**
 * Set-input helpers shared by every tool that logs a set (`log_set`, `edit_last_workout` add):
 * the flat-field → setData mapping and the D15 weight carry-over. One copy, so the weight rules
 * of a set added to a finished workout are the rules of a live set.
 */
import type { z } from 'zod';

import type { SetDataSchema } from '@domain/training/set-data.types';
import type { SetKind, WorkoutSessionWithDetails } from '@domain/training/types';

export type SetDataInput = z.infer<typeof SetDataSchema>;

export interface Carried {
  weight: number;
  weightUnit: 'kg' | 'lbs';
  setNumber: number;
}

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
  if (input.reps != null && input.weight != null) {
    return { type: 'strength' as const, reps: input.reps, weight: input.weight, weightUnit: 'kg' as const };
  }
  if (input.reps != null) {
    return { type: 'functional_reps' as const, reps: input.reps };
  }
  return { type: 'strength' as const, reps: 0, weight: 0, weightUnit: 'kg' as const };
}

/**
 * D15: reps without a weight on an exercise already weighted in this session is shorthand ("did another 12"),
 * not a bodyweight set — carry the weight of the latest set of the same kind (a warm-up weight never reaches a
 * working set) and its total-weight basis; the confirmation says so.
 */
export function carryWeight(
  base: SetDataInput,
  input: { exerciseId?: string; exerciseName?: string; setKind?: SetKind; weightBasis?: 'total' },
  session: WorkoutSessionWithDetails | null,
): { setData: SetDataInput; weightBasis?: 'total'; carried?: Carried } {
  if (base.type !== 'functional_reps') {
    return { setData: base, weightBasis: input.weightBasis };
  }
  const wanted = input.exerciseName?.trim().toLowerCase();
  // The same precedence as the service: an id wins over a name.
  const sessionExercise = session?.exercises.find(se =>
    input.exerciseId != null ? se.exerciseId === input.exerciseId : se.exercise.name.toLowerCase() === wanted,
  );
  const isWarmup = input.setKind === 'warmup';
  const previous = [...(sessionExercise?.sets ?? [])]
    .sort((a, b) => b.setNumber - a.setNumber)
    .find(s => (s.setKind === 'warmup') === isWarmup && s.setData.type === 'strength' && (s.setData.weight ?? 0) > 0);
  if (previous?.setData.type !== 'strength' || previous.setData.weight == null) {
    return { setData: base, weightBasis: input.weightBasis };
  }
  const { weight, weightUnit = 'kg', perHand } = previous.setData;
  return {
    setData: { type: 'strength', reps: base.reps, weight, weightUnit },
    weightBasis: input.weightBasis ?? (perHand === false ? 'total' : undefined),
    carried: { weight, weightUnit, setNumber: previous.setNumber },
  };
}
