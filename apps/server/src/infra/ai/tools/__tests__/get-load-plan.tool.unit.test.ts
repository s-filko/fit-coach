/**
 * `get_load_plan` (load-facts plan AC-LF-4, D12): by id and by name returns the full entry; an
 * unknown name is an llm_error; a resolution failure is a system_error; no record is a plain line.
 */
import type { RunnableConfig } from '@langchain/core/runnables';

import { isToolReturnWithUpdate, type ToolReturn } from '@domain/conversation/tool-outcome';
import { ExerciseNotFoundError } from '@domain/training/errors';

import { CHEST_PRESS, daysBefore, NOW, sessionRow, sets } from '@infra/ai/load-facts/__tests__/rows';
import { toToolMessage } from '@infra/ai/tools/outcome';

import { buildGetLoadPlanTool } from '../get-load-plan.tool';

type InvokableTool = {
  name: string;
  invoke: (input: Record<string, unknown>, config?: RunnableConfig) => Promise<unknown>;
};

const config = {
  configurable: { userId: 'u1', thread_id: 'u1', activeSessionId: 'today' },
  context: { runId: 'run-test', userId: 'u1', now: NOW, user: { timezone: 'Asia/Manila' } },
} as unknown as RunnableConfig;

const past = [
  sessionRow('s1', daysBefore(3), [{ rowId: 'r1', ...CHEST_PRESS, sets: sets(65, [10, 10, 9], daysBefore(3)) }]),
  sessionRow('s2', daysBefore(10), [{ rowId: 'r2', ...CHEST_PRESS, sets: sets(65, [10, 10, 10], daysBefore(10)) }]),
];
const today = sessionRow('today', daysBefore(0, -30), [], { status: 'in_progress' });

function build(overrides: { resolve?: jest.Mock; recent?: unknown[]; suggestion?: boolean } = {}) {
  const trainingService = {
    resolveExerciseIdByName: overrides.resolve ?? jest.fn().mockResolvedValue(CHEST_PRESS.id),
    getSessionDetails: jest.fn().mockResolvedValue(today),
  };
  const tool = buildGetLoadPlanTool({
    trainingService,
    exerciseRepository: { findByIdsWithMuscles: async () => [past[0].exercises[0].exercise] },
    workoutSessionRepo: {
      findRecentByUserIdWithDetails: async () => overrides.recent ?? past,
      findLastPerformancesByExercise: async () => [],
      countRealPerformancesByExercise: async () => new Map([[CHEST_PRESS.id, 2]]),
    },
    userFacts: { getConstraints: async () => [], getForPrompt: async () => [] },
    suggestion: overrides.suggestion,
  } as never) as unknown as InvokableTool;
  return { tool, trainingService };
}

function rendered(ret: unknown): string {
  const r = ret as ToolReturn;
  return String(toToolMessage(isToolReturnWithUpdate(r) ? r.outcome : r, 'test-id').content);
}

describe('get_load_plan (AC-LF-4)', () => {
  it('by id: returns the full entry with the fact lines and the sets in full', async () => {
    const { tool } = build();
    const text = rendered(await tool.invoke({ exerciseId: CHEST_PRESS.id }, config));
    expect(text).toContain(`Machine Chest Press [ID:${CHEST_PRESS.id}]`);
    expect(text).toContain('reference: 2026-09-26');
    expect(text).toContain('10 reps @ 65 kg; 10 reps @ 65 kg; 9 reps @ 65 kg');
    expect(text).toContain('working weight 65 kg (2 performances / 8 wk)');
    expect(text).toContain('data: 2 performances in 8 wk, 2 all-time');
  });

  it('by name: resolves through the catalog resolver', async () => {
    const { tool, trainingService } = build();
    const text = rendered(await tool.invoke({ exerciseName: 'Machine Chest Press' }, config));
    expect(trainingService.resolveExerciseIdByName).toHaveBeenCalledWith('Machine Chest Press');
    expect(text).toContain('reference: 2026-09-26');
  });

  it('unknown name → llm_error suggesting search_exercises', async () => {
    const { tool } = build({ resolve: jest.fn().mockRejectedValue(new ExerciseNotFoundError('nope')) });
    const text = rendered(await tool.invoke({ exerciseName: 'nope' }, config));
    expect(text).toContain('not found in the catalog');
    expect(text).toContain('search_exercises');
  });

  it('resolution failure → system_error, not an llm_error', async () => {
    const { tool } = build({ resolve: jest.fn().mockRejectedValue(new Error('db down')) });
    const text = rendered(await tool.invoke({ exerciseName: 'x' }, config));
    expect(text).toContain('database or embedding error');
    expect(text).not.toContain('search_exercises');
  });

  it('no record → a plain "no completed record" line', async () => {
    const { tool } = build({ recent: [] });
    expect(rendered(await tool.invoke({ exerciseId: CHEST_PRESS.id }, config))).toBe(
      'no completed record of Machine Chest Press',
    );
  });

  it('needs an id or a name', async () => {
    const { tool } = build();
    await expect(tool.invoke({}, config)).rejects.toBeDefined();
  });
});

describe('get_load_plan with LOAD_PLAN_SUGGESTION (load-plan AC-LP-3, A5)', () => {
  it('on: returns the v2 text — the v1 facts plus scheme, decision, recommend, conservative, confidence', async () => {
    const { tool } = build({ suggestion: true });
    const text = rendered(await tool.invoke({ exerciseId: CHEST_PRESS.id }, config));
    expect(text).toContain('reference: 2026-09-26');
    expect(text).toContain('scheme: double progression');
    expect(text).toContain('tactic: none active');
    expect(text).toMatch(/decision: Stage [ABC], /);
    expect(text).toMatch(/recommend: /);
    expect(text).toMatch(/conservative: /);
    expect(text).toMatch(/confidence: /);
  });

  it('on: the description says the numbers are a suggestion the model decides on', () => {
    const { tool } = build({ suggestion: true });
    expect((tool as unknown as { description: string }).description).toMatch(/you decide the load/);
  });

  it('off (default): the v1 text, byte-compatible — no decision lines', async () => {
    const { tool } = build();
    const text = rendered(await tool.invoke({ exerciseId: CHEST_PRESS.id }, config));
    expect(text).not.toMatch(/recommend:|decision:|scheme:|conservative:/);
    expect((tool as unknown as { description: string }).description).toMatch(/recommends nothing/);
  });
});
