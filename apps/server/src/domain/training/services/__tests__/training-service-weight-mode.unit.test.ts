import { WeightRequiredError } from '@domain/training/errors';
import type { Exercise, SessionSet, WeightMode } from '@domain/training/types';

import {
  createMocks,
  makeExerciseWithDetails,
  makeSession,
  makeSessionExercise,
  makeSessionSet,
} from './training-service-test-support';

// plan-and-tool-fixes review pass 5 (R1/R2): the weight_mode rule (AC-PTF-7) lives in the service,
// next to the per-hand shaping, on the catalog row the set-shaping step reads once — the tool no longer
// reads the catalog. Required + reps without a weight is a typed domain error; optional falls
// back to a bodyweight set; none never stores a weight.

const BY_ID = 'd8794819-ffc6-4d08-8336-d9bedc4e554a';
const BY_NAME_RESOLVED_ID = '8c88ebce-f5df-4d33-afdb-0b096a0dd7a8';

const catalogRow = (id: string, name: string, weightMode: WeightMode): Exercise => ({
  id,
  name,
  category: 'compound',
  equipment: weightMode === 'optional' ? 'bodyweight' : 'barbell',
  weightMode,
  exerciseType: 'strength',
  description: null,
  energyCost: 'high',
  complexity: 'intermediate',
  typicalDurationMinutes: 10,
  requiresSpotter: false,
  imageUrl: null,
  videoUrl: null,
  createdAt: new Date(),
});

const setup = (row: Exercise | null) => {
  const mocks = createMocks();
  const { trainingService, mockExerciseRepo } = mocks;
  mockExerciseRepo.findById.mockResolvedValue(row);
  jest.spyOn(trainingService, 'ensureCurrentExercise').mockResolvedValue({
    exercise: makeSessionExercise({ id: 'se-1', exerciseId: row?.id ?? BY_ID, status: 'in_progress' }),
  });
  const logSet = jest
    .spyOn(trainingService, 'logSet')
    .mockImplementation(async (_id, dto) => makeSessionSet({ setData: dto.setData }));
  return { ...mocks, logSet };
};

