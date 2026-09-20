/**
 * commit node tests (refactor-p3-run-context-commit Task 4 Step 1, reworked
 * for P4 Task 4 — ADR-0013 §4.1/§4.3/§8, D-K/D-I): transcript projection of
 * this run's messages only, run-row recording with toolCalls
 * (collectToolCalls), transition evaluation, handler order/isolation, and the
 * durable state that no longer clears `messages` (INV-LLM-002).
 */
import { AIMessage, HumanMessage, ToolMessage } from '@langchain/core/messages';

import type { PhaseTransitionCommitted, TransitionHandler } from '@domain/conversation/events';
import type { IConversationRunService, TranscriptPort } from '@domain/conversation/ports';
import type { User } from '@domain/user/services/user.service';

import { RunMetricsCollector } from '@infra/ai/run-metrics';

import { buildCommitNode } from '../nodes/commit.node';

const UID = '11111111-1111-4111-8111-111111111111';

function makeConfig() {
  const metrics = new RunMetricsCollector('run-test');
  return {
    metrics,
    config: {
      context: {
        runId: 'run-test',
        userId: UID,
        user: { id: UID } as unknown as User,
        now: new Date('2026-09-18T10:00:00Z'),
        client: 'telegram',
        trigger: 'user_message',
        metrics,
      },
    },
  };
}

function makeDeps(handlers: TransitionHandler[] = []) {
  const transcript: jest.Mocked<TranscriptPort> = {
    appendRunMessages: jest.fn(),
    appendSystemNote: jest.fn(),
  };
  const recordRun = jest.fn();
  return {
    node: buildCommitNode({
      transcript,
      runService: { recordRun } as unknown as IConversationRunService,
      onTransition: handlers,
    }),
    transcript,
    recordRun,
  };
}

function stateOf(overrides: Partial<Parameters<ReturnType<typeof buildCommitNode>>[0]> = {}) {
  return {
    phase: 'chat' as const,
    activeSessionId: null as string | null,
    messages: [new HumanMessage('вопрос'), new AIMessage('ответ')],
    pendingTransition: null,
    episodeId: 'ep-1',
    episodeSummaries: [],
    episodeStartedAt: null,
    lastUserMessageAt: null,
    compactReason: null,
    courseDirective: null,
    courseCheckFailure: null,
    courseExpiryQuestions: [],
    ...overrides,
  };
}

