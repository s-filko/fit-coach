import type { RunnableConfig } from '@langchain/core/runnables';

import type { IUserService } from '@domain/user/ports';
import { isToolReturnWithUpdate, type ToolReturn } from '@domain/conversation/tool-outcome';
import { toToolMessage } from '@infra/ai/tools/outcome';

import { buildRegistrationTools } from '../registration.tools';

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

const buildTools = (userService: jest.Mocked<IUserService>): [InvokableTool, InvokableTool] =>
  buildRegistrationTools({ userService }) as unknown as [InvokableTool, InvokableTool];

describe('registration.tools — save_profile_fields', () => {
  it('returns a ToolOutcome, never a Command object', async () => {
    const [saveProfileFields] = buildTools(makeUserService());

    const result = (await saveProfileFields.invoke({ age: 28, gender: 'male' }, makeConfig())) as ToolReturn;

    // Command objects have this sentinel field — ensure it is absent
    expect(result as object).not.toHaveProperty('lc_direct_tool_output');
    expect(renderedContent(result)).toContain('Saved:');
  });

  it('calls updateProfileData with validated fields', async () => {
    const userService = makeUserService();
    const [saveProfileFields] = buildTools(userService);

    await saveProfileFields.invoke({ age: 28, gender: 'male', height: 180 }, makeConfig());

    expect(userService.updateProfileData).toHaveBeenCalledWith(
      'u1',
      expect.objectContaining({
        age: 28,
        gender: 'male',
        height: 180,
      }),
    );
  });

  it('returns "Saved:" confirmation with field names', async () => {
    const [saveProfileFields] = buildTools(makeUserService());

    const result = (await saveProfileFields.invoke({ age: 28 }, makeConfig())) as ToolReturn;

    expect(renderedContent(result)).toContain('Saved:');
  });

  it('returns error string when userId is missing from configurable', async () => {
    const [saveProfileFields] = buildTools(makeUserService());

    const result = (await saveProfileFields.invoke({ age: 28 }, { configurable: {} })) as ToolReturn;

    expect(renderedContent(result)).toContain('Error: could not identify user');
  });

  it('returns "No valid fields" when input is empty', async () => {
    const [saveProfileFields] = buildTools(makeUserService());

    const result = (await saveProfileFields.invoke({}, makeConfig())) as ToolReturn;

    expect(renderedContent(result)).toContain('No valid fields to save');
  });

  it('carries no state update', async () => {
    const [saveProfileFields] = buildTools(makeUserService());

    const result = (await saveProfileFields.invoke({ age: 28 }, makeConfig())) as ToolReturn;

    expect(isToolReturnWithUpdate(result)).toBe(false);
  });

  it('saves firstName when explicitly provided', async () => {
    const userService = makeUserService();
    const [saveProfileFields] = buildTools(userService);

    await saveProfileFields.invoke({ firstName: 'Alex' }, makeConfig());

    expect(userService.updateProfileData).toHaveBeenCalledWith(
      'u1',
      expect.objectContaining({
        firstName: 'Alex',
      }),
    );
  });
});

describe('registration.tools — complete_registration', () => {
  it('returns a ToolReturn with update, never a Command object', async () => {
    const [, completeRegistration] = buildTools(makeUserService());

    const result = (await completeRegistration.invoke({ toPhase: 'chat' }, makeConfig())) as ToolReturn;

    expect(result as object).not.toHaveProperty('lc_direct_tool_output');
    expect(isToolReturnWithUpdate(result)).toBe(true);
    expect(isToolReturnWithUpdate(result) ? result.update.pendingTransition : null).toBeTruthy();
  });

  it('requests pendingTransition with correct toPhase when all fields present', async () => {
    const [, completeRegistration] = buildTools(makeUserService());

    const result = (await completeRegistration.invoke({ toPhase: 'plan_creation' }, makeConfig('u1'))) as ToolReturn;

    expect(isToolReturnWithUpdate(result) ? result.update.pendingTransition : undefined).toEqual({
      toPhase: 'plan_creation',
      reason: 'registration_complete',
    });
  });

  it('returns success string and marks profileStatus complete', async () => {
    const userService = makeUserService();
    const [, completeRegistration] = buildTools(userService);

    const result = (await completeRegistration.invoke({ toPhase: 'chat' }, makeConfig())) as ToolReturn;

    expect(renderedContent(result)).toContain('Registration complete');
    expect(userService.updateProfileData).toHaveBeenCalledWith('u1', { profileStatus: 'complete' });
  });

  it('blocks completion and lists missing fields when profile is incomplete', async () => {
    const userService = makeUserService({ fitnessGoal: undefined, weight: undefined });
    (userService.getUser as jest.Mock).mockResolvedValue({ ...FULL_USER, fitnessGoal: null, weight: null });
    const [, completeRegistration] = buildTools(userService);

    const result = (await completeRegistration.invoke({ toPhase: 'chat' }, makeConfig())) as ToolReturn;

    expect(renderedContent(result)).toContain('Cannot complete registration');
    expect(renderedContent(result)).toContain('missing');
    expect(isToolReturnWithUpdate(result)).toBe(false);
    expect(userService.updateProfileData).not.toHaveBeenCalled();
  });

  it('returns error string when userId is missing from configurable', async () => {
    const [, completeRegistration] = buildTools(makeUserService());

    const result = (await completeRegistration.invoke({ toPhase: 'chat' }, { configurable: {} })) as ToolReturn;

    expect(renderedContent(result)).toContain('Error: could not identify user');
    expect(isToolReturnWithUpdate(result)).toBe(false);
  });

  it('returns error string when user not found in DB', async () => {
    const userService = makeUserService();
    (userService.getUser as jest.Mock).mockResolvedValue(null);
    const [, completeRegistration] = buildTools(userService);

    const result = (await completeRegistration.invoke({ toPhase: 'chat' }, makeConfig())) as ToolReturn;

    expect(renderedContent(result)).toContain('Error: user not found');
    expect(isToolReturnWithUpdate(result)).toBe(false);
  });
});
