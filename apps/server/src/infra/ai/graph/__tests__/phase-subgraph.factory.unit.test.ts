/**
 * buildPhaseSubgraph factory tests (refactor-p3-phase-spec Task 3, ADR-0013
 * §4.1): agent → (tools | finalize), tools → afterTools → (agent | finalize).
 * A fake spec with one tool and a mocked model that calls the tool once must
 * run the loop and surface the tool's update and the final text.
 */
import { AIMessage, type BaseMessage, HumanMessage, ToolMessage } from '@langchain/core/messages';
import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';

import { ok } from '@domain/conversation/tool-outcome';

import type { ConversationGraphDeps, PhaseSpec } from '@infra/ai/graph/phase-spec';
import { buildPhaseSubgraph } from '@infra/ai/graph/phase-subgraph.factory';
import { RunMetricsCollector } from '@infra/ai/run-metrics';

const mockInvoke = jest.fn();
jest.mock('@infra/ai/model.factory', () => ({
  getModel: () => ({ bindTools: () => ({ invoke: mockInvoke }) }),
}));

const FRESH_USER = { id: 'u1', languageCode: 'en', timezone: 'Europe/Berlin' };

function makeDeps(): ConversationGraphDeps {
  return {
    userService: { getUser: jest.fn(async () => FRESH_USER) },
    // P6 Task 4: agent.node.ts loads facts once per run via deps.userFacts.
    userFacts: { getForPrompt: jest.fn(async () => []), getConstraints: jest.fn(), upsertMany: jest.fn() },
  } as unknown as ConversationGraphDeps;
}

/** One fake tool whose return carries a state update (D-B shape). */
function makeFakeTool(): DynamicStructuredTool<{ name: string }> {
  return new DynamicStructuredTool({
    name: 'fake_tool',
    description: 'fake tool for the factory test',
    schema: z.object({}),
    func: async () => ({ outcome: ok('fake tool ran'), update: { activeSessionId: 'sess-9' } }),
  }) as unknown as DynamicStructuredTool<{ name: string }>;
}

function makeSpec(tools: DynamicStructuredTool<{ name: string }>[] = [makeFakeTool()]): PhaseSpec {
  return {
    name: 'chat',
    prompt: {
      current: { id: 'phase.fake', version: 'v1', directives: [], render: () => [] },
      requiredSections: [],
    },
    tools: tools as PhaseSpec['tools'],
    toolPolicy: { llmErrorBudget: Infinity },
    loadContext: async () => ({ ok: true, data: { lastMessageTime: null } }),
    contextBlocks: [],
    modelProfile: 'default',
    budget: { system: 1, longTerm: 1, domain: 1, history: 1000, outputReserve: 1 },
  };
}

describe('buildPhaseSubgraph (ADR-0013 §4.1)', () => {
  beforeEach(() => {
    mockInvoke.mockReset();
  });

  it('runs agent → tools → agent → finalize; output carries the final AIMessage and the tool update', async () => {
    mockInvoke
      .mockResolvedValueOnce(
        new AIMessage({
          content: '',
          tool_calls: [{ id: 'c1', name: 'fake_tool', args: {}, type: 'tool_call' }],
        }),
      )
      .mockResolvedValueOnce(new AIMessage({ content: 'Готово!', tool_calls: [] }));

    const subgraph = buildPhaseSubgraph(makeSpec(), makeDeps());
    const result = (await subgraph.invoke({ messages: [new HumanMessage('привет')] }, {
      configurable: { thread_id: 'factory-test' },
      recursionLimit: 10,
      context: {
        runId: 'run-factory',
        userId: 'u1',
        user: FRESH_USER as never,
        now: new Date(0),
        client: 'telegram' as const,
        trigger: 'user_message' as const,
        metrics: new RunMetricsCollector('run-factory'),
      },
    } as never)) as { activeSessionId?: string | null; messages: BaseMessage[] };

    // Two model calls: the tool-call turn, then the final text turn.
    expect(mockInvoke).toHaveBeenCalledTimes(2);
    // The final text is the last message (finalize validated it).
    const last = result.messages[result.messages.length - 1] as AIMessage;
    expect(last.content).toBe('Готово!');
    // The executor surfaced the tool's state update through the subgraph state.
    expect(result.activeSessionId).toBe('sess-9');
    // The tool result message is in the run's messages.
    const toolMsg = result.messages.find(m => m._getType() === 'tool') as ToolMessage | undefined;
    expect(toolMsg?.content).toContain('fake tool ran');
  });
});