describe('TrainingService.logSetWithContext — the weight requirement per exercise (AC-PTF-7)', () => {
  it('required + reps without a weight → WeightRequiredError naming the exercise, nothing stored', async () => {
    const { trainingService, logSet } = setup(catalogRow(BY_ID, 'Barbell Bench Press', 'required'));

    const call = trainingService.logSetWithContext('session-1', {
      exerciseId: BY_ID,
      setData: { type: 'functional_reps', reps: 12 },
      weightOmitted: true,
    });

    await expect(call).rejects.toBeInstanceOf(WeightRequiredError);
    await expect(call).rejects.toThrow('Barbell Bench Press: weight is required');
    expect(logSet).not.toHaveBeenCalled();
  });

  // The rejection is reached by NAME: logSetWithContext resolves the name first, and the weight
  // rule judges the row of the RESOLVED exercise — one catalog read, by the resolved id.
  it('a required exercise reached by exerciseName is rejected on the resolved row (AC-PTF-7)', async () => {
    const row = catalogRow(BY_NAME_RESOLVED_ID, 'Barbell Back Squat', 'required');
    const { trainingService, mockExerciseRepo, logSet } = setup(row);
    (mockExerciseRepo as unknown as { search: jest.Mock }).search = jest.fn().mockResolvedValue([row]);

    await expect(
      trainingService.logSetWithContext('session-1', {
        exerciseName: 'Barbell Back Squat',
        setData: { type: 'functional_reps', reps: 5 },
        weightOmitted: true,
      }),
    ).rejects.toThrow('Barbell Back Squat: weight is required');

    expect(mockExerciseRepo.findById).toHaveBeenCalledTimes(1);
    expect(mockExerciseRepo.findById).toHaveBeenCalledWith(BY_NAME_RESOLVED_ID);
    expect(logSet).not.toHaveBeenCalled();
  });

  it('required + an explicit weight 0 → a bodyweight set (functional_reps), as AC-PTF-4', async () => {
    const { trainingService, logSet } = setup(catalogRow(BY_ID, 'Barbell Bench Press', 'required'));

    await trainingService.logSetWithContext('session-1', {
      exerciseId: BY_ID,
      setData: { type: 'functional_reps', reps: 8 },
      weightOmitted: false,
    });

    expect(logSet).toHaveBeenCalledWith(
      'se-1',
      expect.objectContaining({ setData: { type: 'functional_reps', reps: 8 } }),
    );
  });

  it('an isometric exercise (optional) logged with reps and no weight → a bodyweight set is stored', async () => {
    const plank: Exercise = {
      ...catalogRow(BY_ID, 'Plank', 'optional'),
      category: 'functional',
      exerciseType: 'isometric',
    };
    const { trainingService, logSet } = setup(plank);

    await trainingService.logSetWithContext('session-1', {
      exerciseId: BY_ID,
      setData: { type: 'functional_reps', reps: 8 },
      weightOmitted: true,
    });

    expect(logSet).toHaveBeenCalledWith(
      'se-1',
      expect.objectContaining({ setData: { type: 'functional_reps', reps: 8 } }),
    );
  });

  it('optional + a number → added load (strength)', async () => {
    const { trainingService, logSet } = setup(catalogRow(BY_ID, 'Pull-ups', 'optional'));
    const strength = { type: 'strength' as const, reps: 8, weight: 10, weightUnit: 'kg' as const };

    await trainingService.logSetWithContext('session-1', {
      exerciseId: BY_ID,
      setData: strength,
      weightOmitted: false,
    });

    expect(logSet).toHaveBeenCalledWith('se-1', expect.objectContaining({ setData: strength }));
  });

  it('none never stores a weight — a reps call with a weight is kept as a bodyweight set', async () => {
    const { trainingService, logSet } = setup(catalogRow(BY_ID, 'Jump Rope', 'none'));

    await trainingService.logSetWithContext('session-1', {
      exerciseId: BY_ID,
      setData: { type: 'strength', reps: 20, weight: 5, weightUnit: 'kg' },
      weightOmitted: false,
    });

    expect(logSet).toHaveBeenCalledWith(
      'se-1',
      expect.objectContaining({ setData: { type: 'functional_reps', reps: 20 } }),
    );
  });

  it('a catalog row the service cannot read leaves the set as given (no mode known)', async () => {
    const { trainingService, logSet } = setup(null);

    await trainingService.logSetWithContext('session-1', {
      exerciseId: BY_ID,
      setData: { type: 'functional_reps', reps: 8 },
      weightOmitted: true,
    });

    expect(logSet).toHaveBeenCalledWith(
      'se-1',
      expect.objectContaining({ setData: { type: 'functional_reps', reps: 8 } }),
    );
  });

  it('a set logged without the flag (webapp route) is not judged by the weight rule', async () => {
    const { trainingService, logSet } = setup(catalogRow(BY_ID, 'Barbell Bench Press', 'required'));

    await trainingService.logSetWithContext('session-1', {
      exerciseId: BY_ID,
      setData: { type: 'functional_reps', reps: 8 },
    });

    expect(logSet).toHaveBeenCalled();
  });
});

