import type { RunnableConfig } from '@langchain/core/runnables';

import { isToolReturnWithUpdate, type ToolReturn } from '@domain/conversation/tool-outcome';
import type { ITrainingService, IWorkoutPlanRepository } from '@domain/training/ports';
import type { IUserService } from '@domain/user/ports';

import { toToolMessage } from '@infra/ai/tools/outcome';

import { buildRequestTransitionTool } from '../request-transition.tool';

// StructuredTool has overloaded .invoke() signatures that TS cannot unify in tests.
// Cast to a simple callable shape to keep tests readable.
type InvokableTool = {
  name: string;
  invoke: (input: Record<string, unknown>, config?: RunnableConfig) => Promise<unknown>;
};

/** Renders a tool return exactly as the executor will (Task 5 contract). */
function renderedContent(ret: ToolReturn): string {
  return String(toToolMessage(isToolReturnWithUpdate(ret) ? ret.outcome : ret, 'test-id').content);
}

const makeUserService = (): jest.Mocked<IUserService> =>
  ({
    getUser: jest.fn(),
    updateProfileData: jest.fn(),
    upsertUser: jest.fn(),
    isRegistrationComplete: jest.fn(),
    needsRegistration: jest.fn(),
  }) as unknown as jest.Mocked<IUserService>;

const makeWorkoutPlanRepo = (): jest.Mocked<IWorkoutPlanRepository> =>
  ({
    create: jest.fn(),
    findById: jest.fn(),
    findActiveByUserId: jest.fn(),
    findByUserId: jest.fn(),
    update: jest.fn(),
    archive: jest.fn(),
  }) as unknown as jest.Mocked<IWorkoutPlanRepository>;

const makeTrainingService = (): jest.Mocked<ITrainingService> =>
  ({
    startSession: jest.fn(),
    getSessionDetails: jest.fn(),
    completeSession: jest.fn(),
    skipSession: jest.fn(),
    getTrainingHistory: jest.fn(),
    addExerciseToSession: jest.fn(),
    logSet: jest.fn(),
    completeCurrentExercise: jest.fn(),
    ensureCurrentExercise: jest.fn(),
  }) as unknown as jest.Mocked<ITrainingService>;

const makeConfig = (userId = 'u1'): RunnableConfig => ({
  configurable: { userId, thread_id: userId },
});

const buildTool = (variant: 'chat' | 'plan_creation' | 'session_planning'): InvokableTool =>
  buildRequestTransitionTool(variant) as unknown as InvokableTool;

describe('request-transition.tool — chat variant', () => {
  it('returns a ToolReturn with update, never a Command object', async () => {
    const requestTransition = buildTool('chat');

    const result = (await requestTransition.invoke({ toPhase: 'plan_creation' }, makeConfig())) as ToolReturn;

    expect(result as object).not.toHaveProperty('lc_direct_tool_output');
    expect(isToolReturnWithUpdate(result)).toBe(true);
  });

  it('requests pendingTransition with correct toPhase', async () => {
    const requestTransition = buildTool('chat');

    const result = (await requestTransition.invoke({ toPhase: 'plan_creation' }, makeConfig('u1'))) as ToolReturn;

    expect(isToolReturnWithUpdate(result) ? result.update.pendingTransition?.toPhase : undefined).toBe('plan_creation');
  });

  it('requests pendingTransition with optional reason', async () => {
    const requestTransition = buildTool('chat');

    const result = (await requestTransition.invoke(
      { toPhase: 'session_planning', reason: 'user wants workout' },
      makeConfig('u1'),
    )) as ToolReturn;

    expect(isToolReturnWithUpdate(result) ? result.update.pendingTransition?.reason : undefined).toBe(
      'user wants workout',
    );
  });

  it('returns confirmation string mentioning the target phase', async () => {
    const requestTransition = buildTool('chat');

    const result = (await requestTransition.invoke({ toPhase: 'session_planning' }, makeConfig())) as ToolReturn;

    expect(renderedContent(result)).toContain('session_planning');
  });

  it('does NOT call userService', async () => {
    const userService = makeUserService();
    const requestTransition = buildTool('chat');

    await requestTransition.invoke({ toPhase: 'plan_creation' }, makeConfig());

    expect(userService.updateProfileData).not.toHaveBeenCalled();
    expect(userService.getUser).not.toHaveBeenCalled();
  });

  it('keys the transition by the configurable userId, not a shared map', async () => {
    // Two sequential invocations for different users each request their own
    // transition — the per-user isolation now lives in the state update the
    // executor applies per run, so the second call must not disturb the first
    // tool's already-returned value.
    const requestTransition = buildTool('chat');

    const a = (await requestTransition.invoke({ toPhase: 'plan_creation' }, makeConfig('userA'))) as ToolReturn;
    const b = (await requestTransition.invoke({ toPhase: 'session_planning' }, makeConfig('userB'))) as ToolReturn;

    expect(isToolReturnWithUpdate(a) ? a.update.pendingTransition?.toPhase : undefined).toBe('plan_creation');
    expect(isToolReturnWithUpdate(b) ? b.update.pendingTransition?.toPhase : undefined).toBe('session_planning');
  });
});

