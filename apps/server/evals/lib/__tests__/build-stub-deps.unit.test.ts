import { COMPLETE_PROFILE, EMPTY_PROFILE } from '../../fixtures/personas';
import { buildStubDeps } from '../build-stub-deps';

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
      trigger: 'user_message' as const,
      client: 'telegram' as const,
      model: 'm',
      promptVersions: {},
      tokensIn: 1,
      tokensOut: 1,
      latencyMs: 1,
      toolCalls: null,
      transition: null,
      outcome: 'ok',
      budgetReport: null,
    });
    expect(world.recordedRuns).toHaveLength(1);
  });

  it('seeds case state.messages as the episode memory the prompt reads', async () => {
    const { deps } = buildStubDeps(EMPTY_PROFILE, [
      { role: 'human', text: 'сделал 80 на 8' },
      { role: 'ai', text: 'Принято!' },
      // tool_call/tool_result seeds are still skipped pre-P4 (Task 7 moves
      // seeding into the messages channel) — not thrown on
      { role: 'tool_call', name: 'log_set', args: { weight: 80, reps: 8 } },
      { role: 'tool_result', text: 'ok', status: 'ok' },
    ]);
    await expect(deps.contextService.getMessagesForPrompt('u', 'chat')).resolves.toEqual([
      { role: 'user', content: 'сделал 80 на 8' },
      { role: 'assistant', content: 'Принято!' },
    ]);
  });

  it('persists no conversation turns', async () => {
    const { deps } = buildStubDeps(COMPLETE_PROFILE);
    await expect(deps.contextService.appendTurn('u', 'chat', 'a', 'b')).resolves.toBeUndefined();
    expect(await deps.contextService.getMessagesForPrompt('u', 'chat')).toEqual([]);
  });
});
