/**
 * prepare failure isolation (AC-RRP-2) — promoted from review-prepare.repro.test.ts.
 *
 * prepare used to read the active session with `getSessionDetails(...).catch(() => null)`, so an
 * infrastructure failure (the read REJECTS) was indistinguishable from "no such session" and was
 * committed as the domain fact `session_ended` — the user got "Your training session has been
 * completed" while the session was still in_progress. A failed read must propagate: the run adapter
 * turns it into a typed error (ADR-0013 §6 → HTTP status + code) and nothing is committed.
 *
 * Three levels: the real `buildPrepareNode` with stubbed collaborators; the real graph (MemorySaver);
 * and the real run adapter over that graph. Only the model, the training service read (the injected
 * fault) and the ports are stubbed. The controls (session really missing / completed) pin the
 * recovery that must survive.
 */
import { AIMessage, type BaseMessage, HumanMessage } from '@langchain/core/messages';
import type { RunnableConfig } from '@langchain/core/runnables';
import { Command, MemorySaver } from '@langchain/langgraph';

import type { ConversationRunRecord } from '@domain/conversation/ports';
import type { LlmGateway } from '@domain/ai/ports/llm.gateway.ports';
import type {
  IExerciseRepository,
  ITrainingService,
  IWorkoutPlanRepository,
  IWorkoutSessionRepository,
} from '@domain/training/ports';
import type { IUserService } from '@domain/user/ports';

import { RunMetricsCollector } from '@infra/ai/run-metrics';

import { buildConversationGraph, type ConversationGraphDeps } from '../conversation.graph';
import { buildConversationRunner } from '../conversation-run.adapter';
import type { ConversationStateType } from '../state';
import { buildPrepareNode } from '../nodes/prepare.node';

// The model beneath the agent nodes: never reached by the fault runs, answers the seeding run.
jest.mock('@infra/ai/model.factory', () => ({
  getModel: () => ({
    bindTools: () => ({
      invoke: jest.fn().mockResolvedValue(new AIMessage({ content: 'Mocked LLM response', tool_calls: [] })),
    }),
  }),
}));

const SESSION_ID = 'session-1';
const USER = { id: 'u1', firstName: 'Test', languageCode: 'en', profileStatus: 'complete' };

const config = {
  configurable: { thread_id: 'u1' },
  context: {
    runId: 'run-rrp-2',
    userId: 'u1',
    user: USER,
    now: new Date(),
    client: 'telegram',
    trigger: 'user_message',
    metrics: new RunMetricsCollector('run-rrp-2'),
  },
} as unknown as RunnableConfig;

const trainingState = {
  phase: 'training',
  activeSessionId: SESSION_ID,
  episodeId: 'ep-1',
  messages: [],
} as unknown as ConversationStateType;

function buildPrepare(getSessionDetails: jest.Mock) {
  return buildPrepareNode({
    userService: { isRegistrationComplete: jest.fn().mockReturnValue(true) } as unknown as IUserService,
    trainingService: { getSessionDetails } as unknown as ITrainingService,
    compact: jest.fn().mockResolvedValue({}),
    courseCheck: jest.fn().mockResolvedValue({}),
  });
}

/** What prepare committed: goto, pendingTransition and the reply text, read off the returned Command. */
function outcomeOf(result: Command<Partial<ConversationStateType>>) {
  const update = (result.update ?? {}) as Partial<ConversationStateType>;
  return {
    goto: [result.goto].flat().join(','),
    pendingTransition: update.pendingTransition ?? null,
    reply: (update.messages ?? []).map(m => (m as AIMessage).content).join(' '),
  };
}

