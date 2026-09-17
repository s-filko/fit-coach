/**
 * AC-1341 (refactor-p4-episode-memory Task 4): the checkpointed `messages`
 * channel survives runs and carries tool calls and tool results — run 2's
 * model input contains run 1's AIMessage(tool_calls) AND its ToolMessage, and
 * the reducer assigned an id to every persisted message (compaction removes
 * by id). MemorySaver + a mocked model — no provider involved.
 */
import { AIMessage, HumanMessage, type BaseMessage, ToolMessage } from '@langchain/core/messages';
import { MemorySaver } from '@langchain/langgraph';

import type { ConversationRunRecord } from '@domain/conversation/ports';

import { RunMetricsCollector } from '@infra/ai/run-metrics';
import { InMemoryConversationContextService } from '@infra/conversation/conversation-context.service';

import { buildConversationGraph, type ConversationGraphDeps } from '../conversation.graph';

const USER = {
  id: 'u1',
  firstName: 'Test',
  languageCode: 'ru',
  profileStatus: 'complete',
  registrationCompleted: true,
};

/** Run 1 calls save_timezone; run 2 replies with plain text. */
jest.mock('@infra/ai/model.factory', () => {
  const recorded: BaseMessage[][] = [];
  const model = {
    bindTools: () => model,
    invoke: async (messages: BaseMessage[]) => {
      recorded.push(messages);
      const seenToolCall = messages.some(m => m._getType() === 'tool');
      if (!seenToolCall) {
        return new AIMessage({
          content: '',
          tool_calls: [
            { id: 'call-tz-1', name: 'save_timezone', args: { timezone: 'Europe/Berlin' }, type: 'tool_call' },
          ],
        });
      }
      return new AIMessage({ content: 'Готово, время сохранено.', tool_calls: [] });
    },
  };
  return { getModel: () => model, __recorded: recorded };
});

const { __recorded } = jest.requireMock('@infra/ai/model.factory') as { __recorded: BaseMessage[][] };

function makeDeps(): ConversationGraphDeps {
  return {
    trainingService: {
      getTrainingHistory: jest.fn().mockResolvedValue([]),
      getSessionDetails: jest.fn().mockResolvedValue(null),
      completeSession: jest.fn(),
      startSession: jest.fn(),
    } as never,
    workoutPlanRepo: { findActiveByUserId: jest.fn().mockResolvedValue(null) } as never,
    workoutSessionRepo: { findRecentByUserIdWithDetails: jest.fn().mockResolvedValue([]) } as never,
    exerciseRepository: {
      searchByEmbedding: jest.fn().mockResolvedValue([]),
      findByIds: jest.fn().mockResolvedValue([]),
    } as never,
    embeddingService: { embed: jest.fn().mockResolvedValue(new Array(384).fill(0)) } as never,
    userService: {
      getUser: jest.fn().mockResolvedValue(USER),
      updateProfileData: jest.fn(),
      isRegistrationComplete: jest.fn().mockReturnValue(true),
      needsRegistration: jest.fn().mockReturnValue(false),
      upsertUser: jest.fn(),
    } as never,
    contextService: new InMemoryConversationContextService(),
    transcript: { appendRunMessages: jest.fn(), appendSystemNote: jest.fn() },
    summaries: { insert: jest.fn(), latestLegacySummary: jest.fn().mockResolvedValue(null) },
    llmGateway: {
      chat: jest.fn(),
      structured: jest.fn(),
    } as never,
    runService: { recordRun: jest.fn() } as never,
    checkpointer: new MemorySaver(),
  } as unknown as ConversationGraphDeps;
}

function ctxConfig(runId: string, userId = 'u1') {
  return {
    configurable: { thread_id: userId },
    metadata: { runId, userId },
    context: {
      runId,
      userId,
      user: USER as never,
      now: new Date(),
      client: 'telegram' as const,
      trigger: 'user_message' as const,
      metrics: new RunMetricsCollector(runId),
    },
    recursionLimit: 25,
  } as never;
}

describe('episode memory across runs (AC-1341, INV-LLM-001/002)', () => {
  it('AC-1341: run 2 sees run 1’s tool call and result; every persisted message has an id', async () => {
    const deps = makeDeps();
    const graph = buildConversationGraph(deps);
    __recorded.length = 0;

    const first = (await graph.invoke(
      { phase: 'chat', messages: [new HumanMessage('Моё время Берлин')] },
      ctxConfig('run-1'),
    )) as { messages: BaseMessage[] };
    const run1Input = __recorded[0]! as BaseMessage[];
    const run1Output = first.messages;
    expect(run1Output.some(m => m._getType() === 'ai' && (m as AIMessage).tool_calls?.length)).toBe(true);

    const second = (await graph.invoke(
      { phase: 'chat', messages: [new HumanMessage('Спасибо!')] },
      ctxConfig('run-2'),
    )) as { messages: BaseMessage[] };

    // Run 2's model input contains run 1's AIMessage(tool_calls) and its ToolMessage.
    const run2Input = __recorded[__recorded.length - 1]! as BaseMessage[];
    const replayedCall = run2Input.find(
      (m: BaseMessage) => m._getType() === 'ai' && (m as AIMessage).tool_calls?.some(c => c.name === 'save_timezone'),
    );
    const replayedResult = run2Input.find(
      (m: BaseMessage) => m._getType() === 'tool' && (m as ToolMessage).tool_call_id === 'call-tz-1',
    );
    expect(replayedCall).toBeDefined();
    expect(replayedResult).toBeDefined();

    // The channel is one continuous episode: run 1's traffic + run 2's messages.
    expect(second.messages.length).toBeGreaterThan(run1Output.length);

    // messagesStateReducer assigned an id to every persisted message (RemoveMessage needs ids).
    expect(second.messages.every(m => typeof m.id === 'string' && m.id.length > 0)).toBe(true);
    void run1Input;
  });
});
