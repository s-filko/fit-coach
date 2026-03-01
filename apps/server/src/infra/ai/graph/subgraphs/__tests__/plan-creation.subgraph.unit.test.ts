/**
 * Tests for plan-creation.subgraph.ts — tool-calling loop (same pattern as registration).
 *
 * Verifies that state.messages (in-flight AIMessage + ToolMessages from the current
 * turn) are included in the second LLM call's prompt, preventing the recursion bug
 * where the LLM repeatedly calls tools because it never sees the tool results.
 */

import { AIMessage, ToolMessage } from '@langchain/core/messages';

import { InMemoryConversationContextService } from '@infra/conversation/conversation-context.service';
import type { IExerciseRepository, IWorkoutPlanRepository } from '@domain/training/ports';
import type { IUserService } from '@domain/user/ports';

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
    findByIds: jest.fn(),
    findByIdsWithMuscles: jest.fn().mockResolvedValue([]),
    findByMuscleGroup: jest.fn(),
    search: jest.fn(),
    findAll: jest.fn().mockResolvedValue([]),
    findAllWithMuscles: jest.fn().mockResolvedValue([]),
  }) as unknown as jest.Mocked<IExerciseRepository>;

const makeWorkoutPlanRepo = (): jest.Mocked<IWorkoutPlanRepository> =>
  ({
    create: jest.fn().mockResolvedValue({ id: 'plan-1' }),
    findById: jest.fn(),
    findActiveByUserId: jest.fn().mockResolvedValue(null),
    findByUserId: jest.fn(),
    update: jest.fn(),
    archive: jest.fn(),
  }) as unknown as jest.Mocked<IWorkoutPlanRepository>;

describe('plan-creation.subgraph — tool-calling loop', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  it('includes ToolMessage from current turn in the prompt for the second LLM call', async () => {
    const capturedMessages: unknown[][] = [];

    const mockInvoke = jest.fn().mockImplementation(async (messages: unknown[]) => {
      capturedMessages.push([...messages]);
      if (capturedMessages.length === 1) {
        return new AIMessage({
          content: '',
          tool_calls: [
            {
              id: 'tc-plan-1',
              name: 'request_transition',
              args: { toPhase: 'chat', reason: 'user declined' },
              type: 'tool_call',
            },
          ],
        });
      }
      return new AIMessage({ content: 'Понял, возвращаемся в чат.', tool_calls: [] });
    });

    jest.mock('@infra/ai/model.factory', () => ({
      getModel: () => ({ bindTools: () => ({ invoke: mockInvoke }) }),
    }));

    const { buildPlanCreationSubgraph } = await import('../plan-creation.subgraph');
    const subgraph = buildPlanCreationSubgraph({
      userService: makeUserService(),
      contextService: new InMemoryConversationContextService(),
      exerciseRepository: makeExerciseRepository(),
      workoutPlanRepository: makeWorkoutPlanRepo(),
    });

    await subgraph.invoke(
      { userId: 'u1', userMessage: 'нет, не хочу план', user: BASE_USER },
      { recursionLimit: 10, configurable: { userId: 'u1', thread_id: 'u1' } },
    );

    expect(mockInvoke).toHaveBeenCalledTimes(2);

    const secondCallMessages = capturedMessages[1] as Array<{ _getType?: () => string }>;
    const hasToolMessage = secondCallMessages.some(
      m => m instanceof ToolMessage || (typeof m._getType === 'function' && m._getType() === 'tool'),
    );
    // GREEN: ToolMessage must be present (in-flight from current turn)
    expect(hasToolMessage).toBe(true);
  });

  it('includes the AIMessage with tool_calls in the prompt for the second LLM call', async () => {
    const capturedMessages: unknown[][] = [];

    const mockInvoke = jest.fn().mockImplementation(async (messages: unknown[]) => {
      capturedMessages.push([...messages]);
      if (capturedMessages.length === 1) {
        return new AIMessage({
          content: '',
          tool_calls: [
            {
              id: 'tc-plan-2',
              name: 'request_transition',
              args: { toPhase: 'chat' },
              type: 'tool_call',
            },
          ],
        });
      }
      return new AIMessage({ content: 'Хорошо.', tool_calls: [] });
    });

    jest.mock('@infra/ai/model.factory', () => ({
      getModel: () => ({ bindTools: () => ({ invoke: mockInvoke }) }),
    }));

    const { buildPlanCreationSubgraph } = await import('../plan-creation.subgraph');
    const subgraph = buildPlanCreationSubgraph({
      userService: makeUserService(),
      contextService: new InMemoryConversationContextService(),
      exerciseRepository: makeExerciseRepository(),
      workoutPlanRepository: makeWorkoutPlanRepo(),
    });

    await subgraph.invoke(
      { userId: 'u1', userMessage: 'отмена', user: BASE_USER },
      { recursionLimit: 10, configurable: { userId: 'u1', thread_id: 'u1' } },
    );

    const secondCallMessages = capturedMessages[1] as Array<{ _getType?: () => string; tool_calls?: unknown[] }>;
    const hasAIWithToolCalls = secondCallMessages.some(
      m => m instanceof AIMessage && Array.isArray(m.tool_calls) && m.tool_calls.length > 0,
    );
    // GREEN: AIMessage(tool_calls) must be present (in-flight from current turn)
    expect(hasAIWithToolCalls).toBe(true);
  });
});
