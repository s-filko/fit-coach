/**
 * The service side of `edit_last_workout` (stale-session-autoclose plan T5 / AC-SSA-5): the
 * user's most recent FINISHED workout is read, and the existing set operations work on it
 * without changing the session or its exercise statuses — `getLastFinishedSession`,
 * `logSetWithContext` with `finishedSession`, `updateLastSet` with a `setNumber`, `deleteSet`.
 */
import { WeightRequiredError } from '@domain/training/errors';

import { createMocks, makeExerciseWithDetails, makeSession, makeSessionSet } from './training-service-test-support';

const EX_ID = 'd8794819-ffc6-4d08-8336-d9bedc4e554a';

const finishedSession = () =>
  ({
    ...makeSession([
      makeExerciseWithDetails({
        id: 'se-bench',
        exerciseId: EX_ID,
        status: 'completed',
        sets: [
          makeSessionSet({ id: 'set-1', setNumber: 1 }),
          makeSessionSet({
            id: 'set-2',
            setNumber: 2,
            setData: { type: 'strength', reps: 8, weight: 55, weightUnit: 'kg' },
          }),
        ],
      }),
    ]),
    status: 'completed' as const,
    completedAt: new Date('2026-10-04T11:32:00.000Z'),
    lastActivityAt: new Date('2026-10-04T11:31:00.000Z'),
  }) as ReturnType<typeof makeSession>;

describe('TrainingService.getLastFinishedSession (AC-SSA-5)', () => {
  it('returns the details of the most recent completed session', async () => {
    const { trainingService, mockSessionRepo } = createMocks();
    const finished = finishedSession();
    mockSessionRepo.findLastCompletedByUserId.mockResolvedValue(finished);
    mockSessionRepo.findByIdWithDetails.mockResolvedValue(finished);

    const result = await trainingService.getLastFinishedSession('user-1');

    expect(mockSessionRepo.findLastCompletedByUserId).toHaveBeenCalledWith('user-1');
    expect(mockSessionRepo.findByIdWithDetails).toHaveBeenCalledWith('session-1');
    expect(result).toBe(finished);
  });

  it('returns null when the user has no completed session', async () => {
    const { trainingService, mockSessionRepo } = createMocks();
    mockSessionRepo.findLastCompletedByUserId.mockResolvedValue(null);

    expect(await trainingService.getLastFinishedSession('user-1')).toBeNull();
    expect(mockSessionRepo.findByIdWithDetails).not.toHaveBeenCalled();
  });
});

describe('TrainingService.logSetWithContext — finishedSession (AC-SSA-5)', () => {
  it('adds the set to the existing exercise without touching exercise statuses or session activity', async () => {
    const { trainingService, mockSessionRepo, mockSessionExerciseRepo, mockSessionSetRepo, mockExerciseRepo } =
      createMocks();
    mockSessionRepo.findByIdWithDetails.mockResolvedValue(finishedSession());
    mockExerciseRepo.findById.mockResolvedValue({ id: EX_ID, equipment: 'barbell' } as never);
    const at = new Date('2026-10-04T11:36:00.000Z');
    mockSessionSetRepo.create.mockResolvedValue(makeSessionSet({ id: 'set-3', setNumber: 3 }));

    const { setNumber } = await trainingService.logSetWithContext('session-1', {
      exerciseId: EX_ID,
      setData: { type: 'strength', reps: 6, weight: 55, weightUnit: 'kg' },
      createdAt: at,
      skipActivityUpdate: true,
      finishedSession: true,
    });

    expect(setNumber).toBe(3);
    expect(mockSessionSetRepo.create).toHaveBeenCalledWith('se-bench', expect.objectContaining({ createdAt: at }));
    expect(mockSessionExerciseRepo.update).not.toHaveBeenCalled();
    expect(mockSessionRepo.updateActivity).not.toHaveBeenCalled();
    expect(mockSessionRepo.update).not.toHaveBeenCalled();
  });

  it('an exercise not in the workout is added to it as a completed row; no other row changes', async () => {
    const { trainingService, mockSessionRepo, mockSessionExerciseRepo, mockSessionSetRepo, mockExerciseRepo } =
      createMocks();
    const other = 'a1111111-ffc6-4d08-8336-d9bedc4e554a';
    mockSessionRepo.findByIdWithDetails.mockResolvedValue(finishedSession());
    mockExerciseRepo.findById.mockResolvedValue({ id: other, equipment: 'bodyweight' } as never);
    mockSessionExerciseRepo.create.mockResolvedValue({ id: 'se-new', exerciseId: other } as never);
    mockSessionSetRepo.create.mockResolvedValue(makeSessionSet({ id: 'set-n', setNumber: 1 }));

    await trainingService.logSetWithContext('session-1', {
      exerciseId: other,
      setData: { type: 'functional_reps', reps: 12 },
      skipActivityUpdate: true,
      finishedSession: true,
    });

    expect(mockSessionExerciseRepo.create).toHaveBeenCalledWith(
      'session-1',
      expect.objectContaining({ exerciseId: other }),
    );
    expect(mockSessionExerciseRepo.update).toHaveBeenCalledTimes(1);
    expect(mockSessionExerciseRepo.update).toHaveBeenCalledWith('se-new', { status: 'completed' });
    expect(mockSessionRepo.updateActivity).not.toHaveBeenCalled();
  });
});

