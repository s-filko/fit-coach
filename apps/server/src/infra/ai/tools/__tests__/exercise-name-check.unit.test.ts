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

  it('D16: a name with NO real (>= 3 letter) words accepts — nothing left to contradict the catalog', () => {
    // Pre-D16 this rejected "Up" as a short token with nothing in common; under containment an
    // empty word list satisfies "every word matches" vacuously — same reasoning as "Smith Machine"
    // being emptied by stop-word removal below.
    const result = checkExerciseNamesAgainstCatalog(
      [{ exerciseId: 'id-1', exerciseName: 'Up' }],
      new Map([['id-1', 'Pull-ups']]),
    );

    expect(result.rejection).toBeNull();
    expect(result.corrected).toEqual([{ exerciseId: 'id-1', exerciseName: 'Pull-ups' }]);
  });

  // Close-out review item 2: a shared prefix of >= 4 chars between any pair of tokens passes —
  // plural/singular and compound-word drift must not be treated as a mismatch.
  describe('prefix match (>= 4 shared chars) — item 2', () => {
    it.each([
      ['Squats', 'Squat'],
      ['Lunges', 'Lunge'],
      ['Pullups', 'Pull-ups'],
    ])('%s (plan) vs %s (catalog) passes', (planName, catalogName) => {
      const result = checkExerciseNamesAgainstCatalog(
        [{ exerciseId: 'id-1', exerciseName: planName }],
        new Map([['id-1', catalogName]]),
      );

      expect(result.rejection).toBeNull();
      expect(result.corrected).toEqual([{ exerciseId: 'id-1', exerciseName: catalogName }]);
    });

    it('a non-English name is still rejected — the catalog is English-only, message says so', () => {
      const result = checkExerciseNamesAgainstCatalog(
        [{ exerciseId: 'id-1', exerciseName: 'Жим лёжа' }],
        new Map([['id-1', 'Barbell Bench Press']]),
      );

      expect(result.rejection).not.toBeNull();
      const { message } = result.rejection as { message: string };
      expect(message).toContain('"Жим лёжа" → id is "Barbell Bench Press"');
      expect(message).toContain('English catalog name');
    });
  });

  // Close-out review item 3: equipment/modifier words must not be enough to pass a mismatch
  // between two genuinely different exercises that merely share the same equipment.
  describe('equipment/modifier stop words never match alone — item 3', () => {
    it('rejects "Barbell Row" naming Barbell Bench Press\'s id (shared word is only "barbell")', () => {
      const result = checkExerciseNamesAgainstCatalog(
        [{ exerciseId: 'id-1', exerciseName: 'Barbell Row' }],
        new Map([['id-1', 'Barbell Bench Press']]),
      );

      expect(result.rejection).not.toBeNull();
    });

    it('rejects "Dumbbell Curl" naming Dumbbell Bench Press\'s id (shared word is only "dumbbell")', () => {
      const result = checkExerciseNamesAgainstCatalog(
        [{ exerciseId: 'id-1', exerciseName: 'Dumbbell Curl' }],
        new Map([['id-1', 'Dumbbell Bench Press']]),
      );

      expect(result.rejection).not.toBeNull();
    });

    it('accepts "45° Leg Press" naming Leg Press\'s id — "leg" is a body part, not a stop word', () => {
      const result = checkExerciseNamesAgainstCatalog(
        [{ exerciseId: 'id-1', exerciseName: '45° Leg Press' }],
        new Map([['id-1', 'Leg Press']]),
      );

      expect(result.rejection).toBeNull();
      expect(result.corrected).toEqual([{ exerciseId: 'id-1', exerciseName: 'Leg Press' }]);
    });
  });

  // D16 (reviewer advisory, accepted): containment, not any-overlap — every word of the shorter
  // (non-stop-word) list must match some word of the other. Fixes the false accept any-overlap gave
  // "Leg Curl" against "Leg Extension" (shared "leg") while keeping every earlier accepted case.
  describe('containment rule (D16)', () => {
    it.each([
      ['Bench Press', 'Barbell Bench Press'],
      ['Lat Pulldown', 'Lever Lat Pulldown (Plate-Loaded)'],
      ['Plank', 'Plank'],
      ['45° Leg Press', '45° Leg Press'],
      ['Squats', 'Barbell Back Squat'],
      ['Pullups', 'Pull-ups'],
      ['Tricep Pushdown', 'Cable Tricep Pushdown, Rope'],
      ['Smith Machine', 'Smith Machine Squat'],
    ])('accepts "%s" naming %s\'s id', (planName, catalogName) => {
      const result = checkExerciseNamesAgainstCatalog(
        [{ exerciseId: 'id-1', exerciseName: planName }],
        new Map([['id-1', catalogName]]),
      );

      expect(result.rejection).toBeNull();
      expect(result.corrected).toEqual([{ exerciseId: 'id-1', exerciseName: catalogName }]);
    });

    it.each([
      ['Leg Curl', 'Leg Extension'],
      ['Barbell Row', 'Barbell Bench Press'],
      ['Treadmill', 'Rowing Machine'],
      ['Dead Bug', 'Deadlift'],
      ['Bicep Curl', 'Leg Curl'],
      ['Calf Raise', 'Lateral Raise'],
      ['Жим лёжа', 'Barbell Bench Press'],
    ])('rejects "%s" naming %s\'s id', (planName, catalogName) => {
      const result = checkExerciseNamesAgainstCatalog(
        [{ exerciseId: 'id-1', exerciseName: planName }],
        new Map([['id-1', catalogName]]),
      );

      expect(result.rejection).not.toBeNull();
      const { message } = result.rejection as { message: string };
      expect(message).toContain(`"${planName}" → id is "${catalogName}"`);
    });
  });
});
