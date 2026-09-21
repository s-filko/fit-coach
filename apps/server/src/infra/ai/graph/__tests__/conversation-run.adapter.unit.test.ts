/**
 * Adapter tests (refactor-p3-run-context-commit Task 5 Step 1): happy path,
 * missing user, failed-run rows (D-F classification), and the invoke config
 * contract (context / metadata.runId / callbacks[0] / thread_id).
 */
import { AIMessage, HumanMessage } from '@langchain/core/messages';

import { CoreError, LlmUnavailableError, type IConversationRunService } from '@domain/conversation/ports';
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
  const deleteThread = jest.fn().mockResolvedValue(undefined);
  const appendSystemNote = jest.fn().mockResolvedValue(undefined);
  const deps = {
    graph,
    userService,
    runService,
    checkpointer: { deleteThread },
    transcript: { appendRunMessages: jest.fn(), appendSystemNote },
  };
  return { deps, deleteThread, appendSystemNote, recordRun };
}

describe('buildConversationRunner (ADR-0013 §11, D-F)', () => {
  it('returns { text, phase, runId } — a single-AI run delivers that text byte-for-byte (AC-CC-3)', async () => {
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

  // chat-continuity Task 3 (AC-CC-3 / BUG-018): the greeting written alongside
  // the tool calls reaches the user too — every non-empty AI text of THIS run,
  // in order, blank line between; the pre-run exchange is never re-sent.
  it('AC-CC-3: the reply carries every non-empty AI text of the run, not only the last one', async () => {
    const graph = {
      invoke: async () => ({
        phase: 'session_planning',
        messages: [
          new HumanMessage('q1'),
          new AIMessage({ content: 'старый ответ', tool_calls: [] }),
          new HumanMessage('привет'),
          new AIMessage({
            content: 'Привет! Рад тебя видеть.',
            tool_calls: [{ id: 'c1', name: 'request_transition', args: {}, type: 'tool_call' }],
          }),
          new AIMessage({
            content: '',
            tool_calls: [{ id: 'c2', name: 'search_exercises', args: {}, type: 'tool_call' }],
          }),
          new AIMessage({ content: 'Финальный ответ.', tool_calls: [] }),
        ],
      }),
    };
    const { deps } = makeDeps(graph, makeUser());
    const runner = buildConversationRunner(deps);

    const out = await runner.run({ userId: UID, text: 'привет' });
    expect(out.text).toBe('Привет! Рад тебя видеть.\n\nФинальный ответ.');
    expect(out.text).not.toContain('старый ответ');
  });

  it('throws before invoke when the user is missing (D-A)', async () => {
    const invoke = jest.fn(async () => ({}));
    const { deps } = makeDeps({ invoke }, null);
    const runner = buildConversationRunner(deps);

    await expect(runner.run({ userId: UID, text: 'x' })).rejects.toThrow('not found');
    expect(invoke).not.toHaveBeenCalled();
  });

  it('D-F/ADR-0013 §6: a throwing graph records outcome core_error and rethrows a typed CoreError', async () => {
    const { deps, recordRun } = makeDeps(
      {
        invoke: async () => {
          throw new Error('boom');
        },
      },
      makeUser(),
    );
    const runner = buildConversationRunner(deps);

    await expect(runner.run({ userId: UID, text: 'x' })).rejects.toBeInstanceOf(CoreError);
    expect(recordRun).toHaveBeenCalledTimes(1);
    const [[record]] = recordRun.mock.calls;
    expect(record.outcome).toBe('core_error');
    expect(record.phaseOut).toBeNull();
    expect(record.userId).toBe(UID);
  });

  it('ADR-0013 §6/INV-LLM-006: the thrown CoreError carries a fixed message, not the original — the original rides cause', async () => {
    const sentinel = 'SENTINEL_ORIGINAL_MESSAGE_e8f2a1';
    const { deps } = makeDeps(
      {
        invoke: async () => {
          throw new Error(sentinel);
        },
      },
      makeUser(),
    );
    const runner = buildConversationRunner(deps);

    await expect(runner.run({ userId: UID, text: 'x' })).rejects.toMatchObject({
      code: 'CORE_ERROR',
    });
    try {
      await runner.run({ userId: UID, text: 'x' });
      throw new Error('expected rejection');
    } catch (thrown) {
      expect(thrown).toBeInstanceOf(CoreError);
      const coreError = thrown as CoreError;
      expect(coreError.message).not.toContain(sentinel);
      expect(coreError.cause).toBeInstanceOf(Error);
      expect((coreError.cause as Error).message).toBe(sentinel);
    }
  });

  it('D-F/ADR-0013 §6: a provider error (status >= 500 / 429) records outcome llm_unavailable and rethrows a typed LlmUnavailableError', async () => {
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

    const rejection = runner.run({ userId: UID, text: 'x' });
    await expect(rejection).rejects.toBeInstanceOf(LlmUnavailableError);
    await expect(rejection).rejects.toMatchObject({ code: 'LLM_UNAVAILABLE' });
    expect(recordRun.mock.calls[0][0].outcome).toBe('llm_unavailable');
  });

  it('D-F: a failed recordRun never masks the original error (still a typed CoreError)', async () => {
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

    await expect(runner.run({ userId: UID, text: 'x' })).rejects.toBeInstanceOf(CoreError);
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

  it('D-F (P4 Task 7): clearContext deletes the thread and notes it in the transcript, port-only', async () => {
    const graph = {
      invoke: async () => ({}),
      getState: async () => ({ values: { phase: 'training' } }),
    };
    const { deps, deleteThread, appendSystemNote } = makeDeps(graph, makeUser());
    const runner = buildConversationRunner(deps);

    await runner.clearContext(UID);

    expect(deleteThread).toHaveBeenCalledWith(UID);
    expect(appendSystemNote).toHaveBeenCalledWith({
      userId: UID,
      phase: 'training',
      text: 'Контекст диалога очищен.', // ru user (makeUser)
    });
  });

  describe('compact (manual /compact)', () => {
    it('runs the graph compact-only: flagged context, no message appended, no run row, no transcript rows', async () => {
      const seen: { input?: unknown; config?: unknown } = {};
      const graph = {
        invoke: async (input: unknown, config: unknown) => {
          Object.assign(seen, { input, config });
          return { episodeId: (config as { context: { runId: string } }).context.runId };
        },
      };
      const { deps, recordRun, appendSystemNote } = makeDeps(graph, makeUser());
      const runner = buildConversationRunner(deps);

      await expect(runner.compact(UID)).resolves.toBe('compacted');

      const { context, configurable } = seen.config as {
        context: { compactOnly: boolean; userId: string };
        configurable: { thread_id: string };
      };
      expect(context.compactOnly).toBe(true);
      expect(context.userId).toBe(UID);
      expect(configurable.thread_id).toBe(UID);
      expect(seen.input).toEqual({ messages: [] }); // nothing appended: no HumanMessage
      expect(recordRun).not.toHaveBeenCalled();
      expect(appendSystemNote).not.toHaveBeenCalled();
    });

    it('nothing folded (the episode id did not move) → nothing_to_compact', async () => {
      const graph = { invoke: async () => ({ episodeId: 'an-older-episode' }) };
      const { deps } = makeDeps(graph, makeUser());

      await expect(buildConversationRunner(deps).compact(UID)).resolves.toBe('nothing_to_compact');
    });

    it('a provider failure rethrows typed (503), a bug as CoreError — the message never rides the error', async () => {
      const providerDown = { invoke: async () => Promise.reject(Object.assign(new Error('secret'), { status: 503 })) };
      const bug = { invoke: async () => Promise.reject(new Error('secret')) };

      await expect(
        buildConversationRunner(makeDeps(providerDown, makeUser()).deps).compact(UID),
      ).rejects.toBeInstanceOf(LlmUnavailableError);
      await expect(buildConversationRunner(makeDeps(bug, makeUser()).deps).compact(UID)).rejects.toBeInstanceOf(
        CoreError,
      );
    });

    it('an unknown user throws before the graph is entered', async () => {
      const invoke = jest.fn();
      const { deps } = makeDeps({ invoke }, null);

      await expect(buildConversationRunner(deps).compact(UID)).rejects.toThrow('not found');
      expect(invoke).not.toHaveBeenCalled();
    });
  });
});
