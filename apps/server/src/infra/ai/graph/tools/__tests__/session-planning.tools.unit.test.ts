import type { RunnableConfig } from '@langchain/core/runnables';

import type { TransitionRequest } from '@domain/conversation/graph/conversation.state';
import type { ITrainingService, IWorkoutPlanRepository } from '@domain/training/ports';

import { buildSessionPlanningTools } from '../session-planning.tools';

// StructuredTool has overloaded .invoke() signatures that TS cannot unify in tests.
type InvokableTool = {
  invoke: (input: Record<string, unknown>, config?: RunnableConfig) => Promise<unknown>;
};

const MINIMAL_SESSION_PLAN = {
  sessionKey: 'upper_a',
  sessionName: 'Upper A - Chest/Back',
  reasoning: 'Last trained upper body 3 days ago. Good recovery.',
  exercises: [
    {
      exerciseId: 1,
      exerciseName: 'Bench Press',
      targetSets: 3,
      targetReps: '8-10',
      restSeconds: 90,
    },
  ],
  estimatedDuration: 60,
};

const makeTrainingService = (sessionId = 'session-1'): jest.Mocked<ITrainingService> =>
  ({
    startSession: jest.fn().mockResolvedValue({ id: sessionId, status: 'planning' }),
    getSessionDetails: jest.fn(),
    completeSession: jest.fn(),
    skipSession: jest.fn(),
    getTrainingHistory: jest.fn(),
    getNextSessionRecommendation: jest.fn(),
    addExerciseToSession: jest.fn(),
    logSet: jest.fn(),
    completeCurrentExercise: jest.fn(),
    ensureCurrentExercise: jest.fn(),
  }) as unknown as jest.Mocked<ITrainingService>;

const makeWorkoutPlanRepo = (planId = 'plan-1'): jest.Mocked<IWorkoutPlanRepository> =>
  ({
    findActiveByUserId: jest.fn().mockResolvedValue({ id: planId }),
    create: jest.fn(),
    findById: jest.fn(),
    findByUserId: jest.fn(),
    update: jest.fn(),
    archive: jest.fn(),
  }) as unknown as jest.Mocked<IWorkoutPlanRepository>;

const makePendingTransitions = (): Map<string, TransitionRequest | null> => new Map();
const makePendingActiveSessionIds = (): Map<string, string | null> => new Map();

const makeConfig = (userId = 'u1'): RunnableConfig => ({
  configurable: { userId, thread_id: userId },
});

const buildTools = (
  trainingService: jest.Mocked<ITrainingService>,
  workoutPlanRepository: jest.Mocked<IWorkoutPlanRepository>,
  pendingTransitions: Map<string, TransitionRequest | null>,
  pendingActiveSessionIds: Map<string, string | null>,
): [InvokableTool, InvokableTool] =>
  buildSessionPlanningTools({
    trainingService,
    workoutPlanRepository,
    pendingTransitions,
    pendingActiveSessionIds,
  }) as unknown as [InvokableTool, InvokableTool];

