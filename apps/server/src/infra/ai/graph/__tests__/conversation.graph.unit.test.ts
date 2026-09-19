import { AIMessage, type BaseMessage, HumanMessage } from '@langchain/core/messages';
import { MemorySaver } from '@langchain/langgraph';

import type { ConversationRunRecord } from '@domain/conversation/ports';
import type {
  IExerciseRepository,
  ITrainingService,
  IWorkoutPlanRepository,
  IWorkoutSessionRepository,
} from '@domain/training/ports';
import type { LlmGateway } from '@domain/ai/ports/llm.gateway.ports';
import type { IUserService } from '@domain/user/ports';

import { RunMetricsCollector } from '@infra/ai/run-metrics';

import { lastAiText } from '../episode';
import { buildConversationGraph, withBudgetOverrides, type ConversationGraphDeps } from '../conversation.graph';
import { buildPhaseSpecs } from '../phases';

// Mock the model factory so tests don't need a real LLM key
jest.mock('@infra/ai/model.factory', () => ({
  getModel: () => ({
    bindTools: () => ({
      invoke: jest.fn().mockResolvedValue(new AIMessage({ content: 'Mocked LLM response', tool_calls: [] })),
    }),
  }),
}));

// INV-LLM-005 harness: the real five specs plus a sixth — the graph must gain
// the node with no builder change. The fake spec carries the fields the
// factory touches at build time (tools/policy/layout); nothing ever routes to
// it, so the missing prompt and loaders never matter.
jest.mock('@infra/ai/graph/phases', () => {
  const actual = jest.requireActual('@infra/ai/graph/phases');
  return {
    ...actual,
    buildPhaseSpecs: (deps: ConversationGraphDeps) => [
      ...actual.buildPhaseSpecs(deps),
      {
        name: 'zzz_test',
        tools: [],
        toolPolicy: { llmErrorBudget: Infinity },
      },
    ],
  };
});

const USER = {
  id: 'u1',
  firstName: 'Test',
  languageCode: 'en',
  profileStatus: 'complete',
};

const makeDeps = (recorded: ConversationRunRecord[] = []): ConversationGraphDeps => ({
  trainingService: {
    getTrainingHistory: jest.fn().mockResolvedValue([]),
    getSessionDetails: jest.fn().mockResolvedValue(null),
    completeSession: jest.fn().mockResolvedValue({}),
    startSession: jest.fn().mockResolvedValue({ id: 'session-1' }),
    addExerciseToSession: jest.fn(),
    logSet: jest.fn(),
    skipSession: jest.fn(),
    completeCurrentExercise: jest.fn(),
    ensureCurrentExercise: jest.fn(),
  } as unknown as ITrainingService,
  workoutPlanRepo: {
    findActiveByUserId: jest.fn().mockResolvedValue(null),
    create: jest.fn(),
  } as unknown as IWorkoutPlanRepository,
  workoutSessionRepo: {
    create: jest.fn(),
    findById: jest.fn(),
    findByIdWithDetails: jest.fn(),
    findRecentByUserId: jest.fn().mockResolvedValue([]),
    findRecentByUserIdWithDetails: jest.fn().mockResolvedValue([]),
    findActiveByUserId: jest.fn().mockResolvedValue(null),
    findLastCompletedByUserAndKey: jest.fn().mockResolvedValue(null),
    update: jest.fn().mockResolvedValue({}),
    complete: jest.fn(),
    updateActivity: jest.fn(),
    findTimedOut: jest.fn().mockResolvedValue([]),
    autoCloseTimedOut: jest.fn().mockResolvedValue(0),
  } as unknown as IWorkoutSessionRepository,
  exerciseRepository: {
    findAllWithMuscles: jest.fn().mockResolvedValue([]),
    findAll: jest.fn().mockResolvedValue([]),
    findByIdsWithMuscles: jest.fn().mockResolvedValue([]),
    findById: jest.fn(),
    findByIdWithMuscles: jest.fn(),
    findByIds: jest.fn().mockResolvedValue([]),
    findByMuscleGroup: jest.fn(),
    search: jest.fn().mockResolvedValue([]),
    searchByEmbedding: jest.fn().mockResolvedValue([]),
    updateEmbedding: jest.fn(),
  } as unknown as IExerciseRepository,
  embeddingService: {
    embed: jest.fn().mockResolvedValue(new Array(384).fill(0)),
    embedBatch: jest.fn().mockResolvedValue([]),
  },
  userService: {
    getUser: jest.fn().mockResolvedValue(USER),
    updateProfileData: jest.fn(),
    isRegistrationComplete: jest.fn().mockReturnValue(true),
    needsRegistration: jest.fn().mockReturnValue(false),
    upsertUser: jest.fn(),
  } as unknown as IUserService,
  transcript: {
    appendRunMessages: async () => undefined,
    appendSystemNote: async () => undefined,
  },
  summaries: {
    insert: async () => undefined,
    latestLegacySummary: async () => null,
  },
  userFacts: {
    upsertMany: jest.fn().mockResolvedValue(0),
    getForPrompt: jest.fn().mockResolvedValue([]),
    getConstraints: jest.fn().mockResolvedValue([]),
  },
  llmGateway: {
    chat: async () => ({ content: '' }),
    // Cast: LlmGateway.structured is generic; the stub returns one fixed shape.
    structured: (async () => ({
      topics: [],
      decisions: [],
      userState: [],
      trainingFeedback: [],
      openItems: [],
      facts: [],
    })) as unknown as LlmGateway['structured'],
  },
  runService: {
    recordRun: jest.fn(async (record: ConversationRunRecord) => {
      recorded.push(record);
    }),
  },
  episodeConfig: { gapMs: 365 * 24 * 3600 * 1000, minTurns: 2, minTokens: 300 },
  checkpointer: new MemorySaver() as unknown as InstanceType<
    typeof import('@langchain/langgraph-checkpoint-postgres').PostgresSaver
  >,
});

