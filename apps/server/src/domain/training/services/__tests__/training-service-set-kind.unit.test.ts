/**
 * set-kind plan Task 1 (D2, D3, D5, AC-SK-1, AC-SK-4, AC-SK-8): `logSetWithContext` defaults
 * `setKind` to 'working' and resolves the exercise's equipment once to decide `perHand`;
 * `updateLastSet` accepts `setKind`. RED today: `logSet`/`sessionSetRepo.create` are never called
 * with a `setKind`, and no equipment lookup happens for `perHand`.
 */
import type { EnsureExerciseResult } from '@domain/training/ports';
import type { Exercise } from '@domain/training/types';
import type { TrainingService } from '@domain/training/services/training.service';

import { createMocks, makeSessionExercise, makeSessionSet } from './training-service-test-support';

const DUMBBELL_EXERCISE: Exercise = {
  id: 'ex-dumbbell',
  name: 'Dumbbell Curl',
  category: 'isolation',
  equipment: 'dumbbell',
  weightMode: 'required',
  exerciseType: 'strength',
  description: null,
  energyCost: 'low',
  complexity: 'beginner',
  typicalDurationMinutes: 5,
  requiresSpotter: false,
  imageUrl: null,
  videoUrl: null,
  createdAt: new Date(),
};

const BARBELL_EXERCISE: Exercise = {
  ...DUMBBELL_EXERCISE,
  id: 'ex-barbell',
  name: 'Barbell Row',
  equipment: 'barbell',
};

describe('TrainingService.logSetWithContext — setKind default (set-kind plan D2, AC-SK-1)', () => {
  it('defaults setKind to working when the caller passes none', async () => {
    const { trainingService, mockSessionSetRepo, mockSessionExerciseRepo, mockExerciseRepo } = createMocks();
    const sessionExercise = makeSessionExercise({ id: 'se-1', exerciseId: BARBELL_EXERCISE.id, status: 'in_progress' });
    const ensureResult: EnsureExerciseResult = { exercise: sessionExercise };
    jest.spyOn(trainingService, 'ensureCurrentExercise').mockResolvedValue(ensureResult);
    mockSessionExerciseRepo.findById.mockResolvedValue(sessionExercise);
    mockExerciseRepo.findById.mockResolvedValue(BARBELL_EXERCISE);
    mockSessionSetRepo.create.mockResolvedValue(makeSessionSet({ setNumber: 1, setKind: 'working' }));

    await trainingService.logSetWithContext('session-1', {
      exerciseId: BARBELL_EXERCISE.id,
      setData: { type: 'strength', reps: 10, weight: 80, weightUnit: 'kg' },
    });

    expect(mockSessionSetRepo.create).toHaveBeenCalledWith('se-1', expect.objectContaining({ setKind: 'working' }));
  });

  it('passes setKind warmup through when the caller says warmup', async () => {
    const { trainingService, mockSessionSetRepo, mockSessionExerciseRepo, mockExerciseRepo } = createMocks();
    const sessionExercise = makeSessionExercise({ id: 'se-1', exerciseId: BARBELL_EXERCISE.id, status: 'in_progress' });
    const ensureResult: EnsureExerciseResult = { exercise: sessionExercise };
    jest.spyOn(trainingService, 'ensureCurrentExercise').mockResolvedValue(ensureResult);
    mockSessionExerciseRepo.findById.mockResolvedValue(sessionExercise);
    mockExerciseRepo.findById.mockResolvedValue(BARBELL_EXERCISE);
    mockSessionSetRepo.create.mockResolvedValue(makeSessionSet({ setNumber: 1, setKind: 'warmup' }));

    await trainingService.logSetWithContext('session-1', {
      exerciseId: BARBELL_EXERCISE.id,
      setData: { type: 'strength', reps: 10, weight: 40, weightUnit: 'kg' },
      setKind: 'warmup',
    });

    expect(mockSessionSetRepo.create).toHaveBeenCalledWith('se-1', expect.objectContaining({ setKind: 'warmup' }));
  });
});

