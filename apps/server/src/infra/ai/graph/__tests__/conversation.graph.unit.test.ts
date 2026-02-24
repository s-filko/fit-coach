import { AIMessage } from '@langchain/core/messages';
import { MemorySaver } from '@langchain/langgraph';

import type { IExerciseRepository, ITrainingService, IWorkoutPlanRepository } from '@domain/training/ports';
import type { IUserService } from '@domain/user/ports';

import { InMemoryConversationContextService } from '@infra/conversation/conversation-context.service';

import { buildConversationGraph, type ConversationGraphDeps } from '../conversation.graph';

// Mock the model factory so tests don't need a real LLM key
jest.mock('@infra/ai/model.factory', () => ({
  getModel: () => ({
    bindTools: () => ({
      invoke: jest.fn().mockResolvedValue(
        new AIMessage({ content: 'Mocked LLM response', tool_calls: [] }),
      ),
    }),
  }),
}));

const makeDeps = (): ConversationGraphDeps => ({
  trainingService: {
    getTrainingHistory: jest.fn().mockResolvedValue([]),
    getSessionDetails: jest.fn().mockResolvedValue(null),
    completeSession: jest.fn().mockResolvedValue({}),
  } as unknown as ITrainingService,
  workoutPlanRepo: {
    findActiveByUserId: jest.fn().mockResolvedValue(null),
    create: jest.fn(),
  } as unknown as IWorkoutPlanRepository,
  exerciseRepository: {
    findAllWithMuscles: jest.fn().mockResolvedValue([]),
    findAll: jest.fn().mockResolvedValue([]),
    findByIdsWithMuscles: jest.fn().mockResolvedValue([]),
    findById: jest.fn(),
    findByIdWithMuscles: jest.fn(),
    findByIds: jest.fn(),
    findByMuscleGroup: jest.fn(),
    search: jest.fn(),
  } as unknown as IExerciseRepository,
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
  checkpointer: new MemorySaver() as unknown as InstanceType<typeof import('@langchain/langgraph-checkpoint-postgres').PostgresSaver>,
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
});
