// Shared plumbing for the log_set tool tests: a mocked ITrainingService, a mocked
// IExerciseRepository (T7: the tool reads the target exercise's weight_mode), the
// executor-shaped RunnableConfig and the invokable tool wrapper. Not a `.unit.test.ts`
// file, so jest's testMatch never picks it up.
import type { RunnableConfig } from '@langchain/core/runnables';

import type { IExerciseRepository, ITrainingService } from '@domain/training/ports';
import type { Exercise } from '@domain/training/types';

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
    resolveExerciseIdByName: jest.fn(),
  }) as unknown as jest.Mocked<ITrainingService>;

/**
 * T7 (AC-PTF-7): `findById` answers whatever exercise the test wants the catalog to hold
 * (null by default — an unknown id, so no per-mode validation applies).
 */
export const makeExerciseRepository = (exercise: Exercise | null = null): jest.Mocked<IExerciseRepository> =>
  ({ findById: jest.fn().mockResolvedValue(exercise) }) as unknown as jest.Mocked<IExerciseRepository>;

/** The executor puts activeSessionId into configurable alongside userId. */
export const makeConfig = (userId = 'u1', sessionId: string | null = 'session-1'): RunnableConfig => ({
  configurable: { userId, thread_id: userId, activeSessionId: sessionId },
});

export const makeDeps = (
  trainingService: jest.Mocked<ITrainingService>,
  exerciseRepository: jest.Mocked<IExerciseRepository> = makeExerciseRepository(),
  sessionId: string | null = 'session-1',
) => {
  const logSet = buildLogSetTool({ trainingService, exerciseRepository }) as unknown as InvokableTool;
  const tools = [logSet];
  const byName = (_name: string) => logSet;
  const config = makeConfig('u1', sessionId);
  return { tools, byName, config };
};