describe('session-planning.tools — start_training_session', () => {
  it('returns a plain string, never a Command object', async () => {
    const [startTrainingSession] = buildTools(
      makeTrainingService(),
      makeWorkoutPlanRepo(),
      makePendingTransitions(),
      makePendingActiveSessionIds(),
    );

    const result = await startTrainingSession.invoke(MINIMAL_SESSION_PLAN, makeConfig());

    expect(typeof result).toBe('string');
    expect(result as object).not.toHaveProperty('lc_direct_tool_output');
  });

  it('calls trainingService.startSession with correct args including planId and sessionPlanJson', async () => {
    const trainingService = makeTrainingService();
    const workoutPlanRepo = makeWorkoutPlanRepo('plan-42');
    const [startTrainingSession] = buildTools(
      trainingService,
      workoutPlanRepo,
      makePendingTransitions(),
      makePendingActiveSessionIds(),
    );

    await startTrainingSession.invoke(MINIMAL_SESSION_PLAN, makeConfig('u1'));

    expect(trainingService.startSession).toHaveBeenCalledWith(
      'u1',
      expect.objectContaining({
        planId: 'plan-42',
        sessionKey: MINIMAL_SESSION_PLAN.sessionKey,
        status: 'planning',
        sessionPlanJson: expect.objectContaining({
          sessionKey: MINIMAL_SESSION_PLAN.sessionKey,
          sessionName: MINIMAL_SESSION_PLAN.sessionName,
          exercises: MINIMAL_SESSION_PLAN.exercises,
          estimatedDuration: MINIMAL_SESSION_PLAN.estimatedDuration,
        }),
      }),
    );
  });

  it('sets pendingActiveSessionIds entry for userId to the created session ID', async () => {
    const pendingActiveSessionIds = makePendingActiveSessionIds();
    const [startTrainingSession] = buildTools(
      makeTrainingService('session-xyz'),
      makeWorkoutPlanRepo(),
      makePendingTransitions(),
      pendingActiveSessionIds,
    );

    await startTrainingSession.invoke(MINIMAL_SESSION_PLAN, makeConfig('u1'));

    expect(pendingActiveSessionIds.get('u1')).toBe('session-xyz');
  });

  it('sets pendingTransitions entry for userId to training phase', async () => {
    const pendingTransitions = makePendingTransitions();
    const [startTrainingSession] = buildTools(
      makeTrainingService(),
      makeWorkoutPlanRepo(),
      pendingTransitions,
      makePendingActiveSessionIds(),
    );

    await startTrainingSession.invoke(MINIMAL_SESSION_PLAN, makeConfig('u1'));

    expect(pendingTransitions.get('u1')).not.toBeNull();
    expect(pendingTransitions.get('u1')?.toPhase).toBe('training');
    expect(pendingTransitions.get('u1')?.reason).toBe('session_planning_complete');
  });

  it('resolves planId from workoutPlanRepository.findActiveByUserId', async () => {
    const workoutPlanRepo = makeWorkoutPlanRepo();
    const [startTrainingSession] = buildTools(
      makeTrainingService(),
      workoutPlanRepo,
      makePendingTransitions(),
      makePendingActiveSessionIds(),
    );

    await startTrainingSession.invoke(MINIMAL_SESSION_PLAN, makeConfig('u99'));

    expect(workoutPlanRepo.findActiveByUserId).toHaveBeenCalledWith('u99');
  });

  it('includes session ID in success string', async () => {
    const [startTrainingSession] = buildTools(
      makeTrainingService('session-1'),
      makeWorkoutPlanRepo(),
      makePendingTransitions(),
      makePendingActiveSessionIds(),
    );

    const result = await startTrainingSession.invoke(MINIMAL_SESSION_PLAN, makeConfig());

    expect(result as string).toContain('session-1');
  });

  it('returns error string when userId is missing', async () => {
    const [startTrainingSession] = buildTools(
      makeTrainingService(),
      makeWorkoutPlanRepo(),
      makePendingTransitions(),
      makePendingActiveSessionIds(),
    );

    const result = await startTrainingSession.invoke(MINIMAL_SESSION_PLAN, { configurable: {} });

    expect(result as string).toContain('Error: could not identify user');
  });

  it('does NOT set maps when userId is missing', async () => {
    const pendingTransitions = makePendingTransitions();
    const pendingActiveSessionIds = makePendingActiveSessionIds();
    const [startTrainingSession] = buildTools(
      makeTrainingService(),
      makeWorkoutPlanRepo(),
      pendingTransitions,
      pendingActiveSessionIds,
    );

    await startTrainingSession.invoke(MINIMAL_SESSION_PLAN, { configurable: {} });

    expect(pendingTransitions.size).toBe(0);
    expect(pendingActiveSessionIds.size).toBe(0);
  });

  it('returns error string when trainingService.startSession throws', async () => {
    const trainingService = makeTrainingService();
    trainingService.startSession.mockRejectedValue(new Error('DB connection failed'));
    const pendingTransitions = makePendingTransitions();
    const pendingActiveSessionIds = makePendingActiveSessionIds();
    const [startTrainingSession] = buildTools(
      trainingService,
      makeWorkoutPlanRepo(),
      pendingTransitions,
      pendingActiveSessionIds,
    );

    const result = await startTrainingSession.invoke(MINIMAL_SESSION_PLAN, makeConfig('u1'));

    expect(result as string).toContain('Error creating session');
    expect(result as string).toContain('DB connection failed');
    // maps must remain empty on error
    expect(pendingTransitions.size).toBe(0);
    expect(pendingActiveSessionIds.size).toBe(0);
  });

  it('works when no active plan exists (planId is undefined)', async () => {
    const workoutPlanRepo = makeWorkoutPlanRepo();
    workoutPlanRepo.findActiveByUserId.mockResolvedValue(null);
    const trainingService = makeTrainingService();
    const [startTrainingSession] = buildTools(
      trainingService,
      workoutPlanRepo,
      makePendingTransitions(),
      makePendingActiveSessionIds(),
    );

    await startTrainingSession.invoke(MINIMAL_SESSION_PLAN, makeConfig());

    expect(trainingService.startSession).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ planId: undefined }),
    );
  });

  it('isolates entries by userId — two users do not overwrite each other', async () => {
    const pendingTransitions = makePendingTransitions();
    const pendingActiveSessionIds = makePendingActiveSessionIds();
    const trainingA = makeTrainingService('session-A');
    const trainingB = makeTrainingService('session-B');

    const [startA] = buildTools(trainingA, makeWorkoutPlanRepo(), pendingTransitions, pendingActiveSessionIds);
    await startA.invoke(MINIMAL_SESSION_PLAN, makeConfig('userA'));

    const [startB] = buildTools(trainingB, makeWorkoutPlanRepo(), pendingTransitions, pendingActiveSessionIds);
    await startB.invoke(MINIMAL_SESSION_PLAN, makeConfig('userB'));

    expect(pendingActiveSessionIds.get('userA')).toBe('session-A');
    expect(pendingActiveSessionIds.get('userB')).toBe('session-B');
  });
});

