import { COMPLETE_PROFILE, EMPTY_PROFILE } from '../../fixtures/personas';
import { buildStubDeps } from '../build-stub-deps';

const NOW = new Date('2026-09-20T12:00:00Z');
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

  it('records transcript and summary writes into the stub world (P4 ports)', async () => {
    const { deps, transcriptRecords, summaryRecords } = buildStubDeps(COMPLETE_PROFILE);
    await deps.transcript.appendRunMessages({
      userId: 'u',
      runId: 'r',
      phase: 'chat',
      episodeId: 'e',
      messages: [{ kind: 'human', text: 'привет' }],
    });
    await deps.summaries.insert({
      userId: 'u',
      runId: 'r',
      episodeId: 'e',
      phaseAtEnd: 'chat',
      structured: { topics: [], decisions: [], userState: [], trainingFeedback: [], openItems: [], facts: [] },
      rendered: 'chat (today): .',
    });
    expect(transcriptRecords).toHaveLength(1);
    expect(summaryRecords).toHaveLength(1);
  });

  it('maps fixture facts onto UserFact rows for getForPrompt (P6 Task 6, AC-1361)', async () => {
    const { deps } = buildStubDeps({
      ...COMPLETE_PROFILE,
      facts: [
        { category: 'physical_constraint', fact: 'Травмировано правое плечо', muscleGroup: 'shoulders_front' },
        { category: 'exercise_preference', fact: 'Предпочитает гантели штангам' },
      ],
    });
    const facts = await deps.userFacts.getForPrompt('u', NOW);
    expect(facts.map(f => [f.category, f.fact, f.muscleGroup])).toEqual([
      ['physical_constraint', 'Травмировано правое плечо', 'shoulders_front'],
      ['exercise_preference', 'Предпочитает гантели штангам', null],
    ]);
    expect(facts.every(f => f.id && f.userId && f.factKey && f.confirmations >= 1)).toBe(true);
  });

  it('getConstraints returns only physical_constraint facts with a muscle group (real port semantics)', async () => {
    const { deps } = buildStubDeps({
      ...COMPLETE_PROFILE,
      facts: [
        { category: 'physical_constraint', fact: 'Боль в колене', muscleGroup: 'quads' },
        { category: 'physical_constraint', fact: 'Общее ограничение без группы' },
        { category: 'exercise_preference', fact: 'Предпочитает гантели штангам', muscleGroup: 'biceps' },
      ],
    });
    const constraints = await deps.userFacts.getConstraints('u', NOW);
    expect(constraints.map(f => f.fact)).toEqual(['Боль в колене']);
  });

  it('returns no facts for facts-free fixtures — nothing moves for existing datasets', async () => {
    const { deps } = buildStubDeps(COMPLETE_PROFILE);
    expect(await deps.userFacts.getForPrompt('u', NOW)).toEqual([]);
    expect(await deps.userFacts.getConstraints('u', NOW)).toEqual([]);
  });
});
