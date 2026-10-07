import type { WorkoutSessionWithDetails } from '@domain/training/types';

import { formatExerciseSets, formatSetData } from '../set-format';

// plan-and-tool-fixes T6 (AC-PTF-6): a set with no external load is named "bodyweight", in full —
// never "BW", never a bare "8 reps" and never "@ 0 kg" (BR-TRAINING-047). formatSetData is the one
// long form behind the log_set / update_last_set / delete_last_sets / get_exercise_history replies.

type SetDataOf = Parameters<typeof formatSetData>[0];

describe('formatSetData — bodyweight wording (AC-PTF-6)', () => {
  it.each<[string, SetDataOf, string]>([
    ['functional_reps', { type: 'functional_reps', reps: 8 }, '8 reps @ bodyweight'],
    ['strength with a null weight (legacy row)', { type: 'strength', reps: 12 }, '12 reps @ bodyweight'],
  ])('%s', (_name, setData, expected) => {
    expect(formatSetData(setData)).toBe(expected);
  });

  it('keeps the weighted strength form untouched', () => {
    expect(formatSetData({ type: 'strength', reps: 8, weight: 55, weightUnit: 'kg' })).toBe('8 reps @ 55 kg');
  });
});

describe('formatExerciseSets — bodyweight wording (AC-PTF-6)', () => {
  const setsOf = (setData: SetDataOf[]): WorkoutSessionWithDetails['exercises'][number]['sets'] =>
    setData.map((s, i) => ({ id: `s${i}`, setNumber: i + 1, rpe: null, userFeedback: null, setData: s })) as never;

  it('lists a bodyweight set with the wording inside a session listing', () => {
    expect(formatExerciseSets(setsOf([{ type: 'functional_reps', reps: 10 }]), null)).toBe(
      '  Set 1: 10 reps @ bodyweight',
    );
  });
});