describe('session-planning.tools — request_transition', () => {
  it('returns a plain string, never a Command object', async () => {
    const [, requestTransition] = buildTools(
      makeTrainingService(),
      makeWorkoutPlanRepo(),
      makePendingTransitions(),
      makePendingActiveSessionIds(),
    );

    const result = await requestTransition.invoke({ toPhase: 'chat' }, makeConfig());

    expect(typeof result).toBe('string');
    expect(result as object).not.toHaveProperty('lc_direct_tool_output');
  });

  it('sets pendingTransitions entry for userId with toPhase=chat', async () => {
    const pendingTransitions = makePendingTransitions();
    const [, requestTransition] = buildTools(
      makeTrainingService(),
      makeWorkoutPlanRepo(),
      pendingTransitions,
      makePendingActiveSessionIds(),
    );

    await requestTransition.invoke({ toPhase: 'chat' }, makeConfig('u1'));

    expect(pendingTransitions.get('u1')?.toPhase).toBe('chat');
  });

  it('sets optional reason in pendingTransitions entry', async () => {
    const pendingTransitions = makePendingTransitions();
    const [, requestTransition] = buildTools(
      makeTrainingService(),
      makeWorkoutPlanRepo(),
      pendingTransitions,
      makePendingActiveSessionIds(),
    );

    await requestTransition.invoke({ toPhase: 'chat', reason: 'user cancelled' }, makeConfig('u1'));

    expect(pendingTransitions.get('u1')?.reason).toBe('user cancelled');
  });

  it('returns confirmation string mentioning the target phase', async () => {
    const [, requestTransition] = buildTools(
      makeTrainingService(),
      makeWorkoutPlanRepo(),
      makePendingTransitions(),
      makePendingActiveSessionIds(),
    );

    const result = await requestTransition.invoke({ toPhase: 'chat' }, makeConfig());

    expect(result as string).toContain('chat');
  });

  it('does NOT touch trainingService or pendingActiveSessionIds', async () => {
    const trainingService = makeTrainingService();
    const pendingActiveSessionIds = makePendingActiveSessionIds();
    const [, requestTransition] = buildTools(
      trainingService,
      makeWorkoutPlanRepo(),
      makePendingTransitions(),
      pendingActiveSessionIds,
    );

    await requestTransition.invoke({ toPhase: 'chat' }, makeConfig());

    expect(trainingService.startSession).not.toHaveBeenCalled();
    expect(pendingActiveSessionIds.size).toBe(0);
  });
});
