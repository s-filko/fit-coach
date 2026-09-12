import { MemorySaver } from '@langchain/langgraph';

import { InMemoryConversationContextService } from '../../../src/infra/conversation/conversation-context.service';
import { finishLlmCall, startLlmCall, startRun } from '../../../src/infra/ai/run-metrics';
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
      runService: runService as never,
      checkpointer: new MemorySaver(),
    });

    const userId = '22222222-2222-4222-8222-222222222222';
    const runId = '11111111-1111-4111-8111-111111111111';

    // The route normally does this (startRun) and the LLM callback handler fills
    // the accumulator (startLlmCall/finishLlmCall). The mocked model bypasses the
    // real handler, so feed the accumulator directly — this keeps the assertion
    // below from passing on the persist node's `?? 'unknown'` fallback, which is
    // exactly how the zero-token defect on dev went unnoticed.
    startRun(runId);
    startLlmCall(runId, 'z-ai/glm-5.3');
    finishLlmCall(runId, 120, 40);

    await graph.invoke(
      { userId, userMessage: 'привет', runId },
      { configurable: { thread_id: userId, userId }, metadata: { runId, userId }, recursionLimit: 50 },
    );

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