describe('review R3 — row statuses of a finished workout', () => {
  it('a set added to a skipped row makes the row completed', async () => {
    const { trainingService, mockSessionRepo, mockSessionExerciseRepo, mockSessionSetRepo, mockExerciseRepo } =
      createMocks();
    const session = finishedSession();
    session.exercises[0]!.status = 'skipped';
    session.exercises[0]!.sets = [];
    mockSessionRepo.findByIdWithDetails.mockResolvedValue(session);
    mockExerciseRepo.findById.mockResolvedValue({ id: EX_ID, equipment: 'barbell' } as never);
    mockSessionSetRepo.create.mockResolvedValue(makeSessionSet({ id: 'set-n', setNumber: 1 }));

    await trainingService.logSetWithContext('session-1', {
      exerciseId: EX_ID,
      setData: { type: 'strength', reps: 6, weight: 55, weightUnit: 'kg' },
      finishedSession: true,
    });

    expect(mockSessionExerciseRepo.update).toHaveBeenCalledWith('se-bench', { status: 'completed' });
  });

  it("deleting the last set of a completed session's row makes it skipped; a row with sets left keeps its status", async () => {
    const { trainingService, mockSessionRepo, mockSessionExerciseRepo } = createMocks();
    const session = finishedSession();
    session.exercises[0]!.sets = [session.exercises[0]!.sets[0]!];
    mockSessionRepo.findByIdWithDetails.mockResolvedValue(session);

    await trainingService.deleteSet('session-1', EX_ID, 1);

    expect(mockSessionExerciseRepo.update).toHaveBeenCalledWith('se-bench', { status: 'skipped' });

    mockSessionExerciseRepo.update.mockClear();
    mockSessionRepo.findByIdWithDetails.mockResolvedValue(finishedSession());
    await trainingService.deleteSet('session-1', EX_ID, 2);
    expect(mockSessionExerciseRepo.update).not.toHaveBeenCalled();
  });
});

