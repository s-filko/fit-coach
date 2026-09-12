/**
 * Regression test for the run-log metrics wiring (AC-1304 live check caught it).
 *
 * Bug: agentNode called model.invoke with a fresh config `{ configurable: { userId } }`,
 * dropping the parent graph config — so the LLM callback handler never saw
 * `configurable.runId`, startLlmCall never fired, and conversation_runs rows came
 * out with model='unknown' and zero tokens.
 *
 * Fix: the node's own LangGraph config (which carries the route's configurable:
 * thread_id, userId, runId) is passed to model.invoke.
 */

import { AIMessage } from '@langchain/core/messages';

import { InMemoryConversationContextService } from '@infra/conversation/conversation-context.service';

const BASE_USER = {
  id: 'u1',
  firstName: 'Test',
  profileStatus: 'complete' as const,
};

describe('chat.subgraph — run metrics config wiring', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  it('passes the invoking config (with runId) to every model.invoke call', async () => {
    const invokeConfigs: unknown[] = [];
    const mockInvoke = jest.fn().mockImplementation(async (_messages: unknown[], config?: unknown) => {
      invokeConfigs.push(config);
      return new AIMessage({ content: 'Ответ готов.', tool_calls: [] });
    });

    jest.mock('@infra/ai/model.factory', () => ({
      getModel: () => ({ bindTools: () => ({ invoke: mockInvoke }) }),
    }));

    const { buildChatSubgraph } = await import('../chat.subgraph');
    const subgraph = buildChatSubgraph({
      userService: {
        getUser: jest.fn().mockResolvedValue(BASE_USER),
      } as never,
      workoutPlanRepo: {
        findActiveByUserId: jest.fn().mockResolvedValue(null),
      } as never,
      workoutSessionRepo: {
        findRecentByUserIdWithDetails: jest.fn().mockResolvedValue([]),
      } as never,
      contextService: new InMemoryConversationContextService(),
    });

    await subgraph.invoke(
      { userId: 'u1', userMessage: 'привет', user: BASE_USER as never },
      { recursionLimit: 10, configurable: { thread_id: 'u1', userId: 'u1', runId: 'run-abc' } },
    );

    expect(mockInvoke).toHaveBeenCalled();
    for (const config of invokeConfigs) {
      expect(config).toEqual(
        expect.objectContaining({
          configurable: expect.objectContaining({ runId: 'run-abc', userId: 'u1' }),
        }),
      );
    }
  });
});
