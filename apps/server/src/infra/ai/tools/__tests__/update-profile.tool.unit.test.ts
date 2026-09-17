import type { RunnableConfig } from '@langchain/core/runnables';

import { isToolReturnWithUpdate, type ToolReturn } from '@domain/conversation/tool-outcome';
import type { IUserService } from '@domain/user/ports';

import { toToolMessage } from '@infra/ai/tools/outcome';

import { buildUpdateProfileTool } from '../update-profile.tool';

// StructuredTool has overloaded .invoke() signatures that TS cannot unify in tests.
// Cast to a simple callable shape to keep tests readable.
type InvokableTool = {
  invoke: (input: Record<string, unknown>, config?: RunnableConfig) => Promise<unknown>;
};

/** Renders a tool return exactly as the executor will (Task 5 contract). */
function renderedContent(ret: ToolReturn): string {
  return String(toToolMessage(isToolReturnWithUpdate(ret) ? ret.outcome : ret, 'test-id').content);
}

const UPDATED_USER = {
  id: 'u1',
  firstName: 'Test',
  profileStatus: 'complete' as const,
  age: 30,
  gender: 'male' as const,
  height: 182,
  weight: 85,
  fitnessLevel: 'advanced' as const,
  fitnessGoal: 'Lose fat',
};

const makeUserService = (): jest.Mocked<IUserService> =>
  ({
    getUser: jest.fn().mockResolvedValue(UPDATED_USER),
    updateProfileData: jest.fn().mockResolvedValue(UPDATED_USER),
    upsertUser: jest.fn(),
    isRegistrationComplete: jest.fn().mockReturnValue(true),
    needsRegistration: jest.fn().mockReturnValue(false),
  }) as unknown as jest.Mocked<IUserService>;

const makeConfig = (userId = 'u1'): RunnableConfig => ({
  configurable: { userId, thread_id: userId },
});

const buildTools = (userService: jest.Mocked<IUserService>): [InvokableTool] => [
  buildUpdateProfileTool({ userService }) as unknown as InvokableTool,
];

describe('update-profile.tool — update_profile', () => {
  it('returns a ToolOutcome, never a Command object', async () => {
    const [updateProfile] = buildTools(makeUserService());

    const result = (await updateProfile.invoke({ age: 30 }, makeConfig())) as ToolReturn;

    expect(result as object).not.toHaveProperty('lc_direct_tool_output');
  });

  it('calls updateProfileData with the provided fields', async () => {
    const userService = makeUserService();
    const [updateProfile] = buildTools(userService);

    await updateProfile.invoke({ age: 30, weight: 85 }, makeConfig());

    expect(userService.updateProfileData).toHaveBeenCalledWith(
      'u1',
      expect.objectContaining({
        age: 30,
        weight: 85,
      }),
    );
  });

  it('returns "Profile updated:" confirmation string', async () => {
    const [updateProfile] = buildTools(makeUserService());

    const result = (await updateProfile.invoke({ age: 30 }, makeConfig())) as ToolReturn;

    expect(renderedContent(result)).toContain('Profile updated:');
  });

  it('returns error string when userId is missing from configurable', async () => {
    const [updateProfile] = buildTools(makeUserService());

    const result = (await updateProfile.invoke({ age: 30 }, { configurable: {} })) as ToolReturn;

    expect(renderedContent(result)).toContain('Error: could not identify user');
  });

  it('returns error string when updateProfileData returns null', async () => {
    const userService = makeUserService();
    (userService.updateProfileData as jest.Mock).mockResolvedValue(null);
    const [updateProfile] = buildTools(userService);

    const result = (await updateProfile.invoke({ age: 30 }, makeConfig())) as ToolReturn;

    expect(renderedContent(result)).toContain('Failed to update profile');
  });

  it('carries no state update', async () => {
    const [updateProfile] = buildTools(makeUserService());

    const result = (await updateProfile.invoke({ age: 30 }, makeConfig())) as ToolReturn;

    expect(isToolReturnWithUpdate(result)).toBe(false);
  });
});