describe('prepare failure isolation (AC-RRP-2)', () => {
  describe('controls: a session that really is gone keeps the existing recovery', () => {
    it('session missing (null) → commit with session_ended', async () => {
      const result = await buildPrepare(jest.fn().mockResolvedValue(null))(trainingState, config);

      expect(outcomeOf(result)).toMatchObject({
        goto: 'commit',
        pendingTransition: { toPhase: 'chat', reason: 'session_ended' },
      });
    });

    it('session completed → commit with session_ended', async () => {
      const result = await buildPrepare(jest.fn().mockResolvedValue({ id: SESSION_ID, status: 'completed' }))(
        trainingState,
        config,
      );

      expect(outcomeOf(result)).toMatchObject({
        goto: 'commit',
        pendingTransition: { toPhase: 'chat', reason: 'session_ended' },
      });
    });

    it('session in_progress → normal route, no transition', async () => {
      const result = await buildPrepare(jest.fn().mockResolvedValue({ id: SESSION_ID, status: 'in_progress' }))(
        trainingState,
        config,
      );

      expect(outcomeOf(result)).toMatchObject({ goto: 'route', pendingTransition: null });
    });
  });

  describe('fault: the session read rejects (infrastructure failure)', () => {
    const failing = () => jest.fn().mockRejectedValue(new Error('database unavailable'));

    it('the failure propagates instead of being swallowed', async () => {
      await expect(buildPrepare(failing())(trainingState, config)).rejects.toThrow('database unavailable');
    });

    it('never produces a committed session_ended transition or the "session ended" reply', async () => {
      const outcome = await buildPrepare(failing())(trainingState, config).then(
        result => ({ rejected: false as const, ...outcomeOf(result) }),
        () => ({ rejected: true as const }),
      );

      // A rejection (technical failure) is acceptable; a successful domain transition is not.
      expect(outcome).not.toMatchObject({ pendingTransition: { reason: 'session_ended' } });
      expect(outcome).not.toMatchObject({ goto: 'commit' });
    });
  });
});

// --- graph level ------------------------------------------------------------------------------------------

const GRAPH_USER = { id: 'u1', firstName: 'Test', languageCode: 'en', profileStatus: 'complete' };
const ENDED_REPLY = 'Your training session has been completed. Ready for a new workout?';