/** Invoke config with a run context — what the adapter builds in production. */
function ctxConfig(runId: string, userId = 'u1') {
  const metrics = new RunMetricsCollector(runId);
  return {
    configurable: { thread_id: `${userId}-${runId}` },
    metadata: { runId, userId },
    context: {
      runId,
      userId,
      user: USER as never,
      now: new Date(),
      client: 'telegram' as const,
      trigger: 'user_message' as const,
      metrics,
    },
    recursionLimit: 25,
  } as never;
}

describe('ConversationGraph (prepare → route → <phase> → commit)', () => {
  it('compiles without throwing', () => {
    expect(() => buildConversationGraph(makeDeps())).not.toThrow();
  });

  it('routes to the chat phase; the reply is the last AI message and the channel persists (INV-LLM-002)', async () => {
    const recorded: ConversationRunRecord[] = [];
    const graph = buildConversationGraph(makeDeps(recorded));
    const cfg = ctxConfig('run-chat');

    const result = (await graph.invoke({ phase: 'chat', messages: [new HumanMessage('hello')] }, cfg)) as {
      phase: string;
      messages: BaseMessage[];
    };

    expect(result.phase).toBe('chat');
    // commit no longer clears the channel — the reply survives for the next run
    expect(lastAiText(result.messages)).toBe('Mocked LLM response');
    expect(result.messages.length).toBeGreaterThan(0);
    // one run row with the non-null observability fields
    expect(recorded).toHaveLength(1);
    expect(recorded[0]?.trigger).toBe('user_message');
    expect(recorded[0]?.client).toBe('telegram');
  });

  it('prepare syncs phase with profile status: complete → chat', async () => {
    const graph = buildConversationGraph(makeDeps());

    const result = (await graph.invoke(
      { phase: 'registration', messages: [new HumanMessage('hi')] },
      ctxConfig('run-sync-up'),
    )) as { phase: string };

    expect(result.phase).toBe('chat');
  });

  it('prepare keeps an unregistered user in registration', async () => {
    const deps = makeDeps();
    (deps.userService.isRegistrationComplete as jest.Mock).mockReturnValue(false);

    const graph = buildConversationGraph(deps);
    const result = (await graph.invoke(
      { phase: 'chat', messages: [new HumanMessage('hi')] },
      ctxConfig('run-sync-down'),
    )) as { phase: string };

    expect(result.phase).toBe('registration');
  });

  describe('prepare training short-circuits (D-E)', () => {
    it('session ended → commit with the catalog reply, phase chat, session cleared', async () => {
      const deps = makeDeps();
      (deps.trainingService.getSessionDetails as jest.Mock).mockResolvedValue({
        id: 'session-1',
        status: 'completed',
        lastActivityAt: new Date(),
        updatedAt: new Date(),
        createdAt: new Date(),
      });

      const graph = buildConversationGraph(deps);
      const cfg = ctxConfig('run-ended');
      const result = (await graph.invoke(
        { phase: 'training', activeSessionId: 'session-1', messages: [new HumanMessage('hi')] },
        cfg,
      )) as { phase: string; activeSessionId: string | null };

      const ctx = (cfg as { context: { metrics: RunMetricsCollector } }).context;
      void ctx;
      expect(lastAiText((result as unknown as { messages: BaseMessage[] }).messages)).toContain('completed');
      expect(result.phase).toBe('chat');
      expect(result.activeSessionId).toBeNull();
      expect(lastAiText((result as unknown as { messages: BaseMessage[] }).messages)).not.toBe('Mocked LLM response');
    });

    it('training without a session → commit with the catalog reply', async () => {
      const graph = buildConversationGraph(makeDeps());
      const cfg = ctxConfig('run-missing');
      const result = (await graph.invoke(
        { phase: 'training', activeSessionId: null, messages: [new HumanMessage('hi')] },
        cfg,
      )) as { phase: string };

      expect(lastAiText((result as unknown as { messages: BaseMessage[] }).messages)).toContain('could not be resumed');
      expect(result.phase).toBe('chat');
    });

    it('in_progress session: no auto-close, phase stays training', async () => {
      const deps = makeDeps();
      const twoHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000);
      (deps.trainingService.getSessionDetails as jest.Mock).mockResolvedValue({
        id: 'session-2',
        status: 'in_progress',
        lastActivityAt: twoHoursAgo,
        updatedAt: twoHoursAgo,
        createdAt: twoHoursAgo,
        exercises: [],
      });

      const graph = buildConversationGraph(deps);
      const result = (await graph.invoke(
        { phase: 'training', activeSessionId: 'session-2', messages: [new HumanMessage('hello')] },
        ctxConfig('run-idle'),
      )) as unknown as { phase: string; messages: BaseMessage[] };

      expect(deps.trainingService.completeSession).not.toHaveBeenCalled();
      expect(result.phase).toBe('training');
    });
  });

  it('commit blocks a transition outside the matrix — phase unchanged, no session side effects', async () => {
    const deps = makeDeps();
    const graph = buildConversationGraph(deps);

    // session_planning → training without an active session: the request is
    // recorded but the verdict is no_active_session (BR-CONV-016).
    const result = (await graph.invoke(
      {
        phase: 'session_planning',
        activeSessionId: null,
        pendingTransition: { toPhase: 'training', reason: 'session_planning_complete' },
        messages: [new HumanMessage('start!'), new AIMessage('ready')],
      },
      ctxConfig('run-blocked'),
    )) as { phase: string; activeSessionId: string | null };

    expect(result.phase).toBe('session_planning');
    expect(result.activeSessionId).toBeNull();
    expect(deps.trainingService.completeSession).not.toHaveBeenCalled();
  });

  it('committed transition end-to-end: run row carries it, phase changes, messages clear', async () => {
    let callCount = 0;
    jest.resetModules();
    jest.mock('@infra/ai/model.factory', () => ({
      getModel: () => ({
        bindTools: () => ({
          invoke: jest.fn().mockImplementation(async () => {
            callCount += 1;
            if (callCount === 1) {
              return new AIMessage({
                content: '',
                tool_calls: [
                  { id: 'tc-req-1', name: 'request_transition', args: { toPhase: 'plan_creation' }, type: 'tool_call' },
                ],
              });
            }
            return new AIMessage({ content: 'Переношу в планирование!', tool_calls: [] });
          }),
        }),
      }),
    }));

    const { buildConversationGraph: buildGraph } = await import('../conversation.graph');

    const recorded: ConversationRunRecord[] = [];
    const deps = makeDeps(recorded);
    const graph = buildGraph(deps);
    const cfg = ctxConfig('run-transition');
    const result = (await graph.invoke(
      { phase: 'chat', messages: [new HumanMessage('составь план')] },
      cfg,
    )) as unknown as { phase: string; messages: BaseMessage[] };

    expect(recorded).toHaveLength(1);
    expect(recorded[0]?.transition?.toPhase).toBe('plan_creation');
    expect(result.phase).toBe('plan_creation');
    // The channel persists across the transition — compaction owns removal (INV-LLM-002)
    expect(lastAiText(result.messages)).toBe('Переношу в планирование!');
  });

  it('INV-LLM-005: a sixth spec gains the graph node and its commit edge — no builder change', () => {
    const graph = buildConversationGraph(makeDeps());
    const drawable = graph.getGraph();

    const nodeIds = Object.values(drawable.nodes).map(n => n.id);
    expect(nodeIds).toContain('zzz_test');

    const edge = [...drawable.edges].find(e => e.source === 'zzz_test');
    expect(edge?.target).toBe('commit');
  });
});

