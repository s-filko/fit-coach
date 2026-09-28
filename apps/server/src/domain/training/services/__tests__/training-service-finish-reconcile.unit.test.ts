/**
 * set-kind plan Task 2 (D7, AC-SK-6): `completeSession` reconciles the plan at finish — an
 * in_progress exercise with zero sets ends `skipped` (RED today: `completed`), and every plan
 * exercise with no `session_exercises` row gets one with the plan's targets and status `skipped`
 * (RED today: no row is ever created). A plan id that is not a valid UUID (legacy placeholder)
 * must be skipped over, not sent to the DB.
 */
import type { WorkoutSessionWithDetails } from '@domain/training/types';

import { createMocks, makeExerciseWithDetails, makeSession, makeSessionSet } from './training-service-test-support';

const BENCH_ID = 'c7b0899c-a0f9-47ca-a69d-4bcd531b0c95';
const PULL_UPS_ID = '8c88ebce-f5df-4d33-afdb-0b096a0dd7a8';

function makeSessionWithPlan(exercises: ReturnType<typeof makeExerciseWithDetails>[]): WorkoutSessionWithDetails {
  return {
    ...makeSession(exercises),
    sessionPlanJson: {
      sessionKey: 'upper_a',
      sessionName: 'Upper A',
      reasoning: 'Upper day per the active split.',
      exercises: [
        {
          exerciseId: BENCH_ID,
          exerciseName: 'Barbell Bench Press',
          targetSets: 3,
          targetReps: '8-10',
          restSeconds: 120,
        },
        {
          exerciseId: PULL_UPS_ID,
          exerciseName: 'Pull-ups',
          targetSets: 3,
          targetReps: '6-8',
          restSeconds: 120,
        },
      ],
      estimatedDuration: 60,
    },
  };
}

describe('TrainingService.completeSession — finish reconciliation (set-kind plan D7, AC-SK-6)', () => {
  it('marks an in_progress exercise with zero sets skipped, not completed', async () => {
    const { trainingService, mockSessionRepo, mockSessionExerciseRepo } = createMocks();
    const zeroSet = makeExerciseWithDetails({ id: 'se-1', exerciseId: BENCH_ID, status: 'in_progress', sets: [] });
    mockSessionRepo.findByIdWithDetails.mockResolvedValue(makeSessionWithPlan([zeroSet]));
    mockSessionRepo.complete.mockResolvedValue({ ...makeSessionWithPlan([]), status: 'completed' });
    mockSessionExerciseRepo.update.mockResolvedValue({ ...zeroSet, status: 'skipped' });
    mockSessionExerciseRepo.create.mockResolvedValue(zeroSet);

    await trainingService.completeSession('session-1');

    expect(mockSessionExerciseRepo.update).toHaveBeenCalledWith('se-1', { status: 'skipped' });
  });

  it('still completes an in_progress exercise that has sets', async () => {
    const { trainingService, mockSessionRepo, mockSessionExerciseRepo } = createMocks();
    const withSets = makeExerciseWithDetails({
      id: 'se-1',
      exerciseId: BENCH_ID,
      status: 'in_progress',
      sets: [makeSessionSet({ setNumber: 1 }), makeSessionSet({ setNumber: 2 })],
    });
    mockSessionRepo.findByIdWithDetails.mockResolvedValue(makeSessionWithPlan([withSets]));
    mockSessionRepo.complete.mockResolvedValue({ ...makeSessionWithPlan([]), status: 'completed' });
    mockSessionExerciseRepo.update.mockResolvedValue({ ...withSets, status: 'completed' });
    mockSessionExerciseRepo.create.mockResolvedValue(withSets);

    await trainingService.completeSession('session-1');

    expect(mockSessionExerciseRepo.update).toHaveBeenCalledWith('se-1', { status: 'completed' });
  });

  it('creates a skipped row with the plan targets for every plan exercise with no row', async () => {
    const { trainingService, mockSessionRepo, mockSessionExerciseRepo, mockExerciseRepo } = createMocks();
    const bench = makeExerciseWithDetails({
      id: 'se-1',
      exerciseId: BENCH_ID,
      status: 'completed',
      sets: [makeSessionSet()],
    });
    mockSessionRepo.findByIdWithDetails.mockResolvedValue(makeSessionWithPlan([bench]));
    mockSessionRepo.complete.mockResolvedValue({ ...makeSessionWithPlan([]), status: 'completed' });
    mockSessionExerciseRepo.update.mockResolvedValue(bench);
    mockSessionExerciseRepo.create.mockResolvedValue(makeExerciseWithDetails({ exerciseId: PULL_UPS_ID }));
    mockExerciseRepo.findById.mockResolvedValue({ id: PULL_UPS_ID } as never);

    await trainingService.completeSession('session-1');

    expect(mockSessionExerciseRepo.create).toHaveBeenCalledWith(
      'session-1',
      expect.objectContaining({ exerciseId: PULL_UPS_ID, targetSets: 3, targetReps: '6-8' }),
    );
  });

  it('never sends a non-UUID legacy plan id to the DB', async () => {
    const { trainingService, mockSessionRepo, mockSessionExerciseRepo } = createMocks();
    const session = makeSessionWithPlan([]);
    // A legacy placeholder that was never a catalog id (training.spec.ts's guard case).
    session.sessionPlanJson!.exercises = [
      { exerciseId: 'calf-raise-placeholder', targetSets: 4, targetReps: '15', restSeconds: 60 },
    ];
    mockSessionRepo.findByIdWithDetails.mockResolvedValue(session);
    mockSessionRepo.complete.mockResolvedValue({ ...session, status: 'completed' });
    mockSessionExerciseRepo.create.mockResolvedValue(makeExerciseWithDetails());

    await trainingService.completeSession('session-1');

    expect(mockSessionExerciseRepo.create).not.toHaveBeenCalled();
  });

  it('skips a well-formed plan id that is not a real catalog exercise, without a create call (close-out review advisory R3)', async () => {
    const { trainingService, mockSessionRepo, mockSessionExerciseRepo, mockExerciseRepo } = createMocks();
    const session = makeSessionWithPlan([]);
    mockSessionRepo.findByIdWithDetails.mockResolvedValue(session);
    mockSessionRepo.complete.mockResolvedValue({ ...session, status: 'completed' });
    mockExerciseRepo.findById.mockResolvedValue(null);

    await trainingService.completeSession('session-1');

    expect(mockExerciseRepo.findById).toHaveBeenCalledWith(BENCH_ID);
    expect(mockExerciseRepo.findById).toHaveBeenCalledWith(PULL_UPS_ID);
    expect(mockSessionExerciseRepo.create).not.toHaveBeenCalled();
  });

  it('creates only one skipped row for a plan id repeated in session_plan_json (close-out review advisory R3)', async () => {
    const { trainingService, mockSessionRepo, mockSessionExerciseRepo, mockExerciseRepo } = createMocks();
    const session = makeSessionWithPlan([]);
    session.sessionPlanJson!.exercises = [
      {
        exerciseId: BENCH_ID,
        exerciseName: 'Barbell Bench Press',
        targetSets: 3,
        targetReps: '8-10',
        restSeconds: 120,
      },
      {
        exerciseId: BENCH_ID,
        exerciseName: 'Barbell Bench Press',
        targetSets: 3,
        targetReps: '8-10',
        restSeconds: 120,
      },
    ];
    mockSessionRepo.findByIdWithDetails.mockResolvedValue(session);
    mockSessionRepo.complete.mockResolvedValue({ ...session, status: 'completed' });
    mockExerciseRepo.findById.mockResolvedValue({ id: BENCH_ID } as never);
    mockSessionExerciseRepo.create.mockResolvedValue(makeExerciseWithDetails({ exerciseId: BENCH_ID }));

    await trainingService.completeSession('session-1');

    expect(mockSessionExerciseRepo.create).toHaveBeenCalledTimes(1);
  });
});

