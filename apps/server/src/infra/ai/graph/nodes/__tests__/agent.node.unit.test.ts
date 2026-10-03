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
import { textOnly } from '@infra/ai/message-text';

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

/** Text of a message whether `content` is a string or a list of text parts. */
function textOf(m: BaseMessage): string {
  return textOnly(m.content) ?? JSON.stringify(m.content);
}

/** The current HumanMessage's <context> text as the request carries it (D2). */
function contextOf(messages: BaseMessage[]): string {
  const human = messages.filter(m => m._getType() === 'human').pop() as BaseMessage;
  const first = Array.isArray(human.content) ? (human.content[0] as { text?: string }) : undefined;
  return first?.text?.startsWith('<context>') ? first.text : '';
}

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

  it('D4: every spec tool is bound, in spec order', async () => {
    mockInvoke.mockResolvedValueOnce(new AIMessage({ content: 'ok', tool_calls: [] }));
    const spec = makeSpec();
    const node = buildAgentNode(spec, makeDeps());

    await node(makeState(), CONFIG);

    expect(mockBindTools).toHaveBeenCalledWith(spec.tools);
  });

  it('post-tool turn (D3): the nudge is a text part appended to the last ToolMessage — no system entry', async () => {
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
    // [system, human(<context>…), ai(tool_calls), tool(+nudge part)] — one system message, the nudge rides
    // on the last ToolMessage, after the cacheable prefix.
    expect(first).toHaveLength(4);
    expect(first.filter(m => m._getType() === 'system')).toHaveLength(1);
    expect(first[3]._getType()).toBe('tool');
    expect(first[3].content).toEqual([
      { type: 'text', text: 'ok' },
      { type: 'text', text: NUDGE_TEXT },
    ]);
    expect((first[3] as ToolMessage).tool_call_id).toBe('c1');
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
    expect(first.every(m => !textOf(m).includes(NUDGE_TEXT))).toBe(true);
    expect(first[4]._getType()).toBe('system');
    expect(String(first[4].content).startsWith('=== TOOL EXECUTION RESULTS ===')).toBe(true);
  });

  it('empty reply → one retry with the nudge → still empty → the empty_reply catalog message (D-D)', async () => {
    mockInvoke.mockResolvedValue(new AIMessage({ content: '', tool_calls: [] }));
    const node = buildAgentNode(makeSpec(), makeDeps());

    const out = await node(makeState({ messages: [new HumanMessage('ещё подход')] }), CONFIG);

    expect(mockInvoke).toHaveBeenCalledTimes(2);
    const retryMessages = mockInvoke.mock.calls[1][0] as BaseMessage[];
    // D3: no ToolMessage to carry it → the nudge is appended to the last message, never a system entry.
    expect(retryMessages.filter(m => m._getType() === 'system')).toHaveLength(1);
    expect(textOf(retryMessages[retryMessages.length - 1]!)).toContain(NUDGE_TEXT);
    expect(out.messages).toHaveLength(1);
    expect((out.messages[0] as AIMessage).content).toBe(t('empty_reply', 'ru'));
  });

  it('D7: the raw provider response LangChain carries for usage extraction never reaches the checkpointed reply', async () => {
    mockInvoke.mockResolvedValueOnce(
      new AIMessage({
        content: 'готово',
        tool_calls: [],
        additional_kwargs: { __raw_response: { usage: {} }, keep: 1 },
      }),
    );
    const node = buildAgentNode(makeSpec(), makeDeps());

    const out = await node(makeState({ messages: [new HumanMessage('привет')] }), CONFIG);

    expect((out.messages[0] as AIMessage).additional_kwargs).toEqual({ keep: 1 });
  });

  // Prompt-caching plan D5 (AC-PC-6): while the cache is warm the assembler skips every budget cut.
  describe('cache-warm deferral of budget cuts (D5, AC-PC-6)', () => {
    const bigHistory = (): BaseMessage[] => [
      new HumanMessage('старый вопрос ' + 'x'.repeat(8000)),
      new AIMessage({ content: 'старый ответ', tool_calls: [] }),
    ];
    const run = async (episodeConfig: Record<string, unknown>, lastAgoMs: number) => {
      mockInvoke.mockResolvedValueOnce(new AIMessage({ content: 'ok', tool_calls: [] }));
      const deps = makeDeps({
        episodeConfig: { gapMs: 3 * 3_600_000, minTurns: 2, minTokens: 300, keepTurns: 6, ...episodeConfig },
      });
      await buildAgentNode(makeSpec(), deps)(
        {
          ...makeState(),
          messages: [...bigHistory(), new HumanMessage('дальше')],
          lastUserMessageAt: new Date(-lastAgoMs).toISOString(),
        },
        CONFIG,
      );
      return mockInvoke.mock.calls[0][0] as BaseMessage[];
    };
    const hasOldHistory = (sent: BaseMessage[]): boolean => sent.some(m => textOf(m).startsWith('старый вопрос'));

    it('warm (previous message 1 min ago) and under the hard cap → history untouched despite the tiny budget', async () => {
      const sent = await run({ cacheTtlMs: 300_000, hardCapTokens: 60_000 }, 60_000);
      expect(hasOldHistory(sent)).toBe(true);
      expect(attachSpy).toHaveBeenCalledWith(expect.objectContaining({ cuts: [] }));
    });

    it('warm but over the hard cap → today’s cuts run, and the cap is logged at info', async () => {
      logFns.info.mockClear();
      const sent = await run({ cacheTtlMs: 300_000, hardCapTokens: 1 }, 60_000);
      expect(hasOldHistory(sent)).toBe(false);
      expect(logFns.info).toHaveBeenCalledWith(
        expect.objectContaining({ phase: 'chat', cap: 1, estimatedTotal: expect.any(Number) }),
        'Context hard cap reached while cache warm',
      );
    });

    it('cache expired (previous message ≥ TTL ago) → today’s cuts run', async () => {
      const sent = await run({ cacheTtlMs: 300_000, hardCapTokens: 60_000 }, 300_001);
      expect(hasOldHistory(sent)).toBe(false);
    });

    it('LLM_PROMPT_CACHE off (no cacheTtlMs configured) → today’s cuts run', async () => {
      const sent = await run({}, 60_000);
      expect(hasOldHistory(sent)).toBe(false);
    });
  });

  it('D8: the call carries the phase and the run’s declared cache-break reasons in its callback metadata', async () => {
    mockInvoke.mockResolvedValueOnce(new AIMessage({ content: 'ok', tool_calls: [] }));
    const metrics = new RunMetricsCollector('run-1');
    metrics.declareCacheBreak('phase_switch');
    const declaringConfig = {
      ...(CONFIG as object),
      context: { ...(CONFIG as never as { context: object }).context, metrics },
    } as never as RunnableConfig;

    await buildAgentNode(makeSpec(), makeDeps())(
      makeState({ messages: [new HumanMessage('привет')] }),
      declaringConfig,
    );

    const passed = mockInvoke.mock.calls[0][1] as RunnableConfig;
    expect(passed.metadata).toMatchObject({ phase: 'chat', cacheBreakReasons: ['phase_switch'], runId: 'run-1' });
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
  it('renders spec.contextBlocks at full depth and sends them in the current user message’s <context> (D2)', async () => {
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

    await node(makeState({ messages: [new HumanMessage('привет')] }), CONFIG);

    const sent = mockInvoke.mock.calls[0][0] as BaseMessage[];
    expect(contextOf(sent)).toContain('BLOCK: hi');
    expect(sent.filter(m => m._getType() === 'system').some(m => String(m.content).includes('BLOCK: hi'))).toBe(false);
    expect(attachSpy).toHaveBeenCalledWith(
      expect.objectContaining({ blocks: [{ id: 'test.block', tokens: expect.any(Number), depth: 0 }] }),
    );
  });

  // coach-simplification I1 (AC-CS1-2): `memory: 'workout'` — the phase's own blocks carry the facts, the request
  // holds this workout's messages only.
  describe("memory: 'workout' (coach-simplification I1)", () => {
    const FACT = {
      id: 'f1',
      category: 'preference',
      fact: 'ALWAYS-ON-FACT',
      confirmations: 1,
      updatedAt: new Date('2026-09-01T10:00:00Z'),
    };
    const DIRECTIVE = {
      vector: 'strength',
      constraints: [],
      questions: ['DIRECTIVE-QUESTION'],
      suspectFacts: [],
      exerciseVerdicts: [],
    };
    const SUMMARY = {
      endedAt: '2026-09-01T10:00:00.000Z',
      phaseAtEnd: 'training',
      summary: {
        topics: ['EPISODE-TOPIC'],
        decisions: [],
        userState: [],
        trainingFeedback: [],
        openItems: [],
        facts: [],
      },
    };
    const START = new AIMessage({
      content: '',
      tool_calls: [{ id: 'start-1', name: 'start_training_session', args: {}, type: 'tool_call' }],
    });
    const messages = [
      new HumanMessage('before the workout'),
      new AIMessage('old reply'),
      new HumanMessage('начнём тренировку'),
      START,
      new ToolMessage({ tool_call_id: 'start-1', content: 'started' }),
      new AIMessage('Поехали!'),
      new HumanMessage('жим 80 на 8'),
    ];
    const loaded = (data: object) => jest.fn(async () => ({ ok: true as const, data }));

    const sentWith = async (memory: 'workout' | undefined): Promise<BaseMessage[]> => {
      mockInvoke.mockResolvedValueOnce(new AIMessage({ content: 'ok', tool_calls: [] }));
      const deps = makeDeps({ userFacts: { getForPrompt: jest.fn(async () => [FACT]) } });
      const spec = makeSpec({ loadContext: loaded({ lastMessageTime: null }), ...(memory ? { memory } : {}) });
      await buildAgentNode(spec, deps)(
        makeState({
          messages,
          episodeSummaries: [SUMMARY as never],
          courseDirective: { directive: DIRECTIVE, createdAt: '2026-09-01T10:00:00.000Z' } as never,
        }),
        CONFIG,
      );
      return mockInvoke.mock.calls[0][0] as BaseMessage[];
    };

    it('no user facts, course directive or episode summaries in the system message; facts are not even loaded', async () => {
      const sent = await sentWith('workout');
      const system = textOf(sent[0] as BaseMessage);
      expect(system).not.toMatch(/ALWAYS-ON-FACT|DIRECTIVE-QUESTION|EPISODE-TOPIC|User Facts|Previous episodes/);
    });

    it('sends this workout only: from the human message that started it, without the start call and its result', async () => {
      const sent = await sentWith('workout');
      const texts = sent.slice(1).map(m => (m._getType() === 'human' ? textOf(m) : String(m.content)));
      expect(texts.some(t => t.includes('before the workout') || t.includes('old reply'))).toBe(false);
      expect(sent.some(m => m._getType() === 'tool')).toBe(false);
      expect(sent.filter(m => m._getType() === 'human')).toHaveLength(2); // «начнём тренировку» + the current one
      expect(sent.some(m => m._getType() === 'ai' && String(m.content) === 'Поехали!')).toBe(true);
    });

    it('the default memory (episodes) is unchanged: facts, directive, summaries and the whole history', async () => {
      const sent = await sentWith(undefined);
      const system = textOf(sent[0] as BaseMessage);
      expect(system).toContain('ALWAYS-ON-FACT');
      expect(system).toContain('DIRECTIVE-QUESTION');
      expect(system).toContain('EPISODE-TOPIC');
      expect(sent.filter(m => m._getType() === 'human')).toHaveLength(3);
    });
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
    it('gap ≥ EPISODE_GAP_HOURS → the note with the duration sits in <context>, directly before the NOW line', async () => {
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
      // D2: the note and the NOW line are consecutive sections of the current message's <context>.
      const context = contextOf(sent);
      expect(context).toContain('The user returns after 4 h.');
      expect(context.indexOf('NOW (')).toBeGreaterThan(context.indexOf('The user returns after 4 h.'));
      expect(sent.filter(m => m._getType() === 'system')).toHaveLength(1);
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

  // load-plan Task 4 (D9, LOAD_PLAN_BREAKS): the same note carries the training-break tier and the once-only
  // reason question; off = v1 exactly.
  describe('time-gap note with breaks (load-plan Task 4)', () => {
    // A run's ctx is per run (the node memoises the break note on it) — never share CONFIG's object across tests.
    const freshConfig = (): RunnableConfig => {
      const base = CONFIG as unknown as { context: Record<string, unknown> };
      return { ...CONFIG, context: { ...base.context } } as unknown as RunnableConfig;
    };
    const FOUR_H_AGO = (): string => new Date(-4 * 3_600_000).toISOString();
    const SHORT_AGO = (): string => new Date(-60_000).toISOString();
    const run = async (deps: ConversationGraphDeps, lastUserMessageAt: string | null) => {
      mockInvoke.mockResolvedValueOnce(new AIMessage({ content: 'ok', tool_calls: [] }));
      await buildAgentNode(makeSpec(), deps)(
        { ...makeState(), messages: [new HumanMessage('привет')], lastUserMessageAt },
        freshConfig(),
      );
      return contextOf(mockInvoke.mock.calls[0][0] as BaseMessage[]);
    };
    const breakContext = (note: unknown) => ({ resolve: jest.fn(async () => note) });

    it('flag on, training break not yet asked about: the tier and the question ride in the note even without a message gap', async () => {
      const resolve = breakContext({ tier: 'rebuild', days: 30, ask: true });
      const context = await run(makeDeps({ loadPlanBreaks: true, breakContext: resolve }), SHORT_AGO());
      expect(context).toContain('The user returns after a training break of 30 days');
      expect(context).toContain('tier rebuild');
      expect(context).toContain('ask ONCE');
      expect(resolve.resolve).toHaveBeenCalledWith('u1', new Date(0), expect.anything());
    });

    it('flag on with a message gap: v1 sentence, then the training tier', async () => {
      const context = await run(
        makeDeps({ loadPlanBreaks: true, breakContext: breakContext({ tier: 'return', days: 15, ask: false }) }),
        FOUR_H_AGO(),
      );
      expect(context).toContain('The user returns after 4 h.');
      expect(context).toContain('Training: training break of 15 days');
      expect(context).not.toContain('ask ONCE');
    });

    it('flag on, already asked and no message gap: no note at all', async () => {
      const context = await run(
        makeDeps({ loadPlanBreaks: true, breakContext: breakContext({ tier: 'return', days: 15, ask: false }) }),
        SHORT_AGO(),
      );
      expect(context).not.toContain('The user returns after');
    });

    it('flag on, no training break and no message gap: no note', async () => {
      const context = await run(makeDeps({ loadPlanBreaks: true, breakContext: breakContext(null) }), SHORT_AGO());
      expect(context).not.toContain('The user returns after');
    });

    it('the question survives the later model calls of the same run (resolved once per run)', async () => {
      const resolve = breakContext({ tier: 'rebuild', days: 30, ask: true });
      const deps = makeDeps({ loadPlanBreaks: true, breakContext: resolve });
      const node = buildAgentNode(makeSpec(), deps);
      const state = { ...makeState(), messages: [new HumanMessage('привет')], lastUserMessageAt: SHORT_AGO() };
      mockInvoke.mockResolvedValue(new AIMessage({ content: 'ok', tool_calls: [] }));
      const runConfig = freshConfig();
      await node(state, runConfig);
      await node(state, runConfig);
      expect(resolve.resolve).toHaveBeenCalledTimes(1);
      expect(contextOf(mockInvoke.mock.calls[1][0] as BaseMessage[])).toContain('ask ONCE');
    });

    it('flag off: the break context is never consulted and the note is v1', async () => {
      const resolve = breakContext({ tier: 'rebuild', days: 30, ask: true });
      const context = await run(makeDeps({ breakContext: resolve }), FOUR_H_AGO());
      expect(resolve.resolve).not.toHaveBeenCalled();
      expect(context).toContain('The user returns after 4 h. Reply to their new message first');
      expect(context).not.toContain('training break');
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

    it('exactly one NOW ( line, in the current HumanMessage’s <context> (D2); block 1 carries no NOW', async () => {
      mockInvoke.mockResolvedValueOnce(new AIMessage({ content: 'ok', tool_calls: [] }));
      const node = buildAgentNode(makeSpec(), makeDeps());

      await node({ ...makeState(), messages: [new HumanMessage('привет')] }, CONFIG);

      const sent = mockInvoke.mock.calls[0][0] as BaseMessage[];
      expect(sent.filter(m => m._getType() === 'system')).toHaveLength(1);
      expect(String(sent[0].content)).not.toContain('NOW (');
      expect(sent).toHaveLength(2); // [block 1, human]
      expect(contextOf(sent).match(/NOW \(/g)).toHaveLength(1);
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

      const known = contextOf(mockInvoke.mock.calls[0][0] as BaseMessage[]);
      const unknown = contextOf(mockInvoke.mock.calls[1][0] as BaseMessage[]);
      expect(known).toContain('(Europe/Berlin)');
      expect(unknown).toContain("user's timezone is unknown");
      expect(unknown).not.toContain('Europe/Berlin');
    });

    it('AC-NL-2: two runs one minute apart → everything before the current message is byte-identical, only its <context> NOW differs', async () => {
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

      // [block 1, history human, history ai, current human(<context>DOMAIN + NOW</context> + text)]
      const currentIdx = first.length - 1;
      expect(first.slice(0, currentIdx).map(m => m._getType())).toEqual(['system', 'human', 'ai']);
      expect(String(first[1].content)).toContain('первое');
      expect(String(first[2].content)).toContain('ответ');
      expect(contextOf(first)).toContain('DOMAIN BLOCK');
      // block 1 .. history, byte-identical — this is the prompt-cacheable prefix.
      expect(first.slice(0, currentIdx).map(m => JSON.stringify([m._getType(), m.content]))).toEqual(
        second.slice(0, currentIdx).map(m => JSON.stringify([m._getType(), m.content])),
      );
      // Only the NOW inside <context> moved: a minute later.
      expect(contextOf(first)).not.toBe(contextOf(second));
      expect(contextOf(first).replace(/NOW \(.*\)/, '')).toBe(contextOf(second).replace(/NOW \(.*\)/, ''));
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