function makeGraphDeps(getSessionDetails: jest.Mock, recorded: ConversationRunRecord[] = []): ConversationGraphDeps {
  return {
    trainingService: {
      getTrainingHistory: jest.fn().mockResolvedValue([]),
      getSessionDetails,
      completeSession: jest.fn().mockResolvedValue({}),
      startSession: jest.fn(),
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
      findById: jest.fn(),
      findByIdWithDetails: jest.fn(),
      findRecentByUserId: jest.fn().mockResolvedValue([]),
      findRecentByUserIdWithDetails: jest.fn().mockResolvedValue([]),
      findActiveByUserId: jest.fn().mockResolvedValue(null),
      findLastPerformancesByExercise: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue({}),
    } as unknown as IWorkoutSessionRepository,
    exerciseRepository: {
      findAllWithMuscles: jest.fn().mockResolvedValue([]),
      findAll: jest.fn().mockResolvedValue([]),
      findByIdsWithMuscles: jest.fn().mockResolvedValue([]),
      findById: jest.fn(),
      findByIds: jest.fn().mockResolvedValue([]),
      search: jest.fn().mockResolvedValue([]),
      searchByEmbedding: jest.fn().mockResolvedValue([]),
    } as unknown as IExerciseRepository,
    embeddingService: { embed: jest.fn().mockResolvedValue(new Array(384).fill(0)), embedBatch: jest.fn() },
    userService: {
      getUser: jest.fn().mockResolvedValue(GRAPH_USER),
      isRegistrationComplete: jest.fn().mockReturnValue(true),
      needsRegistration: jest.fn().mockReturnValue(false),
    } as unknown as IUserService,
    transcript: { appendRunMessages: async () => undefined, appendSystemNote: async () => undefined },
    summaries: {
      insert: async () => ({ summaryTurnId: 'summary-turn-1' }),
      latestLegacySummary: async () => null,
    },
    userFacts: {
      listFacts: jest.fn().mockResolvedValue({ active: [], archived: [] }),
      getForPrompt: jest.fn().mockResolvedValue([]),
      getConstraints: jest.fn().mockResolvedValue([]),
      getExpiredActive: jest.fn().mockResolvedValue([]),
      archiveExpired: jest.fn().mockResolvedValue(false),
    } as unknown as ConversationGraphDeps['userFacts'],
    llmGateway: {
      chat: async () => ({ content: '' }),
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
    episodeConfig: { gapMs: 365 * 24 * 3600 * 1000, minTurns: 2, minTokens: 300, keepTurns: 6 },
    checkpointer: new MemorySaver() as unknown as ConversationGraphDeps['checkpointer'],
  };
}

function graphConfig(runId: string, threadId = 'u1') {
  return {
    configurable: { thread_id: threadId },
    metadata: { runId, userId: 'u1' },
    context: {
      runId,
      userId: 'u1',
      user: GRAPH_USER as never,
      now: new Date(),
      client: 'telegram' as const,
      trigger: 'user_message' as const,
      metrics: new RunMetricsCollector(runId),
    },
    recursionLimit: 25,
  } as never;
}

const replyText = (messages: BaseMessage[]): string =>
  messages.map(m => (typeof m.content === 'string' ? m.content : '')).join(' ');

describe('prepare failure isolation — through the real graph and run adapter (AC-RRP-2)', () => {
  const inProgress = { id: SESSION_ID, status: 'in_progress', exercises: [], lastActivityAt: new Date() };

  it('control: a session that really ended still returns the user to chat with the session_ended reply', async () => {
    const graph = buildConversationGraph(
      makeGraphDeps(jest.fn().mockResolvedValue({ id: SESSION_ID, status: 'completed' })),
    );

    const result = (await graph.invoke(
      { phase: 'training', activeSessionId: SESSION_ID, messages: [new HumanMessage('hi')] },
      graphConfig('run-ended'),
    )) as { phase: string; activeSessionId: string | null; messages: BaseMessage[] };

    expect(result.phase).toBe('chat');
    expect(result.activeSessionId).toBeNull();
    expect(replyText(result.messages)).toContain(ENDED_REPLY);
  });

  it('a rejected session read rejects the graph run: no phase change, no session_ended reply, no run row, session not completed', async () => {
    const recorded: ConversationRunRecord[] = [];
    const getSessionDetails = jest.fn().mockRejectedValue(new Error('database unavailable'));
    const deps = makeGraphDeps(getSessionDetails, recorded);
    const graph = buildConversationGraph(deps);

    await expect(
      graph.invoke(
        { phase: 'training', activeSessionId: SESSION_ID, messages: [new HumanMessage('hi')] },
        graphConfig('run-fault'),
      ),
    ).rejects.toThrow('database unavailable');

    const state = await graph.getState({ configurable: { thread_id: 'u1' } });
    const values = state.values as { phase?: string; activeSessionId?: string | null; messages?: BaseMessage[] };
    expect(values.phase).toBe('training');
    expect(values.activeSessionId).toBe(SESSION_ID);
    expect(replyText(values.messages ?? [])).not.toContain(ENDED_REPLY);
    expect(recorded).toHaveLength(0); // commit never ran: nothing was committed
    expect(deps.trainingService.completeSession).not.toHaveBeenCalled();
  });

  it('through the run adapter the failure is a typed CORE_ERROR (failed-run row), the thread stays in training, and the next run recovers', async () => {
    const recorded: ConversationRunRecord[] = [];
    const getSessionDetails = jest.fn();
    const deps = makeGraphDeps(getSessionDetails, recorded);
    const graph = buildConversationGraph(deps);
    const runner = buildConversationRunner({
      graph,
      userService: deps.userService,
      runService: deps.runService,
      checkpointer: { deleteThread: jest.fn().mockResolvedValue(undefined) },
      transcript: deps.transcript,
    });

    // Seed a live training thread for user u1 (the runner's thread id is the userId).
    getSessionDetails.mockResolvedValue(inProgress);
    await graph.invoke(
      { phase: 'training', activeSessionId: SESSION_ID, messages: [new HumanMessage('start')] },
      graphConfig('run-seed'),
    );
    recorded.length = 0;

    // The read now fails: the runner reports a typed infrastructure error — not a reply.
    getSessionDetails.mockRejectedValue(new Error('database unavailable'));
    const failure = await runner.run({ userId: 'u1', text: 'next set' }).then(
      () => null,
      (err: unknown) => err as { code?: string; name?: string; message?: string },
    );

    expect(failure).toMatchObject({ code: 'CORE_ERROR', name: 'CoreError' });
    expect(failure?.message).not.toContain('database unavailable'); // INV-LLM-006: cause rides `cause`, not the message
    expect(recorded.map(r => r.outcome)).toEqual(['core_error']);
    const mid = (await graph.getState({ configurable: { thread_id: 'u1' } })).values as {
      phase?: string;
      activeSessionId?: string | null;
      messages?: BaseMessage[];
    };
    expect(mid.phase).toBe('training');
    expect(mid.activeSessionId).toBe(SESSION_ID);
    expect(replyText(mid.messages ?? [])).not.toContain(ENDED_REPLY);

    // The database is back: the very next message continues the SAME training session.
    getSessionDetails.mockResolvedValue(inProgress);
    const recovered = await runner.run({ userId: 'u1', text: 'next set' });
    expect(recovered.phase).toBe('training');
  });
});
