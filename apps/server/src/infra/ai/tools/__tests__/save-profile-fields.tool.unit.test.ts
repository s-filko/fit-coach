import type { RunnableConfig } from '@langchain/core/runnables';

import { isToolReturnWithUpdate, type ToolReturn } from '@domain/conversation/tool-outcome';
import type { IUserService } from '@domain/user/ports';

import { toToolMessage } from '@infra/ai/tools/outcome';

import { buildSaveProfileFieldsTool } from '../save-profile-fields.tool';

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
  buildSaveProfileFieldsTool({ userService }) as unknown as InvokableTool,
];

describe('save-profile-fields.tool — save_profile_fields', () => {
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