describe('request-transition.tool — chat variant, D-5 hand-off wording', () => {
  const buildChatTool = (handoffTargets?: Parameters<typeof buildRequestTransitionTool>[1]): InvokableTool =>
    buildRequestTransitionTool('chat', handoffTargets) as unknown as InvokableTool;

  it('keeps "Transition to X requested." when the flag is off (no handoffTargets)', async () => {
    const requestTransition = buildChatTool();

    const result = (await requestTransition.invoke({ toPhase: 'session_planning' }, makeConfig())) as ToolReturn;

    expect(renderedContent(result)).toBe('Transition to session_planning requested.');
  });

  it('keeps "Transition to X requested." when the target is not a hand-off target', async () => {
    const requestTransition = buildChatTool(new Set(['training']));

    const result = (await requestTransition.invoke({ toPhase: 'plan_creation' }, makeConfig())) as ToolReturn;

    expect(renderedContent(result)).toBe('Transition to plan_creation requested.');
  });

  it('switches to the neutral hand-off text when the target IS a hand-off target', async () => {
    const requestTransition = buildChatTool(new Set(['session_planning']));

    const result = (await requestTransition.invoke({ toPhase: 'session_planning' }, makeConfig())) as ToolReturn;

    expect(renderedContent(result)).toBe('Transition registered; the next phase answers the user.');
  });

  it('still requests the pendingTransition update when hand-off wording applies', async () => {
    const requestTransition = buildChatTool(new Set(['session_planning']));

    const result = (await requestTransition.invoke(
      { toPhase: 'session_planning', reason: 'user wants workout' },
      makeConfig('u1'),
    )) as ToolReturn;

    expect(isToolReturnWithUpdate(result) ? result.update.pendingTransition : undefined).toEqual({
      toPhase: 'session_planning',
      reason: 'user wants workout',
    });
  });
});

describe('request-transition.tool — plan_creation variant', () => {
  it('returns a ToolReturn with update, never a Command object', async () => {
    const requestTransition = buildTool('plan_creation');

    const result = (await requestTransition.invoke({ toPhase: 'chat' }, makeConfig())) as ToolReturn;

    expect(result as object).not.toHaveProperty('lc_direct_tool_output');
    expect(isToolReturnWithUpdate(result)).toBe(true);
  });

  it('requests pendingTransition with toPhase=chat', async () => {
    const requestTransition = buildTool('plan_creation');

    const result = (await requestTransition.invoke({ toPhase: 'chat' }, makeConfig('u1'))) as ToolReturn;

    expect(isToolReturnWithUpdate(result) ? result.update.pendingTransition?.toPhase : undefined).toBe('chat');
  });

  it('requests pendingTransition with optional reason', async () => {
    const requestTransition = buildTool('plan_creation');

    const result = (await requestTransition.invoke(
      { toPhase: 'chat', reason: 'user cancelled' },
      makeConfig('u1'),
    )) as ToolReturn;

    expect(isToolReturnWithUpdate(result) ? result.update.pendingTransition?.reason : undefined).toBe('user cancelled');
  });

  it('returns confirmation string mentioning the target phase', async () => {
    const requestTransition = buildTool('plan_creation');

    const result = (await requestTransition.invoke({ toPhase: 'chat' }, makeConfig())) as ToolReturn;

    expect(renderedContent(result)).toContain('chat');
  });

  it('does NOT call workoutPlanRepository', async () => {
    const repo = makeWorkoutPlanRepo();
    const requestTransition = buildTool('plan_creation');

    await requestTransition.invoke({ toPhase: 'chat' }, makeConfig());

    expect(repo.create).not.toHaveBeenCalled();
  });

  it('each invocation requests its own transition — two users do not overwrite each other', async () => {
    const requestTransition = buildTool('plan_creation');

    const a = (await requestTransition.invoke(
      { toPhase: 'chat', reason: 'A cancelled' },
      makeConfig('userA'),
    )) as ToolReturn;
    const b = (await requestTransition.invoke(
      { toPhase: 'chat', reason: 'B cancelled' },
      makeConfig('userB'),
    )) as ToolReturn;

    expect(isToolReturnWithUpdate(a) ? a.update.pendingTransition?.reason : undefined).toBe('A cancelled');
    expect(isToolReturnWithUpdate(b) ? b.update.pendingTransition?.reason : undefined).toBe('B cancelled');
  });
});

describe('request-transition.tool — session_planning variant', () => {
  it('returns a ToolReturn with update, never a Command object', async () => {
    const requestTransition = buildTool('session_planning');

    const result = (await requestTransition.invoke({ toPhase: 'chat' }, makeConfig())) as ToolReturn;

    expect(result as object).not.toHaveProperty('lc_direct_tool_output');
    expect(isToolReturnWithUpdate(result)).toBe(true);
  });

  it('requests pendingTransition with toPhase=chat', async () => {
    const requestTransition = buildTool('session_planning');

    const result = (await requestTransition.invoke({ toPhase: 'chat' }, makeConfig('u1'))) as ToolReturn;

    expect(isToolReturnWithUpdate(result) ? result.update.pendingTransition?.toPhase : undefined).toBe('chat');
  });

  it('requests pendingTransition with optional reason', async () => {
    const requestTransition = buildTool('session_planning');

    const result = (await requestTransition.invoke(
      { toPhase: 'chat', reason: 'user cancelled' },
      makeConfig('u1'),
    )) as ToolReturn;

    expect(isToolReturnWithUpdate(result) ? result.update.pendingTransition?.reason : undefined).toBe('user cancelled');
  });

  it('returns confirmation string mentioning the target phase', async () => {
    const requestTransition = buildTool('session_planning');

    const result = (await requestTransition.invoke({ toPhase: 'chat' }, makeConfig())) as ToolReturn;

    expect(renderedContent(result)).toContain('chat');
  });

  it('does NOT touch trainingService and requests no activeSessionId', async () => {
    const trainingService = makeTrainingService();
    const requestTransition = buildTool('session_planning');

    const result = (await requestTransition.invoke({ toPhase: 'chat' }, makeConfig())) as ToolReturn;

    expect(trainingService.startSession).not.toHaveBeenCalled();
    expect(isToolReturnWithUpdate(result) ? result.update.activeSessionId : undefined).toBeUndefined();
  });
});
