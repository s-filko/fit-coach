/**
 * Shared tool executor unit tests — AC-1332 (refactor-p3-tool-executor
 * Task 4). Every AC-1332 bullet is an it whose name starts with 'AC-1332:'.
 */
import { AIMessage, type BaseMessage, ToolMessage } from '@langchain/core/messages';
import type { RunnableConfig } from '@langchain/core/runnables';
import type { StructuredToolInterface } from '@langchain/core/tools';
import { END } from '@langchain/langgraph';

import { ok, systemError } from '@domain/conversation/tool-outcome';

import { RunMetricsCollector } from '@infra/ai/run-metrics';

import { afterTools, buildToolExecutor } from '../tool-executor';
import { type ToolPolicy, TRAINING_TOOL_PRIORITY } from '../tool-policy';

interface FakeTool {
  name: string;
  invoke: jest.Mock;
}

function fakeTool(name: string, impl?: jest.Mock): FakeTool {
  return { name, invoke: impl ?? jest.fn().mockResolvedValue(ok(`${name} done`)) };
}

function asTools(...fakes: FakeTool[]): StructuredToolInterface[] {
  return fakes as unknown as StructuredToolInterface[];
}

function stateWithCalls(
  calls: Array<{ name: string; args: Record<string, unknown>; id: string }>,
  extra: {
    messages?: BaseMessage[];
    userId?: string;
    activeSessionId?: string | null;
    languageCode?: string | null;
  } = {},
) {
  return {
    messages: [...(extra.messages ?? []), new AIMessage({ content: '', tool_calls: calls })],
    userId: extra.userId ?? 'user-1',
    ...(extra.activeSessionId !== undefined ? { activeSessionId: extra.activeSessionId } : {}),
    user: { languageCode: extra.languageCode === undefined ? null : extra.languageCode },
  };
}

const CTX = {
  runId: 'run-1',
  userId: 'user-1',
  user: { languageCode: null },
  now: new Date(0),
  client: 'telegram' as const,
  trigger: 'user_message' as const,
  metrics: new RunMetricsCollector('run-1'),
};
/** Config with run context; the language lives in ctx.user (state no longer carries it). */
function configWith(languageCode: string | null = null): RunnableConfig {
  return {
    configurable: { thread_id: 't-1' },
    metadata: { runId: 'run-1' },
    context: { ...CTX, user: { languageCode } },
  } as never;
}
const CONFIG: RunnableConfig = configWith();

