import type { RunnableConfig } from '@langchain/core/runnables';

import { isToolReturnWithUpdate, type ToolReturn } from '@domain/conversation/tool-outcome';
import type { ITrainingService } from '@domain/training/ports';

import { LLM_ERROR_PREFIX, SYSTEM_ERROR_PREFIX, toToolMessage } from '@infra/ai/tools/outcome';

import { buildUpdateLastSetTool } from '../update-last-set.tool';

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
    updateLastSet: jest.fn(),
  }) as unknown as jest.Mocked<ITrainingService>;

const makeDeps = (trainingService: jest.Mocked<ITrainingService>) => {
  const updateLastSet = buildUpdateLastSetTool({ trainingService }) as unknown as InvokableTool;
  const tools = [updateLastSet];
  return { tools };
};

const makeConfig = (userId = 'u1', sessionId: string | null = 'session-1'): RunnableConfig => ({
  configurable: { userId, thread_id: userId, activeSessionId: sessionId },
});

/** Renders a tool return exactly as the executor will (Task 5 contract). */
function renderedContent(ret: ToolReturn): string {
  return String(toToolMessage(isToolReturnWithUpdate(ret) ? ret.outcome : ret, 'test-id').content);
}

const EXERCISE_ID = 'd8794819-ffc6-4d08-8336-d9bedc4e554a';

/** Shaped like a driver-level Postgres error (a `code` SQLSTATE alongside the message). */
function makePgError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}

// -------------------------------------------------------------------------
// ADR-0011 Phase 2.2: update_last_set tool
// -------------------------------------------------------------------------

describe('update-last-set.tool — update_last_set (ADR-0011 Fix 2.2)', () => {
  it('should be available in training tools', () => {
    const { tools } = makeDeps(makeTrainingService());

    expect(tools.map(t => t.name as string)).toContain('update_last_set');
  });
});

// -------------------------------------------------------------------------
// ADR-0011 P3: Correction-triggered phantom sets (two-turn incident replay)
// -------------------------------------------------------------------------

describe('update-last-set.tool — P3 incident replay — correction misclassified as new set', () => {
  it('(after fix) LLM can call update_last_set to fix wrong weight without adding phantom', async () => {
    // Scenario: user reported "10 reps at 80kg" but meant "10 reps at 70kg"
    // Before fix: no update tool → LLM adds another log_set with corrected weight
    //             → original wrong set stays + new set added = phantom
    // After fix: LLM calls update_last_set → original set updated, no phantom created
    const trainingService = makeTrainingService();
    const { tools } = makeDeps(trainingService);

    const toolNames = tools.map(t => t.name as string);
    const hasUpdateTool = toolNames.includes('update_last_set');

    expect(hasUpdateTool).toBe(true);
  });
});

// -------------------------------------------------------------------------
// session-investigation-0925 R2 (BUG-035): RPE half-points, DB failures as
// system_error with no SQL text
// -------------------------------------------------------------------------

describe('update-last-set.tool — RPE rounding (BUG-035)', () => {
  it('rounds a fractional rpe to the nearest 0.5 before passing it to updateLastSet', async () => {
    const trainingService = makeTrainingService();
    trainingService.updateLastSet.mockResolvedValue({
      exerciseId: EXERCISE_ID,
      setNumber: 2,
      before: { setData: { type: 'strength', reps: 10, weight: 80, weightUnit: 'kg' }, rpe: 8, userFeedback: null },
      after: { setData: { type: 'strength', reps: 10, weight: 80, weightUnit: 'kg' }, rpe: 9.5, userFeedback: null },
    });
    const tool = buildUpdateLastSetTool({ trainingService }) as unknown as InvokableTool;

    await tool.invoke({ exercise_id: EXERCISE_ID, rpe: 9.3 }, makeConfig());

    expect(trainingService.updateLastSet).toHaveBeenCalledWith(
      'session-1',
      EXERCISE_ID,
      expect.objectContaining({ rpe: 9.5 }),
    );
  });
});

describe('update-last-set.tool — repository/DB failures (BUG-035 part 3)', () => {
  it('returns SYSTEM_ERROR, not LLM_ERROR, when the repository fails with a Postgres error', async () => {
    const trainingService = makeTrainingService();
    trainingService.updateLastSet.mockRejectedValue(
      makePgError('22P02', 'invalid input syntax for type numeric: "9.55" in relation "session_sets"'),
    );
    const tool = buildUpdateLastSetTool({ trainingService }) as unknown as InvokableTool;

    const result = (await tool.invoke({ exercise_id: EXERCISE_ID, rpe: 9 }, makeConfig())) as ToolReturn;
    const content = renderedContent(result);

    expect(content).toContain(SYSTEM_ERROR_PREFIX);
    expect(content).not.toContain(LLM_ERROR_PREFIX);
  });

  it('never echoes the raw DB error text (no SQL/table/column names) into the system_error message', async () => {
    const trainingService = makeTrainingService();
    trainingService.updateLastSet.mockRejectedValue(
      makePgError('22P02', 'invalid input syntax for type numeric: "9.55" in relation "session_sets"'),
    );
    const tool = buildUpdateLastSetTool({ trainingService }) as unknown as InvokableTool;

    const result = (await tool.invoke({ exercise_id: EXERCISE_ID, rpe: 9 }, makeConfig())) as ToolReturn;

    expect(renderedContent(result)).not.toMatch(/session_sets|invalid input syntax/i);
  });

  it('still returns LLM_ERROR for a non-DB failure (e.g. an unrecognised exercise)', async () => {
    const trainingService = makeTrainingService();
    trainingService.updateLastSet.mockRejectedValue(new Error('Exercise not found in session'));
    const tool = buildUpdateLastSetTool({ trainingService }) as unknown as InvokableTool;

    const result = (await tool.invoke({ exercise_id: EXERCISE_ID, rpe: 8 }, makeConfig())) as ToolReturn;

    expect(renderedContent(result)).toContain(LLM_ERROR_PREFIX);
  });
});