describe('TrainingService — auto-close reconciles before marking the session completed (close-out review advisory R3)', () => {
  it('reconciles a timed-out session (via findTimedOut) before autoCloseTimedOut runs', async () => {
    const { trainingService, mockSessionRepo, mockSessionExerciseRepo } = createMocks();
    const zeroSet = makeExerciseWithDetails({ id: 'se-1', exerciseId: BENCH_ID, status: 'in_progress', sets: [] });
    const timedOutSession = makeSession([zeroSet]);

    mockSessionRepo.findTimedOut.mockResolvedValue([{ id: 'session-1', userId: 'user-1' } as never]);
    mockSessionRepo.findByIdWithDetails.mockResolvedValue(timedOutSession);
    mockSessionRepo.findActiveByUserId.mockResolvedValue(null);
    mockSessionRepo.findRecentByUserIdWithDetails.mockResolvedValue([]);
    mockSessionExerciseRepo.update.mockResolvedValue({ ...zeroSet, status: 'skipped' });

    await trainingService.getActiveSession('user-1');

    expect(mockSessionExerciseRepo.update).toHaveBeenCalledWith('se-1', { status: 'skipped' });
    const [reconcileOrder] = mockSessionExerciseRepo.update.mock.invocationCallOrder;
    const [autoCloseOrder] = mockSessionRepo.autoCloseTimedOut.mock.invocationCallOrder;
    expect(reconcileOrder).toBeLessThan(autoCloseOrder);
  });
});

describe('TrainingService.setSessionPlace — session place (set-kind plan D6, AC-SK-5)', () => {
  it('updates the session row with the place and returns it', async () => {
    const { trainingService, mockSessionRepo } = createMocks();
    const session = makeSessionWithPlan([]);
    mockSessionRepo.findById.mockResolvedValue(session);
    mockSessionRepo.update.mockResolvedValue({ ...session, place: 'Fitness House на Ленина' });

    const updated = await trainingService.setSessionPlace('session-1', 'Fitness House на Ленина');

    expect(mockSessionRepo.update).toHaveBeenCalledWith('session-1', { place: 'Fitness House на Ленина' });
    expect(updated.place).toBe('Fitness House на Ленина');
  });

  it('throws on an unknown session, writing nothing', async () => {
    const { trainingService, mockSessionRepo } = createMocks();
    mockSessionRepo.findById.mockResolvedValue(null);

    await expect(trainingService.setSessionPlace('nope', 'дома')).rejects.toThrow('Session not found');
    expect(mockSessionRepo.update).not.toHaveBeenCalled();
  });
});
