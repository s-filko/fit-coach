import type { RunnableConfig } from '@langchain/core/runnables';

import type { TransitionRequest } from '@domain/conversation/graph/conversation.state';
import type { IUserService } from '@domain/user/ports';

import { buildRegistrationTools } from '../registration.tools';

// StructuredTool has overloaded .invoke() signatures that TS cannot unify in tests.
// Cast to a simple callable shape to keep tests readable.
type InvokableTool = {
  invoke: (input: Record<string, unknown>, config?: RunnableConfig) => Promise<unknown>;
};

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

const makeUserService = (userOverrides: Partial<typeof FULL_USER> = {}): jest.Mocked<IUserService> => ({
  getUser: jest.fn().mockResolvedValue({ ...FULL_USER, ...userOverrides }),
  updateProfileData: jest.fn().mockResolvedValue({ ...FULL_USER, ...userOverrides }),
  upsertUser: jest.fn(),
  isRegistrationComplete: jest.fn().mockReturnValue(false),
  needsRegistration: jest.fn().mockReturnValue(true),
} as unknown as jest.Mocked<IUserService>);

const makePendingTransition = (): { value: TransitionRequest | null } => ({ value: null });

/** RunnableConfig with userId in configurable — matches what agentNode passes to model.invoke */
const makeConfig = (userId = 'u1'): RunnableConfig => ({
  configurable: { userId, thread_id: userId },
});

const buildTools = (
  userService: jest.Mocked<IUserService>,
  pendingTransition: { value: TransitionRequest | null },
): [InvokableTool, InvokableTool] =>
  buildRegistrationTools({ userService, pendingTransition }) as unknown as [InvokableTool, InvokableTool];

describe('registration.tools — save_profile_fields', () => {
  it('returns a plain string, never a Command object', async () => {
    const [saveProfileFields] = buildTools(makeUserService(), makePendingTransition());

    const result = await saveProfileFields.invoke({ age: 28, gender: 'male' }, makeConfig());

    expect(typeof result).toBe('string');
    // Command objects have this sentinel field — ensure it is absent
    expect(result as object).not.toHaveProperty('lc_direct_tool_output');
  });

  it('calls updateProfileData with validated fields', async () => {
    const userService = makeUserService();
    const [saveProfileFields] = buildTools(userService, makePendingTransition());

    await saveProfileFields.invoke({ age: 28, gender: 'male', height: 180 }, makeConfig());

    expect(userService.updateProfileData).toHaveBeenCalledWith('u1', expect.objectContaining({
      age: 28,
      gender: 'male',
      height: 180,
    }));
  });

  it('returns "Saved:" confirmation with field names', async () => {
    const [saveProfileFields] = buildTools(makeUserService(), makePendingTransition());

    const result = await saveProfileFields.invoke({ age: 28 }, makeConfig());

    expect(result as string).toContain('Saved:');
  });

  it('returns error string when userId is missing from configurable', async () => {
    const [saveProfileFields] = buildTools(makeUserService(), makePendingTransition());

    const result = await saveProfileFields.invoke({ age: 28 }, { configurable: {} });

    expect(result as string).toContain('Error: could not identify user');
  });

  it('returns "No valid fields" when input is empty', async () => {
    const [saveProfileFields] = buildTools(makeUserService(), makePendingTransition());

    const result = await saveProfileFields.invoke({}, makeConfig());

    expect(result as string).toContain('No valid fields to save');
  });

  it('does NOT touch pendingTransition', async () => {
    const pendingTransition = makePendingTransition();
    const [saveProfileFields] = buildTools(makeUserService(), pendingTransition);

    await saveProfileFields.invoke({ age: 28 }, makeConfig());

    expect(pendingTransition.value).toBeNull();
  });

  it('saves firstName when explicitly provided', async () => {
    const userService = makeUserService();
    const [saveProfileFields] = buildTools(userService, makePendingTransition());

    await saveProfileFields.invoke({ firstName: 'Alex' }, makeConfig());

    expect(userService.updateProfileData).toHaveBeenCalledWith('u1', expect.objectContaining({
      firstName: 'Alex',
    }));
  });
});

describe('registration.tools — complete_registration', () => {
  it('returns a plain string, never a Command object', async () => {
    const [, completeRegistration] = buildTools(makeUserService(), makePendingTransition());

    const result = await completeRegistration.invoke({ toPhase: 'chat' }, makeConfig());

    expect(typeof result).toBe('string');
    expect(result as object).not.toHaveProperty('lc_direct_tool_output');
  });

  it('sets pendingTransition.value with correct toPhase when all fields present', async () => {
    const pendingTransition = makePendingTransition();
    const [, completeRegistration] = buildTools(makeUserService(), pendingTransition);

    await completeRegistration.invoke({ toPhase: 'plan_creation' }, makeConfig());

    expect(pendingTransition.value).not.toBeNull();
    expect(pendingTransition.value?.toPhase).toBe('plan_creation');
    expect(pendingTransition.value?.reason).toBe('registration_complete');
  });

  it('returns success string and marks profileStatus complete', async () => {
    const userService = makeUserService();
    const [, completeRegistration] = buildTools(userService, makePendingTransition());

    const result = await completeRegistration.invoke({ toPhase: 'chat' }, makeConfig());

    expect(result as string).toContain('Registration complete');
    expect(userService.updateProfileData).toHaveBeenCalledWith('u1', { profileStatus: 'complete' });
  });

  it('blocks completion and lists missing fields when profile is incomplete', async () => {
    const userService = makeUserService({ fitnessGoal: undefined, weight: undefined });
    (userService.getUser as jest.Mock).mockResolvedValue({ ...FULL_USER, fitnessGoal: null, weight: null });
    const pendingTransition = makePendingTransition();
    const [, completeRegistration] = buildTools(userService, pendingTransition);

    const result = await completeRegistration.invoke({ toPhase: 'chat' }, makeConfig());

    expect(result as string).toContain('Cannot complete registration');
    expect(result as string).toContain('missing');
    expect(pendingTransition.value).toBeNull();
    expect(userService.updateProfileData).not.toHaveBeenCalled();
  });

  it('returns error string when userId is missing from configurable', async () => {
    const pendingTransition = makePendingTransition();
    const [, completeRegistration] = buildTools(makeUserService(), pendingTransition);

    const result = await completeRegistration.invoke({ toPhase: 'chat' }, { configurable: {} });

    expect(result as string).toContain('Error: could not identify user');
    expect(pendingTransition.value).toBeNull();
  });

  it('returns error string when user not found in DB', async () => {
    const userService = makeUserService();
    (userService.getUser as jest.Mock).mockResolvedValue(null);
    const pendingTransition = makePendingTransition();
    const [, completeRegistration] = buildTools(userService, pendingTransition);

    const result = await completeRegistration.invoke({ toPhase: 'chat' }, makeConfig());

    expect(result as string).toContain('Error: user not found');
    expect(pendingTransition.value).toBeNull();
  });
});
