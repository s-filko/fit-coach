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

const makeUserService = (userOverrides: Partial<typeof FULL_USER> = {}): jest.Mocked<IUserService> =>
  ({
    getUser: jest.fn().mockResolvedValue({ ...FULL_USER, ...userOverrides }),
    updateProfileData: jest.fn().mockResolvedValue({ ...FULL_USER, ...userOverrides }),
    upsertUser: jest.fn(),
    isRegistrationComplete: jest.fn().mockReturnValue(false),
    needsRegistration: jest.fn().mockReturnValue(true),
  }) as unknown as jest.Mocked<IUserService>;

const makePendingTransitions = (): Map<string, TransitionRequest | null> => new Map();

/** RunnableConfig with userId in configurable — matches what agentNode passes to model.invoke */
const makeConfig = (userId = 'u1'): RunnableConfig => ({
  configurable: { userId, thread_id: userId },
});

const buildTools = (
  userService: jest.Mocked<IUserService>,
  pendingTransitions: Map<string, TransitionRequest | null>,
): [InvokableTool, InvokableTool] =>
  buildRegistrationTools({ userService, pendingTransitions }) as unknown as [InvokableTool, InvokableTool];

describe('registration.tools — save_profile_fields', () => {
  it('returns a plain string, never a Command object', async () => {
    const [saveProfileFields] = buildTools(makeUserService(), makePendingTransitions());

    const result = await saveProfileFields.invoke({ age: 28, gender: 'male' }, makeConfig());

    expect(typeof result).toBe('string');
    // Command objects have this sentinel field — ensure it is absent
    expect(result as object).not.toHaveProperty('lc_direct_tool_output');
  });

  it('calls updateProfileData with validated fields', async () => {
    const userService = makeUserService();
    const [saveProfileFields] = buildTools(userService, makePendingTransitions());

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
    const [saveProfileFields] = buildTools(makeUserService(), makePendingTransitions());

    const result = await saveProfileFields.invoke({ age: 28 }, makeConfig());

    expect(result as string).toContain('Saved:');
  });

  it('returns error string when userId is missing from configurable', async () => {
    const [saveProfileFields] = buildTools(makeUserService(), makePendingTransitions());

    const result = await saveProfileFields.invoke({ age: 28 }, { configurable: {} });

    expect(result as string).toContain('Error: could not identify user');
  });

  it('returns "No valid fields" when input is empty', async () => {
    const [saveProfileFields] = buildTools(makeUserService(), makePendingTransitions());

    const result = await saveProfileFields.invoke({}, makeConfig());

    expect(result as string).toContain('No valid fields to save');
  });

  it('does NOT touch pendingTransitions', async () => {
    const pendingTransitions = makePendingTransitions();
    const [saveProfileFields] = buildTools(makeUserService(), pendingTransitions);

    await saveProfileFields.invoke({ age: 28 }, makeConfig());

    expect(pendingTransitions.size).toBe(0);
  });

  it('saves firstName when explicitly provided', async () => {
    const userService = makeUserService();
    const [saveProfileFields] = buildTools(userService, makePendingTransitions());

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
  it('returns a plain string, never a Command object', async () => {
    const [, completeRegistration] = buildTools(makeUserService(), makePendingTransitions());

    const result = await completeRegistration.invoke({ toPhase: 'chat' }, makeConfig());

    expect(typeof result).toBe('string');
    expect(result as object).not.toHaveProperty('lc_direct_tool_output');
  });

  it('sets pendingTransitions entry with correct toPhase when all fields present', async () => {
    const pendingTransitions = makePendingTransitions();
    const [, completeRegistration] = buildTools(makeUserService(), pendingTransitions);

    await completeRegistration.invoke({ toPhase: 'plan_creation' }, makeConfig('u1'));

    expect(pendingTransitions.get('u1')).not.toBeNull();
    expect(pendingTransitions.get('u1')?.toPhase).toBe('plan_creation');
    expect(pendingTransitions.get('u1')?.reason).toBe('registration_complete');
  });

  it('returns success string and marks profileStatus complete', async () => {
    const userService = makeUserService();
    const [, completeRegistration] = buildTools(userService, makePendingTransitions());

    const result = await completeRegistration.invoke({ toPhase: 'chat' }, makeConfig());

    expect(result as string).toContain('Registration complete');
    expect(userService.updateProfileData).toHaveBeenCalledWith('u1', { profileStatus: 'complete' });
  });

  it('blocks completion and lists missing fields when profile is incomplete', async () => {
    const userService = makeUserService({ fitnessGoal: undefined, weight: undefined });
    (userService.getUser as jest.Mock).mockResolvedValue({ ...FULL_USER, fitnessGoal: null, weight: null });
    const pendingTransitions = makePendingTransitions();
    const [, completeRegistration] = buildTools(userService, pendingTransitions);

    const result = await completeRegistration.invoke({ toPhase: 'chat' }, makeConfig());

    expect(result as string).toContain('Cannot complete registration');
    expect(result as string).toContain('missing');
    expect(pendingTransitions.size).toBe(0);
    expect(userService.updateProfileData).not.toHaveBeenCalled();
  });

  it('returns error string when userId is missing from configurable', async () => {
    const pendingTransitions = makePendingTransitions();
    const [, completeRegistration] = buildTools(makeUserService(), pendingTransitions);

    const result = await completeRegistration.invoke({ toPhase: 'chat' }, { configurable: {} });

    expect(result as string).toContain('Error: could not identify user');
    expect(pendingTransitions.size).toBe(0);
  });

  it('returns error string when user not found in DB', async () => {
    const userService = makeUserService();
    (userService.getUser as jest.Mock).mockResolvedValue(null);
    const pendingTransitions = makePendingTransitions();
    const [, completeRegistration] = buildTools(userService, pendingTransitions);

    const result = await completeRegistration.invoke({ toPhase: 'chat' }, makeConfig());

    expect(result as string).toContain('Error: user not found');
    expect(pendingTransitions.size).toBe(0);
  });
});
