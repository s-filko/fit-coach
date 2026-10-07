import type { ITrainingService } from '@domain/training/ports';
import { isToolReturnWithUpdate, type ToolReturn } from '@domain/conversation/tool-outcome';

import { toToolMessage } from '@infra/ai/tools/outcome';

import { buildDeleteLastSetsTool } from '../delete-last-sets.tool';

type InvokableTool = {
  name: string;
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

const makeDeps = (trainingService: jest.Mocked<ITrainingService>) => {
  const deleteLastSets = buildDeleteLastSetsTool({ trainingService }) as unknown as InvokableTool;
  const tools = [deleteLastSets];
  return { tools };
};

// -------------------------------------------------------------------------
// ADR-0011 Phase 2.1: delete_last_sets tool
// -------------------------------------------------------------------------

describe('delete-last-sets.tool — delete_last_sets (ADR-0011 Fix 2.1)', () => {
  it('should be available in training tools', () => {
    const { tools } = makeDeps(makeTrainingService());

    expect(tools.map(t => t.name as string)).toContain('delete_last_sets');
  });
});

// -------------------------------------------------------------------------
// ADR-0011 P3: Correction-triggered phantom sets (two-turn incident replay)
//
// These tests verify the structural preconditions of the incident:
//   (b) After fix: delete_last_sets exists — LLM can correct without adding phantoms.
// -------------------------------------------------------------------------

describe('delete-last-sets.tool — P3 incident replay — correction misclassified as new set', () => {
  it('(after fix) LLM can call delete_last_sets to correct without adding phantom', async () => {
    // After fix: delete_last_sets tool exists.
    // LLM receives correction intent → calls delete_last_sets, NOT log_set again.
    // Verifies the structural fix: the tool must be available for LLM to use it.
    const trainingService = makeTrainingService();
    const { tools } = makeDeps(trainingService);

    // Cast to string to bypass TS literal type narrowing — the point is to check
    // runtime tool names, which after the fix will include 'delete_last_sets'.
    const toolNames = tools.map(t => t.name as string);
    const hasDeleteTool = toolNames.includes('delete_last_sets');

    // This is the key structural assertion: without this tool, correction is impossible.
    // When this is RED → LLM has no choice but to call log_set → phantom sets.
    // When this is GREEN → LLM can call delete_last_sets → no phantom.
    expect(hasDeleteTool).toBe(true);
  });
});

// -------------------------------------------------------------------------
// plan-and-tool-fixes T6 (AC-PTF-6): the deleted-set lines render through the
// shared set formatter — a bodyweight set is named "bodyweight", never raw JSON.
// -------------------------------------------------------------------------

describe('delete-last-sets.tool — deleted-set rendering (AC-PTF-6)', () => {
  it('lists a deleted bodyweight set with the wording, not its raw setData JSON', async () => {
    const trainingService = {
      ...makeTrainingService(),
      deleteLastSets: jest.fn(),
    } as unknown as jest.Mocked<ITrainingService> & { deleteLastSets: jest.Mock };
    trainingService.getSessionDetails.mockResolvedValue({
      exercises: [{ status: 'in_progress', sets: [{}] }],
    } as never);
    trainingService.deleteLastSets.mockResolvedValue({
      exerciseId: 'ex-1',
      deletedSets: [{ setNumber: 2, setData: { type: 'functional_reps', reps: 8 }, rpe: null }],
    });
    const tool = buildDeleteLastSetsTool({ trainingService }) as unknown as {
      invoke: (input: Record<string, unknown>, config: unknown) => Promise<unknown>;
    };

    const ret = (await tool.invoke(
      { exercise_id: 'd8794819-ffc6-4d08-8336-d9bedc4e554a' },
      {
        configurable: { userId: 'u1', activeSessionId: 'session-1' },
      },
    )) as ToolReturn;
    const outcome = isToolReturnWithUpdate(ret) ? ret.outcome : ret;
    const content = String(toToolMessage(outcome, 'test-id').content);

    expect(content).toContain('Set 2: 8 reps @ bodyweight');
    expect(content).not.toContain('{"reps"');
  });
});
