/**
 * `checkExerciseNamesAgainstCatalog` (training-history-lookup plan D5) — the plan-save name/id
 * check `start_training_session` and `save_workout_plan` share. Pure unit tests over the helper
 * itself; the tools' own tests cover wiring (unit + `plan-name-check.integration.test.ts`).
 */
import { checkExerciseNamesAgainstCatalog } from '../exercise-name-check';

describe('checkExerciseNamesAgainstCatalog (AC-HL-5)', () => {
  it('passes an entry through unchanged when it has no exerciseName', () => {
    const result = checkExerciseNamesAgainstCatalog(
      [{ exerciseId: 'id-1' }],
      new Map([['id-1', 'Barbell Bench Press']]),
    );

    expect(result.rejection).toBeNull();
    expect(result.corrected).toEqual([{ exerciseId: 'id-1' }]);
  });

  it('passes an entry through unchanged when its id is not in the catalog map (missing-id check runs first)', () => {
    const result = checkExerciseNamesAgainstCatalog(
      [{ exerciseId: 'unknown-id', exerciseName: 'Whatever' }],
      new Map([['id-1', 'Barbell Bench Press']]),
    );

    expect(result.rejection).toBeNull();
    expect(result.corrected).toEqual([{ exerciseId: 'unknown-id', exerciseName: 'Whatever' }]);
  });

  it('corrects a partial name that shares a word (>= 3 letters) with the catalog name', () => {
    const result = checkExerciseNamesAgainstCatalog(
      [{ exerciseId: 'id-1', exerciseName: 'Bench Press' }],
      new Map([['id-1', 'Barbell Bench Press']]),
    );

    expect(result.rejection).toBeNull();
    expect(result.corrected).toEqual([{ exerciseId: 'id-1', exerciseName: 'Barbell Bench Press' }]);
  });

  it('leaves an already-matching name as the same object (no unnecessary copy)', () => {
    const entry = { exerciseId: 'id-1', exerciseName: 'Barbell Bench Press' };
    const result = checkExerciseNamesAgainstCatalog([entry], new Map([['id-1', 'Barbell Bench Press']]));

    expect(result.corrected[0]).toBe(entry);
  });

  it('is case-insensitive and Unicode-aware', () => {
    const result = checkExerciseNamesAgainstCatalog(
      [{ exerciseId: 'id-1', exerciseName: 'ЖИМ лёжа' }],
      new Map([['id-1', 'жим лёжа штанги']]),
    );

    expect(result.rejection).toBeNull();
    expect(result.corrected).toEqual([{ exerciseId: 'id-1', exerciseName: 'жим лёжа штанги' }]);
  });

  it('rejects with an llm_error listing the mismatch when no word is shared (the live BUG-030 D19 case)', () => {
    const result = checkExerciseNamesAgainstCatalog(
      [{ exerciseId: 'id-rowing', exerciseName: 'Treadmill' }],
      new Map([['id-rowing', 'Rowing Machine']]),
    );

    expect(result.rejection).not.toBeNull();
    expect(result.rejection).toMatchObject({ ok: false, kind: 'llm_error' });
    expect((result.rejection as { message: string }).message).toContain('"Treadmill" → id is "Rowing Machine"');
    expect((result.rejection as { message: string }).message).toContain('search_exercises');
    // Nothing is corrected on rejection — the caller must persist nothing.
    expect(result.corrected).toEqual([{ exerciseId: 'id-rowing', exerciseName: 'Treadmill' }]);
  });

  it('rejects the whole batch and lists EVERY mismatch when several entries disagree', () => {
    const result = checkExerciseNamesAgainstCatalog(
      [
        { exerciseId: 'id-1', exerciseName: 'Bench Press' }, // matches, would not appear
        { exerciseId: 'id-2', exerciseName: 'Treadmill' }, // mismatch
        { exerciseId: 'id-3', exerciseName: 'Deadlift' }, // mismatch
      ],
      new Map([
        ['id-1', 'Barbell Bench Press'],
        ['id-2', 'Rowing Machine'],
        ['id-3', 'Pull-ups'],
      ]),
    );

    expect(result.rejection).not.toBeNull();
    const { message } = result.rejection as { message: string };
    expect(message).toContain('"Treadmill" → id is "Rowing Machine"');
    expect(message).toContain('"Deadlift" → id is "Pull-ups"');
    expect(message).not.toContain('Bench Press" → id is'); // the matching entry is never listed
  });

  it('never matches on words shorter than 3 letters alone', () => {
    // "8" / "up" style short tokens must not create a false match between unrelated exercises.
    const result = checkExerciseNamesAgainstCatalog(
      [{ exerciseId: 'id-1', exerciseName: 'Up' }],
      new Map([['id-1', 'Pull-ups']]),
    );

    expect(result.rejection).not.toBeNull();
  });
});
