/**
 * Shared agent node unit tests (refactor-p3-phase-spec Task 2, ADR-0013
 * §4.1/§6): the recording-model pattern from the message-assembly harness,
 * with a fake spec so the node is exercised as pure phase-agnostic logic.
 * Message-class checks are duck-typed (_getType) — never instanceof.
 */
import { AIMessage, type BaseMessage, HumanMessage, SystemMessage, ToolMessage } from '@langchain/core/messages';
import type { RunnableConfig } from '@langchain/core/runnables';
import type { StructuredToolInterface } from '@langchain/core/tools';

import { type AgentNodeState, buildAgentNode } from '@infra/ai/graph/nodes/agent.node';
import type { ConversationGraphDeps, PhaseSpec } from '@infra/ai/graph/phase-spec';
import { t } from '@infra/ai/messages';
import { POST_TOOL_NUDGE_V1, renderBlock } from '@infra/ai/prompts/blocks';
import { RunMetricsCollector } from '@infra/ai/run-metrics';

const mockInvoke = jest.fn();
const mockBindTools = jest.fn(() => ({ invoke: mockInvoke }));
const mockGetModel = jest.fn((_profile?: string) => ({ bindTools: mockBindTools }));

jest.mock('@infra/ai/model.factory', () => ({
  getModel: (profile?: string) => mockGetModel(profile),
}));

// AC-RL-2: the node's log lines (info per response, warn on truncation) are
// part of the contract — one shared mock, same pattern as llm.gateway tests.
jest.mock('@shared/logger', () => {
  const fns = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
  return { createLogger: () => fns, __logFns: fns };
});
const { __logFns: logFns } = jest.requireMock('@shared/logger') as {
  __logFns: { info: jest.Mock; warn: jest.Mock; error: jest.Mock; debug: jest.Mock };
};

// The agent attaches the report to ctx.metrics (a real collector — spy on it).
const metricsCollector = new RunMetricsCollector('run-1');
const attachSpy = jest.spyOn(metricsCollector, 'attachBudgetReport');

const NUDGE_TEXT = renderBlock(POST_TOOL_NUDGE_V1, {});

const FRESH_USER = { id: 'fresh-user', languageCode: 'ru', timezone: 'Europe/Berlin' };

const renderSpy = jest.fn((ctx: { user?: { id?: string } | null }) => [
  { id: 'task', text: `rendered-for:${ctx.user?.id ?? 'none'}`, required: true },
]);

function makeSpec(overrides: Partial<PhaseSpec> = {}): PhaseSpec {
  return {
    name: 'chat',
    prompt: {
      current: { id: 'phase.test', version: 'v1', directives: [], render: renderSpy },
      requiredSections: [],
    } as unknown as PhaseSpec['prompt'],
    tools: [{ name: 'tool_a' }, { name: 'tool_b' }] as unknown as StructuredToolInterface[],
    toolPolicy: { llmErrorBudget: Infinity },
    loadContext: jest.fn(async () => ({ ok: true as const, data: { lastMessageTime: null } })),
    contextBlocks: [],
    modelProfile: 'default',
    budget: { system: 1, longTerm: 1, domain: 1, history: 1000, outputReserve: 1 },
    ...overrides,
  };
}

function makeDeps(overrides: Record<string, unknown> = {}): ConversationGraphDeps {
  return {
    userService: { getUser: jest.fn(async () => FRESH_USER) },
    // P6 Task 4: agent.node.ts loads facts once per run via deps.userFacts.
    userFacts: { getForPrompt: jest.fn(async () => []), getConstraints: jest.fn(), upsertMany: jest.fn() },
    // The production default gap (3 h) — AC-CC-2's threshold, same as compaction's.
    episodeConfig: { gapMs: 3 * 3_600_000, minTurns: 2, minTokens: 300, keepTurns: 6 },
    ...overrides,
  } as unknown as ConversationGraphDeps;
}

function makeState(overrides: Partial<AgentNodeState> = {}): AgentNodeState {
  return {
    ...overrides,
  };
}

