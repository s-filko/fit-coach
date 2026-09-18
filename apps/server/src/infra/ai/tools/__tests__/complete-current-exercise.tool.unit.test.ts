import type { RunnableConfig } from '@langchain/core/runnables';

import { isToolReturnWithUpdate, type ToolReturn } from '@domain/conversation/tool-outcome';
import type { ITrainingService } from '@domain/training/ports';

import { LLM_ERROR_PREFIX, SYSTEM_ERROR_PREFIX, toToolMessage } from '@infra/ai/tools/outcome';

import { buildCompleteCurrentExerciseTool } from '../complete-current-exercise.tool';

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
  const completeCurrentExercise = buildCompleteCurrentExerciseTool({ trainingService }) as unknown as InvokableTool;
  const tools = [completeCurrentExercise];
  const byName = (_name: string) => completeCurrentExercise;
  const config = makeConfig('u1', sessionId);
  return { tools, byName, config };
};

describe('complete-current-exercise.tool — complete_current_exercise', () => {
  const mockSummary = {
    exerciseId: '00000000-0000-4000-8000-000000000004',
    exerciseName: 'Overhead Press',
    setsLogged: 3,
    sets: [
      { setNumber: 1, reps: 10, weight: 40, weightUnit: 'kg', rpe: null },
      { setNumber: 2, reps: 9, weight: 40, weightUnit: 'kg', rpe: 8 },
      { setNumber: 3, reps: 8, weight: 40, weightUnit: 'kg', rpe: 9 },
    ],
    targetSets: 3,
    targetReps: '8-10',
    targetWeight: null,
  };

  it('calls completeCurrentExercise and returns full exercise summary', async () => {
    const trainingService = makeTrainingService();
    trainingService.completeCurrentExercise.mockResolvedValue(mockSummary);

    const { byName, config } = makeDeps(trainingService);
    const result = (await byName('complete_current_exercise').invoke({}, config)) as ToolReturn;

    expect(trainingService.completeCurrentExercise).toHaveBeenCalledWith('session-1');
    expect(renderedContent(result)).toContain('Overhead Press');
    expect(renderedContent(result)).toContain('completed');
    expect(renderedContent(result)).toContain('Set 1');
    expect(renderedContent(result)).toContain('Set 2');
    expect(renderedContent(result)).toContain('Set 3');
    expect(renderedContent(result)).toContain('3/3 sets');
  });

  it('returns SYSTEM_ERROR when no sessionId is set for the user', async () => {
    const trainingService = makeTrainingService();

    const { byName, config } = makeDeps(trainingService, null);
    const result = (await byName('complete_current_exercise').invoke({}, config)) as ToolReturn;

    expect(renderedContent(result)).toContain(SYSTEM_ERROR_PREFIX);
    expect(trainingService.completeCurrentExercise).not.toHaveBeenCalled();
  });

  it('returns LLM_ERROR when completeCurrentExercise throws', async () => {
    const trainingService = makeTrainingService();
    trainingService.completeCurrentExercise.mockRejectedValue(new Error('No exercise in progress'));

    const { byName, config } = makeDeps(trainingService);
    const result = (await byName('complete_current_exercise').invoke({}, config)) as ToolReturn;

    expect(renderedContent(result)).toContain(LLM_ERROR_PREFIX);
    expect(renderedContent(result)).toContain('No exercise in progress');
  });
});

describe('complete-current-exercise.tool — available in tools', () => {
  it('should be available in training tools', () => {
    const { tools } = makeDeps(makeTrainingService());
    expect(tools.map(t => t.name as string)).toContain('complete_current_exercise');
  });

  it('should NOT have exercise_id param — it only completes the current exercise', () => {
    const { tools } = makeDeps(makeTrainingService());
    const completeTool = tools.find(t => t.name === 'complete_current_exercise');
    expect(completeTool).toBeDefined();
  });
});