describe('buildToolExecutor (AC-1332)', () => {
  it('AC-1332: orders calls per policy and by args.order within log_set', async () => {
    const logSet = fakeTool('log_set');
    const finish = fakeTool('finish_training');
    const executor = buildToolExecutor(asTools(logSet, finish), {
      ordering: TRAINING_TOOL_PRIORITY,
      llmErrorBudget: Infinity,
    });

    const result = await executor(
      stateWithCalls([
        { name: 'finish_training', args: {}, id: 'f' },
        { name: 'log_set', args: { reps: 10, order: 2 }, id: 's2' },
        { name: 'log_set', args: { reps: 8, order: 1 }, id: 's1' },
      ]),
      CONFIG,
    );

    const order = (result.messages as ToolMessage[]).map(m => m.tool_call_id);
    expect(order).toEqual(['s1', 's2', 'f']);
  });

  it('AC-1332: batch dedup rejects the whole duplicate group and runs the rest', async () => {
    const logSet = fakeTool('log_set');
    const other = fakeTool('complete_current_exercise');
    const executor = buildToolExecutor(asTools(logSet, other), {
      batchDedup: ['log_set'],
      llmErrorBudget: Infinity,
    });

    const result = await executor(
      stateWithCalls([
        { name: 'log_set', args: { reps: 10 }, id: 'dup-1' },
        { name: 'log_set', args: { reps: 10 }, id: 'dup-2' },
        { name: 'complete_current_exercise', args: {}, id: 'ok-1' },
      ]),
      CONFIG,
    );

    const byId = Object.fromEntries((result.messages as ToolMessage[]).map(m => [m.tool_call_id, m]));
    expect((byId['dup-1'] as ToolMessage).content).toContain('Duplicate log_set calls detected');
    expect((byId['dup-1'] as ToolMessage).content).toMatch(/^LLM_ERROR:/);
    expect((byId['dup-2'] as ToolMessage).content).toBe((byId['dup-1'] as ToolMessage).content);
    expect((byId['ok-1'] as ToolMessage).content).toBe('complete_current_exercise done');
    expect(logSet.invoke).not.toHaveBeenCalled();
    expect(other.invoke).toHaveBeenCalledTimes(1);
  });

  it('AC-1332: perTurnDedup runs search_exercises once for identical args and twice for different ones', async () => {
    const search = fakeTool('search_exercises', jest.fn().mockResolvedValue(ok('bench results')));
    const executor = buildToolExecutor(asTools(search), {
      perTurnDedup: ['search_exercises'],
      llmErrorBudget: Infinity,
    });

    const result = (await executor(
      stateWithCalls([
        { name: 'search_exercises', args: { query: 'bench' }, id: 'q1' },
        { name: 'search_exercises', args: { query: 'Bench ' }, id: 'q2' },
        { name: 'search_exercises', args: { query: 'squat' }, id: 'q3' },
      ]),
      CONFIG,
    )) as { messages: ToolMessage[] };

    expect(search.invoke).toHaveBeenCalledTimes(2);
    expect(result.messages.map(m => m.content)).toEqual(['bench results', 'bench results', 'bench results']);
    expect(search.invoke.mock.calls.map(c => c[0])).toEqual([{ query: 'bench' }, { query: 'squat' }]);
  });

  it('AC-1332: propagates pendingTransition and activeSessionId updates into the return value', async () => {
    const starter = fakeTool(
      'start_training_session',
      jest.fn().mockResolvedValue({
        outcome: ok('Session created'),
        update: {
          pendingTransition: { toPhase: 'training', reason: 'session_planning_complete' },
          activeSessionId: 's-42',
        },
      }),
    );
    const finisher = fakeTool(
      'finish_training',
      jest.fn().mockResolvedValue({
        outcome: ok('Session finished'),
        update: { pendingTransition: { toPhase: 'chat', reason: 'training_complete' } },
      }),
    );
    const executor = buildToolExecutor(asTools(starter, finisher), { llmErrorBudget: Infinity });

    const result = await executor(
      stateWithCalls([
        { name: 'start_training_session', args: {}, id: 'a' },
        { name: 'finish_training', args: {}, id: 'b' },
      ]),
      CONFIG,
    );

    // Last write wins per field; activeSessionId survives from the first update.
    expect(result.pendingTransition).toEqual({ toPhase: 'chat', reason: 'training_complete' });
    expect(result.activeSessionId).toBe('s-42');
  });

  it('AC-1332: system_error short-circuits — catalog AIMessage appended, remaining calls skipped', async () => {
    const breaker = fakeTool('log_set', jest.fn().mockResolvedValue(systemError('DB unavailable')));
    const after = fakeTool('finish_training');
    const executor = buildToolExecutor(asTools(breaker, after), {
      ordering: { log_set: 1, finish_training: 4 },
      llmErrorBudget: Infinity,
    });

    const result = (await executor(
      stateWithCalls(
        [
          { name: 'log_set', args: {}, id: 'a' },
          { name: 'finish_training', args: {}, id: 'b' },
        ],
        { languageCode: 'ru' },
      ),
      configWith('ru'),
    )) as { messages: BaseMessage[] };

    expect(after.invoke).not.toHaveBeenCalled();
    const last = result.messages[result.messages.length - 1];
    expect(last).toBeInstanceOf(AIMessage);
    expect((last as AIMessage).content).toBe(
      'Произошла техническая ошибка при сохранении данных тренировки. Пожалуйста, попробуй снова или обратись в поддержку.',
    );
    // afterTools routes the terminal AIMessage to END
    expect(afterTools({ messages: [...stateWithCalls([]).messages, ...result.messages] })).toBe(END);
  });

  it('AC-1332/D-J: every tool_call id is answered after a system_error — skipped calls get a ToolMessage', async () => {
    const breaker = fakeTool('log_set', jest.fn().mockResolvedValue(systemError('DB unavailable')));
    const after = fakeTool('finish_training');
    const executor = buildToolExecutor(asTools(breaker, after), {
      ordering: { log_set: 1, finish_training: 4 },
      llmErrorBudget: Infinity,
    });

    const result = (await executor(
      stateWithCalls(
        [
          { name: 'log_set', args: {}, id: 'a' },
          { name: 'finish_training', args: {}, id: 'b' },
          { name: 'log_set', args: {}, id: 'c' },
        ],
        { languageCode: 'en' },
      ),
      configWith('en'),
    )) as { messages: BaseMessage[] };

    // The invariant: every tool_call id of the last AIMessage has a ToolMessage —
    // an orphan would be replayed to the provider next run (rollback trigger).
    const toolMessages = result.messages.filter((m): m is ToolMessage => m instanceof ToolMessage);
    const answeredIds = new Set(toolMessages.map(m => m.tool_call_id));
    expect(answeredIds).toEqual(new Set(['a', 'b', 'c']));
    const skipped = toolMessages.find(m => m.tool_call_id === 'b');
    expect(String(skipped?.content)).toContain('Skipped');
  });

  it('AC-1332: llm_error budget exhaustion (budget 1) on the second error across two batches', async () => {
    const failing = fakeTool('log_set', jest.fn().mockRejectedValue(new Error('Invalid set data')));
    const executor = buildToolExecutor(asTools(failing), { batchDedup: ['log_set'], llmErrorBudget: 1 });

    // First batch: one llm_error lands in state.messages.
    const first = (await executor(stateWithCalls([{ name: 'log_set', args: { reps: 8 }, id: 'b1' }]), CONFIG)) as {
      messages: BaseMessage[];
    };
    expect(first.messages).toHaveLength(1);

    // Second batch with DIFFERENT args (so batch dedup does not reject it):
    // previous error + this one = 2 > budget 1 → catalog AIMessage appended.
    const second = (await executor(
      stateWithCalls([{ name: 'log_set', args: { reps: 6 }, id: 'b2' }], {
        messages: [new ToolMessage({ tool_call_id: 'b1', content: 'LLM_ERROR: Invalid set data', status: 'error' })],
      }),
      configWith('ru'),
    )) as { messages: BaseMessage[] };

    const last = second.messages[second.messages.length - 1];
    expect((last as AIMessage).content).toBe(
      'Не удалось записать данные после нескольких попыток. Попробуй переформулировать: укажи упражнение, вес и количество повторений чётко.',
    );
  });

  it('AC-1332: a schema-rejection error gets the search_exercises recovery hint appended', async () => {
    const boom = fakeTool(
      'save_workout_plan',
      jest
        .fn()
        .mockRejectedValue(
          new Error(
            'Received tool input did not match expected schema\n\n✖ Invalid UUID\n  → at sessionTemplates[1].exercises[0].exerciseId',
          ),
        ),
    );
    const executor = buildToolExecutor(asTools(boom), { llmErrorBudget: Infinity });
    const update = await executor(stateWithCalls([{ name: 'save_workout_plan', args: {}, id: 'c1' }]), CONFIG);
    const toolMsg = update.messages.find(m => m._getType() === 'tool') as ToolMessage;
    expect(String(toolMsg.content)).toContain('did not match expected schema');
    expect(String(toolMsg.content)).toContain('UUID copied verbatim from the search_exercises results');
    expect(String(toolMsg.content)).toContain('save_workout_plan again');
  });

  it('AC-1332: a non-schema tool error passes through without the hint', async () => {
    const boom = fakeTool('log_set', jest.fn().mockRejectedValue(new Error('db down')));
    const executor = buildToolExecutor(asTools(boom), { llmErrorBudget: Infinity });
    const update = await executor(stateWithCalls([{ name: 'log_set', args: {}, id: 'c1' }]), CONFIG);
    const toolMsg = update.messages.find(m => m._getType() === 'tool') as ToolMessage;
    expect(String(toolMsg.content)).toBe('LLM_ERROR: db down');
  });

  it('AC-1332: Infinity budget never exhausts', async () => {
    const failing = fakeTool('log_set', jest.fn().mockRejectedValue(new Error('boom')));
    const executor = buildToolExecutor(asTools(failing), NO_BUDGET_POLICY);

    const seeded: BaseMessage[] = [
      new ToolMessage({ tool_call_id: 'x', content: 'LLM_ERROR: old 1', status: 'error' }),
      new ToolMessage({ tool_call_id: 'y', content: 'LLM_ERROR: old 2', status: 'error' }),
      new ToolMessage({ tool_call_id: 'z', content: 'LLM_ERROR: old 3', status: 'error' }),
    ];
    const result = (await executor(
      stateWithCalls([{ name: 'log_set', args: {}, id: 'n' }], { messages: seeded }),
      CONFIG,
    )) as { messages: BaseMessage[] };

    // Only the new ToolMessage — no terminal AIMessage despite 4 total llm_errors.
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]).toBeInstanceOf(ToolMessage);
  });

  it('AC-1332: afterTools routes agent after plain tool messages, END after a terminal AIMessage', () => {
    const withToolLast = [new AIMessage('calling'), new ToolMessage({ tool_call_id: 'c', content: 'r' })];
    const withAiLast = [new ToolMessage({ tool_call_id: 'c', content: 'r' }), new AIMessage('done')];
    expect(afterTools({ messages: withToolLast })).toBe('agent');
    expect(afterTools({ messages: withAiLast })).toBe(END);
  });

  it('AC-1332: passes userId, activeSessionId, runId and callbacks through to the tool', async () => {
    const probe = fakeTool('save_timezone');
    const callbacks = [{ name: 'probe-handler' }];
    const config: RunnableConfig = {
      configurable: { thread_id: 't-9' },
      metadata: { runId: 'run-77' },
      callbacks: callbacks as never,
      context: { ...CTX, runId: 'run-77' },
    } as never;

    await executorWithProbe(probe, config);

    const invokeConfig = probe.invoke.mock.calls[0][1] as RunnableConfig;
    expect(invokeConfig.configurable).toMatchObject({
      thread_id: 't-9',
      userId: 'user-1',
      activeSessionId: 's-9',
      runId: 'run-77',
    });
    expect(invokeConfig.callbacks).toBe(callbacks as never);
    expect(invokeConfig.metadata).toMatchObject({ runId: 'run-77' });

    function executorWithProbe(p: FakeTool, cfg: RunnableConfig): Promise<unknown> {
      const executor = buildToolExecutor(asTools(p), { llmErrorBudget: Infinity });
      return executor(
        {
          messages: [new AIMessage({ content: '', tool_calls: [{ name: 'save_timezone', args: {}, id: 'c1' }] })],
          activeSessionId: 's-9',
        },
        cfg,
      );
    }
  });

  it('AC-1332: picks the catalog language from user.languageCode (ru → Russian, null → English)', async () => {
    const failing = fakeTool('log_set', jest.fn().mockResolvedValue(systemError('x')));
    const executor = buildToolExecutor(asTools(failing), { llmErrorBudget: 1 });

    const ru = (await executor(stateWithCalls([{ name: 'log_set', args: {}, id: 'r' }]), configWith('ru')))
      .messages as BaseMessage[];
    expect((ru[ru.length - 1] as AIMessage).content).toMatch(/техническая ошибка/);

    const failing2 = fakeTool('log_set', jest.fn().mockResolvedValue(systemError('x')));
    const executor2 = buildToolExecutor(asTools(failing2), { llmErrorBudget: 1 });
    const en = (await executor2(stateWithCalls([{ name: 'log_set', args: {}, id: 'e' }]), configWith(null)))
      .messages as BaseMessage[];
    expect((en[en.length - 1] as AIMessage).content).toMatch(/technical error/i);
  });
});

const NO_BUDGET_POLICY: ToolPolicy = { llmErrorBudget: Infinity };
