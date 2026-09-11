import type {
  IExerciseRepository,
  ISessionExerciseRepository,
  ISessionSetRepository,
  IWorkoutPlanRepository,
  IWorkoutSessionRepository,
  EnsureExerciseResult,
} from '@domain/training/ports';
import type { SessionExercise, SessionSet } from '@domain/training/types';
import { TrainingService } from '@domain/training/services/training.service';

const makeSessionExercise = (overrides: Partial<SessionExercise> = {}): SessionExercise => ({
  id: 'se-1',
  sessionId: 'session-1',
  exerciseId: 'd8794819-ffc6-4d08-8336-d9bedc4e554a',
  orderIndex: 0,
  status: 'in_progress',
  targetSets: 4,
  targetReps: '8-10',
  targetWeight: null,
  actualRepsRange: null,
  userFeedback: null,
  createdAt: new Date(),
  ...overrides,
});

const makeSessionSet = (setNumber: number): SessionSet => ({
  id: `set-${setNumber}`,
  sessionExerciseId: 'se-1',
  setNumber,
  rpe: null,
  userFeedback: null,
  createdAt: new Date(),
  completedAt: null,
  setData: { type: 'strength', reps: 10, weight: 80, weightUnit: 'kg' },
});

describe('TrainingService.logSetWithContext', () => {
  let trainingService: TrainingService;
  let mockSessionSetRepo: jest.Mocked<ISessionSetRepository>;
  let mockSessionExerciseRepo: jest.Mocked<ISessionExerciseRepository>;

  beforeEach(() => {
    mockSessionSetRepo = {
      create: jest.fn(),
      findById: jest.fn(),
      findByExerciseId: jest.fn(),
      update: jest.fn(),
    } as unknown as jest.Mocked<ISessionSetRepository>;

    mockSessionExerciseRepo = {
      create: jest.fn(),
      findById: jest.fn(),
      findBySessionId: jest.fn(),
      update: jest.fn(),
    } as unknown as jest.Mocked<ISessionExerciseRepository>;

    const mockWorkoutPlanRepo = {} as jest.Mocked<IWorkoutPlanRepository>;
    const mockSessionRepo = {
      findById: jest.fn(),
      findByIdWithDetails: jest.fn().mockResolvedValue({
        id: 'session-1',
        exercises: [],
        sessionPlanJson: null,
        status: 'in_progress',
        userId: 'user-1',
      }),
      updateActivity: jest.fn().mockResolvedValue(undefined),
      create: jest.fn(),
      findRecentByUserId: jest.fn(),
      findRecentByUserIdWithDetails: jest.fn(),
      findActiveByUserId: jest.fn(),
      update: jest.fn(),
      complete: jest.fn(),
      findTimedOut: jest.fn(),
      autoCloseTimedOut: jest.fn().mockResolvedValue(0),
      findLastCompletedByUserAndKey: jest.fn(),
    } as unknown as jest.Mocked<IWorkoutSessionRepository>;

    const mockExerciseRepo = {} as jest.Mocked<IExerciseRepository>;
    const mockUserRepo = { getById: jest.fn() } as never;
    const mockLlmService = {} as never;

    trainingService = new TrainingService(
      mockWorkoutPlanRepo,
      mockSessionRepo,
      mockExerciseRepo,
      mockSessionExerciseRepo,
      mockSessionSetRepo,
      mockUserRepo,
      mockLlmService,
    );

    const ensureResult: EnsureExerciseResult = { exercise: makeSessionExercise() };
    jest.spyOn(trainingService, 'ensureCurrentExercise').mockResolvedValue(ensureResult);
  });

  it('returns setNumber from the created set (computed in DB)', async () => {
    // DB computes setNumber = 3 atomically — service just returns it from the created row
    jest.spyOn(trainingService, 'logSet').mockResolvedValue(makeSessionSet(3));

    const result = await trainingService.logSetWithContext('session-1', {
      exerciseId: 'd8794819-ffc6-4d08-8336-d9bedc4e554a',
      setData: { type: 'strength', reps: 10, weight: 80, weightUnit: 'kg' },
    });

    expect(result.setNumber).toBe(3);
    expect(result.set.setNumber).toBe(3);
  });

  it('passes rpe and feedback to logSet without setNumber', async () => {
    jest.spyOn(trainingService, 'logSet').mockResolvedValue(makeSessionSet(2));

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
    jest.spyOn(trainingService, 'logSet').mockResolvedValue(makeSessionSet(1));

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
