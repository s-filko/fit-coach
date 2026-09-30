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

describe('formatExerciseSummary — instruction text per transition kind (BUG-037)', () => {
  it('set-triggered (log_set path): tells the model to confirm the reported set FIRST, recap of the finished exercise brief and at the end', () => {
    const text = formatExerciseSummary(finishedExercise, 'set-triggered');
    const confirmIdx = /(confirm|acknowledge|reply to|respond to)[^.\n]{0,140}\bset\b/i.exec(text)?.index ?? -1;
    const recapIdx = /recap[^.\n]{0,140}\b(finished|completed|previous|prior)\b/i.exec(text)?.index ?? -1;
    expect(confirmIdx).toBeGreaterThan(-1);
    expect(recapIdx).toBeGreaterThan(-1);
    expect(confirmIdx).toBeLessThan(recapIdx);
    // The recap is a side note, not the answer.
    expect(text.slice(Math.max(0, recapIdx - 200), recapIdx + 200)).toMatch(/\b(brief|short|concise)\b/i);
  });

  it('set-triggered (log_set path): never tells the model to announce the next exercise — the user already started it', () => {
    expect(formatExerciseSummary(finishedExercise, 'set-triggered')).not.toMatch(/announce[^.\n]{0,80}next exercise/i);
  });

  it('explicit (complete_current_exercise path): keeps the full summary and the announcement', () => {
    const text = formatExerciseSummary(finishedExercise, 'explicit');
    expect(text).toMatch(/summariz[ei][^.\n]{0,140}exercise/i);
    expect(text).toMatch(/announce[^.\n]{0,80}next exercise/i);
  });

  it('both modes render the same factual payload — only the instruction line differs', () => {
    const setTriggered = formatExerciseSummary(finishedExercise, 'set-triggered');
    const explicit = formatExerciseSummary(finishedExercise, 'explicit');
    for (const text of [setTriggered, explicit]) {
      expect(text).toContain("Exercise 'Lateral Raise' completed.");
      expect(text).toContain('Sets performed:');
      expect(text).toContain('Total: 2/3 sets.');
    }
    const factsOf = (text: string) => text.slice(0, text.indexOf('Total:'));
    expect(factsOf(setTriggered)).toBe(factsOf(explicit));
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

describe('formatExerciseSummary — Target line without the plan weight (load-plan plan Task 5b)', () => {
  const legacyExercise: AutoCompletedExercise = { ...finishedExercise, targetWeight: '10' };

  it('default (flag off) keeps printing the target weight (legacy behaviour)', () => {
    expect(formatExerciseSummary(legacyExercise)).toContain('Target: 3x12-15 @ 10 kg');
  });

  it('omitTargetWeight drops the weight, keeps sets × reps and the logged sets untouched', () => {
    const text = formatExerciseSummary(legacyExercise, 'explicit', { omitTargetWeight: true });
    expect(text).toContain('Target: 3x12-15');
    expect(text).not.toContain('Target: 3x12-15 @ 10 kg');
    // The logged sets are the record of what happened — their weights stay.
    expect(text).toContain('Set 1: 15 reps @ 10 kg');
  });
});
