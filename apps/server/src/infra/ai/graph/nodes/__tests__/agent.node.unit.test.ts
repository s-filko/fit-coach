/**
 * Shared agent node unit tests (refactor-p3-phase-spec Task 2, ADR-0013
 * §4.1/§6): the recording-model pattern from the message-assembly harness,
 * with a fake spec so the node is exercised as pure phase-agnostic logic.
 * Message-class checks are duck-typed (_getType) — never instanceof.
 */
import { AIMessage, type BaseMessage, SystemMessage, ToolMessage } from '@langchain/core/messages';
import type { RunnableConfig } from '@langchain/core/runnables';
import type { StructuredToolInterface } from '@langchain/core/tools';

import { type AgentNodeState, buildAgentNode } from '@infra/ai/graph/nodes/agent.node';
import type { ConversationGraphDeps, PhaseSpec } from '@infra/ai/graph/phase-spec';
import { t } from '@infra/ai/messages';
import { POST_TOOL_NUDGE_V1, renderBlock } from '@infra/ai/prompts/blocks';

const mockInvoke = jest.fn();
const mockBindTools = jest.fn(() => ({ invoke: mockInvoke }));
const mockGetModel = jest.fn((_profile?: string) => ({ bindTools: mockBindTools }));

jest.mock('@infra/ai/model.factory', () => ({
  getModel: (profile?: string) => mockGetModel(profile),
}));

const mockAttachBudgetReport = jest.fn();
jest.mock('@infra/ai/run-metrics', () => ({
  attachBudgetReport: (...args: unknown[]) => mockAttachBudgetReport(...args),
}));

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
    layout: { summaryFrame: true, historyMode: 'interleaved', toolResultsFrame: false },
    tools: [{ name: 'tool_a' }, { name: 'tool_b' }] as unknown as StructuredToolInterface[],
    toolPolicy: { llmErrorBudget: Infinity },
    loadContext: jest.fn(async () => ({ ok: true as const, data: { lastMessageTime: null } })),
    modelProfile: 'default',
    ...overrides,
  };
}

function makeDeps(overrides: Record<string, unknown> = {}): ConversationGraphDeps {
  return {
    contextService: {
      getMessagesForPrompt: jest.fn(async () => []),
      getLatestSummary: jest.fn(async () => 'SUMMARY TEXT'),
    },
    userService: { getUser: jest.fn(async () => FRESH_USER) },
    ...overrides,
  } as unknown as ConversationGraphDeps;
}

function makeState(overrides: Partial<AgentNodeState> = {}): AgentNodeState {
  return {
    userId: 'u1',
    user: { id: 'stale-user' } as AgentNodeState['user'],
    userMessage: 'hi',
    ...overrides,
  };
}

const CONFIG = {
  configurable: { userId: 'u1' },
  metadata: { runId: 'run-1', userId: 'u1' },
} as RunnableConfig;

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
    mockAttachBudgetReport.mockClear();
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
      messages: [aiWithToolCall(), new ToolMessage({ tool_call_id: 'c1', content: 'ok' })],
    });

    await node(state, CONFIG);

    const first = mockInvoke.mock.calls[0][0] as BaseMessage[];
    // [system, summary frame, human, ai(tool_calls), nudge, tool] — the nudge
    // sits immediately before the last ToolMessage.
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
        aiWithToolCall(),
        new ToolMessage({ tool_call_id: 'c1', content: 'ok' }),
        new SystemMessage('=== TOOL EXECUTION RESULTS ==='),
      ],
    });

    await node(state, CONFIG);

    const first = mockInvoke.mock.calls[0][0] as BaseMessage[];
    // [system, summary frame, human, ai(tool_calls), tool, tool-results frame]
    expect(first).toHaveLength(6);
    expect(first.every(m => m.content !== NUDGE_TEXT)).toBe(true);
    expect(first[5]._getType()).toBe('system');
    expect(String(first[5].content).startsWith('=== TOOL EXECUTION RESULTS ===')).toBe(true);
  });

  it('empty reply → one retry with the nudge → still empty → empty_reply in the user’s language (D-D)', async () => {
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

  it('attachBudgetReport receives config.metadata.runId and the assembler report', async () => {
    mockInvoke.mockResolvedValueOnce(new AIMessage({ content: 'ok', tool_calls: [] }));
    const node = buildAgentNode(makeSpec(), makeDeps());

    await node(makeState(), CONFIG);

    expect(mockAttachBudgetReport).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({ total: expect.any(Number) }),
    );
  });

  it('summaryFrame false: the summary is never loaded', async () => {
    mockInvoke.mockResolvedValueOnce(new AIMessage({ content: 'ok', tool_calls: [] }));
    const deps = makeDeps();
    const spec = makeSpec({ layout: { summaryFrame: false, historyMode: 'interleaved', toolResultsFrame: false } });
    const node = buildAgentNode(spec, deps);

    await node(makeState(), CONFIG);

    expect(deps.contextService.getLatestSummary as jest.Mock).not.toHaveBeenCalled();
  });
});
