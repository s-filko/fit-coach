/**
 * load-plan-fixes item 2 (AC-LPF-2, replay C2): `log_set` sends `durationSeconds` as `cardio_duration` for every
 * exercise; `logSetWithContext` re-keys it by the exercise's type — a hold on an isometric exercise (Plank, Side
 * Plank) is stored as an `isometric` set with its duration, cardio stays `cardio_duration`.
 */
import type { EnsureExerciseResult } from '@domain/training/ports';
import type { Exercise } from '@domain/training/types';

import { createMocks, makeSessionExercise, makeSessionSet } from './training-service-test-support';

const PLANK: Exercise = {
  id: 'ex-plank',
  name: 'Plank',
  category: 'functional',
  equipment: 'bodyweight',
  exerciseType: 'isometric',
  description: null,
  energyCost: 'low',
  complexity: 'beginner',
  typicalDurationMinutes: 2,
  requiresSpotter: false,
  imageUrl: null,
  videoUrl: null,
  createdAt: new Date(),
};

const BIKE: Exercise = { ...PLANK, id: 'ex-bike', name: 'Stationary Bike', exerciseType: 'cardio_duration' };

async function logDuration(exercise: Exercise): Promise<unknown> {
  const { trainingService, mockSessionSetRepo, mockSessionExerciseRepo, mockExerciseRepo } = createMocks();
  const sessionExercise = makeSessionExercise({ id: 'se-1', exerciseId: exercise.id, status: 'in_progress' });
  const ensureResult: EnsureExerciseResult = { exercise: sessionExercise };
  jest.spyOn(trainingService, 'ensureCurrentExercise').mockResolvedValue(ensureResult);
  mockSessionExerciseRepo.findById.mockResolvedValue(sessionExercise);
  mockExerciseRepo.findById.mockResolvedValue(exercise);
  mockSessionSetRepo.create.mockResolvedValue(makeSessionSet({ setNumber: 1 }));

  await trainingService.logSetWithContext('session-1', {
    exerciseId: exercise.id,
    setData: { type: 'cardio_duration', duration: 45 },
  });
  return mockSessionSetRepo.create.mock.calls[0]?.[1].setData;
}

describe('AC-LPF-2 · logSetWithContext keys a duration set by the exercise type', () => {
  it('a hold on an isometric exercise is stored as an isometric set with its duration', async () => {
    expect(await logDuration(PLANK)).toEqual({ type: 'isometric', duration: 45 });
  });

  it('cardio duration is unchanged', async () => {
    expect(await logDuration(BIKE)).toEqual({ type: 'cardio_duration', duration: 45 });
  });
});
