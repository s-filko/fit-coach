import { buildStubDeps } from '../build-stub-deps';
import { COMPLETE_PROFILE, EMPTY_PROFILE } from '../../fixtures/personas';

describe('buildStubDeps', () => {
  it('returns a user matching the fixture', async () => {
    const { deps } = buildStubDeps(COMPLETE_PROFILE);
    const user = await deps.userService.getUser('any-id');
    expect(user?.fitnessGoal).toBe('strength');
    expect(user?.languageCode).toBe('ru');
  });

  it('reports an active plan only when the fixture says so', async () => {
    const withPlan = buildStubDeps(COMPLETE_PROFILE);
    const withoutPlan = buildStubDeps(EMPTY_PROFILE);
    expect(await withPlan.deps.workoutPlanRepo.findActiveByUserId('u')).not.toBeNull();
    expect(await withoutPlan.deps.workoutPlanRepo.findActiveByUserId('u')).toBeNull();
  });

  it('answers getSessionDetails so the training router does not throw', async () => {
    const { deps } = buildStubDeps(COMPLETE_PROFILE);
    await expect(deps.trainingService.getSessionDetails('s1')).resolves.toBeDefined();
  });

  it('collects run records instead of writing them', async () => {
    const world = buildStubDeps(COMPLETE_PROFILE);
    await world.deps.runService.recordRun({
      runId: 'r1',
      userId: 'u1',
      phaseIn: 'chat',
      phaseOut: null,
      model: 'm',
      promptVersions: {},
      tokensIn: 1,
      tokensOut: 1,
      latencyMs: 1,
      toolCalls: null,
      transition: null,
      outcome: 'ok',
    });
    expect(world.recordedRuns).toHaveLength(1);
  });

  it('persists no conversation turns', async () => {
    const { deps } = buildStubDeps(COMPLETE_PROFILE);
    await expect(deps.contextService.appendTurn('u', 'chat', 'a', 'b')).resolves.toBeUndefined();
    expect(await deps.contextService.getMessagesForPrompt('u', 'chat')).toEqual([]);
  });
});