describe('withBudgetOverrides (P4 context-budget plan Task 3 — LLM_BUDGET_<PHASE>_<PART>)', () => {
  const deps = makeDeps();

  it('applies a partial override over the phase default without touching other fields', () => {
    const specs = buildPhaseSpecs(deps);
    const defaultChat = specs.find(s => s.name === 'chat')!.budget;

    const overridden = withBudgetOverrides(specs, { chat: { history: 12345 } });
    const chat = overridden.find(s => s.name === 'chat')!;

    expect(chat.budget.history).toBe(12345);
    expect(chat.budget.system).toBe(defaultChat.system);
    expect(chat.budget.domain).toBe(defaultChat.domain);
  });

  it('leaves phases with no matching override untouched', () => {
    const specs = buildPhaseSpecs(deps);
    const overridden = withBudgetOverrides(specs, { chat: { history: 1 } });
    const training = overridden.find(s => s.name === 'training')!;
    const originalTraining = specs.find(s => s.name === 'training')!;

    expect(training.budget).toEqual(originalTraining.budget);
    expect(training).toBe(originalTraining); // untouched entries are the same object
  });

  it('empty overrides map returns budgets unchanged', () => {
    const specs = buildPhaseSpecs(deps);
    const overridden = withBudgetOverrides(specs, {});
    expect(overridden.map(s => s.budget)).toEqual(specs.map(s => s.budget));
  });
});
