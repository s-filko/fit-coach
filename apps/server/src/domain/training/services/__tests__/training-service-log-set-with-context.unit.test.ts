import type { EnsureExerciseResult } from '@domain/training/ports';
import type { TrainingService } from '@domain/training/services/training.service';

import { createMocks, makeSessionExercise, makeSessionSet } from './training-service-test-support';

describe('TrainingService.logSetWithContext', () => {
  let trainingService: TrainingService;

  beforeEach(() => {
    ({ trainingService } = createMocks());

    const ensureResult: EnsureExerciseResult = { exercise: makeSessionExercise({ id: 'se-1', status: 'in_progress' }) };
    jest.spyOn(trainingService, 'ensureCurrentExercise').mockResolvedValue(ensureResult);
  });

  it('returns setNumber from the created set (computed in DB)', async () => {
    // DB computes setNumber = 3 atomically — service just returns it from the created row
    jest.spyOn(trainingService, 'logSet').mockResolvedValue(makeSessionSet({ setNumber: 3 }));

    const result = await trainingService.logSetWithContext('session-1', {
      exerciseId: 'd8794819-ffc6-4d08-8336-d9bedc4e554a',
      setData: { type: 'strength', reps: 10, weight: 80, weightUnit: 'kg' },
    });

    expect(result.setNumber).toBe(3);
    expect(result.set.setNumber).toBe(3);
  });

  it('passes rpe and feedback to logSet without setNumber', async () => {
    jest.spyOn(trainingService, 'logSet').mockResolvedValue(makeSessionSet({ setNumber: 2 }));

    await trainingService.logSetWithContext('session-1', {
      exerciseId: 'd8794819-ffc6-4d08-8336-d9bedc4e554a',
      setData: { type: 'strength', reps: 10, weight: 80 },
      rpe: 8,
      feedback: 'felt strong',
    });

    expect(trainingService.logSet).toHaveBeenCalledWith('se-1', {
      setData: { type: 'strength', reps: 10, weight: 80 },
      rpe: 8,
      userFeedback: 'felt strong',
    });
  });

  it('calls ensureCurrentExercise with exerciseId and exerciseName', async () => {
    jest.spyOn(trainingService, 'logSet').mockResolvedValue(makeSessionSet({ setNumber: 1 }));

    await trainingService.logSetWithContext('session-1', {
      exerciseId: 'd8794819-ffc6-4d08-8336-d9bedc4e554a',
      exerciseName: 'Bench Press',
      setData: { type: 'strength', reps: 10 },
    });

    expect(trainingService.ensureCurrentExercise).toHaveBeenCalledWith('session-1', {
      exerciseId: 'd8794819-ffc6-4d08-8336-d9bedc4e554a',
      exerciseName: 'Bench Press',
    });
  });
});
