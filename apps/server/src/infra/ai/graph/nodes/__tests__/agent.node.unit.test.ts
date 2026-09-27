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

const FRESH_USER = { id: 'fresh-user', languageCode: 'ru', timezone: 'Europe/Berlin' as string | null };

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
    // [system, NOW, human, ai(tool_calls), nudge, tool] — the nudge sits
    // immediately before the last ToolMessage (one shape, no frames); the
    // NOW line (now-line-last) is its own message ahead of `current`.
    expect(first).toHaveLength(6);
    expect(first[4]._getType()).toBe('system');
    expect(first[4].content).toBe(NUDGE_TEXT);
    expect(first[5]._getType()).toBe('tool');
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
    // [system, NOW, human, ai(tool_calls), tool, system-frame] — a system-final
    // turn gets no nudge on the first call.
    expect(first).toHaveLength(6);
    expect(first.every(m => m.content !== NUDGE_TEXT)).toBe(true);
    expect(first[5]._getType()).toBe('system');
    expect(String(first[5].content).startsWith('=== TOOL EXECUTION RESULTS ===')).toBe(true);
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

    it('gap ≥ EPISODE_GAP_HOURS → a system note with the duration directly before the NOW line', async () => {
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
      // now-line-last D1: [system, note, NOW, human] — the note no longer
      // touches the human message; the NOW line does.
      const noteIdx = sent.findIndex(m => String(m.content).includes('The user returns after 4 h.'));
      expect(noteIdx).toBeGreaterThan(0);
      expect(sent[noteIdx]._getType()).toBe('system');
      expect(sent[noteIdx + 1]._getType()).toBe('system');
      expect(String(sent[noteIdx + 1].content).startsWith('NOW (')).toBe(true);
      expect(messageBeforeHuman(sent)).toBe(sent[noteIdx + 1]);
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

  // now-line-last plan (BUG-032 amendment, D1/D2): the NOW line left the
  // directives (block 1) and is rendered here — same CURRENT_TIME_V1 renderer,
  // the gap-note wiring — into its own SystemMessage immediately before
  // `current`'s HumanMessage, so everything ahead of it is prompt-cacheable.
  describe('NOW line (now-line-last, AC-NL-1/AC-NL-2)', () => {
    const configWithNow = (now: Date, user = FRESH_USER): RunnableConfig =>
      ({
        configurable: { userId: 'u1' },
        metadata: { runId: 'run-1', userId: 'u1' },
        context: {
          runId: 'run-1',
          userId: 'u1',
          user: user as never,
          now,
          client: 'telegram' as const,
          trigger: 'user_message' as const,
          metrics: metricsCollector,
        },
      }) as never as RunnableConfig;

    it('exactly one SystemMessage starting with NOW ( directly before the current HumanMessage; block 1 carries no NOW', async () => {
      mockInvoke.mockResolvedValueOnce(new AIMessage({ content: 'ok', tool_calls: [] }));
      const node = buildAgentNode(makeSpec(), makeDeps());

      await node({ ...makeState(), messages: [new HumanMessage('привет')] }, CONFIG);

      const sent = mockInvoke.mock.calls[0][0] as BaseMessage[];
      const nowMessages = sent.filter(m => String(m.content).startsWith('NOW ('));
      expect(nowMessages).toHaveLength(1);
      expect(sent[0]._getType()).toBe('system');
      expect(String(sent[0].content)).not.toContain('NOW (');
      const humanIdx = sent.findIndex(m => m._getType() === 'human');
      expect(humanIdx).toBe(2); // [block 1, NOW, human]
      expect(String(sent[humanIdx - 1].content).startsWith('NOW (')).toBe(true);
    });

    // Review R3: non-vacuous — the assertion targets the NOW message itself
    // (found by its prefix), both timezone variants, not "somewhere in sent".
    it('renders the user’s timezone (FRESH_USER → Europe/Berlin), both variants one renderer', async () => {
      mockInvoke.mockResolvedValue(new AIMessage({ content: 'ok', tool_calls: [] }));
      const node = buildAgentNode(makeSpec(), makeDeps());

      await node({ ...makeState(), messages: [new HumanMessage('привет')] }, configWithNow(new Date(0)));
      await node(
        { ...makeState(), messages: [new HumanMessage('привет')] },
        configWithNow(new Date(0), { ...FRESH_USER, timezone: null }),
      );

      const nowOf = (messages: BaseMessage[]) =>
        messages.find(m => String(m.content).startsWith('NOW (')) as BaseMessage;
      const known = nowOf(mockInvoke.mock.calls[0][0] as BaseMessage[]);
      const unknown = nowOf(mockInvoke.mock.calls[1][0] as BaseMessage[]);
      expect(String(known.content)).toContain('(Europe/Berlin)');
      expect(String(unknown.content)).toContain("user's timezone is unknown");
      expect(String(unknown.content)).not.toContain('Europe/Berlin');
    });

    it('AC-NL-2: two runs one minute apart → everything before the NOW message is byte-identical, only NOW differs', async () => {
      mockInvoke.mockResolvedValue(new AIMessage({ content: 'ok', tool_calls: [] }));
      // Review R3: non-empty history and a domain block, so "byte-identical"
      // actually covers block 1 + domain + history, not just block 1.
      const node = buildAgentNode(
        makeSpec({
          contextBlocks: [{ id: 'test.domain', render: () => 'DOMAIN BLOCK (stable across runs)' }],
        } as never),
        makeDeps(),
      );
      const state = {
        ...makeState(),
        messages: [new HumanMessage('первое'), new AIMessage('ответ'), new HumanMessage('привет')],
      };

      await node(state, configWithNow(new Date(0)));
      await node(state, configWithNow(new Date(60_000)));

      const first = mockInvoke.mock.calls[0][0] as BaseMessage[];
      const second = mockInvoke.mock.calls[1][0] as BaseMessage[];
      expect(first).toHaveLength(second.length);

      const nowIdx = first.findIndex(m => String(m.content).startsWith('NOW ('));
      // [block 1, domain, history human, history ai, NOW, current human]
      expect(first.slice(0, nowIdx).map(m => m._getType())).toEqual(['system', 'system', 'human', 'ai']);
      expect(String(first[nowIdx - 3].content)).toContain('DOMAIN BLOCK');
      expect(String(first[nowIdx - 2].content)).toContain('первое');
      expect(String(first[nowIdx - 1].content)).toContain('ответ');
      // block 1 .. history, byte-identical — this is the prompt-cacheable prefix.
      expect(first.slice(0, nowIdx).map(m => JSON.stringify([m._getType(), m.content]))).toEqual(
        second.slice(0, nowIdx).map(m => JSON.stringify([m._getType(), m.content])),
      );
      // Only the NOW message moved: minute later, still the same shape.
      expect(String(first[nowIdx].content)).not.toBe(String(second[nowIdx].content));
      expect(
        first
          .slice(nowIdx)
          .map(m => JSON.stringify([m._getType(), m.content]))
          .slice(1),
      ).toEqual(
        second
          .slice(nowIdx)
          .map(m => JSON.stringify([m._getType(), m.content]))
          .slice(1),
      );
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

    it('D2: the info line adds cacheReadTokens/reasoningTokens off usage_metadata details', async () => {
      mockInvoke.mockResolvedValueOnce(
        new AIMessage({
          content: 'готово',
          tool_calls: [],
          usage_metadata: {
            input_tokens: 5765,
            output_tokens: 30,
            total_tokens: 5795,
            input_token_details: { cache_read: 5760 },
            output_token_details: { reasoning: 30 },
          },
        }),
      );
      const node = buildAgentNode(makeSpec(), makeDeps());

      await node(makeState(), CONFIG);

      expect(logFns.info).toHaveBeenCalledWith(
        expect.objectContaining({
          promptTokens: 5765,
          completionTokens: 30,
          cacheReadTokens: 5760,
          reasoningTokens: 30,
        }),
        expect.any(String),
      );
    });

    it('D2: no cache/reasoning detail reported → those fields log as null, never 0', async () => {
      mockInvoke.mockResolvedValueOnce(
        new AIMessage({
          content: 'готово',
          tool_calls: [],
          response_metadata: { finish_reason: 'stop', tokenUsage: { promptTokens: 100, completionTokens: 10 } },
        }),
      );
      const node = buildAgentNode(makeSpec(), makeDeps());

      await node(makeState(), CONFIG);

      expect(logFns.info).toHaveBeenCalledWith(
        expect.objectContaining({ cacheReadTokens: null, reasoningTokens: null }),
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
