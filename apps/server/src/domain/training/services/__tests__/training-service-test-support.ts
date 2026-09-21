// Shared fixtures for the TrainingService unit tests: session/exercise/set factories and the
// mocked-repository TrainingService. Not a `.unit.test.ts` file, so jest's testMatch never picks
// it up.
import type {
  IExerciseRepository,
  ISessionExerciseRepository,
  ISessionSetRepository,
  IWorkoutPlanRepository,
  IWorkoutSessionRepository,
} from '@domain/training/ports';
import { TrainingService } from '@domain/training/services/training.service';
import type { SessionExerciseWithDetails, SessionSet, WorkoutSessionWithDetails } from '@domain/training/types';

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

export const makeSessionSet = (overrides: Partial<SessionSet> = {}): SessionSet => ({
  id: `set-${Date.now()}-${Math.random()}`,
  sessionExerciseId: 'se-1',
  setNumber: 1,
  rpe: null,
  userFeedback: null,
  createdAt: new Date(),
  completedAt: null,
  setData: { type: 'strength', reps: 10, weight: 80, weightUnit: 'kg' },
  ...overrides,
});

export const makeExerciseWithDetails = (
  overrides: Partial<SessionExerciseWithDetails> = {},
): SessionExerciseWithDetails => ({
  id: 'se-default',
  sessionId: 'session-1',
  exerciseId: 'd8794819-ffc6-4d08-8336-d9bedc4e554a',
  orderIndex: 0,
  status: 'pending',
  targetSets: 4,
  targetReps: '8-10',
  targetWeight: null,
  actualRepsRange: null,
  userFeedback: null,
  createdAt: new Date(),
  exercise: {
    id: 'd8794819-ffc6-4d08-8336-d9bedc4e554a',
    name: 'Bench Press',
    category: 'compound',
    equipment: 'barbell',
    exerciseType: 'strength',
    description: null,
    energyCost: 'high',
    complexity: 'intermediate',
    typicalDurationMinutes: 15,
    requiresSpotter: true,
    imageUrl: null,
    videoUrl: null,
    createdAt: new Date(),
    muscleGroups: [],
  },
  sets: [],
  ...overrides,
});

export const makeSession = (exercises: SessionExerciseWithDetails[] = []): WorkoutSessionWithDetails => ({
  id: 'session-1',
  userId: 'user-1',
  planId: null,
  sessionKey: null,
  status: 'in_progress',
  startedAt: new Date(),
  completedAt: null,
  durationMinutes: null,
  userContextJson: null,
  sessionPlanJson: null,
  lastActivityAt: new Date(),
  autoCloseReason: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  exercises,
});

// ---------------------------------------------------------------------------
// Common mock setup
// ---------------------------------------------------------------------------

export function createMocks() {
  const mockSessionSetRepo = {
    create: jest.fn(),
    findById: jest.fn(),
    findByExerciseId: jest.fn(),
    update: jest.fn(),
  } as unknown as jest.Mocked<ISessionSetRepository>;

  const mockSessionExerciseRepo = {
    create: jest.fn(),
    findById: jest.fn(),
    findBySessionId: jest.fn(),
    update: jest.fn(),
  } as unknown as jest.Mocked<ISessionExerciseRepository>;

  const mockSessionRepo = {
    findById: jest.fn(),
    findByIdWithDetails: jest.fn(),
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

  const mockWorkoutPlanRepo = {} as jest.Mocked<IWorkoutPlanRepository>;
  const mockExerciseRepo = { findById: jest.fn() } as unknown as jest.Mocked<IExerciseRepository>;
  const mockUserRepo = { getById: jest.fn() } as never;
  const mockLlmService = {} as never;

  const trainingService = new TrainingService(
    mockWorkoutPlanRepo,
    mockSessionRepo,
    mockExerciseRepo,
    mockSessionExerciseRepo,
    mockSessionSetRepo,
    mockUserRepo,
    mockLlmService,
  );

  return {
    trainingService,
    mockSessionRepo,
    mockSessionExerciseRepo,
    mockSessionSetRepo,
    mockExerciseRepo,
  };
}
