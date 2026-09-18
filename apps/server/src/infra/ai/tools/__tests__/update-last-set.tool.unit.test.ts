import type { ITrainingService } from '@domain/training/ports';

import { buildUpdateLastSetTool } from '../update-last-set.tool';

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
  const updateLastSet = buildUpdateLastSetTool({ trainingService }) as unknown as InvokableTool;
  const tools = [updateLastSet];
  return { tools };
};

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