// R3 (pass 5, closure): the rejection happens BEFORE any state changes — a real service over fake repos,
// ensureCurrentExercise not stubbed. A required exercise B reached by name while A is in progress must not
// complete A, create B's row or bump activity.
describe('TrainingService.logSetWithContext — a rejected weight leaves the session untouched (AC-PTF-7)', () => {
  it('required B by exerciseName, reps without weight, A in progress → rejected, no switch, no activity bump', async () => {
    const mocks = createMocks();
    const { trainingService, mockSessionRepo, mockSessionExerciseRepo, mockExerciseRepo } = mocks;
    const exA = makeExerciseWithDetails({ id: 'se-a', exerciseId: 'ex-a', status: 'in_progress', sets: [] });
    mockSessionRepo.findByIdWithDetails.mockResolvedValue(makeSession([exA]));
    const rowB = catalogRow(BY_NAME_RESOLVED_ID, 'Barbell Back Squat', 'required');
    (mockExerciseRepo as unknown as { search: jest.Mock }).search = jest.fn().mockResolvedValue([rowB]);
    mockExerciseRepo.findById.mockResolvedValue(rowB);
    mockSessionExerciseRepo.create.mockResolvedValue(
      makeSessionExercise({ id: 'se-b', exerciseId: BY_NAME_RESOLVED_ID }),
    );

    await expect(
      trainingService.logSetWithContext('session-1', {
        exerciseName: 'Barbell Back Squat',
        setData: { type: 'functional_reps', reps: 5 },
        weightOmitted: true,
      }),
    ).rejects.toBeInstanceOf(WeightRequiredError);

    expect(mockSessionExerciseRepo.update).not.toHaveBeenCalled();
    expect(mockSessionExerciseRepo.create).not.toHaveBeenCalled();
    expect(mockSessionRepo.updateActivity).not.toHaveBeenCalled();
    expect(mockSessionRepo.update).not.toHaveBeenCalled();
  });
});

describe('TrainingService.updateLastSet — weight_mode none keeps weight out of setData (AC-PTF-7)', () => {
  const EX_ID = BY_ID;
  const run = async (mode: WeightMode, setData: SessionSet['setData']) => {
    const { trainingService, mockSessionRepo, mockSessionSetRepo } = createMocks();
    const set = makeSessionSet({ id: 'set-1', setNumber: 1, setData });
    const base = makeExerciseWithDetails({ exerciseId: EX_ID, sets: [set] });
    mockSessionRepo.findByIdWithDetails.mockResolvedValue(
      makeSession([{ ...base, exercise: { ...base.exercise, weightMode: mode } }]),
    );
    mockSessionSetRepo.update.mockImplementation(async (_id, patch) => ({ ...set, ...patch }) as SessionSet);
    return { trainingService, mockSessionSetRepo };
  };

  it('a weight on a cardio set of a `none` exercise is not stored — no weight key in setData', async () => {
    const { trainingService, mockSessionSetRepo } = await run('none', {
      type: 'cardio_distance',
      distance: 5,
      distanceUnit: 'km',
      duration: 1800,
    });

    await trainingService.updateLastSet('session-1', EX_ID, { weight: 7, durationSeconds: 1500 });

    const patch = mockSessionSetRepo.update.mock.calls[0]![1] as { setData: Record<string, unknown> };
    expect(patch.setData).toEqual({ type: 'cardio_distance', distance: 5, distanceUnit: 'km', duration: 1500 });
    expect(patch.setData).not.toHaveProperty('weight');
  });

  it('a weight on a reps-only set of a `none` exercise leaves it a bodyweight set', async () => {
    const { trainingService, mockSessionSetRepo } = await run('none', { type: 'functional_reps', reps: 20 });

    await trainingService.updateLastSet('session-1', EX_ID, { weight: 5 });

    expect(mockSessionSetRepo.update).toHaveBeenCalledWith(
      'set-1',
      expect.objectContaining({ setData: { type: 'functional_reps', reps: 20 } }),
    );
  });

  it('other modes still take the weight (required: reps-only → strength)', async () => {
    const { trainingService, mockSessionSetRepo } = await run('required', { type: 'functional_reps', reps: 12 });

    await trainingService.updateLastSet('session-1', EX_ID, { weight: 59 });

    expect(mockSessionSetRepo.update).toHaveBeenCalledWith(
      'set-1',
      expect.objectContaining({ setData: { type: 'strength', reps: 12, weight: 59, weightUnit: 'kg' } }),
    );
  });
});
