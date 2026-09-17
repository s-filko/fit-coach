import type { RunnableConfig } from '@langchain/core/runnables';

import { isToolReturnWithUpdate, type ToolReturn } from '@domain/conversation/tool-outcome';
import type { ITrainingService } from '@domain/training/ports';
import type { WorkoutSessionWithDetails } from '@domain/training/types';

import { LLM_ERROR_PREFIX, SYSTEM_ERROR_PREFIX, toToolMessage } from '@infra/ai/tools/outcome';

import { buildFinishTrainingTool } from '../finish-training.tool';

/** Renders a tool return exactly as the executor will (Task 5 contract). */
function renderedContent(ret: ToolReturn): string {
  return String(toToolMessage(isToolReturnWithUpdate(ret) ? ret.outcome : ret, 'test-id').content);
}

type InvokableTool = {
  name: string;
  invoke: (input: Record<string, unknown>, config?: RunnableConfig) => Promise<unknown>;
};

const makeTrainingService = (): jest.Mocked<ITrainingService> =>
  ({
    startSession: jest.fn(),
    getSessionDetails: jest.fn(),
    completeSession: jest.fn(),
    skipSession: jest.fn(),
    getTrainingHistory: jest.fn(),
    addExerciseToSession: jest.fn(),
    logSet: jest.fn(),
    completeCurrentExercise: jest.fn(),
    ensureCurrentExercise: jest.fn(),
  }) as unknown as jest.Mocked<ITrainingService>;

/** The executor puts activeSessionId into configurable alongside userId. */
const makeConfig = (userId = 'u1', sessionId: string | null = 'session-1'): RunnableConfig => ({
  configurable: { userId, thread_id: userId, activeSessionId: sessionId },
});

const makeDeps = (trainingService: jest.Mocked<ITrainingService>, sessionId: string | null = 'session-1') => {
  const finishTraining = buildFinishTrainingTool({ trainingService }) as unknown as InvokableTool;
  const byName = (_name: string) => finishTraining;
  const config = makeConfig('u1', sessionId);
  return { byName, config };
};

describe('finish-training.tool — finish_training', () => {
  it('calls completeSession, requests the transition update, returns summary', async () => {
    const trainingService = makeTrainingService();
    const mockSession: WorkoutSessionWithDetails = {
      id: 'session-1',
      userId: 'user-1',
      planId: null,
      sessionKey: null,
      status: 'completed',
      startedAt: new Date(),
      completedAt: new Date(),
      durationMinutes: 45,
      userContextJson: null,
      sessionPlanJson: null,
      lastActivityAt: new Date(),
      autoCloseReason: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      exercises: [],
    };
    trainingService.completeSession.mockResolvedValue(mockSession);
    trainingService.getSessionDetails.mockResolvedValue(mockSession);

    const { byName, config } = makeDeps(trainingService);
    const result = (await byName('finish_training').invoke({ feedback: 'Great session!' }, config)) as ToolReturn;

    expect(trainingService.completeSession).toHaveBeenCalledWith('session-1', undefined, undefined);
    expect(isToolReturnWithUpdate(result) ? result.update.pendingTransition : undefined).toEqual({
      toPhase: 'chat',
      reason: 'training_completed',
    });
    expect(renderedContent(result)).toContain('45 min');
    expect(renderedContent(result)).toContain('Great session!');
  });

  it('returns SYSTEM_ERROR when no sessionId is set for the user', async () => {
    const trainingService = makeTrainingService();

    const { byName, config } = makeDeps(trainingService, null);
    const result = (await byName('finish_training').invoke({}, config)) as ToolReturn;

    expect(renderedContent(result)).toContain(SYSTEM_ERROR_PREFIX);
    expect(trainingService.completeSession).not.toHaveBeenCalled();
  });

  it('returns LLM_ERROR when completeSession throws', async () => {
    const trainingService = makeTrainingService();
    trainingService.completeSession.mockRejectedValue(new Error('Session not found'));

    const { byName, config } = makeDeps(trainingService);
    const result = (await byName('finish_training').invoke({}, config)) as ToolReturn;

    expect(renderedContent(result)).toContain(LLM_ERROR_PREFIX);
    expect(renderedContent(result)).toContain('Session not found');
  });

  it('each run requests its own transition — two users do not overwrite each other', async () => {
    const trainingService = makeTrainingService();
    const mockSession: WorkoutSessionWithDetails = {
      id: 'session-1',
      userId: 'u',
      planId: null,
      sessionKey: null,
      status: 'completed',
      startedAt: new Date(),
      completedAt: new Date(),
      durationMinutes: 30,
      userContextJson: null,
      sessionPlanJson: null,
      lastActivityAt: new Date(),
      autoCloseReason: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      exercises: [],
    };
    trainingService.completeSession.mockResolvedValue(mockSession);
    trainingService.getSessionDetails.mockResolvedValue(mockSession);

    const finishTraining = buildFinishTrainingTool({ trainingService }) as unknown as InvokableTool;

    // Each invocation carries its own session via configurable — the state
    // update is requested per run, so users can never overwrite each other.
    const a = (await finishTraining.invoke({}, makeConfig('userA', 'session-A'))) as ToolReturn;
    const b = (await finishTraining.invoke({}, makeConfig('userB', 'session-B'))) as ToolReturn;

    expect(isToolReturnWithUpdate(a) ? a.update.pendingTransition : undefined).toEqual({
      toPhase: 'chat',
      reason: 'training_completed',
    });
    expect(isToolReturnWithUpdate(b) ? b.update.pendingTransition : undefined).toEqual({
      toPhase: 'chat',
      reason: 'training_completed',
    });
  });
});
