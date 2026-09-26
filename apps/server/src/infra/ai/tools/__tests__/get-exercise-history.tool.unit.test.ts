/**
 * `get_exercise_history` — unit tests for the two close-out review defects that don't need a real
 * DB (items 4 and 5, training-history-lookup plan Task 1 close-out): the not-found/systemic error
 * split, and skipping the exclusion when there is no active session. AC-HL-1/2/3 (the happy paths,
 * DB-backed) live in `tests/integration/scenarios/exercise-history-lookup*.integration.test.ts`.
 */
import type { RunnableConfig } from '@langchain/core/runnables';

import { isToolReturnWithUpdate, type ToolReturn } from '@domain/conversation/tool-outcome';
import { ExerciseNotFoundError } from '@domain/training/errors';
import type { IExerciseRepository, ITrainingService, IWorkoutSessionRepository } from '@domain/training/ports';

import { toToolMessage } from '@infra/ai/tools/outcome';

import { buildGetExerciseHistoryTool } from '../get-exercise-history.tool';

// StructuredTool has overloaded .invoke() signatures that TS cannot unify in tests.
type InvokableTool = {
  name: string;
  invoke: (input: Record<string, unknown>, config?: RunnableConfig) => Promise<unknown>;
};

function renderedContent(ret: ToolReturn): string {
  return String(toToolMessage(isToolReturnWithUpdate(ret) ? ret.outcome : ret, 'test-id').content);
}

const makeConfig = (activeSessionId?: string): RunnableConfig =>
  ({
    configurable: { userId: 'u1', thread_id: 'u1', ...(activeSessionId !== undefined ? { activeSessionId } : {}) },
    context: { runId: 'run-test', userId: 'u1', now: new Date('2026-09-26T09:00:00Z'), user: null },
  }) as unknown as RunnableConfig;

const EXERCISE_ID = '11111111-1111-4111-8111-111111111111';

const makeExerciseRepository = (): jest.Mocked<IExerciseRepository> =>
  ({
    findById: jest.fn().mockResolvedValue({ id: EXERCISE_ID, name: 'Barbell Bench Press' }),
  }) as unknown as jest.Mocked<IExerciseRepository>;

function buildTool(
  trainingService: jest.Mocked<ITrainingService>,
  workoutSessionRepo: jest.Mocked<IWorkoutSessionRepository>,
  exerciseRepository: jest.Mocked<IExerciseRepository> = makeExerciseRepository(),
): InvokableTool {
  return buildGetExerciseHistoryTool({
    trainingService,
    exerciseRepository,
    workoutSessionRepo,
  }) as unknown as InvokableTool;
}

describe('get_exercise_history — unit (close-out review items 4, 5)', () => {
  describe('item 5: no activeSessionId', () => {
    it('passes null, never an empty string, as excludeSessionId', async () => {
      const findRecentPerformancesForExercise = jest.fn().mockResolvedValue([]);
      const trainingService = {} as unknown as jest.Mocked<ITrainingService>;
      const workoutSessionRepo = {
        findRecentPerformancesForExercise,
      } as unknown as jest.Mocked<IWorkoutSessionRepository>;
      const tool = buildTool(trainingService, workoutSessionRepo);

      // makeConfig() with no arg omits `activeSessionId` from `configurable` entirely —
      // sessionIdOf then returns null (format-exercise-summary.ts), never ''.
      await tool.invoke({ exerciseId: EXERCISE_ID }, makeConfig());

      expect(findRecentPerformancesForExercise).toHaveBeenCalledWith('u1', EXERCISE_ID, null, 3);
    });

    it('still passes the real session id when one is active', async () => {
      const findRecentPerformancesForExercise = jest.fn().mockResolvedValue([]);
      const trainingService = {} as unknown as jest.Mocked<ITrainingService>;
      const workoutSessionRepo = {
        findRecentPerformancesForExercise,
      } as unknown as jest.Mocked<IWorkoutSessionRepository>;
      const tool = buildTool(trainingService, workoutSessionRepo);

      await tool.invoke({ exerciseId: EXERCISE_ID }, makeConfig('session-1'));

      expect(findRecentPerformancesForExercise).toHaveBeenCalledWith('u1', EXERCISE_ID, 'session-1', 3);
    });
  });

  describe('item 4: not-found vs systemic name-resolution errors', () => {
    it('a genuine miss (ExerciseNotFoundError) is llm_error, pointing at search_exercises', async () => {
      const trainingService = {
        resolveExerciseIdByName: jest.fn().mockRejectedValue(new ExerciseNotFoundError('Zzz Unknown')),
      } as unknown as jest.Mocked<ITrainingService>;
      const workoutSessionRepo = {} as unknown as jest.Mocked<IWorkoutSessionRepository>;
      const tool = buildTool(trainingService, workoutSessionRepo);

      const result = (await tool.invoke({ exerciseName: 'Zzz Unknown' }, makeConfig('session-1'))) as ToolReturn;
      const content = renderedContent(result);

      expect(content).toContain('LLM_ERROR');
      expect(content).toContain('search_exercises');
    });

    it('a DB/embedding failure is system_error, not llm_error', async () => {
      const trainingService = {
        resolveExerciseIdByName: jest.fn().mockRejectedValue(new Error('connection terminated unexpectedly')),
      } as unknown as jest.Mocked<ITrainingService>;
      const workoutSessionRepo = {} as unknown as jest.Mocked<IWorkoutSessionRepository>;
      const tool = buildTool(trainingService, workoutSessionRepo);

      const result = (await tool.invoke({ exerciseName: 'Bench Press' }, makeConfig('session-1'))) as ToolReturn;
      const content = renderedContent(result);

      expect(content).toContain('SYSTEM_ERROR');
      expect(content).not.toContain('LLM_ERROR');
    });
  });
});