describe('merge with plan-and-tool-fixes — the weight rule (AC-PTF-7) applies to a finished workout', () => {
  it('add: a required exercise + reps without a weight → WeightRequiredError, nothing written (no row, set or status change)', async () => {
    const { trainingService, mockSessionRepo, mockSessionExerciseRepo, mockSessionSetRepo, mockExerciseRepo } =
      createMocks();
    mockSessionRepo.findByIdWithDetails.mockResolvedValue(finishedSession());
    mockExerciseRepo.findById.mockResolvedValue({
      id: EX_ID,
      name: 'Barbell Bench Press',
      weightMode: 'required',
    } as never);

    await expect(
      trainingService.logSetWithContext('session-1', {
        exerciseId: EX_ID,
        setData: { type: 'functional_reps', reps: 8 },
        weightOmitted: true,
        finishedSession: true,
      }),
    ).rejects.toBeInstanceOf(WeightRequiredError);

    expect(mockSessionSetRepo.create).not.toHaveBeenCalled();
    expect(mockSessionExerciseRepo.create).not.toHaveBeenCalled();
    expect(mockSessionExerciseRepo.update).not.toHaveBeenCalled();
    expect(mockSessionRepo.updateActivity).not.toHaveBeenCalled();
  });

  it('add: an optional (bodyweight) exercise + reps without a weight is stored as a bodyweight set', async () => {
    const { trainingService, mockSessionRepo, mockSessionSetRepo, mockExerciseRepo } = createMocks();
    mockSessionRepo.findByIdWithDetails.mockResolvedValue(finishedSession());
    mockExerciseRepo.findById.mockResolvedValue({ id: EX_ID, name: 'Pull-ups', weightMode: 'optional' } as never);
    mockSessionSetRepo.create.mockResolvedValue(makeSessionSet({ id: 'set-n', setNumber: 3 }));

    await trainingService.logSetWithContext('session-1', {
      exerciseId: EX_ID,
      setData: { type: 'functional_reps', reps: 8 },
      weightOmitted: true,
      finishedSession: true,
    });

    expect(mockSessionSetRepo.create).toHaveBeenCalledWith(
      'se-bench',
      expect.objectContaining({ setData: { type: 'functional_reps', reps: 8 } }),
    );
  });

  it('update: an explicit weight 0 on a named set makes it a bodyweight set (same rule as update_last_set)', async () => {
    const { trainingService, mockSessionRepo, mockSessionSetRepo } = createMocks();
    const session = finishedSession();
    mockSessionRepo.findByIdWithDetails.mockResolvedValue(session);
    const first = session.exercises[0]!.sets[0]!;
    mockSessionSetRepo.update.mockImplementation(async (_id, patch) => ({ ...first, ...patch }) as never);

    await trainingService.updateLastSet('session-1', EX_ID, { weight: 0 }, { setNumber: 1 });

    expect(mockSessionSetRepo.update).toHaveBeenCalledWith(
      'set-1',
      expect.objectContaining({ setData: { type: 'functional_reps', reps: 10 } }),
    );
  });
});

describe('TrainingService.updateLastSet — setNumber (AC-SSA-5)', () => {
  it('updates the named set instead of the last one', async () => {
    const { trainingService, mockSessionRepo, mockSessionSetRepo } = createMocks();
    const session = finishedSession();
    mockSessionRepo.findByIdWithDetails.mockResolvedValue(session);
    const first = session.exercises[0]!.sets[0]!;
    mockSessionSetRepo.update.mockImplementation(async (_id, patch) => ({ ...first, ...patch }) as never);

    const result = await trainingService.updateLastSet('session-1', EX_ID, { reps: 12 }, { setNumber: 1 });

    expect(mockSessionSetRepo.update).toHaveBeenCalledWith(
      'set-1',
      expect.objectContaining({ setData: expect.objectContaining({ reps: 12 }) }),
    );
    expect(result.setNumber).toBe(1);
  });

  it('refuses a set number the exercise does not have', async () => {
    const { trainingService, mockSessionRepo, mockSessionSetRepo } = createMocks();
    mockSessionRepo.findByIdWithDetails.mockResolvedValue(finishedSession());

    await expect(trainingService.updateLastSet('session-1', EX_ID, { reps: 12 }, { setNumber: 5 })).rejects.toThrow(
      /set 5/i,
    );
    expect(mockSessionSetRepo.update).not.toHaveBeenCalled();
  });
});

describe('TrainingService.deleteSet (AC-SSA-5)', () => {
  it('deletes the named set and reports what was removed', async () => {
    const { trainingService, mockSessionRepo, mockSessionSetRepo } = createMocks();
    mockSessionRepo.findByIdWithDetails.mockResolvedValue(finishedSession());

    const result = await trainingService.deleteSet('session-1', EX_ID, 2);

    expect(mockSessionSetRepo.deleteById).toHaveBeenCalledTimes(1);
    expect(mockSessionSetRepo.deleteById).toHaveBeenCalledWith('set-2');
    expect(result.deletedSets).toEqual([
      { setNumber: 2, setData: { type: 'strength', reps: 8, weight: 55, weightUnit: 'kg' }, rpe: null },
    ]);
  });

  it('refuses a set number the exercise does not have', async () => {
    const { trainingService, mockSessionRepo, mockSessionSetRepo } = createMocks();
    mockSessionRepo.findByIdWithDetails.mockResolvedValue(finishedSession());

    await expect(trainingService.deleteSet('session-1', EX_ID, 9)).rejects.toThrow(/set 9/i);
    expect(mockSessionSetRepo.deleteById).not.toHaveBeenCalled();
  });
});