const CONFIG = {
  configurable: { userId: 'u1' },
  metadata: { runId: 'run-1', userId: 'u1' },
  context: {
    runId: 'run-1',
    userId: 'u1',
    user: FRESH_USER as never,
    now: new Date(0),
    client: 'telegram' as const,
    trigger: 'user_message' as const,
    metrics: metricsCollector,
  },
} as never as RunnableConfig;

function aiWithToolCall(): AIMessage {
  return new AIMessage({
    content: '',
    tool_calls: [{ id: 'c1', name: 'tool_a', args: {}, type: 'tool_call' }],
  });
}

describe('buildAgentNode (ADR-0013 §4.1/§6)', () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    mockBindTools.mockClear();
    mockGetModel.mockClear();
    attachSpy.mockClear();
    renderSpy.mockClear();
  });

  it('renders the prompt with the fresh user (D-C) and invokes the model once', async () => {
    mockInvoke.mockResolvedValueOnce(new AIMessage({ content: 'ok', tool_calls: [] }));
    const node = buildAgentNode(makeSpec(), makeDeps());

    const out = await node(makeState(), CONFIG);

    expect(renderSpy).toHaveBeenCalledWith(
      expect.objectContaining({ user: expect.objectContaining({ id: 'fresh-user' }), client: 'telegram' }),
    );
    expect(mockGetModel).toHaveBeenCalledWith('default');
    expect(mockInvoke).toHaveBeenCalledTimes(1);
    expect(out.messages).toHaveLength(1);
    expect((out.messages[0] as AIMessage).content).toBe('ok');
  });

  it('loader refusal → catalog reply in the user’s language, no model call (D-B)', async () => {
    const spec = makeSpec({
      loadContext: jest.fn(async () => ({
        ok: false as const,
        reply: 'training_no_active_session' as const,
      })),
    });
    const node = buildAgentNode(spec, makeDeps());

    const out = await node(makeState(), CONFIG);

    expect(mockInvoke).not.toHaveBeenCalled();
    expect(mockBindTools).not.toHaveBeenCalled();
    expect(out.messages).toHaveLength(1);
    expect((out.messages[0] as AIMessage).content).toBe(t('training_no_active_session', 'ru'));
  });

  it('the availability filter decides what bindTools receives', async () => {
    mockInvoke.mockResolvedValueOnce(new AIMessage({ content: 'ok', tool_calls: [] }));
    const spec = makeSpec({ toolPolicy: { llmErrorBudget: Infinity, availability: () => ['tool_b'] } });
    const node = buildAgentNode(spec, makeDeps());

    await node(makeState(), CONFIG);

    expect(mockBindTools).toHaveBeenCalledWith([spec.tools[1]]);
  });

  it('post-tool turn: nudge inserted as a system entry right before the last ToolMessage', async () => {
    mockInvoke.mockResolvedValueOnce(new AIMessage({ content: 'ok', tool_calls: [] }));
    const node = buildAgentNode(makeSpec(), makeDeps());
    const state = makeState({
      // P4 shape: this run = human, then the in-flight tool traffic (D-I).
      messages: [
        new HumanMessage('ещё подход'),
        aiWithToolCall(),
        new ToolMessage({ tool_call_id: 'c1', content: 'ok' }),
      ],
    });

    await node(state, CONFIG);

    const first = mockInvoke.mock.calls[0][0] as BaseMessage[];
    // [system, human, ai(tool_calls), nudge, tool] — the nudge sits
    // immediately before the last ToolMessage (one shape, no frames).
    expect(first).toHaveLength(5);
    expect(first[3]._getType()).toBe('system');
    expect(first[3].content).toBe(NUDGE_TEXT);
    expect(first[4]._getType()).toBe('tool');
  });

  it('system-block-final turn (training tool-results frame): no nudge on the first call', async () => {
    mockInvoke.mockResolvedValueOnce(new AIMessage({ content: 'ok', tool_calls: [] }));
    const node = buildAgentNode(makeSpec(), makeDeps());
    const state = makeState({
      messages: [
        new HumanMessage('ещё подход'),
        aiWithToolCall(),
        new ToolMessage({ tool_call_id: 'c1', content: 'ok' }),
        new SystemMessage('=== TOOL EXECUTION RESULTS ==='),
      ],
    });

    await node(state, CONFIG);

    const first = mockInvoke.mock.calls[0][0] as BaseMessage[];
    // [system, human, ai(tool_calls), tool, system-frame] — a system-final
    // turn gets no nudge on the first call.
    expect(first).toHaveLength(5);
    expect(first.every(m => m.content !== NUDGE_TEXT)).toBe(true);
    expect(first[4]._getType()).toBe('system');
    expect(String(first[4].content).startsWith('=== TOOL EXECUTION RESULTS ===')).toBe(true);
  });

  it('empty reply → one retry with the nudge → still empty → the empty_reply catalog message (D-D)', async () => {
    mockInvoke.mockResolvedValue(new AIMessage({ content: '', tool_calls: [] }));
    const node = buildAgentNode(makeSpec(), makeDeps());

    const out = await node(makeState(), CONFIG);

    expect(mockInvoke).toHaveBeenCalledTimes(2);
    const retryMessages = mockInvoke.mock.calls[1][0] as BaseMessage[];
    expect(retryMessages.some(m => m._getType() === 'system' && m.content === NUDGE_TEXT)).toBe(true);
    expect(out.messages).toHaveLength(1);
    expect((out.messages[0] as AIMessage).content).toBe(t('empty_reply', 'ru'));
  });

  it('non-empty reply skips the retry entirely', async () => {
    mockInvoke.mockResolvedValueOnce(new AIMessage({ content: 'готово', tool_calls: [] }));
    const node = buildAgentNode(makeSpec(), makeDeps());

    await node(makeState(), CONFIG);

    expect(mockInvoke).toHaveBeenCalledTimes(1);
  });

  it('the assembler report is attached to the run-context collector', async () => {
    mockInvoke.mockResolvedValueOnce(new AIMessage({ content: 'ok', tool_calls: [] }));
    const node = buildAgentNode(makeSpec(), makeDeps());

    await node(makeState(), CONFIG);

    expect(attachSpy).toHaveBeenCalledWith(expect.objectContaining({ total: expect.any(Number) }));
  });

  it('summaries come from state, never from the context service (INV-LLM-001)', async () => {
    mockInvoke.mockResolvedValueOnce(new AIMessage({ content: 'ok', tool_calls: [] }));
    const deps = makeDeps();
    const spec = makeSpec();
    const node = buildAgentNode(spec, deps);

    await node({ ...makeState(), episodeSummaries: [] }, CONFIG);
  });

  // P4 context-budget plan, Task 2 (ADR-0013 §3.4 block 3, D-A/D-B): the
  // node renders spec.contextBlocks from loaded.data at full depth and hands
  // them to the assembler as a domain SystemMessage.
  it('renders spec.contextBlocks at full depth and sends them to the model as a domain block', async () => {
    mockInvoke.mockResolvedValueOnce(new AIMessage({ content: 'ok', tool_calls: [] }));
    const spec = makeSpec({
      loadContext: jest.fn(async () => ({ ok: true as const, data: { greeting: 'hi' } })),
      contextBlocks: [
        {
          id: 'test.block',
          version: 'v1',
          render: (data: { greeting: string }) => `BLOCK: ${data.greeting}`,
        },
      ],
    });
    const node = buildAgentNode(spec, makeDeps());

    await node(makeState(), CONFIG);

    const sent = mockInvoke.mock.calls[0][0] as BaseMessage[];
    const domainMessage = sent.find(m => m._getType() === 'system' && String(m.content) === 'BLOCK: hi');
    expect(domainMessage).toBeDefined();
    expect(attachSpy).toHaveBeenCalledWith(
      expect.objectContaining({ blocks: [{ id: 'test.block', tokens: expect.any(Number), depth: 0 }] }),
    );
  });

  it('a block that renders null is absent from the message array (block is "not applicable" this run)', async () => {
    mockInvoke.mockResolvedValueOnce(new AIMessage({ content: 'ok', tool_calls: [] }));
    const spec = makeSpec({
      contextBlocks: [{ id: 'test.absent', version: 'v1', render: () => null }],
    });
    const node = buildAgentNode(spec, makeDeps());

    await node(makeState(), CONFIG);

    expect(attachSpy).toHaveBeenCalledWith(expect.objectContaining({ blocks: [], domain: 0 }));
  });

  // chat-continuity plan Task 2 (AC-CC-2 / BUG-018): after an EPISODE_GAP_HOURS
  // pause, one time-gap system note sits immediately before the new message.
  describe('time-gap note (AC-CC-2)', () => {
    const messageBeforeHuman = (sent: BaseMessage[]): BaseMessage | undefined => {
      const humanIdx = sent.findIndex(m => m._getType() === 'human');
      return humanIdx > 0 ? sent[humanIdx - 1] : undefined;
    };

    it('gap ≥ EPISODE_GAP_HOURS → a system note with the duration right before the new message', async () => {
      mockInvoke.mockResolvedValueOnce(new AIMessage({ content: 'ok', tool_calls: [] }));
      const node = buildAgentNode(makeSpec(), makeDeps());

      // CONFIG's now is the epoch; the previous message was 4 h earlier.
      await node(
        {
          ...makeState(),
          messages: [new HumanMessage('привет')],
          lastUserMessageAt: new Date(-4 * 3_600_000).toISOString(),
        },
        CONFIG,
      );

      const sent = mockInvoke.mock.calls[0][0] as BaseMessage[];
      const before = messageBeforeHuman(sent);
      expect(before?._getType()).toBe('system');
      expect(String(before?.content)).toContain('The user returns after 4 h.');
    });

    it('gap below EPISODE_GAP_HOURS → no note anywhere', async () => {
      mockInvoke.mockResolvedValueOnce(new AIMessage({ content: 'ok', tool_calls: [] }));
      const node = buildAgentNode(makeSpec(), makeDeps());

      await node(
        { ...makeState(), messages: [new HumanMessage('привет')], lastUserMessageAt: new Date(-60_000).toISOString() },
        CONFIG,
      );

      const sent = mockInvoke.mock.calls[0][0] as BaseMessage[];
      expect(sent.some(m => String(m.content).includes('The user returns after'))).toBe(false);
    });

    it('first message ever (lastUserMessageAt null) → no note', async () => {
      mockInvoke.mockResolvedValueOnce(new AIMessage({ content: 'ok', tool_calls: [] }));
      const node = buildAgentNode(makeSpec(), makeDeps());

      await node({ ...makeState(), messages: [new HumanMessage('привет')], lastUserMessageAt: null }, CONFIG);

      const sent = mockInvoke.mock.calls[0][0] as BaseMessage[];
      expect(sent.some(m => String(m.content).includes('The user returns after'))).toBe(false);
    });
  });

  // BUG-019 / AC-RL-2: a length-truncated answer is visible in the log and is
  // never blindly re-run; only a genuinely empty stop answer keeps the retry.
  describe('truncation visibility and the no-blind-retry rule (AC-RL-2)', () => {
    beforeEach(() => {
      logFns.info.mockClear();
      logFns.warn.mockClear();
      logFns.error.mockClear();
      logFns.debug.mockClear();
      process.env.LLM_MAX_TOKENS = '16384';
    });
    afterEach(() => {
      delete process.env.LLM_MAX_TOKENS;
    });

    it('length + empty → ONE invoke, warn names the truncation and the cap, catalog text (no retry)', async () => {
      mockInvoke.mockResolvedValueOnce(
        new AIMessage({
          content: '',
          tool_calls: [],
          response_metadata: { finish_reason: 'length', tokenUsage: { promptTokens: 30160, completionTokens: 16384 } },
        }),
      );
      const node = buildAgentNode(makeSpec(), makeDeps());

      const out = await node(makeState(), CONFIG);

      expect(mockInvoke).toHaveBeenCalledTimes(1);
      expect(out.messages).toHaveLength(1);
      expect((out.messages[0] as AIMessage).content).toBe(t('empty_reply', 'ru'));
      expect(logFns.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'u1',
          phase: 'chat',
          finishReason: 'length',
          completionTokens: 16384,
          maxTokens: 16384,
        }),
        expect.stringMatching(/truncat/i),
      );
    });

    it('stop + empty → retried once exactly as today (two invokes, then the catalog text)', async () => {
      mockInvoke.mockResolvedValue(
        new AIMessage({ content: '', tool_calls: [], response_metadata: { finish_reason: 'stop' } }),
      );
      const node = buildAgentNode(makeSpec(), makeDeps());

      const out = await node(makeState(), CONFIG);

      expect(mockInvoke).toHaveBeenCalledTimes(2);
      expect((out.messages[0] as AIMessage).content).toBe(t('empty_reply', 'ru'));
      expect(logFns.warn).not.toHaveBeenCalledWith(
        expect.objectContaining({ finishReason: 'length' }),
        expect.anything(),
      );
    });

    it('normal answer → one info line with the finish reason and token counts, no warn', async () => {
      mockInvoke.mockResolvedValueOnce(
        new AIMessage({
          content: 'готово',
          tool_calls: [],
          response_metadata: { finish_reason: 'stop', tokenUsage: { promptTokens: 30160, completionTokens: 1200 } },
        }),
      );
      const node = buildAgentNode(makeSpec(), makeDeps());

      await node(makeState(), CONFIG);

      expect(logFns.info).toHaveBeenCalledTimes(1);
      expect(logFns.info).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'u1',
          phase: 'chat',
          finishReason: 'stop',
          promptTokens: 30160,
          completionTokens: 1200,
        }),
        expect.any(String),
      );
      // the fake spec's budget (system: 1) always trips the budget warn — what
      // must NOT appear is the truncation warn
      expect(logFns.warn).not.toHaveBeenCalledWith(
        expect.objectContaining({ finishReason: 'length' }),
        expect.anything(),
      );
    });

    it('reads token counts from usage_metadata when tokenUsage is absent', async () => {
      mockInvoke.mockResolvedValueOnce(
        new AIMessage({
          content: 'готово',
          tool_calls: [],
          usage_metadata: { input_tokens: 500, output_tokens: 25, total_tokens: 525 },
        }),
      );
      const node = buildAgentNode(makeSpec(), makeDeps());

      await node(makeState(), CONFIG);

      expect(logFns.info).toHaveBeenCalledWith(
        expect.objectContaining({ promptTokens: 500, completionTokens: 25 }),
        expect.any(String),
      );
    });

    it('truncated-but-non-empty → flow unchanged (the partial answer is returned), warn logged', async () => {
      mockInvoke.mockResolvedValueOnce(
        new AIMessage({ content: 'частичный ответ', tool_calls: [], response_metadata: { finish_reason: 'length' } }),
      );
      const node = buildAgentNode(makeSpec(), makeDeps());

      const out = await node(makeState(), CONFIG);

      expect(mockInvoke).toHaveBeenCalledTimes(1);
      expect((out.messages[0] as AIMessage).content).toBe('частичный ответ');
      expect(logFns.warn).toHaveBeenCalledWith(
        expect.objectContaining({ finishReason: 'length' }),
        expect.stringMatching(/truncat/i),
      );
    });

    it('no message bodies in the info line — only counters and the finish reason', async () => {
      mockInvoke.mockResolvedValueOnce(new AIMessage({ content: 'СЕКРЕТНЫЙ_ТЕКСТ_ОТВЕТА', tool_calls: [] }));
      const node = buildAgentNode(makeSpec(), makeDeps());

      await node(makeState(), CONFIG);

      const infoArg = JSON.stringify(logFns.info.mock.calls[0][0]);
      expect(infoArg).not.toContain('СЕКРЕТНЫЙ_ТЕКСТ_ОТВЕТА');
    });
  });
});
