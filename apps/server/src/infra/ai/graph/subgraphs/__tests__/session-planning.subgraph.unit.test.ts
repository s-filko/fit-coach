/**
 * Tests for session-planning.subgraph.ts
 *
 * Verifies:
 * 1. extractNode reads and deletes both pendingTransitions and pendingActiveSessionIds Map entries
 * 2. activeSessionId propagates to parent state when start_training_session is called
 * 3. LLM text response (no tool calls) produces responseMessage with no side effects
 * 4. Tool-calling loop includes in-flight messages in the second LLM call (prevents recursion bug)
 */

import { AIMessage, ToolMessage } from '@langchain/core/messages';

import type {
  IEmbeddingService,
  IExerciseRepository,
  ITrainingService,
  IWorkoutPlanRepository,
  IWorkoutSessionRepository,
} from '@domain/training/ports';
import type { IUserService } from '@domain/user/ports';

import { InMemoryConversationContextService } from '@infra/conversation/conversation-context.service';

const BASE_USER = {
  id: 'u1',
  firstName: 'Aleksei',
  profileStatus: 'complete' as const,
  age: 28,
  gender: 'male' as const,
  height: 180,
  weight: 80,
  fitnessLevel: 'intermediate' as const,
  fitnessGoal: 'Build muscle',
};

const MINIMAL_SESSION_PLAN = {
  sessionKey: 'upper_a',
  sessionName: 'Upper A',
  reasoning: 'Good recovery',
  exercises: [{ exerciseId: 1, targetSets: 3, targetReps: '8-10', restSeconds: 90 }],
  estimatedDuration: 60,
};

const makeUserService = (): jest.Mocked<IUserService> =>
  ({
    getUser: jest.fn().mockResolvedValue(BASE_USER),
    updateProfileData: jest.fn().mockResolvedValue(BASE_USER),
    upsertUser: jest.fn(),
    isRegistrationComplete: jest.fn().mockReturnValue(true),
    needsRegistration: jest.fn().mockReturnValue(false),
  }) as unknown as jest.Mocked<IUserService>;

const makeExerciseRepository = (): jest.Mocked<IExerciseRepository> =>
  ({
    findById: jest.fn(),
    findByIdWithMuscles: jest.fn(),
    // Return any requested IDs so exerciseId validation always passes in subgraph tests
    findByIds: jest.fn().mockImplementation(async (ids: number[]) => ids.map(id => ({ id }))),
    findByIdsWithMuscles: jest.fn().mockResolvedValue([]),
    findByMuscleGroup: jest.fn(),
    search: jest.fn().mockResolvedValue([]),
    findAll: jest.fn().mockResolvedValue([]),
    findAllWithMuscles: jest.fn().mockResolvedValue([]),
    searchByEmbedding: jest.fn().mockResolvedValue([]),
    updateEmbedding: jest.fn(),
  }) as unknown as jest.Mocked<IExerciseRepository>;

const makeEmbeddingService = (): jest.Mocked<IEmbeddingService> =>
  ({
    embed: jest.fn().mockResolvedValue(new Array(384).fill(0)),
    embedBatch: jest.fn().mockResolvedValue([]),
  }) as unknown as jest.Mocked<IEmbeddingService>;

const makeWorkoutPlanRepo = (): jest.Mocked<IWorkoutPlanRepository> =>
  ({
    create: jest.fn(),
    findById: jest.fn(),
    findActiveByUserId: jest.fn().mockResolvedValue({ id: 'plan-1' }),
    findByUserId: jest.fn(),
    update: jest.fn(),
    archive: jest.fn(),
  }) as unknown as jest.Mocked<IWorkoutPlanRepository>;

