import type { LLMService } from '@domain/ai/ports';
import type { ITrainingService, IWorkoutPlanRepository } from '@domain/training/ports';
import type { IPromptService, IUserService } from '@domain/user/ports';

import { buildConversationGraph, type ConversationGraphDeps } from '../conversation.graph';

const makeDeps = (): ConversationGraphDeps => ({
  promptService: {
    buildChatSystemPrompt: jest.fn().mockReturnValue('system'),
    buildUnifiedRegistrationPrompt: jest.fn(),
    buildPlanCreationPrompt: jest.fn(),
    buildSessionPlanningPrompt: jest.fn(),
    buildTrainingPrompt: jest.fn(),
  } as unknown as IPromptService,
  llmService: {
    generateWithSystemPrompt: jest.fn().mockResolvedValue('{"message": "ok"}'),
    generateStructured: jest.fn(),
  } as unknown as LLMService,
  trainingService: {
    getTrainingHistory: jest.fn().mockResolvedValue([]),
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
    upsertUser: jest.fn(),
  } as unknown as IUserService,
});

describe('ConversationGraph', () => {
  it('compiles without throwing', () => {
    expect(() => buildConversationGraph(makeDeps())).not.toThrow();
  });

  it('routes chat phase to chatNode and returns responseMessage', async() => {
    const graph = buildConversationGraph(makeDeps());

    const result = await graph.invoke({
      userId: 'u1',
      phase: 'chat',
      messages: [],
      userMessage: 'hello',
      responseMessage: '',
      requestedTransition: null,
    });

    expect(result.responseMessage).toBe('ok');
    expect(result.userId).toBe('u1');
    expect(result.phase).toBe('chat');
  });

  it('throws stub error for plan_creation phase', async() => {
    const graph = buildConversationGraph(makeDeps());

    await expect(graph.invoke({
      userId: 'u1',
      phase: 'plan_creation',
      messages: [],
      userMessage: 'create plan',
      responseMessage: '',
      requestedTransition: null,
    })).rejects.toThrow('Phase \'plan_creation\' not yet migrated');
  });
});
