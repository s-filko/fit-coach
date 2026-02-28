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

const makeTrainingService = (sessionId = 'session-1'): jest.Mocked<ITrainingService> => ({
  startSession: jest.fn().mockResolvedValue({ id: sessionId, status: 'planning' }),
  getSessionDetails: jest.fn(),
  completeSession: jest.fn(),
  skipSession: jest.fn(),
  getTrainingHistory: jest.fn(),
  getNextSessionRecommendation: jest.fn(),
  addExerciseToSession: jest.fn(),
  logSet: jest.fn(),
  startNextExercise: jest.fn(),
  skipCurrentExercise: jest.fn(),
  completeCurrentExercise: jest.fn(),
  ensureCurrentExercise: jest.fn(),
} as unknown as jest.Mocked<ITrainingService>);

const makeWorkoutPlanRepo = (planId = 'plan-1'): jest.Mocked<IWorkoutPlanRepository> => ({
  findActiveByUserId: jest.fn().mockResolvedValue({ id: planId }),
  create: jest.fn(),
  findById: jest.fn(),
  findByUserId: jest.fn(),
  update: jest.fn(),
  archive: jest.fn(),
} as unknown as jest.Mocked<IWorkoutPlanRepository>);

const makePendingTransition = (): { value: TransitionRequest | null } => ({ value: null });
const makePendingActiveSessionId = (): { value: string | null } => ({ value: null });

const makeConfig = (userId = 'u1'): RunnableConfig => ({
  configurable: { userId, thread_id: userId },
});

const buildTools = (
  trainingService: jest.Mocked<ITrainingService>,
  workoutPlanRepository: jest.Mocked<IWorkoutPlanRepository>,
  pendingTransition: { value: TransitionRequest | null },
  pendingActiveSessionId: { value: string | null },
): [InvokableTool, InvokableTool] =>
  buildSessionPlanningTools({
    trainingService,
    workoutPlanRepository,
    pendingTransition,
    pendingActiveSessionId,
  }) as unknown as [InvokableTool, InvokableTool];

describe('session-planning.tools — start_training_session', () => {
  it('returns a plain string, never a Command object', async () => {
    const [startTrainingSession] = buildTools(
      makeTrainingService(),
      makeWorkoutPlanRepo(),
      makePendingTransition(),
      makePendingActiveSessionId(),
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
      makePendingTransition(),
      makePendingActiveSessionId(),
    );

    await startTrainingSession.invoke(MINIMAL_SESSION_PLAN, makeConfig('u1'));

    expect(trainingService.startSession).toHaveBeenCalledWith('u1', expect.objectContaining({
      planId: 'plan-42',
      sessionKey: MINIMAL_SESSION_PLAN.sessionKey,
      status: 'planning',
      sessionPlanJson: expect.objectContaining({
        sessionKey: MINIMAL_SESSION_PLAN.sessionKey,
        sessionName: MINIMAL_SESSION_PLAN.sessionName,
        exercises: MINIMAL_SESSION_PLAN.exercises,
        estimatedDuration: MINIMAL_SESSION_PLAN.estimatedDuration,
      }),
    }));
  });

  it('sets pendingActiveSessionId.value to the created session ID', async () => {
    const pendingActiveSessionId = makePendingActiveSessionId();
    const [startTrainingSession] = buildTools(
      makeTrainingService('session-xyz'),
      makeWorkoutPlanRepo(),
      makePendingTransition(),
      pendingActiveSessionId,
    );

    await startTrainingSession.invoke(MINIMAL_SESSION_PLAN, makeConfig());

    expect(pendingActiveSessionId.value).toBe('session-xyz');
  });

  it('sets pendingTransition.value to training phase', async () => {
    const pendingTransition = makePendingTransition();
    const [startTrainingSession] = buildTools(
      makeTrainingService(),
      makeWorkoutPlanRepo(),
      pendingTransition,
      makePendingActiveSessionId(),
    );

    await startTrainingSession.invoke(MINIMAL_SESSION_PLAN, makeConfig());

    expect(pendingTransition.value).not.toBeNull();
    expect(pendingTransition.value?.toPhase).toBe('training');
    expect(pendingTransition.value?.reason).toBe('session_planning_complete');
  });

  it('resolves planId from workoutPlanRepository.findActiveByUserId', async () => {
    const workoutPlanRepo = makeWorkoutPlanRepo();
    const [startTrainingSession] = buildTools(
      makeTrainingService(),
      workoutPlanRepo,
      makePendingTransition(),
      makePendingActiveSessionId(),
    );

    await startTrainingSession.invoke(MINIMAL_SESSION_PLAN, makeConfig('u99'));

    expect(workoutPlanRepo.findActiveByUserId).toHaveBeenCalledWith('u99');
  });

  it('includes session ID in success string', async () => {
    const [startTrainingSession] = buildTools(
      makeTrainingService('session-1'),
      makeWorkoutPlanRepo(),
      makePendingTransition(),
      makePendingActiveSessionId(),
    );

    const result = await startTrainingSession.invoke(MINIMAL_SESSION_PLAN, makeConfig());

    expect(result as string).toContain('session-1');
  });

  it('returns error string when userId is missing', async () => {
    const [startTrainingSession] = buildTools(
      makeTrainingService(),
      makeWorkoutPlanRepo(),
      makePendingTransition(),
      makePendingActiveSessionId(),
    );

    const result = await startTrainingSession.invoke(MINIMAL_SESSION_PLAN, { configurable: {} });

    expect(result as string).toContain('Error: could not identify user');
  });

  it('does NOT set refs when userId is missing', async () => {
    const pendingTransition = makePendingTransition();
    const pendingActiveSessionId = makePendingActiveSessionId();
    const [startTrainingSession] = buildTools(
      makeTrainingService(),
      makeWorkoutPlanRepo(),
      pendingTransition,
      pendingActiveSessionId,
    );

    await startTrainingSession.invoke(MINIMAL_SESSION_PLAN, { configurable: {} });

    expect(pendingTransition.value).toBeNull();
    expect(pendingActiveSessionId.value).toBeNull();
  });

  it('returns error string when trainingService.startSession throws', async () => {
    const trainingService = makeTrainingService();
    trainingService.startSession.mockRejectedValue(new Error('DB connection failed'));
    const pendingTransition = makePendingTransition();
    const pendingActiveSessionId = makePendingActiveSessionId();
    const [startTrainingSession] = buildTools(
      trainingService,
      makeWorkoutPlanRepo(),
      pendingTransition,
      pendingActiveSessionId,
    );

    const result = await startTrainingSession.invoke(MINIMAL_SESSION_PLAN, makeConfig());

    expect(result as string).toContain('Error creating session');
    expect(result as string).toContain('DB connection failed');
    // refs must remain null on error
    expect(pendingTransition.value).toBeNull();
    expect(pendingActiveSessionId.value).toBeNull();
  });

  it('works when no active plan exists (planId is undefined)', async () => {
    const workoutPlanRepo = makeWorkoutPlanRepo();
    workoutPlanRepo.findActiveByUserId.mockResolvedValue(null);
    const trainingService = makeTrainingService();
    const [startTrainingSession] = buildTools(
      trainingService,
      workoutPlanRepo,
      makePendingTransition(),
      makePendingActiveSessionId(),
    );

    await startTrainingSession.invoke(MINIMAL_SESSION_PLAN, makeConfig());

    expect(trainingService.startSession).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ planId: undefined }),
    );
  });
});