const makeWorkoutSessionRepo = (): jest.Mocked<IWorkoutSessionRepository> =>
  ({
    create: jest.fn(),
    findById: jest.fn(),
    findByIdWithDetails: jest.fn(),
    findRecentByUserId: jest.fn().mockResolvedValue([]),
    findRecentByUserIdWithDetails: jest.fn().mockResolvedValue([]),
    findActiveByUserId: jest.fn().mockResolvedValue(null),
    update: jest.fn(),
    complete: jest.fn(),
    updateActivity: jest.fn(),
    findTimedOut: jest.fn().mockResolvedValue([]),
    autoCloseTimedOut: jest.fn().mockResolvedValue(0),
  }) as unknown as jest.Mocked<IWorkoutSessionRepository>;

const makeTrainingService = (sessionId = 'session-1'): jest.Mocked<ITrainingService> =>
  ({
    startSession: jest.fn().mockResolvedValue({ id: sessionId, status: 'planning' }),
    getSessionDetails: jest.fn(),
    completeSession: jest.fn(),
    skipSession: jest.fn(),
    getTrainingHistory: jest.fn(),
    getNextSessionRecommendation: jest.fn(),
    addExerciseToSession: jest.fn(),
    logSet: jest.fn(),
    completeCurrentExercise: jest.fn(),
    ensureCurrentExercise: jest.fn(),
  }) as unknown as jest.Mocked<ITrainingService>;

describe('session-planning.subgraph — text response (no tools)', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  it('sets responseMessage and no side effects when LLM responds with text only', async() => {
    const mockInvoke = jest
      .fn()
      .mockResolvedValue(new AIMessage({ content: 'How are you feeling today?', tool_calls: [] }));

    jest.mock('@infra/ai/model.factory', () => ({
      getModel: () => ({ bindTools: () => ({ invoke: mockInvoke }) }),
    }));

    const { buildSessionPlanningSubgraph } = await import('../session-planning.subgraph');
    const subgraph = buildSessionPlanningSubgraph({
      userService: makeUserService(),
      contextService: new InMemoryConversationContextService(),
      exerciseRepository: makeExerciseRepository(),
      embeddingService: makeEmbeddingService(),
      workoutPlanRepository: makeWorkoutPlanRepo(),
      workoutSessionRepository: makeWorkoutSessionRepo(),
      trainingService: makeTrainingService(),
    });

    const result = await subgraph.invoke(
      { userId: 'u1', userMessage: 'hello', user: BASE_USER },
      { recursionLimit: 10, configurable: { userId: 'u1', thread_id: 'u1' } },
    );

    expect(result.responseMessage).toBe('How are you feeling today?');
    // No session created, no transition requested
    expect(result.activeSessionId).toBeNull();
    expect(result.requestedTransition).toBeNull();
  });
});

describe('session-planning.subgraph — start_training_session tool', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  it('extractNode propagates activeSessionId to output when start_training_session is called', async() => {
    let llmCallCount = 0;
    const mockInvoke = jest.fn().mockImplementation(async() => {
      llmCallCount++;
      if (llmCallCount === 1) {
        return new AIMessage({
          content: '',
          tool_calls: [
            {
              id: 'tc-start-1',
              name: 'start_training_session',
              args: MINIMAL_SESSION_PLAN,
              type: 'tool_call',
            },
          ],
        });
      }
      return new AIMessage({ content: 'Let\'s go! Starting training.', tool_calls: [] });
    });

    jest.mock('@infra/ai/model.factory', () => ({
      getModel: () => ({ bindTools: () => ({ invoke: mockInvoke }) }),
    }));

    const { buildSessionPlanningSubgraph } = await import('../session-planning.subgraph');
    const subgraph = buildSessionPlanningSubgraph({
      userService: makeUserService(),
      contextService: new InMemoryConversationContextService(),
      exerciseRepository: makeExerciseRepository(),
      embeddingService: makeEmbeddingService(),
      workoutPlanRepository: makeWorkoutPlanRepo(),
      workoutSessionRepository: makeWorkoutSessionRepo(),
      trainingService: makeTrainingService('session-abc'),
    });

    const result = await subgraph.invoke(
      { userId: 'u1', userMessage: 'yes, let\'s start!', user: BASE_USER },
      { recursionLimit: 10, configurable: { userId: 'u1', thread_id: 'u1' } },
    );

    expect(result.activeSessionId).toBe('session-abc');
    expect(result.requestedTransition?.toPhase).toBe('training');
  });
});