describe('TrainingService.logSetWithContext — perHand load basis (set-kind plan D5, AC-SK-4)', () => {
  it('sets perHand true on a dumbbell exercise when no weightBasis was passed', async () => {
    const { trainingService, mockSessionSetRepo, mockSessionExerciseRepo, mockExerciseRepo } = createMocks();
    const sessionExercise = makeSessionExercise({
      id: 'se-1',
      exerciseId: DUMBBELL_EXERCISE.id,
      status: 'in_progress',
    });
    const ensureResult: EnsureExerciseResult = { exercise: sessionExercise };
    jest.spyOn(trainingService, 'ensureCurrentExercise').mockResolvedValue(ensureResult);
    mockSessionExerciseRepo.findById.mockResolvedValue(sessionExercise);
    mockExerciseRepo.findById.mockResolvedValue(DUMBBELL_EXERCISE);
    mockSessionSetRepo.create.mockResolvedValue(makeSessionSet({ setNumber: 1 }));

    await trainingService.logSetWithContext('session-1', {
      exerciseId: DUMBBELL_EXERCISE.id,
      setData: { type: 'strength', reps: 10, weight: 12, weightUnit: 'kg' },
    });

    expect(mockSessionSetRepo.create).toHaveBeenCalledWith(
      'se-1',
      expect.objectContaining({ setData: expect.objectContaining({ perHand: true }) }),
    );
  });

  it('sets perHand false on a dumbbell exercise when weightBasis is total', async () => {
    const { trainingService, mockSessionSetRepo, mockSessionExerciseRepo, mockExerciseRepo } = createMocks();
    const sessionExercise = makeSessionExercise({
      id: 'se-1',
      exerciseId: DUMBBELL_EXERCISE.id,
      status: 'in_progress',
    });
    const ensureResult: EnsureExerciseResult = { exercise: sessionExercise };
    jest.spyOn(trainingService, 'ensureCurrentExercise').mockResolvedValue(ensureResult);
    mockSessionExerciseRepo.findById.mockResolvedValue(sessionExercise);
    mockExerciseRepo.findById.mockResolvedValue(DUMBBELL_EXERCISE);
    mockSessionSetRepo.create.mockResolvedValue(makeSessionSet({ setNumber: 1 }));

    await trainingService.logSetWithContext('session-1', {
      exerciseId: DUMBBELL_EXERCISE.id,
      setData: { type: 'strength', reps: 10, weight: 24, weightUnit: 'kg' },
      weightBasis: 'total',
    });

    expect(mockSessionSetRepo.create).toHaveBeenCalledWith(
      'se-1',
      expect.objectContaining({ setData: expect.objectContaining({ perHand: false }) }),
    );
  });

  it('never adds perHand on a barbell exercise', async () => {
    const { trainingService, mockSessionSetRepo, mockSessionExerciseRepo, mockExerciseRepo } = createMocks();
    const sessionExercise = makeSessionExercise({ id: 'se-1', exerciseId: BARBELL_EXERCISE.id, status: 'in_progress' });
    const ensureResult: EnsureExerciseResult = { exercise: sessionExercise };
    jest.spyOn(trainingService, 'ensureCurrentExercise').mockResolvedValue(ensureResult);
    mockSessionExerciseRepo.findById.mockResolvedValue(sessionExercise);
    mockExerciseRepo.findById.mockResolvedValue(BARBELL_EXERCISE);
    mockSessionSetRepo.create.mockResolvedValue(makeSessionSet({ setNumber: 1 }));

    await trainingService.logSetWithContext('session-1', {
      exerciseId: BARBELL_EXERCISE.id,
      setData: { type: 'strength', reps: 10, weight: 80, weightUnit: 'kg' },
    });

    const call = mockSessionSetRepo.create.mock.calls[0]?.[1] as { setData?: Record<string, unknown> } | undefined;
    expect(call?.setData).not.toHaveProperty('perHand');
  });
});

describe('TrainingService.updateLastSet — setKind (set-kind plan D3, AC-SK-8)', () => {
  it('merges setKind into the update and reports before/after', async () => {
    const { trainingService, mockSessionRepo, mockSessionSetRepo } = createMocks();
    const set = makeSessionSet({ id: 'set-1', sessionExerciseId: 'se-1', setNumber: 1, setKind: 'warmup' });
    mockSessionRepo.findByIdWithDetails.mockResolvedValue({
      id: 'session-1',
      exercises: [{ ...makeSessionExercise({ id: 'se-1', exerciseId: 'ex-1' }), sets: [set] }],
    } as unknown as Awaited<ReturnType<TrainingService['getSessionDetails']>>);
    mockSessionSetRepo.update.mockResolvedValue({ ...set, setKind: 'working' });

    const result = await trainingService.updateLastSet('session-1', 'ex-1', { setKind: 'working' });

    expect(mockSessionSetRepo.update).toHaveBeenCalledWith('set-1', expect.objectContaining({ setKind: 'working' }));
    expect(result.before.setKind).toBe('warmup');
    expect(result.after.setKind).toBe('working');
  });
});
