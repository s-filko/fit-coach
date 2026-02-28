/**
 * Tests for registration.subgraph.ts — tool-calling loop.
 *
 * Bug: agentNode builds the LLM prompt from contextService.getMessagesForPrompt()
 * (persisted DB history) but ignores state.messages (the in-flight AIMessage +
 * ToolMessages from the current turn). When the tool-calling loop runs:
 *
 *   1. agent → LLM returns AIMessage with tool_calls
 *   2. tools → ToolNode creates ToolMessage("Saved: age") in state.messages
 *   3. agent again → reads same DB history (persist hasn't run yet), builds
 *      the same prompt WITHOUT ToolMessage → LLM sees only the original HumanMessage
 *      → returns tool_calls again → infinite loop
 *
 * Fix: agentNode must append state.messages (excluding the initial HumanMessage
 * that it adds manually) into the LLM messages array so the LLM can see
 * AIMessage(tool_calls) + ToolMessage(result) and produce a text reply.
 */

import { AIMessage, ToolMessage } from '@langchain/core/messages';

import { InMemoryConversationContextService } from '@infra/conversation/conversation-context.service';
import type { IUserService } from '@domain/user/ports';

const BASE_USER = {
  id: 'u1',
  firstName: 'Test',
  profileStatus: 'registration' as const,
  age: null,
  gender: null,
  height: null,
  weight: null,
  fitnessLevel: null,
  fitnessGoal: null,
};

const makeUserService = (): jest.Mocked<IUserService> => ({
  getUser: jest.fn().mockResolvedValue(BASE_USER),
  updateProfileData: jest.fn().mockResolvedValue({ ...BASE_USER, age: 28, gender: 'male' }),
  upsertUser: jest.fn(),
  isRegistrationComplete: jest.fn().mockReturnValue(false),
  needsRegistration: jest.fn().mockReturnValue(true),
} as unknown as jest.Mocked<IUserService>);

describe('registration.subgraph — tool-calling loop', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  /**
   * RED TEST: verifies that the second LLM call receives ToolMessage
   * from the current turn in its messages array.
   *
   * With the bug: the second call sees the same prompt as the first
   * (no ToolMessage) → this assertion fails.
   * With the fix: ToolMessage is present in the second call → passes.
   */
  it('includes ToolMessage from current turn in the prompt for the second LLM call', async () => {
    const capturedMessages: unknown[][] = [];

    const mockInvoke = jest.fn().mockImplementation(async (messages: unknown[]) => {
      capturedMessages.push([...messages]);
      if (capturedMessages.length === 1) {
        return new AIMessage({
          content: '',
          tool_calls: [{
            id: 'tc-1',
            name: 'save_profile_fields',
            args: { age: 28, gender: 'male' },
            type: 'tool_call',
          }],
        });
      }
      return new AIMessage({ content: 'Возраст и пол сохранены.', tool_calls: [] });
    });

    jest.mock('@infra/ai/model.factory', () => ({
      getModel: () => ({ bindTools: () => ({ invoke: mockInvoke }) }),
    }));

    const { buildRegistrationSubgraph } = await import('../registration.subgraph');
    const subgraph = buildRegistrationSubgraph({
      userService: makeUserService(),
      contextService: new InMemoryConversationContextService(),
    });

    await subgraph.invoke(
      { userId: 'u1', userMessage: 'мне 28 лет, мужской', user: BASE_USER },
      { recursionLimit: 10, configurable: { userId: 'u1', thread_id: 'u1' } },
    );

    // Must have been called exactly twice
    expect(mockInvoke).toHaveBeenCalledTimes(2);

    // The 2nd call must include ToolMessage in its messages array
    const secondCallMessages = capturedMessages[1] as Array<{ _getType?: () => string }>;
    const hasToolMessage = secondCallMessages.some(
      (m) => m instanceof ToolMessage || (typeof m._getType === 'function' && m._getType() === 'tool'),
    );
    // RED with bug: ToolMessage is absent → false
    // GREEN with fix: ToolMessage is present → true
    expect(hasToolMessage).toBe(true);
  });

  /**
   * RED TEST: the same bug expressed differently — verifies the AIMessage
   * with tool_calls is also included in the second call's messages,
   * so the LLM has context of what it requested and what was returned.
   */
  it('includes the AIMessage with tool_calls in the prompt for the second LLM call', async () => {
    const capturedMessages: unknown[][] = [];

    const mockInvoke = jest.fn().mockImplementation(async (messages: unknown[]) => {
      capturedMessages.push([...messages]);
      if (capturedMessages.length === 1) {
        return new AIMessage({
          content: '',
          tool_calls: [{
            id: 'tc-2',
            name: 'save_profile_fields',
            args: { age: 30 },
            type: 'tool_call',
          }],
        });
      }
      return new AIMessage({ content: 'Готово.', tool_calls: [] });
    });

    jest.mock('@infra/ai/model.factory', () => ({
      getModel: () => ({ bindTools: () => ({ invoke: mockInvoke }) }),
    }));

    const { buildRegistrationSubgraph } = await import('../registration.subgraph');
    const subgraph = buildRegistrationSubgraph({
      userService: makeUserService(),
      contextService: new InMemoryConversationContextService(),
    });

    await subgraph.invoke(
      { userId: 'u1', userMessage: 'мне 30 лет', user: BASE_USER },
      { recursionLimit: 10, configurable: { userId: 'u1', thread_id: 'u1' } },
    );

    const secondCallMessages = capturedMessages[1] as Array<{ _getType?: () => string; tool_calls?: unknown[] }>;

    const hasAIWithToolCalls = secondCallMessages.some(
      (m) => m instanceof AIMessage && Array.isArray(m.tool_calls) && m.tool_calls.length > 0,
    );
    // RED with bug: AIMessage(tool_calls) absent from prompt → false
    // GREEN with fix: present → true
    expect(hasAIWithToolCalls).toBe(true);
  });
});
