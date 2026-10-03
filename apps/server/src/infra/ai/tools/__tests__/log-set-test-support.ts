// Shared plumbing for the log_set tool tests: a mocked ITrainingService, the executor-shaped
// RunnableConfig and the invokable tool wrapper. Not a `.unit.test.ts` file, so jest's testMatch
// never picks it up.
import type { RunnableConfig } from '@langchain/core/runnables';

import type { ITrainingService } from '@domain/training/ports';

import { buildLogSetTool } from '../log-set.tool';

export type InvokableTool = {
  name: string;
  invoke: (input: Record<string, unknown>, config?: RunnableConfig) => Promise<unknown>;
};

export const makeTrainingService = (): jest.Mocked<ITrainingService> =>
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
    logSetWithContext: jest.fn(),
  }) as unknown as jest.Mocked<ITrainingService>;

/** The executor puts activeSessionId into configurable alongside userId. */
export const makeConfig = (userId = 'u1', sessionId: string | null = 'session-1'): RunnableConfig => ({
  configurable: { userId, thread_id: userId, activeSessionId: sessionId },
});

export const makeDeps = (trainingService: jest.Mocked<ITrainingService>, sessionId: string | null = 'session-1') => {
  const logSet = buildLogSetTool({ trainingService }) as unknown as InvokableTool;
  const tools = [logSet];
  const byName = (_name: string) => logSet;
  const config = makeConfig('u1', sessionId);
  return { tools, byName, config };
};
