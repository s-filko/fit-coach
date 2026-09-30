/**
 * Prompt-caching plan (BUG-051) AC-PC-4, executor half (D4): availability moves from hiding to rejecting.
 * `delete_last_sets` / `update_last_set` called before the current exercise has a set come back as a refusal
 * ToolMessage (same meaning BUG-008 Plan A gave by hiding them), never reach the training service, and — review
 * fix — never spend training's `llmErrorBudget` (a `user_error`, not an `llm_error`).
 *
 * Interface assumed: the rejection is observable through `buildToolExecutor` over the REAL training tools
 * and policy, with the session read via `trainingService.getSessionDetails(activeSessionId)`. Where the
 * check lives (executor, policy hook, tool) is T3's choice — only `makeExecutor` below may need to follow
 * the wiring T3 picks.
 */
import { AIMessage, type BaseMessage, HumanMessage, type ToolMessage } from '@langchain/core/messages';
import type { RunnableConfig } from '@langchain/core/runnables';
import type { StructuredToolInterface } from '@langchain/core/tools';

import type { ITrainingService } from '@domain/training/ports';

import { buildDeleteLastSetsTool } from '@infra/ai/tools/delete-last-sets.tool';
import { outcomeKindOf } from '@infra/ai/tools/outcome';
import { buildUpdateLastSetTool } from '@infra/ai/tools/update-last-set.tool';
import { RunMetricsCollector } from '@infra/ai/run-metrics';

import { buildTrainingToolPolicy } from '../phases/training.spec';
import { buildToolExecutor } from '../tool-executor';

const SESSION_ID = '11111111-1111-4111-8111-111111111111';
const EXERCISE_ID = '22222222-2222-4222-8222-222222222222';

function makeTrainingService(sets: unknown[]) {
  return {
    getSessionDetails: jest.fn(async () => ({
      id: SESSION_ID,
      exercises: [{ id: EXERCISE_ID, exerciseId: EXERCISE_ID, status: 'in_progress', sets }],
    })),
    deleteLastSets: jest.fn(async () => ({ deletedSets: [{ setNumber: 1, setData: {}, rpe: null }] })),
    updateLastSet: jest.fn(async () => ({
      setNumber: 1,
      before: { setData: { reps: 8 }, rpe: null, setKind: null },
      after: { setData: { reps: 9 }, rpe: null, setKind: null },
    })),
  } as unknown as jest.Mocked<ITrainingService>;
}

function makeExecutor(trainingService: jest.Mocked<ITrainingService>) {
  const tools = [
    buildDeleteLastSetsTool({ trainingService }),
    buildUpdateLastSetTool({ trainingService }),
  ] as unknown as StructuredToolInterface[];
  return buildToolExecutor(tools, buildTrainingToolPolicy(tools));
}

const CONFIG = {
  configurable: { thread_id: 't-1' },
  metadata: { runId: 'run-1' },
  context: {
    runId: 'run-1',
    userId: 'user-1',
    user: { languageCode: null },
    now: new Date(0),
    client: 'telegram' as const,
    trigger: 'user_message' as const,
    metrics: new RunMetricsCollector('run-1'),
  },
} as never as RunnableConfig;

function stateCalling(name: string, args: Record<string, unknown>) {
  const messages: BaseMessage[] = [
    new HumanMessage('удали последний подход'),
    new AIMessage({ content: '', tool_calls: [{ id: 'c1', name, args, type: 'tool_call' }] }),
  ];
  return { messages, activeSessionId: SESSION_ID };
}

describe('AC-PC-4: delete_last_sets / update_last_set before the first set are rejected by the executor (D4)', () => {
  it('AC-PC-4: delete_last_sets with no set on the current exercise → refusal (not an llm_error), training service never called', async () => {
    const trainingService = makeTrainingService([]);
    const result = await makeExecutor(trainingService)(
      stateCalling('delete_last_sets', { exercise_id: EXERCISE_ID }),
      CONFIG,
    );
    const message = result.messages[0] as ToolMessage;
    expect(outcomeKindOf(message)).toBe('ok');
    expect(String(message.content)).toContain('delete_last_sets is not available yet');
    expect(trainingService.deleteLastSets).not.toHaveBeenCalled();
  });

  it('AC-PC-4: update_last_set with no set on the current exercise → refusal (not an llm_error), training service never called', async () => {
    const trainingService = makeTrainingService([]);
    const result = await makeExecutor(trainingService)(
      stateCalling('update_last_set', { exercise_id: EXERCISE_ID, reps: 9 }),
      CONFIG,
    );
    const message = result.messages[0] as ToolMessage;
    expect(outcomeKindOf(message)).toBe('ok');
    expect(String(message.content)).toContain('update_last_set is not available yet');
    expect(trainingService.updateLastSet).not.toHaveBeenCalled();
  });

  it('AC-PC-4: a premature delete/update does not spend the tool-error budget (no tool_error_budget_exhausted)', async () => {
    const trainingService = makeTrainingService([]);
    const state = stateCalling('delete_last_sets', { exercise_id: EXERCISE_ID });
    (state.messages[1] as AIMessage).tool_calls = [
      { id: 'c1', name: 'delete_last_sets', args: { exercise_id: EXERCISE_ID }, type: 'tool_call' },
      { id: 'c2', name: 'update_last_set', args: { exercise_id: EXERCISE_ID, reps: 9 }, type: 'tool_call' },
    ];
    const result = await makeExecutor(trainingService)(state, CONFIG);
    expect(result.messages).toHaveLength(2);
    expect(result.messages.every(m => m._getType() === 'tool')).toBe(true);
  });

  it('AC-PC-4: a failing session read inside the tool is handled by the tool, not thrown out of it', async () => {
    const trainingService = makeTrainingService([]);
    (trainingService.getSessionDetails as jest.Mock).mockRejectedValue(new Error('db down'));
    const result = await makeExecutor(trainingService)(
      stateCalling('delete_last_sets', { exercise_id: EXERCISE_ID }),
      CONFIG,
    );
    expect(result.messages[0]!._getType()).toBe('tool');
    expect(trainingService.deleteLastSets).not.toHaveBeenCalled();
  });

  it('AC-PC-4: once a set exists the same calls go through', async () => {
    const trainingService = makeTrainingService([{ setNumber: 1 }]);
    const executor = makeExecutor(trainingService);
    const del = await executor(stateCalling('delete_last_sets', { exercise_id: EXERCISE_ID }), CONFIG);
    expect(outcomeKindOf(del.messages[0] as ToolMessage)).toBe('ok');
    expect(trainingService.deleteLastSets).toHaveBeenCalledTimes(1);
    const upd = await executor(stateCalling('update_last_set', { exercise_id: EXERCISE_ID, reps: 9 }), CONFIG);
    expect(outcomeKindOf(upd.messages[0] as ToolMessage)).toBe('ok');
  });
});