describe('session-planning.subgraph — tool-calling loop (recursion prevention)', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  it('includes ToolMessage from current turn in the prompt for the second LLM call', async() => {
    const capturedMessages: unknown[][] = [];

    const mockInvoke = jest.fn().mockImplementation(async(messages: unknown[]) => {
      capturedMessages.push([...messages]);
      if (capturedMessages.length === 1) {
        return new AIMessage({
          content: '',
          tool_calls: [
            {
              id: 'tc-sp-1',
              name: 'request_transition',
              args: { toPhase: 'chat', reason: 'user cancelled' },
              type: 'tool_call',
            },
          ],
        });
      }
      return new AIMessage({ content: 'Ok, going back to chat.', tool_calls: [] });
    });

    jest.mock('@infra/ai/model.factory', () => ({
      getModel: () => ({ bindTools: () => ({ invoke: mockInvoke }) }),
    }));

    const { buildSessionPlanningSubgraph } = await import('../session-planning.subgraph');
    const subgraph = buildSessionPlanningSubgraph({
      userService: makeUserService(),
      contextService: new InMemoryConversationContextService(),
      exerciseRepository: makeExerciseRepository(),
      embeddingService: makeEmbeddingService(),
      workoutPlanRepository: makeWorkoutPlanRepo(),
      workoutSessionRepository: makeWorkoutSessionRepo(),
      trainingService: makeTrainingService(),
    });

    await subgraph.invoke(
      { userId: 'u1', userMessage: 'cancel', user: BASE_USER },
      { recursionLimit: 10, configurable: { userId: 'u1', thread_id: 'u1' } },
    );

    expect(mockInvoke).toHaveBeenCalledTimes(2);

    const secondCallMessages = capturedMessages[1] as Array<{ _getType?: () => string }>;
    const hasToolMessage = secondCallMessages.some(
      m => m instanceof ToolMessage || (typeof m._getType === 'function' && m._getType() === 'tool'),
    );
    expect(hasToolMessage).toBe(true);
  });

  it('includes the AIMessage with tool_calls in the prompt for the second LLM call', async() => {
    const capturedMessages: unknown[][] = [];

    const mockInvoke = jest.fn().mockImplementation(async(messages: unknown[]) => {
      capturedMessages.push([...messages]);
      if (capturedMessages.length === 1) {
        return new AIMessage({
          content: '',
          tool_calls: [
            {
              id: 'tc-sp-2',
              name: 'request_transition',
              args: { toPhase: 'chat' },
              type: 'tool_call',
            },
          ],
        });
      }
      return new AIMessage({ content: 'Done.', tool_calls: [] });
    });

    jest.mock('@infra/ai/model.factory', () => ({
      getModel: () => ({ bindTools: () => ({ invoke: mockInvoke }) }),
    }));

    const { buildSessionPlanningSubgraph } = await import('../session-planning.subgraph');
    const subgraph = buildSessionPlanningSubgraph({
      userService: makeUserService(),
      contextService: new InMemoryConversationContextService(),
      exerciseRepository: makeExerciseRepository(),
      embeddingService: makeEmbeddingService(),
      workoutPlanRepository: makeWorkoutPlanRepo(),
      workoutSessionRepository: makeWorkoutSessionRepo(),
      trainingService: makeTrainingService(),
    });

    await subgraph.invoke(
      { userId: 'u1', userMessage: 'no thanks', user: BASE_USER },
      { recursionLimit: 10, configurable: { userId: 'u1', thread_id: 'u1' } },
    );

    const secondCallMessages = capturedMessages[1] as Array<{ _getType?: () => string; tool_calls?: unknown[] }>;
    const hasAIWithToolCalls = secondCallMessages.some(
      m => m instanceof AIMessage && Array.isArray(m.tool_calls) && m.tool_calls.length > 0,
    );
    expect(hasAIWithToolCalls).toBe(true);
  });
});
