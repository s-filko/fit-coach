/**
 * Adapter tests (refactor-p3-run-context-commit Task 5 Step 1): happy path,
 * missing user, failed-run rows (D-F classification), and the invoke config
 * contract (context / metadata.runId / callbacks[0] / thread_id).
 */
import { AIMessage, HumanMessage } from '@langchain/core/messages';

import type { IConversationRunService } from '@domain/conversation/ports';
import type { IUserService } from '@domain/user/ports';
import type { User } from '@domain/user/services/user.service';

import { RunMetricsCollector } from '@infra/ai/run-metrics';

import { buildConversationRunner } from '../conversation-run.adapter';

const UID = '11111111-1111-4111-8111-111111111111';

function makeUser(): User {
  return { id: UID, languageCode: 'ru' } as unknown as User;
}

type StubGraph = { invoke(input: unknown, config?: unknown): Promise<unknown> };

function makeDeps(graph: StubGraph, user: User | null) {
  const userService = { getUser: async () => user } as unknown as IUserService;
  const recordRun = jest.fn();
  const runService = { recordRun } as unknown as IConversationRunService;
  return { deps: { graph, userService, runService }, recordRun };
}

describe('buildConversationRunner (ADR-0013 §11, D-F)', () => {
  it('returns { text, phase, runId } — the text is the last AI message of the channel (P4, ADR-0013 §3.2)', async () => {
    const graph = {
      invoke: async () => ({
        phase: 'chat',
        messages: [new HumanMessage('привет'), new AIMessage({ content: 'Ответ', tool_calls: [] })],
      }),
    };
    const { deps } = makeDeps(graph, makeUser());
    const runner = buildConversationRunner(deps);

    await expect(runner.run({ userId: UID, text: 'привет' })).resolves.toEqual({
      text: 'Ответ',
      phase: 'chat',
      runId: expect.any(String),
    });
  });

  it('throws before invoke when the user is missing (D-A)', async () => {
    const invoke = jest.fn(async () => ({}));
    const { deps } = makeDeps({ invoke }, null);
    const runner = buildConversationRunner(deps);

    await expect(runner.run({ userId: UID, text: 'x' })).rejects.toThrow('not found');
    expect(invoke).not.toHaveBeenCalled();
  });

  it('D-F: a throwing graph records outcome core_error and rethrows', async () => {
    const { deps, recordRun } = makeDeps(
      {
        invoke: async () => {
          throw new Error('boom');
        },
      },
      makeUser(),
    );
    const runner = buildConversationRunner(deps);

    await expect(runner.run({ userId: UID, text: 'x' })).rejects.toThrow('boom');
    expect(recordRun).toHaveBeenCalledTimes(1);
    const [[record]] = recordRun.mock.calls;
    expect(record.outcome).toBe('core_error');
    expect(record.phaseOut).toBeNull();
    expect(record.userId).toBe(UID);
  });

  it('D-F: a provider error (status >= 500 / 429) records outcome llm_unavailable', async () => {
    const providerError = Object.assign(new Error('upstream'), { status: 503 });
    const { deps, recordRun } = makeDeps(
      {
        invoke: async () => {
          throw providerError;
        },
      },
      makeUser(),
    );
    const runner = buildConversationRunner(deps);

    await expect(runner.run({ userId: UID, text: 'x' })).rejects.toThrow('upstream');
    expect(recordRun.mock.calls[0][0].outcome).toBe('llm_unavailable');
  });

  it('D-F: a failed recordRun never masks the original error', async () => {
    const { deps, recordRun } = makeDeps(
      {
        invoke: async () => {
          throw new Error('boom');
        },
      },
      makeUser(),
    );
    recordRun.mockRejectedValueOnce(new Error('db down'));
    const runner = buildConversationRunner(deps);

    await expect(runner.run({ userId: UID, text: 'x' })).rejects.toThrow('boom');
  });

  it('carries the invoke config contract: context, metadata.runId, callbacks[0], thread_id (D-B)', async () => {
    let seen: Record<string, unknown> = {};
    const graph = {
      invoke: async (input: unknown, config: unknown) => {
        seen = { input, config };
        return { phase: 'registration' };
      },
    };
    const { deps } = makeDeps(graph, makeUser());
    const runner = buildConversationRunner(deps);

    await runner.run({ userId: UID, text: 'привет' });
    const config = seen.config as {
      configurable: { thread_id: string };
      metadata: { runId: string; userId: string };
      context: { runId: string; userId: string; metrics: RunMetricsCollector };
      callbacks: unknown[];
    };
    expect(config.configurable.thread_id).toBe(UID);
    expect(config.metadata.userId).toBe(UID);
    expect(config.context.runId).toBe(config.metadata.runId);
    expect(config.context.userId).toBe(UID);
    expect(config.context.metrics).toBeInstanceOf(RunMetricsCollector);
    const first = config.callbacks[0] as { handleLLMEnd?: unknown };
    expect(typeof first.handleLLMEnd).toBe('function'); // the collector's handler
    expect((seen.input as { messages: HumanMessage[] }).messages).toHaveLength(1);
  });
});