describe('session-planning.tools — request_transition', () => {
  it('returns a plain string, never a Command object', async () => {
    const [, requestTransition] = buildTools(
      makeTrainingService(),
      makeWorkoutPlanRepo(),
      makePendingTransition(),
      makePendingActiveSessionId(),
    );

    const result = await requestTransition.invoke({ toPhase: 'chat' }, makeConfig());

    expect(typeof result).toBe('string');
    expect(result as object).not.toHaveProperty('lc_direct_tool_output');
  });

  it('sets pendingTransition.value with toPhase=chat', async () => {
    const pendingTransition = makePendingTransition();
    const [, requestTransition] = buildTools(
      makeTrainingService(),
      makeWorkoutPlanRepo(),
      pendingTransition,
      makePendingActiveSessionId(),
    );

    await requestTransition.invoke({ toPhase: 'chat' }, makeConfig());

    expect(pendingTransition.value?.toPhase).toBe('chat');
  });

  it('sets optional reason in pendingTransition', async () => {
    const pendingTransition = makePendingTransition();
    const [, requestTransition] = buildTools(
      makeTrainingService(),
      makeWorkoutPlanRepo(),
      pendingTransition,
      makePendingActiveSessionId(),
    );

    await requestTransition.invoke({ toPhase: 'chat', reason: 'user cancelled' }, makeConfig());

    expect(pendingTransition.value?.reason).toBe('user cancelled');
  });

  it('returns confirmation string mentioning the target phase', async () => {
    const [, requestTransition] = buildTools(
      makeTrainingService(),
      makeWorkoutPlanRepo(),
      makePendingTransition(),
      makePendingActiveSessionId(),
    );

    const result = await requestTransition.invoke({ toPhase: 'chat' }, makeConfig());

    expect(result as string).toContain('chat');
  });

  it('does NOT touch trainingService or pendingActiveSessionId', async () => {
    const trainingService = makeTrainingService();
    const pendingActiveSessionId = makePendingActiveSessionId();
    const [, requestTransition] = buildTools(
      trainingService,
      makeWorkoutPlanRepo(),
      makePendingTransition(),
      pendingActiveSessionId,
    );

    await requestTransition.invoke({ toPhase: 'chat' }, makeConfig());

    expect(trainingService.startSession).not.toHaveBeenCalled();
    expect(pendingActiveSessionId.value).toBeNull();
  });
});
