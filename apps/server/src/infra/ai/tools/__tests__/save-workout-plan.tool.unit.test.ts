import type { RunnableConfig } from '@langchain/core/runnables';

import { isToolReturnWithUpdate, type ToolReturn } from '@domain/conversation/tool-outcome';
import type { IExerciseRepository, IWorkoutPlanRepository } from '@domain/training/ports';

import { toToolMessage } from '@infra/ai/tools/outcome';

import { buildSaveWorkoutPlanTool } from '../save-workout-plan.tool';

// StructuredTool has overloaded .invoke() signatures that TS cannot unify in tests.
type InvokableTool = {
  name: string;
  invoke: (input: Record<string, unknown>, config?: RunnableConfig) => Promise<unknown>;
};

/** Renders a tool return exactly as the executor will (Task 5 contract). */
function renderedContent(ret: ToolReturn): string {
  return String(toToolMessage(isToolReturnWithUpdate(ret) ? ret.outcome : ret, 'test-id').content);
}

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
          exerciseId: 'c7b0899c-a0f9-47ca-a69d-4bcd531b0c95',
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
          exerciseId: '3818f94a-0543-4241-83b4-6840d06a4e6a',
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

const makeWorkoutPlanRepo = (): jest.Mocked<IWorkoutPlanRepository> =>
  ({
    create: jest.fn().mockResolvedValue({ id: 'plan-1', ...MINIMAL_PLAN }),
    findById: jest.fn(),
    findActiveByUserId: jest.fn(),
    findByUserId: jest.fn(),
    update: jest.fn(),
    archive: jest.fn(),
  }) as unknown as jest.Mocked<IWorkoutPlanRepository>;

const makeConfig = (userId = 'u1'): RunnableConfig => ({
  configurable: { userId, thread_id: userId },
});

const makeExerciseRepository = (): jest.Mocked<IExerciseRepository> =>
  ({
    findByIds: jest
      .fn()
      .mockResolvedValue([
        { id: 'c7b0899c-a0f9-47ca-a69d-4bcd531b0c95' },
        { id: '3818f94a-0543-4241-83b4-6840d06a4e6a' },
      ]),
    searchByEmbedding: jest.fn().mockResolvedValue([]),
    updateEmbedding: jest.fn(),
    findAll: jest.fn(),
    findAllWithMuscles: jest.fn(),
    findById: jest.fn(),
    findByIdWithMuscles: jest.fn(),
    findByIdsWithMuscles: jest.fn(),
    findByMuscleGroup: jest.fn(),
    search: jest.fn(),
  }) as unknown as jest.Mocked<IExerciseRepository>;

const buildTools = (workoutPlanRepository: jest.Mocked<IWorkoutPlanRepository>) => {
  const saveWorkoutPlan = buildSaveWorkoutPlanTool({
    workoutPlanRepository,
    exerciseRepository: makeExerciseRepository(),
  }) as unknown as InvokableTool;
  return { saveWorkoutPlan };
};

describe('save-workout-plan.tool — save_workout_plan', () => {
  it('returns a ToolReturn with update, never a Command object', async () => {
    const { saveWorkoutPlan } = buildTools(makeWorkoutPlanRepo());

    const result = (await saveWorkoutPlan.invoke(MINIMAL_PLAN, makeConfig())) as ToolReturn;

    expect(result as object).not.toHaveProperty('lc_direct_tool_output');
    expect(isToolReturnWithUpdate(result)).toBe(true);
  });

  it('calls workoutPlanRepository.create with correct userId and plan data', async () => {
    const repo = makeWorkoutPlanRepo();
    const { saveWorkoutPlan } = buildTools(repo);

    await saveWorkoutPlan.invoke(MINIMAL_PLAN, makeConfig('u1'));

    expect(repo.create).toHaveBeenCalledWith(
      'u1',
      expect.objectContaining({
        name: MINIMAL_PLAN.name,
        status: 'active',
        planJson: expect.objectContaining({
          goal: MINIMAL_PLAN.goal,
          trainingStyle: MINIMAL_PLAN.trainingStyle,
        }),
      }),
    );
  });

  it('requests pendingTransition to chat after saving the plan', async () => {
    const { saveWorkoutPlan } = buildTools(makeWorkoutPlanRepo());

    const result = (await saveWorkoutPlan.invoke(MINIMAL_PLAN, makeConfig('u1'))) as ToolReturn;

    expect(isToolReturnWithUpdate(result) ? result.update.pendingTransition : undefined).toEqual({
      toPhase: 'chat',
      reason: 'plan_creation_complete',
    });
  });

  it('returns success string', async () => {
    const { saveWorkoutPlan } = buildTools(makeWorkoutPlanRepo());

    const result = (await saveWorkoutPlan.invoke(MINIMAL_PLAN, makeConfig())) as ToolReturn;

    expect(renderedContent(result)).toContain('Plan saved');
  });

  it('returns error string when userId is missing from configurable', async () => {
    const { saveWorkoutPlan } = buildTools(makeWorkoutPlanRepo());

    const result = (await saveWorkoutPlan.invoke(MINIMAL_PLAN, { configurable: {} })) as ToolReturn;

    expect(renderedContent(result)).toContain('Error: could not identify user');
  });

  it('does NOT call create when userId is missing', async () => {
    const repo = makeWorkoutPlanRepo();
    const { saveWorkoutPlan } = buildTools(repo);

    await saveWorkoutPlan.invoke(MINIMAL_PLAN, { configurable: {} });

    expect(repo.create).not.toHaveBeenCalled();
  });

  it('does NOT request a transition when userId is missing', async () => {
    const { saveWorkoutPlan } = buildTools(makeWorkoutPlanRepo());

    const result = (await saveWorkoutPlan.invoke(MINIMAL_PLAN, { configurable: {} })) as ToolReturn;

    expect(isToolReturnWithUpdate(result)).toBe(false);
  });
});
