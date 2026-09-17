/**
 * buildPhaseSubgraph factory tests (refactor-p3-phase-spec Task 3, ADR-0013
 * §4.1): agent → (tools | finalize), tools → afterTools → (agent | finalize).
 * A fake spec with one tool and a mocked model that calls the tool once must
 * run the loop and surface the tool's update and the final text.
 */
import { AIMessage, type BaseMessage, ToolMessage } from '@langchain/core/messages';
import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';

import { ok } from '@domain/conversation/tool-outcome';

import type { ConversationGraphDeps, PhaseSpec } from '@infra/ai/graph/phase-spec';
import { buildPhaseSubgraph } from '@infra/ai/graph/phase-subgraph.factory';

const mockInvoke = jest.fn();
jest.mock('@infra/ai/model.factory', () => ({
  getModel: () => ({ bindTools: () => ({ invoke: mockInvoke }) }),
}));

const FRESH_USER = { id: 'u1', languageCode: 'en', timezone: 'Europe/Berlin' };

function makeDeps(): ConversationGraphDeps {
  return {
    userService: { getUser: jest.fn(async () => FRESH_USER) },
    contextService: { getMessagesForPrompt: jest.fn(async () => []) },
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
    layout: { summaryFrame: false, historyMode: 'interleaved', toolResultsFrame: false },
    tools: tools as PhaseSpec['tools'],
    toolPolicy: { llmErrorBudget: Infinity },
    loadContext: async () => ({ ok: true, data: { lastMessageTime: null } }),
    modelProfile: 'default',
  };
}

describe('buildPhaseSubgraph (ADR-0013 §4.1)', () => {
  beforeEach(() => {
    mockInvoke.mockReset();
  });

  it('runs agent → tools → agent → finalize; output carries responseMessage and the tool update', async () => {
    mockInvoke
      .mockResolvedValueOnce(
        new AIMessage({
          content: '',
          tool_calls: [{ id: 'c1', name: 'fake_tool', args: {}, type: 'tool_call' }],
        }),
      )
      .mockResolvedValueOnce(new AIMessage({ content: 'Готово!', tool_calls: [] }));

    const subgraph = buildPhaseSubgraph(makeSpec(), makeDeps());
    const result = (await subgraph.invoke(
      { userId: 'u1', userMessage: 'привет', user: FRESH_USER },
      { configurable: { thread_id: 'factory-test' }, recursionLimit: 10 },
    )) as { responseMessage: string; activeSessionId?: string; messages: BaseMessage[] };

    // Two model calls: the tool-call turn, then the final text turn.
    expect(mockInvoke).toHaveBeenCalledTimes(2);
    expect(result.responseMessage).toBe('Готово!');
    // The executor surfaced the tool's state update through the subgraph state.
    expect(result.activeSessionId).toBe('sess-9');
    // The tool result message is in the run's messages.
    const toolMsg = result.messages.find(m => m._getType() === 'tool') as ToolMessage | undefined;
    expect(toolMsg?.content).toContain('fake tool ran');
  });
});
