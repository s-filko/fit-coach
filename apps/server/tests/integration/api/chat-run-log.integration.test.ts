import { MemorySaver } from '@langchain/langgraph';

import { HumanMessage } from '@langchain/core/messages';

import { RunMetricsCollector } from '../../../src/infra/ai/run-metrics';
import { buildConversationGraph } from '../../../src/infra/ai/graph/conversation.graph';
import type { ConversationRunRecord } from '../../../src/domain/conversation/ports';

jest.mock('../../../src/infra/ai/model.factory', () => {
  const { AIMessage } = jest.requireActual('@langchain/core/messages');
  // A fresh instance per call — one shared AIMessage keeps its id, and the
  // messages reducer would collapse the second run's reply into the first's.
  const invoke = jest.fn(async () => new AIMessage('Mocked coach reply'));
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

  const buildLoggedGraph = (episodeConfig: Record<string, number>) =>
    buildConversationGraph({
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
      transcript: {
        appendRunMessages: async () => undefined,
        appendSystemNote: async () => undefined,
      } as never,
      summaries: {
        insert: async () => undefined,
        latestLegacySummary: async () => null,
      } as never,
      userFacts: {
        upsertMany: async () => 0,
        getForPrompt: async () => [],
        getConstraints: async () => [],
      } as never,
      llmGateway: {
        chat: async () => ({ content: '' }),
        structured: async () => ({}),
      } as never,
      runService: runService as never,
      episodeConfig: episodeConfig as never,
      checkpointer: new MemorySaver(),
    });

  /** One run on the shared thread — the adapter's invoke shape, with a chosen clock. */
  const runAt = async (graph: ReturnType<typeof buildLoggedGraph>, text: string, runId: string, now: Date) => {
    const userId = '22222222-2222-4222-8222-222222222222';
    // The route normally does this (startRun) and the LLM callback handler fills
    // the accumulator (startLlmCall/finishLlmCall). The mocked model bypasses
    // the real callback handler, so feed the collector directly — this keeps
    // the token assertions from passing on the `?? 'unknown'` fallback, which
    // is exactly how the zero-token defect on dev went unnoticed.
    const metrics = new RunMetricsCollector(runId);
    metrics.onStart('lc-1', 'z-ai/glm-5.3');
    metrics.onEnd('lc-1', 120, 40);
    await graph.invoke({ messages: [new HumanMessage(text)] }, {
      configurable: { thread_id: userId },
      metadata: { runId, userId },
      context: {
        runId,
        userId,
        user: await userService.getUser(),
        now,
        client: 'telegram',
        trigger: 'user_message',
        metrics,
      },
      recursionLimit: 50,
    } as never);
  };

  beforeEach(() => {
    recorded.length = 0;
  });

  it('writes exactly one run row with the AC-1301 non-null fields', async () => {
    const graph = buildLoggedGraph({ gapMs: 365 * 24 * 3600 * 1000, minTurns: 2, minTokens: 300, keepTurns: 6 });

    const runId = '11111111-1111-4111-8111-111111111111';
    await runAt(graph, 'привет', runId, new Date());

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

  // now-line-last review R1 (BR-LLM-008): the NOW line and the gap note are
  // model-facing modules that reach the request — the run row's promptVersions
  // must stamp them (the NOW module on every run, the gap note only on the run
  // that sent it).
  it('stamps block.current_time on every run and block.time_gap only on the run that sent the note', async () => {
    const DAY = 24 * 3600 * 1000;
    const graph = buildLoggedGraph({ gapMs: DAY, minTurns: 2, minTokens: 300, keepTurns: 6 });

    const t0 = new Date('2026-09-27T10:00:00.000Z');
    await runAt(graph, 'привет', '21111111-1111-4111-8111-111111111111', t0);
    await runAt(
      graph,
      'снова привет',
      '31111111-1111-4111-8111-111111111111',
      new Date(t0.getTime() + 25 * 3600 * 1000),
    );

    expect(recorded).toHaveLength(2);
    expect(recorded[0].promptVersions?.['block.current_time']).toBe('v1');
    expect(recorded[0].promptVersions?.['block.time_gap']).toBeUndefined();
    // 25 h > the 24 h episode gap — the second run sent the note and says so.
    expect(recorded[1].promptVersions?.['block.current_time']).toBe('v1');
    expect(recorded[1].promptVersions?.['block.time_gap']).toBe('v1');
  });
});