describe('buildCommitNode (ADR-0013 §4.1/§4.3/§8; P4 Task 4)', () => {
  it('INV-LLM-002: does not return a messages key — the channel persists, compaction is the only remover', async () => {
    const { node } = makeDeps();
    const { config } = makeConfig();

    const result = await node(stateOf(), config as never);

    expect(result).not.toHaveProperty('messages');
    expect(result.phase).toBe('chat');
    expect(result.pendingTransition).toBeNull();
  });

  it('D-K/D-I: projects only this run (from the last HumanMessage) with one row per message plus tool calls', async () => {
    const { node, transcript } = makeDeps();
    const { config } = makeConfig();
    const call = new AIMessage({
      content: '',
      tool_calls: [{ id: 'c1', name: 'log_set', args: { weight: 60 } }],
    });
    const messages = [
      new HumanMessage('старый вопрос'),
      new AIMessage('старый ответ'),
      new HumanMessage('вопрос'),
      call,
      new ToolMessage({ tool_call_id: 'c1', content: 'ok result' }),
      new AIMessage('готово'),
    ];

    await node(stateOf({ messages }), config as never);

    expect(transcript.appendRunMessages).toHaveBeenCalledTimes(1);
    const input = transcript.appendRunMessages.mock.calls[0]?.[0];
    // Only from the last HumanMessage; tool_calls carry their own rows (D-K).
    expect(input).toMatchObject({ userId: UID, runId: 'run-test', phase: 'chat', episodeId: 'ep-1' });
    expect(input?.messages).toEqual([
      { kind: 'human', text: 'вопрос' },
      { kind: 'ai', text: '', toolCalls: [{ id: 'c1', name: 'log_set', args: { weight: 60 } }] },
      { kind: 'tool_result', toolCallId: 'c1', text: 'ok result', status: 'ok' },
      { kind: 'ai', text: 'готово' },
    ]);
  });

  it('stamps lastUserMessageAt from ctx.now and no compactReason without a transition', async () => {
    const { node } = makeDeps();
    const { config } = makeConfig();

    const result = await node(stateOf(), config as never);

    expect(result.lastUserMessageAt).toBe('2026-09-18T10:00:00.000Z');
    expect(result.compactReason).toBeNull();
  });

  it('§8: records one run row with toolCalls filled from this run (collectToolCalls) and outcome ok', async () => {
    const { node, recordRun } = makeDeps();
    const { config } = makeConfig();
    const toolMsg = new ToolMessage({ tool_call_id: 'c1', content: 'ok result' });
    const ai = new AIMessage({
      content: '',
      tool_calls: [{ id: 'c1', name: 'log_set', args: { exerciseId: 'e1', weight: 60 } }],
    });

    await node(stateOf({ messages: [new HumanMessage('q'), ai, toolMsg, new AIMessage('готово')] }), config as never);

    expect(recordRun).toHaveBeenCalledTimes(1);
    const [[record]] = recordRun.mock.calls;
    expect(record.outcome).toBe('ok');
    expect(record.toolCalls).toEqual([{ name: 'log_set', argsHash: expect.any(String), outcomeKind: 'ok' }]);
  });

  it('BR-CONV-015: a blocked transition keeps the phase, records it, and fires no handlers', async () => {
    const handler = jest.fn();
    const { node, recordRun } = makeDeps([handler]);
    const { config } = makeConfig();

    const result = await node(
      stateOf({ phase: 'registration', pendingTransition: { toPhase: 'training' } }), // not in matrix
      config as never,
    );

    expect(result.phase).toBe('registration');
    expect(handler).not.toHaveBeenCalled();
    const [[record]] = recordRun.mock.calls;
    expect(record.phaseOut).toBeNull();
    expect(record.transition).toEqual({ toPhase: 'training', reason: undefined });
  });

  it('§4.3: a committed transition raises the event to handlers in order, merging activeSessionId and compactReason', async () => {
    const order: string[] = [];
    const first: TransitionHandler = async e => {
      order.push(`first:${e.to}`);
      return { activeSessionId: 's-new' };
    };
    const second: TransitionHandler = async e => {
      order.push(`second:${e.from}->${e.to}`);
      return { compactReason: 'phase_boundary' };
    };
    const { node } = makeDeps([first, second]);
    const { config } = makeConfig();

    const result = await node(
      stateOf({
        phase: 'session_planning',
        activeSessionId: 's-plan',
        pendingTransition: { toPhase: 'training', reason: 'session_started' },
      }),
      config as never,
    );

    expect(order).toEqual(['first:training', 'second:session_planning->training']);
    expect(result.phase).toBe('training');
    expect(result.activeSessionId).toBe('s-new');
    expect(result.compactReason).toBe('phase_boundary');
  });

  it('BR-CONV-007 spirit: one failing handler is isolated — the rest still run, the reply survives', async () => {
    const first: TransitionHandler = async () => {
      throw new Error('handler boom');
    };
    const second = jest.fn(async () => ({ activeSessionId: null }));
    const { node } = makeDeps([first, second]);
    const { config } = makeConfig();

    const result = await node(
      stateOf({ phase: 'training', activeSessionId: 's1', pendingTransition: { toPhase: 'chat' } }),
      config as never,
    );

    expect(second).toHaveBeenCalledTimes(1);
    expect(result.phase).toBe('chat');
    expect(result.activeSessionId).toBeNull();
  });

  it('a failing projection or recordRun never fails the run (analytics is best-effort)', async () => {
    const transcript: jest.Mocked<TranscriptPort> = {
      appendRunMessages: jest.fn().mockRejectedValue(new Error('db')),
      appendSystemNote: jest.fn(),
    };
    const recordRun = jest.fn().mockRejectedValue(new Error('db'));
    const node = buildCommitNode({
      transcript,
      runService: { recordRun } as unknown as IConversationRunService,
      onTransition: [],
    });
    const { config } = makeConfig();

    await expect(node(stateOf(), config as never)).resolves.toMatchObject({ phase: 'chat' });
  });
});

describe('event shape (§4.3)', () => {
  it('carries from/to/reason/activeSessionId as they were before the handlers ran', async () => {
    let seen: PhaseTransitionCommitted | null = null;
    const spy: TransitionHandler = async e => {
      seen = e;
      return {};
    };
    const { node } = makeDeps([spy]);
    const { config } = makeConfig();

    await node(
      stateOf({ phase: 'training', activeSessionId: 's1', pendingTransition: { toPhase: 'chat' } }),
      config as never,
    );

    expect(seen).toMatchObject({
      type: 'phase_transition_committed',
      userId: UID,
      from: 'training',
      to: 'chat',
      reason: null,
      activeSessionId: 's1',
    });
  });
});
