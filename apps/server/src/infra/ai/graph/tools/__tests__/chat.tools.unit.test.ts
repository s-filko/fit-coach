import type { RunnableConfig } from '@langchain/core/runnables';

import type { TransitionRequest } from '@domain/conversation/graph/conversation.state';
import type { IUserService } from '@domain/user/ports';

import { buildChatTools } from '../chat.tools';

// StructuredTool has overloaded .invoke() signatures that TS cannot unify in tests.
// Cast to a simple callable shape to keep tests readable.
type InvokableTool = {
  invoke: (input: Record<string, unknown>, config?: RunnableConfig) => Promise<unknown>;
};

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

const makePendingTransitions = (): Map<string, TransitionRequest | null> => new Map();

const makeConfig = (userId = 'u1'): RunnableConfig => ({
  configurable: { userId, thread_id: userId },
});

const buildTools = (
  userService: jest.Mocked<IUserService>,
  pendingTransitions: Map<string, TransitionRequest | null>,
): [InvokableTool, InvokableTool] =>
  buildChatTools({ userService, pendingTransitions }) as unknown as [InvokableTool, InvokableTool];

describe('chat.tools — update_profile', () => {
  it('returns a plain string, never a Command object', async () => {
    const [updateProfile] = buildTools(makeUserService(), makePendingTransitions());

    const result = await updateProfile.invoke({ age: 30 }, makeConfig());

    expect(typeof result).toBe('string');
    expect(result as object).not.toHaveProperty('lc_direct_tool_output');
  });

  it('calls updateProfileData with the provided fields', async () => {
    const userService = makeUserService();
    const [updateProfile] = buildTools(userService, makePendingTransitions());

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
    const [updateProfile] = buildTools(makeUserService(), makePendingTransitions());

    const result = await updateProfile.invoke({ age: 30 }, makeConfig());

    expect(result as string).toContain('Profile updated:');
  });

  it('returns error string when userId is missing from configurable', async () => {
    const [updateProfile] = buildTools(makeUserService(), makePendingTransitions());

    const result = await updateProfile.invoke({ age: 30 }, { configurable: {} });

    expect(result as string).toContain('Error: could not identify user');
  });

  it('returns error string when updateProfileData returns null', async () => {
    const userService = makeUserService();
    (userService.updateProfileData as jest.Mock).mockResolvedValue(null);
    const [updateProfile] = buildTools(userService, makePendingTransitions());

    const result = await updateProfile.invoke({ age: 30 }, makeConfig());

    expect(result as string).toContain('Failed to update profile');
  });

  it('does NOT touch pendingTransitions', async () => {
    const pendingTransitions = makePendingTransitions();
    const [updateProfile] = buildTools(makeUserService(), pendingTransitions);

    await updateProfile.invoke({ age: 30 }, makeConfig());

    expect(pendingTransitions.size).toBe(0);
  });
});

describe('chat.tools — request_transition', () => {
  it('returns a plain string, never a Command object', async () => {
    const [, requestTransition] = buildTools(makeUserService(), makePendingTransitions());

    const result = await requestTransition.invoke({ toPhase: 'plan_creation' }, makeConfig());

    expect(typeof result).toBe('string');
    expect(result as object).not.toHaveProperty('lc_direct_tool_output');
  });

  it('sets pendingTransitions entry for userId with correct toPhase', async () => {
    const pendingTransitions = makePendingTransitions();
    const [, requestTransition] = buildTools(makeUserService(), pendingTransitions);

    await requestTransition.invoke({ toPhase: 'plan_creation' }, makeConfig('u1'));

    expect(pendingTransitions.get('u1')).not.toBeNull();
    expect(pendingTransitions.get('u1')?.toPhase).toBe('plan_creation');
  });

  it('sets pendingTransitions entry with optional reason', async () => {
    const pendingTransitions = makePendingTransitions();
    const [, requestTransition] = buildTools(makeUserService(), pendingTransitions);

    await requestTransition.invoke({ toPhase: 'session_planning', reason: 'user wants workout' }, makeConfig('u1'));

    expect(pendingTransitions.get('u1')?.reason).toBe('user wants workout');
  });

  it('returns confirmation string mentioning the target phase', async () => {
    const [, requestTransition] = buildTools(makeUserService(), makePendingTransitions());

    const result = await requestTransition.invoke({ toPhase: 'session_planning' }, makeConfig());

    expect(result as string).toContain('session_planning');
  });

  it('does NOT call userService', async () => {
    const userService = makeUserService();
    const [, requestTransition] = buildTools(userService, makePendingTransitions());

    await requestTransition.invoke({ toPhase: 'plan_creation' }, makeConfig());

    expect(userService.updateProfileData).not.toHaveBeenCalled();
    expect(userService.getUser).not.toHaveBeenCalled();
  });

  it('isolates entries by userId — two users do not overwrite each other', async () => {
    const pendingTransitions = makePendingTransitions();
    const [, requestTransition] = buildTools(makeUserService(), pendingTransitions);

    await requestTransition.invoke({ toPhase: 'plan_creation' }, makeConfig('userA'));
    await requestTransition.invoke({ toPhase: 'session_planning' }, makeConfig('userB'));

    expect(pendingTransitions.get('userA')?.toPhase).toBe('plan_creation');
    expect(pendingTransitions.get('userB')?.toPhase).toBe('session_planning');
  });
});
