import { AIMessage } from '@langchain/core/messages';
import { MemorySaver } from '@langchain/langgraph';

import type {
  IExerciseRepository,
  ITrainingService,
  IWorkoutPlanRepository,
  IWorkoutSessionRepository,
} from '@domain/training/ports';
import type { IUserService } from '@domain/user/ports';

import { InMemoryConversationContextService } from '@infra/conversation/conversation-context.service';

import { buildConversationGraph, type ConversationGraphDeps } from '../conversation.graph';

// Mock the model factory so tests don't need a real LLM key
jest.mock('@infra/ai/model.factory', () => ({
  getModel: () => ({
    bindTools: () => ({
      invoke: jest.fn().mockResolvedValue(new AIMessage({ content: 'Mocked LLM response', tool_calls: [] })),
    }),
  }),
}));

const makeDeps = (): ConversationGraphDeps => ({
  trainingService: {
    getTrainingHistory: jest.fn().mockResolvedValue([]),
    getSessionDetails: jest.fn().mockResolvedValue(null),
    completeSession: jest.fn().mockResolvedValue({}),
    startSession: jest.fn().mockResolvedValue({ id: 'session-1' }),
    getNextSessionRecommendation: jest.fn(),
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
    getUser: jest.fn().mockResolvedValue({
      id: 'u1',
      firstName: 'Test',
      profileStatus: 'complete',
    }),
    updateProfileData: jest.fn(),
    isRegistrationComplete: jest.fn().mockReturnValue(true),
    needsRegistration: jest.fn().mockReturnValue(false),
    upsertUser: jest.fn(),
  } as unknown as IUserService,
  contextService: new InMemoryConversationContextService(),
  checkpointer: new MemorySaver() as unknown as InstanceType<
    typeof import('@langchain/langgraph-checkpoint-postgres').PostgresSaver
  >,
});

