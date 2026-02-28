import type { RunnableConfig } from '@langchain/core/runnables';

import type { TransitionRequest } from '@domain/conversation/graph/conversation.state';
import type { IWorkoutPlanRepository } from '@domain/training/ports';

import { buildPlanCreationTools } from '../plan-creation.tools';

// StructuredTool has overloaded .invoke() signatures that TS cannot unify in tests.
type InvokableTool = {
  invoke: (input: Record<string, unknown>, config?: RunnableConfig) => Promise<unknown>;
};

const MINIMAL_PLAN = {
  name: 'Upper-Lower Split',
  goal: 'Build muscle',
  trainingStyle: 'Upper-Lower',
  targetMuscleGroups: ['chest', 'back_lats'],
  recoveryGuidelines: {
    majorMuscleGroups: { minRestDays: 2, maxRestDays: 3 },
    smallMuscleGroups: { minRestDays: 1, maxRestDays: 2 },
    highIntensity: { minRestDays: 2 },
    customRules: ['Always warm up'],
  },
  sessionTemplates: [
    {
      key: 'upper_a',
      name: 'Upper A',
      focus: 'Push: chest, shoulders, triceps',
      energyCost: 'high',
      estimatedDuration: 60,
      exercises: [
        {
          exerciseId: 1,
          exerciseName: 'Bench Press',
          energyCost: 'high',
          targetSets: 4,
          targetReps: '8-10',
          restSeconds: 90,
          estimatedDuration: 12,
        },
      ],
    },
    {
      key: 'lower_a',
      name: 'Lower A',
      focus: 'Quads and glutes',
      energyCost: 'high',
      estimatedDuration: 55,
      exercises: [
        {
          exerciseId: 2,
          exerciseName: 'Squat',
          energyCost: 'very_high',
          targetSets: 4,
          targetReps: '5-6',
          restSeconds: 120,
          estimatedDuration: 15,
        },
      ],
    },
  ],
  progressionRules: ['Increase weight by 2.5kg when you hit the top of the rep range for all sets'],
};

const makeWorkoutPlanRepo = (): jest.Mocked<IWorkoutPlanRepository> => ({
  create: jest.fn().mockResolvedValue({ id: 'plan-1', ...MINIMAL_PLAN }),
  findById: jest.fn(),
  findActiveByUserId: jest.fn(),
  findByUserId: jest.fn(),
  update: jest.fn(),
  archive: jest.fn(),
} as unknown as jest.Mocked<IWorkoutPlanRepository>);

const makePendingTransitions = (): Map<string, TransitionRequest | null> => new Map();

const makeConfig = (userId = 'u1'): RunnableConfig => ({
  configurable: { userId, thread_id: userId },
});

const buildTools = (
  workoutPlanRepository: jest.Mocked<IWorkoutPlanRepository>,
  pendingTransitions: Map<string, TransitionRequest | null>,
): [InvokableTool, InvokableTool] =>
  buildPlanCreationTools({ workoutPlanRepository, pendingTransitions }) as unknown as [InvokableTool, InvokableTool];

