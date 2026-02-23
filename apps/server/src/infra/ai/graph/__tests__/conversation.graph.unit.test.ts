import { AIMessage } from '@langchain/core/messages';
import { MemorySaver } from '@langchain/langgraph';

import type { ITrainingService, IWorkoutPlanRepository } from '@domain/training/ports';
import type { IPromptService, IUserService } from '@domain/user/ports';

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
  promptService: {} as unknown as IPromptService,
  trainingService: {
    getTrainingHistory: jest.fn().mockResolvedValue([]),
    getSessionDetails: jest.fn().mockResolvedValue(null),
    completeSession: jest.fn().mockResolvedValue({}),
  } as unknown as ITrainingService,
  workoutPlanRepo: {
    findActiveByUserId: jest.fn().mockResolvedValue(null),
  } as unknown as IWorkoutPlanRepository,
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

  it('returns stub response for unimplemented phases', async () => {
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

    expect(result.responseMessage).toContain('not yet implemented');
    expect(result.phase).toBe('registration');
  });
});
