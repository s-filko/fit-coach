import type { RunnableConfig } from '@langchain/core/runnables';

import { isToolReturnWithUpdate, type ToolReturn } from '@domain/conversation/tool-outcome';
import type { IUserService } from '@domain/user/ports';

import { toToolMessage } from '@infra/ai/tools/outcome';

import { buildCompleteRegistrationTool } from '../complete-registration.tool';

// StructuredTool has overloaded .invoke() signatures that TS cannot unify in tests.
// Cast to a simple callable shape to keep tests readable.
type InvokableTool = {
  invoke: (input: Record<string, unknown>, config?: RunnableConfig) => Promise<unknown>;
};

/** Renders a tool return exactly as the executor will (Task 5 contract). */
function renderedContent(ret: ToolReturn): string {
  return String(toToolMessage('outcome' in ret && 'update' in ret ? ret.outcome : ret, 'test-id').content);
}

const FULL_USER = {
  id: 'u1',
  firstName: 'Test',
  profileStatus: 'registration' as const,
  age: 28,
  gender: 'male' as const,
  height: 180,
  weight: 80,
  fitnessLevel: 'intermediate' as const,
  fitnessGoal: 'Build muscle',
};

const makeUserService = (userOverrides: Partial<typeof FULL_USER> = {}): jest.Mocked<IUserService> =>
  ({
    getUser: jest.fn().mockResolvedValue({ ...FULL_USER, ...userOverrides }),
    updateProfileData: jest.fn().mockResolvedValue({ ...FULL_USER, ...userOverrides }),
    upsertUser: jest.fn(),
    isRegistrationComplete: jest.fn().mockReturnValue(false),
    needsRegistration: jest.fn().mockReturnValue(true),
  }) as unknown as jest.Mocked<IUserService>;

/** RunnableConfig with userId in configurable — matches what the executor passes */
const makeConfig = (userId = 'u1'): RunnableConfig => ({
  configurable: { userId, thread_id: userId },
});

const buildTools = (userService: jest.Mocked<IUserService>): [InvokableTool] => [
  buildCompleteRegistrationTool({ userService }) as unknown as InvokableTool,
];

describe('complete-registration.tool — complete_registration', () => {
  it('returns a ToolReturn with update, never a Command object', async () => {
    const [completeRegistration] = buildTools(makeUserService());

    const result = (await completeRegistration.invoke({ toPhase: 'chat' }, makeConfig())) as ToolReturn;

    expect(result as object).not.toHaveProperty('lc_direct_tool_output');
    expect(isToolReturnWithUpdate(result)).toBe(true);
    expect(isToolReturnWithUpdate(result) ? result.update.pendingTransition : null).toBeTruthy();
  });

  it('requests pendingTransition with correct toPhase when all fields present', async () => {
    const [completeRegistration] = buildTools(makeUserService());

    const result = (await completeRegistration.invoke({ toPhase: 'plan_creation' }, makeConfig('u1'))) as ToolReturn;

    expect(isToolReturnWithUpdate(result) ? result.update.pendingTransition : undefined).toEqual({
      toPhase: 'plan_creation',
      reason: 'registration_complete',
    });
  });

  it('returns success string and marks profileStatus complete', async () => {
    const userService = makeUserService();
    const [completeRegistration] = buildTools(userService);

    const result = (await completeRegistration.invoke({ toPhase: 'chat' }, makeConfig())) as ToolReturn;

    expect(renderedContent(result)).toContain('Registration complete');
    expect(userService.updateProfileData).toHaveBeenCalledWith('u1', { profileStatus: 'complete' });
  });

  it('blocks completion and lists missing fields when profile is incomplete', async () => {
    const userService = makeUserService({ fitnessGoal: undefined, weight: undefined });
    (userService.getUser as jest.Mock).mockResolvedValue({ ...FULL_USER, fitnessGoal: null, weight: null });
    const [completeRegistration] = buildTools(userService);

    const result = (await completeRegistration.invoke({ toPhase: 'chat' }, makeConfig())) as ToolReturn;

    expect(renderedContent(result)).toContain('Cannot complete registration');
    expect(renderedContent(result)).toContain('missing');
    expect(isToolReturnWithUpdate(result)).toBe(false);
    expect(userService.updateProfileData).not.toHaveBeenCalled();
  });

  it('returns error string when userId is missing from configurable', async () => {
    const [completeRegistration] = buildTools(makeUserService());

    const result = (await completeRegistration.invoke({ toPhase: 'chat' }, { configurable: {} })) as ToolReturn;

    expect(renderedContent(result)).toContain('Error: could not identify user');
    expect(isToolReturnWithUpdate(result)).toBe(false);
  });

  it('returns error string when user not found in DB', async () => {
    const userService = makeUserService();
    (userService.getUser as jest.Mock).mockResolvedValue(null);
    const [completeRegistration] = buildTools(userService);

    const result = (await completeRegistration.invoke({ toPhase: 'chat' }, makeConfig())) as ToolReturn;

    expect(renderedContent(result)).toContain('Error: user not found');
    expect(isToolReturnWithUpdate(result)).toBe(false);
  });
});