describe('plan-creation.tools — save_workout_plan', () => {
  it('returns a plain string, never a Command object', async () => {
    const [saveWorkoutPlan] = buildTools(makeWorkoutPlanRepo(), makePendingTransitions());

    const result = await saveWorkoutPlan.invoke(MINIMAL_PLAN, makeConfig());

    expect(typeof result).toBe('string');
    expect(result as object).not.toHaveProperty('lc_direct_tool_output');
  });

  it('calls workoutPlanRepository.create with correct userId and plan data', async () => {
    const repo = makeWorkoutPlanRepo();
    const [saveWorkoutPlan] = buildTools(repo, makePendingTransitions());

    await saveWorkoutPlan.invoke(MINIMAL_PLAN, makeConfig('u1'));

    expect(repo.create).toHaveBeenCalledWith('u1', expect.objectContaining({
      name: MINIMAL_PLAN.name,
      status: 'active',
      planJson: expect.objectContaining({
        goal: MINIMAL_PLAN.goal,
        trainingStyle: MINIMAL_PLAN.trainingStyle,
      }),
    }));
  });

  it('sets pendingTransitions entry for userId to chat after saving the plan', async () => {
    const pendingTransitions = makePendingTransitions();
    const [saveWorkoutPlan] = buildTools(makeWorkoutPlanRepo(), pendingTransitions);

    await saveWorkoutPlan.invoke(MINIMAL_PLAN, makeConfig('u1'));

    expect(pendingTransitions.get('u1')).not.toBeNull();
    expect(pendingTransitions.get('u1')?.toPhase).toBe('chat');
    expect(pendingTransitions.get('u1')?.reason).toBe('plan_creation_complete');
  });

  it('returns success string', async () => {
    const [saveWorkoutPlan] = buildTools(makeWorkoutPlanRepo(), makePendingTransitions());

    const result = await saveWorkoutPlan.invoke(MINIMAL_PLAN, makeConfig());

    expect(result as string).toContain('saved successfully');
  });

  it('returns error string when userId is missing from configurable', async () => {
    const [saveWorkoutPlan] = buildTools(makeWorkoutPlanRepo(), makePendingTransitions());

    const result = await saveWorkoutPlan.invoke(MINIMAL_PLAN, { configurable: {} });

    expect(result as string).toContain('Error: could not identify user');
  });

  it('does NOT call create when userId is missing', async () => {
    const repo = makeWorkoutPlanRepo();
    const [saveWorkoutPlan] = buildTools(repo, makePendingTransitions());

    await saveWorkoutPlan.invoke(MINIMAL_PLAN, { configurable: {} });

    expect(repo.create).not.toHaveBeenCalled();
  });

  it('does NOT set pendingTransitions when userId is missing', async () => {
    const pendingTransitions = makePendingTransitions();
    const [saveWorkoutPlan] = buildTools(makeWorkoutPlanRepo(), pendingTransitions);

    await saveWorkoutPlan.invoke(MINIMAL_PLAN, { configurable: {} });

    expect(pendingTransitions.size).toBe(0);
  });
});

describe('plan-creation.tools — request_transition', () => {
  it('returns a plain string, never a Command object', async () => {
    const [, requestTransition] = buildTools(makeWorkoutPlanRepo(), makePendingTransitions());

    const result = await requestTransition.invoke({ toPhase: 'chat' }, makeConfig());

    expect(typeof result).toBe('string');
    expect(result as object).not.toHaveProperty('lc_direct_tool_output');
  });

  it('sets pendingTransitions entry for userId with toPhase=chat', async () => {
    const pendingTransitions = makePendingTransitions();
    const [, requestTransition] = buildTools(makeWorkoutPlanRepo(), pendingTransitions);

    await requestTransition.invoke({ toPhase: 'chat' }, makeConfig('u1'));

    expect(pendingTransitions.get('u1')).not.toBeNull();
    expect(pendingTransitions.get('u1')?.toPhase).toBe('chat');
  });

  it('sets optional reason in pendingTransitions entry', async () => {
    const pendingTransitions = makePendingTransitions();
    const [, requestTransition] = buildTools(makeWorkoutPlanRepo(), pendingTransitions);

    await requestTransition.invoke({ toPhase: 'chat', reason: 'user cancelled' }, makeConfig('u1'));

    expect(pendingTransitions.get('u1')?.reason).toBe('user cancelled');
  });

  it('returns confirmation string mentioning the target phase', async () => {
    const [, requestTransition] = buildTools(makeWorkoutPlanRepo(), makePendingTransitions());

    const result = await requestTransition.invoke({ toPhase: 'chat' }, makeConfig());

    expect(result as string).toContain('chat');
  });

  it('does NOT call workoutPlanRepository', async () => {
    const repo = makeWorkoutPlanRepo();
    const [, requestTransition] = buildTools(repo, makePendingTransitions());

    await requestTransition.invoke({ toPhase: 'chat' }, makeConfig());

    expect(repo.create).not.toHaveBeenCalled();
  });

  it('isolates entries by userId — two users do not overwrite each other', async () => {
    const pendingTransitions = makePendingTransitions();
    const [, requestTransition] = buildTools(makeWorkoutPlanRepo(), pendingTransitions);

    await requestTransition.invoke({ toPhase: 'chat', reason: 'A cancelled' }, makeConfig('userA'));
    await requestTransition.invoke({ toPhase: 'chat', reason: 'B cancelled' }, makeConfig('userB'));

    expect(pendingTransitions.get('userA')?.reason).toBe('A cancelled');
    expect(pendingTransitions.get('userB')?.reason).toBe('B cancelled');
  });
});
