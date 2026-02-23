import type { LLMService } from '@domain/ai/ports';
import type { ConversationStateType } from '@domain/conversation/graph/conversation.state';
import type { ITrainingService, IWorkoutPlanRepository } from '@domain/training/ports';
import type { IPromptService, IUserService } from '@domain/user/ports';
import type { User } from '@domain/user/services/user.service';

import { buildChatNode, type ChatNodeDeps } from '../chat.node';

const makeState = (overrides: Partial<ConversationStateType> = {}): ConversationStateType => ({
  userId: 'u1',
  phase: 'chat',
  messages: [],
  userMessage: 'Hello coach!',
  responseMessage: '',
  requestedTransition: null,
  ...overrides,
});

const makeUser = (): User => ({
  id: 'u1',
  username: 'testuser',
  firstName: 'Test',
  lastName: null,
  languageCode: 'en',
  profileStatus: 'complete',
  age: 25,
  gender: 'male',
  height: 180,
  weight: 80,
  fitnessLevel: 'intermediate',
  fitnessGoal: 'lose weight',
});

const makeDeps = (overrides: Partial<ChatNodeDeps> = {}): ChatNodeDeps => ({
  promptService: {
    buildChatSystemPrompt: jest.fn().mockReturnValue('system prompt'),
    buildUnifiedRegistrationPrompt: jest.fn(),
    buildPlanCreationPrompt: jest.fn(),
    buildSessionPlanningPrompt: jest.fn(),
    buildTrainingPrompt: jest.fn(),
  } as unknown as IPromptService,
  llmService: {
    generateWithSystemPrompt: jest.fn().mockResolvedValue('{"message": "Hey! Keep pushing!"}'),
    generateStructured: jest.fn(),
  } as unknown as LLMService,
  trainingService: {
    getTrainingHistory: jest.fn().mockResolvedValue([]),
    getNextSessionRecommendation: jest.fn(),
    startSession: jest.fn(),
    addExerciseToSession: jest.fn(),
    logSet: jest.fn(),
    completeSession: jest.fn(),
    skipSession: jest.fn(),
    getSessionDetails: jest.fn(),
    startNextExercise: jest.fn(),
    skipCurrentExercise: jest.fn(),
    completeCurrentExercise: jest.fn(),
    ensureCurrentExercise: jest.fn(),
  } as unknown as ITrainingService,
  workoutPlanRepo: {
    findActiveByUserId: jest.fn().mockResolvedValue(null),
    create: jest.fn(),
    findAll: jest.fn(),
    findById: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  } as unknown as IWorkoutPlanRepository,
  userService: {
    getUser: jest.fn().mockResolvedValue(makeUser()),
    upsertUser: jest.fn(),
    updateProfileData: jest.fn(),
    isRegistrationComplete: jest.fn().mockReturnValue(true),
  } as unknown as IUserService,
  ...overrides,
});

describe('chatNode', () => {
  it('sets responseMessage from LLM response', async() => {
    const chatNode = buildChatNode(makeDeps());
    const result = await chatNode(makeState());

    expect(result.responseMessage).toBe('Hey! Keep pushing!');
    expect(result.requestedTransition).toBeNull();
  });

  it('sets requestedTransition when LLM returns phaseTransition', async() => {
    const llmResponse = '{"message": "Let\'s build your plan!", "phaseTransition": {"toPhase": "plan_creation", "reason": "user_requested"}}';
    const chatNode = buildChatNode(makeDeps({
      llmService: {
        generateWithSystemPrompt: jest.fn().mockResolvedValue(llmResponse),
        generateStructured: jest.fn(),
      } as unknown as LLMService,
    }));

    const result = await chatNode(makeState());

    expect(result.responseMessage).toBe('Let\'s build your plan!');
    expect(result.requestedTransition).toEqual({ toPhase: 'plan_creation', reason: 'user_requested', sessionId: undefined });
  });

  it('calls updateProfileData when LLM returns profileUpdate', async() => {
    const updateProfileData = jest.fn().mockResolvedValue(makeUser());
    const chatNode = buildChatNode(makeDeps({
      llmService: {
        generateWithSystemPrompt: jest.fn().mockResolvedValue('{"message": "Updated your weight!", "profileUpdate": {"weight": 75}}'),
        generateStructured: jest.fn(),
      } as unknown as LLMService,
      userService: {
        getUser: jest.fn().mockResolvedValue(makeUser()),
        upsertUser: jest.fn(),
        updateProfileData,
        isRegistrationComplete: jest.fn().mockReturnValue(true),
      } as unknown as IUserService,
    }));

    await chatNode(makeState());

    expect(updateProfileData).toHaveBeenCalledWith('u1', { weight: 75 });
  });

  it('throws when user not found', async() => {
    const chatNode = buildChatNode(makeDeps({
      userService: {
        getUser: jest.fn().mockResolvedValue(null),
        upsertUser: jest.fn(),
        updateProfileData: jest.fn(),
        isRegistrationComplete: jest.fn(),
      } as unknown as IUserService,
    }));

    await expect(chatNode(makeState())).rejects.toThrow('User u1 not found');
  });
});
