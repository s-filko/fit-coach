/**
 * RED tests for ADR-0011: TrainingService hardening.
 *
 * Phase 1: ensureCurrentExercise auto-complete on exercise switch.
 * Phase 2: deleteLastSets, updateLastSet methods.
 *
 * WHY RED:
 *   1.3 — ensureCurrentExercise does NOT close the previous exercise → assertions fail
 *   2.1 — deleteLastSets method does not exist → toHaveProperty fails
 *   2.2 — updateLastSet method does not exist → toHaveProperty fails
 */

import type {
  IExerciseRepository,
  ISessionExerciseRepository,
  ISessionSetRepository,
  IWorkoutPlanRepository,
  IWorkoutSessionRepository,
} from '@domain/training/ports';
import type {
  SessionExercise,
  SessionExerciseWithDetails,
  SessionSet,
  WorkoutSessionWithDetails,
} from '@domain/training/types';
import { TrainingService } from '@domain/training/services/training.service';

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

const makeSessionSet = (overrides: Partial<SessionSet> = {}): SessionSet => ({
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

const makeExerciseWithDetails = (overrides: Partial<SessionExerciseWithDetails> = {}): SessionExerciseWithDetails => ({
  id: 'se-default',
  sessionId: 'session-1',
  exerciseId: 12,
  orderIndex: 0,
  status: 'pending',
  targetSets: 4,
  targetReps: '8-10',
  targetWeight: null,
  actualRepsRange: null,
  userFeedback: null,
  createdAt: new Date(),
  exercise: {
    id: 12,
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

const makeSession = (exercises: SessionExerciseWithDetails[] = []): WorkoutSessionWithDetails => ({
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

function createMocks() {
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
  const mockExerciseRepo = {} as jest.Mocked<IExerciseRepository>;
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
  };
}

// ---------------------------------------------------------------------------
// Phase 1.3: ensureCurrentExercise auto-complete on switch
// ---------------------------------------------------------------------------

describe('TrainingService.ensureCurrentExercise — auto-complete on switch (ADR-0011 Fix 1.3)', () => {
  it('should auto-complete current exercise (with sets) when switching to a different exerciseId', async () => {
    const { trainingService, mockSessionRepo, mockSessionExerciseRepo } = createMocks();

    const exerciseA = makeExerciseWithDetails({
      id: 'se-A',
      exerciseId: 12,
      status: 'in_progress',
      sets: [makeSessionSet({ sessionExerciseId: 'se-A', setNumber: 1 })],
      exercise: {
        id: 12,
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
    });

    const exerciseB = makeExerciseWithDetails({
      id: 'se-B',
      exerciseId: 15,
      status: 'pending',
      exercise: {
        id: 15,
        name: 'Bicep Curl',
        category: 'isolation',
        equipment: 'dumbbell',
        exerciseType: 'strength',
        description: null,
        energyCost: 'medium',
        complexity: 'beginner',
        typicalDurationMinutes: 10,
        requiresSpotter: false,
        imageUrl: null,
        videoUrl: null,
        createdAt: new Date(),
        muscleGroups: [],
      },
    });

    mockSessionRepo.findByIdWithDetails.mockResolvedValue(makeSession([exerciseA, exerciseB]));
    mockSessionExerciseRepo.update.mockImplementation(
      async (id, updates) =>
        ({
          ...(id === 'se-A' ? exerciseA : exerciseB),
          ...updates,
        }) as unknown as SessionExercise,
    );

    await trainingService.ensureCurrentExercise('session-1', { exerciseId: 15 });

    // Exercise A must be closed as 'completed' (it has 1 set)
    expect(mockSessionExerciseRepo.update).toHaveBeenCalledWith('se-A', { status: 'completed' });
  });

  it('should auto-skip current exercise (with 0 sets) when switching', async () => {
    const { trainingService, mockSessionRepo, mockSessionExerciseRepo } = createMocks();

    const exerciseA = makeExerciseWithDetails({
      id: 'se-A',
      exerciseId: 12,
      status: 'in_progress',
      sets: [], // 0 sets → should be skipped
    });

    const exerciseB = makeExerciseWithDetails({
      id: 'se-B',
      exerciseId: 15,
      status: 'pending',
    });

    mockSessionRepo.findByIdWithDetails.mockResolvedValue(makeSession([exerciseA, exerciseB]));
    mockSessionExerciseRepo.update.mockImplementation(
      async (id, updates) =>
        ({
          ...(id === 'se-A' ? exerciseA : exerciseB),
          ...updates,
        }) as unknown as SessionExercise,
    );

    await trainingService.ensureCurrentExercise('session-1', { exerciseId: 15 });

    // Exercise A must be closed as 'skipped' (0 sets)
    expect(mockSessionExerciseRepo.update).toHaveBeenCalledWith('se-A', { status: 'skipped' });
  });

  it('should return autoCompleted metadata when switching exercises', async () => {
    const { trainingService, mockSessionRepo, mockSessionExerciseRepo } = createMocks();

    const exerciseA = makeExerciseWithDetails({
      id: 'se-A',
      exerciseId: 12,
      status: 'in_progress',
      sets: [
        makeSessionSet({ sessionExerciseId: 'se-A', setNumber: 1 }),
        makeSessionSet({ sessionExerciseId: 'se-A', setNumber: 2 }),
        makeSessionSet({ sessionExerciseId: 'se-A', setNumber: 3 }),
      ],
    });

    const exerciseB = makeExerciseWithDetails({
      id: 'se-B',
      exerciseId: 15,
      status: 'pending',
    });

    mockSessionRepo.findByIdWithDetails.mockResolvedValue(makeSession([exerciseA, exerciseB]));
    mockSessionExerciseRepo.update.mockImplementation(
      async (id, updates) =>
        ({
          ...(id === 'se-A' ? exerciseA : exerciseB),
          ...updates,
        }) as unknown as SessionExercise,
    );

    const result = await trainingService.ensureCurrentExercise('session-1', { exerciseId: 15 });

    expect(result).toHaveProperty('autoCompleted');
    const ac = (result as { autoCompleted?: Record<string, unknown> }).autoCompleted!;
    expect(ac.exerciseId).toBe(12);
    expect(ac.exerciseName).toBe('Bench Press');
    expect(ac.setsLogged).toBe(3);
    expect(ac.targetSets).toBe(4);
    expect(ac.targetReps).toBe('8-10');
    expect(Array.isArray(ac.sets)).toBe(true);
    expect((ac.sets as unknown[]).length).toBe(3);
  });

  it('should NOT auto-complete when exerciseId matches current in_progress exercise', async () => {
    const { trainingService, mockSessionRepo, mockSessionExerciseRepo } = createMocks();

    const exerciseA = makeExerciseWithDetails({
      id: 'se-A',
      exerciseId: 12,
      status: 'in_progress',
      sets: [makeSessionSet()],
    });

    mockSessionRepo.findByIdWithDetails.mockResolvedValue(makeSession([exerciseA]));

    await trainingService.ensureCurrentExercise('session-1', { exerciseId: 12 });

    // Should NOT have called update with 'completed' or 'skipped'
    const completeCalls = mockSessionExerciseRepo.update.mock.calls.filter(
      ([, updates]) =>
        (updates as Partial<SessionExercise>).status === 'completed' ||
        (updates as Partial<SessionExercise>).status === 'skipped',
    );
    expect(completeCalls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// BUG-012: completeSession should close in_progress exercises
// ---------------------------------------------------------------------------

describe('TrainingService.completeSession — closes in_progress exercises (BUG-012)', () => {
  it('should complete all in_progress exercises before closing the session', async () => {
    const { trainingService, mockSessionRepo, mockSessionExerciseRepo } = createMocks();

    const session = {
      id: 'session-1',
      userId: 'user-1',
      status: 'in_progress' as const,
      startedAt: new Date(Date.now() - 30 * 60_000),
      completedAt: null,
      durationMinutes: null,
    };
    mockSessionRepo.findById.mockResolvedValue(session as never);
    mockSessionExerciseRepo.findBySessionId.mockResolvedValue([
      { id: 'se-1', status: 'completed' },
      { id: 'se-2', status: 'in_progress' },
    ] as never);
    mockSessionRepo.complete.mockResolvedValue({ ...session, status: 'completed' } as never);

    await trainingService.completeSession('session-1');

    expect(mockSessionExerciseRepo.findBySessionId).toHaveBeenCalledWith('session-1');
    expect(mockSessionExerciseRepo.update).toHaveBeenCalledWith('se-2', { status: 'completed' });
    expect(mockSessionExerciseRepo.update).not.toHaveBeenCalledWith('se-1', expect.anything());
    expect(mockSessionRepo.complete).toHaveBeenCalled();
  });

  it('should not call update when no exercises are in_progress', async () => {
    const { trainingService, mockSessionRepo, mockSessionExerciseRepo } = createMocks();

    const session = {
      id: 'session-1',
      userId: 'user-1',
      status: 'in_progress' as const,
      startedAt: new Date(Date.now() - 30 * 60_000),
      completedAt: null,
      durationMinutes: null,
    };
    mockSessionRepo.findById.mockResolvedValue(session as never);
    mockSessionExerciseRepo.findBySessionId.mockResolvedValue([
      { id: 'se-1', status: 'completed' },
      { id: 'se-2', status: 'completed' },
    ] as never);
    mockSessionRepo.complete.mockResolvedValue({ ...session, status: 'completed' } as never);

    await trainingService.completeSession('session-1');

    expect(mockSessionExerciseRepo.update).not.toHaveBeenCalled();
    expect(mockSessionRepo.complete).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Phase 2.1: deleteLastSets
// ---------------------------------------------------------------------------

describe('TrainingService.deleteLastSets (ADR-0011 Fix 2.1)', () => {
  it('should have deleteLastSets method', () => {
    const { trainingService } = createMocks();

    expect(trainingService).toHaveProperty('deleteLastSets');
  });

  it('should have deleteLastSets as a function', () => {
    const { trainingService } = createMocks();

    expect(typeof (trainingService as unknown as Record<string, unknown>)['deleteLastSets']).toBe('function');
  });
});

// ---------------------------------------------------------------------------
// Phase 2.2: updateLastSet
// ---------------------------------------------------------------------------

describe('TrainingService.updateLastSet (ADR-0011 Fix 2.2)', () => {
  it('should have updateLastSet method', () => {
    const { trainingService } = createMocks();

    expect(trainingService).toHaveProperty('updateLastSet');
  });

  it('should have updateLastSet as a function', () => {
    const { trainingService } = createMocks();

    expect(typeof (trainingService as unknown as Record<string, unknown>)['updateLastSet']).toBe('function');
  });
});
