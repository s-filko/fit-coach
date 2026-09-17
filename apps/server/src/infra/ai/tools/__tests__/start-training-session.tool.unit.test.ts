import type { RunnableConfig } from '@langchain/core/runnables';

import { isToolReturnWithUpdate, type ToolReturn } from '@domain/conversation/tool-outcome';
import type { IExerciseRepository, ITrainingService, IWorkoutPlanRepository } from '@domain/training/ports';

import { toToolMessage } from '@infra/ai/tools/outcome';

import { buildStartTrainingSessionTool } from '../start-training-session.tool';

// StructuredTool has overloaded .invoke() signatures that TS cannot unify in tests.
type InvokableTool = {
  name: string;
  invoke: (input: Record<string, unknown>, config?: RunnableConfig) => Promise<unknown>;
};

/** Renders a tool return exactly as the executor will (Task 5 contract). */
function renderedContent(ret: ToolReturn): string {
  return String(toToolMessage(isToolReturnWithUpdate(ret) ? ret.outcome : ret, 'test-id').content);
}

const MINIMAL_SESSION_PLAN = {
  sessionKey: 'upper_a',
  sessionName: 'Upper A - Chest/Back',
  reasoning: 'Last trained upper body 3 days ago. Good recovery.',
  exercises: [
    {
      exerciseId: 'c7b0899c-a0f9-47ca-a69d-4bcd531b0c95',
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

const makeConfig = (userId = 'u1'): RunnableConfig => ({
  configurable: { userId, thread_id: userId },
});

const makeExerciseRepository = (): jest.Mocked<IExerciseRepository> =>
  ({
    findByIds: jest.fn().mockResolvedValue([{ id: 'c7b0899c-a0f9-47ca-a69d-4bcd531b0c95' }]),
    searchByEmbedding: jest.fn().mockResolvedValue([]),
    updateEmbedding: jest.fn(),
    findAll: jest.fn(),
    findAllWithMuscles: jest.fn(),
    findById: jest.fn(),
    findByIdWithMuscles: jest.fn(),
    findByIdsWithMuscles: jest.fn(),
    findByMuscleGroup: jest.fn(),
    search: jest.fn(),
  }) as unknown as jest.Mocked<IExerciseRepository>;

const buildTools = (
  trainingService: jest.Mocked<ITrainingService>,
  workoutPlanRepository: jest.Mocked<IWorkoutPlanRepository>,
) => {
  const startTrainingSession = buildStartTrainingSessionTool({
    trainingService,
    workoutPlanRepository,
    exerciseRepository: makeExerciseRepository(),
  }) as unknown as InvokableTool;
  return { startTrainingSession };
};

describe('start-training-session.tool — start_training_session', () => {
  it('returns a ToolReturn with update, never a Command object', async () => {
    const { startTrainingSession } = buildTools(makeTrainingService(), makeWorkoutPlanRepo());

    const result = (await startTrainingSession.invoke(MINIMAL_SESSION_PLAN, makeConfig())) as ToolReturn;

    expect(result as object).not.toHaveProperty('lc_direct_tool_output');
    expect(isToolReturnWithUpdate(result)).toBe(true);
  });

  it('calls trainingService.startSession with correct args including planId and sessionPlanJson', async () => {
    const trainingService = makeTrainingService();
    const workoutPlanRepo = makeWorkoutPlanRepo('plan-42');
    const { startTrainingSession } = buildTools(trainingService, workoutPlanRepo);

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

  it('requests activeSessionId update with the created session ID', async () => {
    const { startTrainingSession } = buildTools(makeTrainingService('session-xyz'), makeWorkoutPlanRepo());

    const result = (await startTrainingSession.invoke(MINIMAL_SESSION_PLAN, makeConfig('u1'))) as ToolReturn;

    expect(isToolReturnWithUpdate(result) ? result.update.activeSessionId : undefined).toBe('session-xyz');
  });

  it('requests pendingTransition to the training phase', async () => {
    const { startTrainingSession } = buildTools(makeTrainingService(), makeWorkoutPlanRepo());

    const result = (await startTrainingSession.invoke(MINIMAL_SESSION_PLAN, makeConfig('u1'))) as ToolReturn;

    expect(isToolReturnWithUpdate(result) ? result.update.pendingTransition : undefined).toEqual({
      toPhase: 'training',
      reason: 'session_planning_complete',
    });
  });

  it('resolves planId from workoutPlanRepository.findActiveByUserId', async () => {
    const workoutPlanRepo = makeWorkoutPlanRepo();
    const { startTrainingSession } = buildTools(makeTrainingService(), workoutPlanRepo);

    await startTrainingSession.invoke(MINIMAL_SESSION_PLAN, makeConfig('u99'));

    expect(workoutPlanRepo.findActiveByUserId).toHaveBeenCalledWith('u99');
  });

  it('includes session ID in success string', async () => {
    const { startTrainingSession } = buildTools(makeTrainingService('session-1'), makeWorkoutPlanRepo());

    const result = (await startTrainingSession.invoke(MINIMAL_SESSION_PLAN, makeConfig())) as ToolReturn;

    expect(renderedContent(result)).toContain('session-1');
  });

  it('returns error string when userId is missing', async () => {
    const { startTrainingSession } = buildTools(makeTrainingService(), makeWorkoutPlanRepo());

    const result = (await startTrainingSession.invoke(MINIMAL_SESSION_PLAN, { configurable: {} })) as ToolReturn;

    expect(renderedContent(result)).toContain('Error: could not identify user');
  });

  it('does NOT request updates when userId is missing', async () => {
    const { startTrainingSession } = buildTools(makeTrainingService(), makeWorkoutPlanRepo());

    const result = (await startTrainingSession.invoke(MINIMAL_SESSION_PLAN, { configurable: {} })) as ToolReturn;

    expect(isToolReturnWithUpdate(result)).toBe(false);
  });

  it('returns error string when trainingService.startSession throws', async () => {
    const trainingService = makeTrainingService();
    trainingService.startSession.mockRejectedValue(new Error('DB connection failed'));
    const { startTrainingSession } = buildTools(trainingService, makeWorkoutPlanRepo());

    const result = (await startTrainingSession.invoke(MINIMAL_SESSION_PLAN, makeConfig('u1'))) as ToolReturn;

    expect(renderedContent(result)).toContain('Error creating session');
    expect(renderedContent(result)).toContain('DB connection failed');
    // no state update on error
    expect(isToolReturnWithUpdate(result)).toBe(false);
  });

  it('works when no active plan exists (planId is undefined)', async () => {
    const workoutPlanRepo = makeWorkoutPlanRepo();
    workoutPlanRepo.findActiveByUserId.mockResolvedValue(null);
    const trainingService = makeTrainingService();
    const { startTrainingSession } = buildTools(trainingService, workoutPlanRepo);

    await startTrainingSession.invoke(MINIMAL_SESSION_PLAN, makeConfig());

    expect(trainingService.startSession).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ planId: undefined }),
    );
  });

  it('each invocation requests its own session — two users do not overwrite each other', async () => {
    const trainingA = makeTrainingService('session-A');
    const trainingB = makeTrainingService('session-B');

    const toolsA = buildTools(trainingA, makeWorkoutPlanRepo());
    const a = (await toolsA.startTrainingSession.invoke(MINIMAL_SESSION_PLAN, makeConfig('userA'))) as ToolReturn;

    const toolsB = buildTools(trainingB, makeWorkoutPlanRepo());
    const b = (await toolsB.startTrainingSession.invoke(MINIMAL_SESSION_PLAN, makeConfig('userB'))) as ToolReturn;

    expect(isToolReturnWithUpdate(a) ? a.update.activeSessionId : undefined).toBe('session-A');
    expect(isToolReturnWithUpdate(b) ? b.update.activeSessionId : undefined).toBe('session-B');
  });
});
