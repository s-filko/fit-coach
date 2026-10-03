import type { AutoCompletedExercise } from '@domain/training/ports';

import { formatExerciseSummary } from '../format-exercise-summary';

/** The Lateral Raise the user left behind by reporting a Lat Pulldown set (session e9e76f10). */
const finishedExercise: AutoCompletedExercise = {
  exerciseId: '00000000-0000-4000-8000-00000000000a',
  exerciseName: 'Lateral Raise',
  setsLogged: 2,
  sets: [
    { setNumber: 1, reps: 15, weight: 10, weightUnit: 'kg', rpe: null },
    { setNumber: 2, reps: 12, weight: 10, weightUnit: 'kg', rpe: 8 },
  ],
  targetSets: 3,
  targetReps: '12-15',
  targetWeight: null,
};

describe('formatExerciseSummary — facts only (coach-simplification I1)', () => {
  it('renders the sets and the volume line and nothing that tells the model what to say', () => {
    const text = formatExerciseSummary(finishedExercise);
    expect(text).toContain("Exercise 'Lateral Raise' completed.");
    expect(text).toContain('Sets performed:');
    expect(text).toContain('Total: 2/3 sets.');
    expect(text).not.toMatch(/summariz|announce|recap|coaching comment|SESSION PLAN|next exercise/i);
    expect(text.trimEnd().endsWith('Total: 2/3 sets.')).toBe(true);
  });
});

// -------------------------------------------------------------------------
// set-kind plan Task 1 (D4, AC-SK-2): the completion summary's volume line excludes warm-ups.
// RED today: `Total:` counts every set in `ex.sets`, warm-up or not.
// -------------------------------------------------------------------------

describe('formatExerciseSummary — volume excludes warm-ups (set-kind plan D4, AC-SK-2)', () => {
  it('"Total:" counts only working sets against the target', () => {
    const exercise: AutoCompletedExercise = {
      exerciseId: '00000000-0000-4000-8000-00000000000b',
      exerciseName: 'Bench Press',
      setsLogged: 3,
      sets: [
        { setNumber: 1, reps: 10, weight: 40, weightUnit: 'kg', rpe: null, setKind: 'warmup' },
        { setNumber: 2, reps: 10, weight: 40, weightUnit: 'kg', rpe: null, setKind: 'warmup' },
        { setNumber: 3, reps: 10, weight: 60, weightUnit: 'kg', rpe: null, setKind: 'working' },
      ],
      targetSets: 3,
      targetReps: '8-10',
      targetWeight: null,
    };

    expect(formatExerciseSummary(exercise)).toContain('Total: 1/3 sets.');
  });

  it('a legacy set with no setKind still counts as working (AC-SK-3)', () => {
    const exercise: AutoCompletedExercise = {
      ...finishedExercise,
      sets: finishedExercise.sets.map(s => ({ ...s, setKind: undefined })),
    };

    expect(formatExerciseSummary(exercise)).toContain('Total: 2/3 sets.');
  });
});

// -------------------------------------------------------------------------
// load-plan plan Task 5b (D10, AC-LP-7): with LOAD_PLAN_PLANNER_REBIND on, the Target line
// prints sets × reps only — no plan target weight, even for a legacy row that still carries one.
// -------------------------------------------------------------------------

describe('formatExerciseSummary — Target line without the plan weight', () => {
  const legacyExercise: AutoCompletedExercise = { ...finishedExercise, targetWeight: '10' };

  it('always drops the plan weight (loads are not planned), keeps sets × reps and the logged sets untouched', () => {
    const text = formatExerciseSummary(legacyExercise);
    expect(text).toContain('Target: 3x12-15');
    expect(text).not.toContain('Target: 3x12-15 @ 10 kg');
    // The logged sets are the record of what happened — their weights stay.
    expect(text).toContain('Set 1: 15 reps @ 10 kg');
  });
});
