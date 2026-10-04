import type { SessionSet } from '@domain/training/types';

import { createMocks, makeExerciseWithDetails, makeSession, makeSessionSet } from './training-service-test-support';

// D15: a weight given to a reps-only set must produce a weighted (strength) set.

const EX_ID = 'd8794819-ffc6-4d08-8336-d9bedc4e554a';

const setup = (setData: SessionSet['setData']) => {
  const { trainingService, mockSessionRepo, mockSessionSetRepo, mockExerciseRepo } = createMocks();
  const set = makeSessionSet({ id: 'set-1', setNumber: 1, setData });
  mockSessionRepo.findByIdWithDetails.mockResolvedValue(
    makeSession([makeExerciseWithDetails({ exerciseId: EX_ID, sets: [set] })]),
  );
  mockSessionSetRepo.update.mockImplementation(async (_id, patch) => ({ ...set, ...patch }) as SessionSet);
  return { trainingService, mockSessionSetRepo, mockExerciseRepo };
};

describe('TrainingService.updateLastSet — weight on a reps-only set', () => {
  it('converts functional_reps to a strength set when a weight is given', async () => {
    const { trainingService, mockSessionSetRepo } = setup({ type: 'functional_reps', reps: 12 });

    await trainingService.updateLastSet('session-1', EX_ID, { weight: 59 });

    expect(mockSessionSetRepo.update).toHaveBeenCalledWith(
      'set-1',
      expect.objectContaining({ setData: { type: 'strength', reps: 12, weight: 59, weightUnit: 'kg' } }),
    );
  });

  it('keeps functional_reps when only reps change', async () => {
    const { trainingService, mockSessionSetRepo } = setup({ type: 'functional_reps', reps: 12 });

    await trainingService.updateLastSet('session-1', EX_ID, { reps: 10 });

    expect(mockSessionSetRepo.update).toHaveBeenCalledWith(
      'set-1',
      expect.objectContaining({ setData: { type: 'functional_reps', reps: 10 } }),
    );
  });

  it('marks the weight per hand when the converted set is a dumbbell exercise', async () => {
    const { trainingService, mockSessionSetRepo, mockExerciseRepo } = setup({ type: 'functional_reps', reps: 12 });
    mockExerciseRepo.findById.mockResolvedValue({ id: EX_ID, equipment: 'dumbbell' } as never);

    await trainingService.updateLastSet('session-1', EX_ID, { weight: 10 });

    expect(mockSessionSetRepo.update).toHaveBeenCalledWith(
      'set-1',
      expect.objectContaining({
        setData: { type: 'strength', reps: 12, weight: 10, weightUnit: 'kg', perHand: true },
      }),
    );
  });
});

// AC-PTF-4 (plan-and-tool-fixes T4): an explicit weight of 0 means a bodyweight set —
// the mirror of the D15 conversion above.
describe('TrainingService.updateLastSet — weight 0 means a bodyweight set', () => {
  it('converts a strength set to functional_reps with the same reps', async () => {
    const { trainingService, mockSessionSetRepo } = setup({ type: 'strength', reps: 8, weight: 10, weightUnit: 'kg' });

    await trainingService.updateLastSet('session-1', EX_ID, { weight: 0 });

    expect(mockSessionSetRepo.update).toHaveBeenCalledWith(
      'set-1',
      expect.objectContaining({ setData: { type: 'functional_reps', reps: 8 } }),
    );
  });

  it('keeps functional_reps when weight 0 is given to a reps-only set', async () => {
    const { trainingService, mockSessionSetRepo, mockExerciseRepo } = setup({ type: 'functional_reps', reps: 12 });

    await trainingService.updateLastSet('session-1', EX_ID, { weight: 0 });

    expect(mockSessionSetRepo.update).toHaveBeenCalledWith(
      'set-1',
      expect.objectContaining({ setData: { type: 'functional_reps', reps: 12 } }),
    );
    expect(mockExerciseRepo.findById).not.toHaveBeenCalled(); // no D15 per-hand conversion fires
  });
});