describe('ConversationGraph', () => {
  it('compiles without throwing', () => {
    expect(() => buildConversationGraph(makeDeps())).not.toThrow();
  });

  it('routes to chat subgraph and returns responseMessage', async () => {
    const graph = buildConversationGraph(makeDeps());

    const result = await graph.invoke(
      { userId: 'u1', phase: 'chat', userMessage: 'hello' },
      { configurable: { thread_id: 'u1' } },
    );

    expect(result.responseMessage).toBe('Mocked LLM response');
    expect(result.userId).toBe('u1');
    expect(result.phase).toBe('chat');
  });

  it('router loads user and sets phase from profile', async () => {
    const deps = makeDeps();
    const graph = buildConversationGraph(deps);

    const result = await graph.invoke(
      { userId: 'u1', phase: 'registration', userMessage: 'hi' },
      { configurable: { thread_id: 'u1-new' } },
    );

    expect(result.user).not.toBeNull();
    expect(result.user?.id).toBe('u1');
    // profileStatus is 'complete' → router advances phase to 'chat'
    expect(result.phase).toBe('chat');
  });

  it('routes unregistered user to registration subgraph', async () => {
    const deps = makeDeps();
    // Override: user is NOT registered → stays in registration
    (deps.userService.isRegistrationComplete as jest.Mock).mockReturnValue(false);
    (deps.userService.getUser as jest.Mock).mockResolvedValue({
      id: 'u2',
      firstName: 'New',
      profileStatus: 'registration',
    });

    const graph = buildConversationGraph(deps);
    const result = await graph.invoke(
      { userId: 'u2', phase: 'registration', userMessage: 'hi' },
      { configurable: { thread_id: 'u2' } },
    );

    // Registration subgraph is now real (mocked LLM) — check it returned a response
    expect(result.responseMessage).toBeTruthy();
    expect(result.phase).toBe('registration');
  });

  describe('session timeout routing', () => {
    it('session ended: router uses Command(goto=persist) — LLM subgraph is NOT invoked', async () => {
      const deps = makeDeps();

      // Simulate: user is in training phase with an active session that has already ended
      (deps.trainingService.getSessionDetails as jest.Mock).mockResolvedValue({
        id: 'session-1',
        status: 'completed',
        lastActivityAt: new Date(),
        updatedAt: new Date(),
        createdAt: new Date(),
      });

      const graph = buildConversationGraph(deps);

      // Start the thread in training phase with an active session
      const result = await graph.invoke(
        { userId: 'u1', phase: 'training', userMessage: 'hi', activeSessionId: 'session-1' },
        { configurable: { thread_id: 'u1-timeout-ended' } },
      );

      // Router should have bypassed the training subgraph via Command(goto='persist')
      // and returned the timeout message directly — NOT the mocked LLM response
      expect(result.responseMessage).toContain('completed');
      expect(result.phase).toBe('chat');
      expect(result.activeSessionId).toBeNull();

      // LLM was NOT invoked — the mocked LLM returns 'Mocked LLM response'
      // so if responseMessage equals that, the subgraph ran (which is the bug)
      expect(result.responseMessage).not.toBe('Mocked LLM response');
    });

    it('session idle timeout: router completes session, uses Command(goto=persist)', async () => {
      const deps = makeDeps();

      // Session is in_progress but idle for > 2 hours
      const twoHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000);
      (deps.trainingService.getSessionDetails as jest.Mock).mockResolvedValue({
        id: 'session-2',
        status: 'in_progress',
        lastActivityAt: twoHoursAgo,
        updatedAt: twoHoursAgo,
        createdAt: twoHoursAgo,
      });

      const graph = buildConversationGraph(deps);

      const result = await graph.invoke(
        { userId: 'u1', phase: 'training', userMessage: 'hello', activeSessionId: 'session-2' },
        { configurable: { thread_id: 'u1-timeout-idle' } },
      );

      // completeSession should have been called
      expect(deps.trainingService.completeSession).toHaveBeenCalledWith('session-2');

      // Router bypassed the training subgraph
      expect(result.responseMessage).toContain('inactivity');
      expect(result.phase).toBe('chat');
      expect(result.activeSessionId).toBeNull();
      expect(result.responseMessage).not.toBe('Mocked LLM response');
    });
  });

  describe('session_planning subgraph routing', () => {
    it('routes to session_planning subgraph and returns LLM response', async () => {
      const deps = makeDeps();
      const graph = buildConversationGraph(deps);

      const result = await graph.invoke(
        { userId: 'u1', phase: 'session_planning', userMessage: 'what should I do today?' },
        { configurable: { thread_id: 'u1-sp-basic' } },
      );

      expect(result.responseMessage).toBe('Mocked LLM response');
      expect(result.phase).toBe('session_planning');
      expect(result.activeSessionId).toBeNull();
    });
  });

  describe('training phase guards', () => {
    it('router falls back to chat when phase=training but activeSessionId is null', async () => {
      const deps = makeDeps();
      const graph = buildConversationGraph(deps);

      const result = await graph.invoke(
        { userId: 'u1', phase: 'training', userMessage: 'hi', activeSessionId: null },
        { configurable: { thread_id: 'u1-guard-null-session' } },
      );

      // Router should have bypassed the training subgraph and fallen back to chat
      expect(result.phase).toBe('chat');
      expect(result.activeSessionId).toBeNull();
      expect(result.responseMessage).not.toBe('Mocked LLM response');
      expect(result.responseMessage).toContain('could not be resumed');
    });

    it('transitionGuard blocks session_planning→training when activeSessionId is missing', async () => {
      // Mock LLM to call request_transition with toPhase=training via a tool call
      // that writes pendingTransition directly. We simulate this by having the LLM
      // call start_training_session which would normally set activeSessionId, but here
      // the service throws — so activeSessionId stays null while requestedTransition is set.
      let callCount = 0;
      jest.resetModules();
      jest.mock('@infra/ai/model.factory', () => ({
        getModel: () => ({
          bindTools: () => ({
            invoke: jest.fn().mockImplementation(async () => {
              callCount++;
              if (callCount === 1) {
                // First call in session_planning: call start_training_session
                return new AIMessage({
                  content: '',
                  tool_calls: [
                    {
                      id: 'tc-guard-1',
                      name: 'start_training_session',
                      args: {
                        sessionKey: 'test',
                        sessionName: 'Test',
                        reasoning: 'test',
                        exercises: [
                          {
                            exerciseId: 'c7b0899c-a0f9-47ca-a69d-4bcd531b0c95',
                            exerciseName: 'Bench Press',
                            targetSets: 3,
                            targetReps: '8-10',
                            restSeconds: 90,
                          },
                        ],
                        estimatedDuration: 60,
                      },
                      type: 'tool_call',
                    },
                  ],
                });
              }
              return new AIMessage({ content: 'OK ready!', tool_calls: [] });
            }),
          }),
        }),
      }));

      const { buildConversationGraph: buildGraph } = await import('../conversation.graph');

      const guardDeps = makeDeps();
      // startSession throws → pendingActiveSessionId stays null, but pendingTransition IS set
      (guardDeps.trainingService.startSession as jest.Mock).mockRejectedValue(new Error('DB unavailable'));

      const graph = buildGraph(guardDeps);
      const result = await graph.invoke(
        { userId: 'u1', phase: 'session_planning', userMessage: 'start!' },
        { configurable: { thread_id: 'u1-guard-block' }, recursionLimit: 10 },
      );

      // Guard should have blocked: phase stays session_planning, no activeSessionId
      expect(result.phase).toBe('session_planning');
      expect(result.activeSessionId).toBeNull();
    });
  });
});
