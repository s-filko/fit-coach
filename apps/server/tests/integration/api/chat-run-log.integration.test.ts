import { MemorySaver } from '@langchain/langgraph';

import { HumanMessage } from '@langchain/core/messages';

import { InMemoryConversationContextService } from '../../../src/infra/conversation/conversation-context.service';
import { RunMetricsCollector } from '../../../src/infra/ai/run-metrics';
import { buildConversationGraph } from '../../../src/infra/ai/graph/conversation.graph';
import type { ConversationRunRecord } from '../../../src/domain/conversation/ports';

jest.mock('../../../src/infra/ai/model.factory', () => {
  const { AIMessage } = jest.requireActual('@langchain/core/messages');
  const invoke = jest.fn().mockResolvedValue(new AIMessage('Mocked coach reply'));
  return {
    getModel: () => ({ invoke, bindTools: () => ({ invoke }) }),
  };
});

describe('conversation run log — AC-1301', () => {
  const recorded: ConversationRunRecord[] = [];

  const runService = {
    recordRun: async (record: ConversationRunRecord) => {
      recorded.push(record);
    },
  };

  const userService = {
    getUser: async () => ({
      id: '22222222-2222-4222-8222-222222222222',
      firstName: 'Test',
      languageCode: 'ru',
      timezone: 'Europe/Berlin',
      age: 30,
      gender: 'male',
      height: '180',
      weight: '80',
      fitnessLevel: 'intermediate',
      fitnessGoal: 'strength',
      profileStatus: 'complete',
      registrationCompleted: true,
    }),
    updateProfileData: async () => undefined,
    isRegistrationComplete: () => true,
    needsRegistration: () => false,
    upsertUser: async () => undefined,
  };

  beforeEach(() => {
    recorded.length = 0;
  });

  it('writes exactly one run row with the AC-1301 non-null fields', async () => {
    const graph = buildConversationGraph({
      userService: userService as never,
      trainingService: {} as never,
      workoutPlanRepo: {
        findActiveByUserId: async () => null,
        create: async () => undefined,
      } as never,
      workoutSessionRepo: {
        findRecentByUserId: async () => [],
        findRecentByUserIdWithDetails: async () => [],
        findActiveByUserId: async () => null,
      } as never,
      exerciseRepository: {} as never,
      embeddingService: {} as never,
      contextService: new InMemoryConversationContextService(),
      transcript: {
        appendRunMessages: async () => undefined,
        appendSystemNote: async () => undefined,
      } as never,
      summaries: {
        insert: async () => undefined,
        latestLegacySummary: async () => null,
      } as never,
      llmGateway: {
        chat: async () => ({ content: '' }),
        structured: async () => ({}),
      } as never,
      runService: runService as never,
      checkpointer: new MemorySaver(),
    });

    const userId = '22222222-2222-4222-8222-222222222222';
    const runId = '11111111-1111-4111-8111-111111111111';

    // The route normally does this (startRun) and the LLM callback handler fills
    // the accumulator (startLlmCall/finishLlmCall). The mocked model bypasses the
    // The adapter normally builds the collector; the mocked model bypasses the
    // real callback handler, so feed the collector directly — this keeps the
    // assertion below from passing on the `?? 'unknown'` fallback, which is
    // exactly how the zero-token defect on dev went unnoticed.
    const metrics = new RunMetricsCollector(runId);
    metrics.onStart('lc-1', 'z-ai/glm-5.3');
    metrics.onEnd('lc-1', 120, 40);

    await graph.invoke({ messages: [new HumanMessage('привет')] }, {
      configurable: { thread_id: userId },
      metadata: { runId, userId },
      context: {
        runId,
        userId,
        user: await userService.getUser(),
        now: new Date(),
        client: 'telegram',
        trigger: 'user_message',
        metrics,
      },
      recursionLimit: 50,
    } as never);

    expect(recorded).toHaveLength(1);
    const [row] = recorded;
    expect(row.runId).toBe(runId);
    expect(row.phaseIn).toBeTruthy();
    expect(row.model).toBe('z-ai/glm-5.3');
    expect(row.tokensIn).toBe(120);
    expect(row.tokensOut).toBe(40);
    expect(row.latencyMs).not.toBeNull();
    expect(row.outcome).toBe('ok');
  });
});
