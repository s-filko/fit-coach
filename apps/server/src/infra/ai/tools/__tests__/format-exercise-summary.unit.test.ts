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
