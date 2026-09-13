import { MemorySaver } from '@langchain/langgraph';

import type { ConversationRunRecord } from '@domain/conversation/ports';
import type { ConversationGraphDeps } from '@infra/ai/graph/conversation.graph';

import type { EvalFixture } from '../schema/case.schema';

export interface StubWorld {
  deps: ConversationGraphDeps;
  recordedRuns: ConversationRunRecord[];
}

export function buildStubDeps(fixture: EvalFixture): StubWorld {
  const recordedRuns: ConversationRunRecord[] = [];
  const userId = '22222222-2222-4222-8222-222222222222';

  const user = { id: userId, ...fixture.user };
  const activePlan = fixture.hasActivePlan ? (fixture.plan ?? { id: 'plan-1', name: 'Test plan' }) : null;

  const deps = {
    // IUserService — the port's method is getUser(id), not getUserById.
    // Verified against src/domain/user/ports/service.ports.ts:5-11.
    userService: {
      upsertUser: async () => user,
      getUser: async () => user,
      updateProfileData: async () => user,
      isRegistrationComplete: () => fixture.user.registrationCompleted === true,
      needsRegistration: () => fixture.user.registrationCompleted !== true,
    },
    // ITrainingService — the router calls getSessionDetails on every training-phase run
    // (router.node.ts:47) and the training subgraph calls it again (training.subgraph.ts:326).
    // An empty object here throws before the model is ever reached.
    trainingService: {
      getSessionDetails: async () => (fixture.activeSession ?? null),
      getActiveSession: async () => (fixture.activeSession ?? null),
      getActivePlan: async () => activePlan,
      getTrainingHistory: async () => (fixture.sessions ?? []),
    },
    workoutPlanRepo: {
      // Real method name — chat.subgraph.ts:57, session-planning builder.
      findActiveByUserId: async () => activePlan,
    },
    workoutSessionRepo: {
      // Real names — chat.subgraph.ts:58, training.subgraph.ts:338.
      findRecentByUserIdWithDetails: async () => (fixture.sessions ?? []),
      findRecentByUserId: async () => (fixture.sessions ?? []),
      findLastCompletedByUserAndKey: async () => null,
    },
    exerciseRepository: {
      searchByEmbedding: async () => [],
      findByIds: async () => [],
    },
    embeddingService: {
      embed: async () => new Array(1536).fill(0),
    },
    contextService: {
      appendTurn: async () => undefined,
      getMessagesForPrompt: async () => [],
      insertContextReset: async () => undefined,
      insertPhaseSummary: async () => undefined,
      getLatestSummary: async () => null,
      getLastUserMessageTime: async () => null,
    },
    runService: {
      recordRun: async (record: ConversationRunRecord) => {
        recordedRuns.push(record);
      },
    },
    checkpointer: new MemorySaver(),
  } as unknown as ConversationGraphDeps;

  return { deps, recordedRuns };
}
