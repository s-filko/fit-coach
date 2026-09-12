import { MemorySaver } from '@langchain/langgraph';

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

  const contextService = {
    appendTurn: async () => undefined,
    getMessagesForPrompt: async () => [],
    insertContextReset: async () => undefined,
    insertPhaseSummary: async () => undefined,
    getLatestSummary: async () => null,
    getLastUserMessageTime: async () => null,
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
      contextService: contextService as never,
      runService: runService as never,
      checkpointer: new MemorySaver(),
    });

    const userId = '22222222-2222-4222-8222-222222222222';
    const runId = '11111111-1111-4111-8111-111111111111';

    await graph.invoke(
      { userId, userMessage: 'привет', runId },
      { configurable: { thread_id: userId, userId, runId }, recursionLimit: 50 },
    );

    expect(recorded).toHaveLength(1);
    const [row] = recorded;
    expect(row.runId).toBe(runId);
    expect(row.phaseIn).toBeTruthy();
    expect(row.model).toBeTruthy();
    expect(row.latencyMs).not.toBeNull();
    expect(row.outcome).toBe('ok');
  });
});
