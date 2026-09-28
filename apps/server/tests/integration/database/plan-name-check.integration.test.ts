/**
 * AC-HL-5 (training-history-lookup plan D5) — DB-backed: `start_training_session` and
 * `save_workout_plan` both check a plan entry's `exerciseName` against the REAL catalog row of its
 * `exerciseId` (`exerciseRepository.findByIdsWithMuscles` over the test DB's seed catalog:
 * `Barbell Bench Press`, `Barbell Back Squat`, `Pull-ups`, `Running` — src/app/test/setup.ts).
 * "Treadmill" naming `Running`'s id stands in for the live 2026-09-25 case ("Treadmill" naming
 * Rowing Machine's id — BACKLOG.md § Findings; the test catalog has no Rowing Machine).
 */
import { isToolReturnWithUpdate, type ToolReturn } from '@domain/conversation/tool-outcome';

import { buildSaveWorkoutPlanTool } from '@infra/ai/tools/save-workout-plan.tool';
import { buildStartTrainingSessionTool } from '@infra/ai/tools/start-training-session.tool';
import { toToolMessage } from '@infra/ai/tools/outcome';
import { ExerciseRepository } from '@infra/db/repositories/exercise.repository';
import { WorkoutPlanRepository } from '@infra/db/repositories/workout-plan.repository';
import { DrizzleUserRepository } from '@infra/db/repositories/user.repository';

import { createTestUserData } from '../../shared/test-factories';

/** A stub `ITrainingService` — the name check runs (and, on rejection, returns) before it is touched. */
const trainingServiceStub = {
  startSession: jest.fn().mockResolvedValue({ id: 'session-1', status: 'planning' }),
} as never;

/** No physical constraints — `guardFactConstraints` is a no-op pass-through in every case here. */
const userFactsServiceStub = { getConstraints: async () => [] } as never;

function makeConfig(userId: string) {
  return {
    configurable: { userId, thread_id: userId },
    context: { runId: 'run-test', userId, now: new Date('2026-09-26T09:00:00.000Z') },
  } as never;
}

function renderedContent(ret: ToolReturn): string {
  return String(toToolMessage(isToolReturnWithUpdate(ret) ? ret.outcome : ret, 'test-id').content);
}

describe('plan-save name/id check over the real catalog (AC-HL-5)', () => {
  const exerciseRepo = new ExerciseRepository();
  const workoutPlanRepo = new WorkoutPlanRepository();
  const userRepo = new DrizzleUserRepository();

  let userId: string;
  let benchPressId: string;
  let runningId: string;

  beforeAll(async () => {
    const all = await exerciseRepo.findAll();
    const bench = all.find(e => e.name === 'Barbell Bench Press');
    const running = all.find(e => e.name === 'Running');
    if (!bench || !running) {
      throw new Error('plan-name-check: seed exercises not found — run with RUN_DB_TESTS=1 against fitcoach_test');
    }
    benchPressId = bench.id;
    runningId = running.id;

    userId = (await userRepo.create(createTestUserData({ username: `plan_name_check_${Date.now()}` }))).id;
  });

  describe('start_training_session', () => {
    const buildTool = () =>
      buildStartTrainingSessionTool({
        trainingService: trainingServiceStub,
        workoutPlanRepository: workoutPlanRepo,
        exerciseRepository: exerciseRepo,
        userFactsService: userFactsServiceStub,
      });

    it('rejects "Treadmill" naming Running\'s id — nothing persisted', async () => {
      const tool = buildTool();
      const startSession = jest.fn();
      (trainingServiceStub as unknown as { startSession: typeof startSession }).startSession = startSession;

      const result = (await tool.invoke(
        {
          sessionKey: 'mismatch_a',
          sessionName: 'Mismatch A',
          reasoning: 'test',
          exercises: [
            { exerciseId: runningId, exerciseName: 'Treadmill', targetSets: 3, targetReps: '10', restSeconds: 60 },
          ],
          estimatedDuration: 20,
        },
        makeConfig(userId),
      )) as ToolReturn;

      expect(renderedContent(result)).toContain('LLM_ERROR');
      expect(renderedContent(result)).toContain('"Treadmill" → id is "Running"');
      expect(startSession).not.toHaveBeenCalled();
    });

    it('accepts "Bench Press" naming Barbell Bench Press\'s id, stored as the catalog name', async () => {
      const tool = buildTool();
      const startSession = jest.fn().mockResolvedValue({ id: 'session-ok', status: 'planning' });
      (trainingServiceStub as unknown as { startSession: typeof startSession }).startSession = startSession;

      const result = (await tool.invoke(
        {
          sessionKey: 'match_a',
          sessionName: 'Match A',
          reasoning: 'test',
          exercises: [
            {
              exerciseId: benchPressId,
              exerciseName: 'Bench Press',
              targetSets: 3,
              targetReps: '10',
              restSeconds: 60,
            },
          ],
          estimatedDuration: 20,
        },
        makeConfig(userId),
      )) as ToolReturn;

      expect(isToolReturnWithUpdate(result)).toBe(true);
      expect(startSession).toHaveBeenCalledWith(
        userId,
        expect.objectContaining({
          sessionPlanJson: expect.objectContaining({
            exercises: [expect.objectContaining({ exerciseId: benchPressId, exerciseName: 'Barbell Bench Press' })],
          }),
        }),
      );
    });
  });

  describe('save_workout_plan', () => {
    const buildTool = () =>
      buildSaveWorkoutPlanTool({
        workoutPlanRepository: workoutPlanRepo,
        exerciseRepository: exerciseRepo,
        userFactsService: userFactsServiceStub,
      });

    const basePlan = (exerciseId: string, exerciseName: string) => ({
      name: 'Test Plan',
      goal: 'General fitness',
      trainingStyle: 'Full body',
      targetMuscleGroups: ['chest' as const],
      recoveryGuidelines: {
        majorMuscleGroups: { minRestDays: 1, maxRestDays: 3 },
        smallMuscleGroups: { minRestDays: 1, maxRestDays: 2 },
        highIntensity: { minRestDays: 2 },
        customRules: [],
      },
      sessionTemplates: [
        {
          key: 'day_a',
          name: 'Day A',
          focus: 'Full body',
          energyCost: 'medium' as const,
          estimatedDuration: 30,
          exercises: [
            {
              exerciseId,
              exerciseName,
              energyCost: 'medium' as const,
              targetSets: 3,
              targetReps: '8-10',
              restSeconds: 90,
              estimatedDuration: 10,
            },
          ],
        },
        {
          key: 'day_b',
          name: 'Day B',
          focus: 'Full body',
          energyCost: 'medium' as const,
          estimatedDuration: 30,
          exercises: [
            {
              exerciseId,
              exerciseName,
              energyCost: 'medium' as const,
              targetSets: 3,
              targetReps: '8-10',
              restSeconds: 90,
              estimatedDuration: 10,
            },
          ],
        },
      ],
      progressionRules: ['Add weight when all sets hit the top of the rep range'],
    });

    it('rejects "Treadmill" naming Running\'s id — nothing persisted', async () => {
      const tool = buildTool();
      const createSpy = jest.spyOn(workoutPlanRepo, 'create');

      const result = (await tool.invoke(basePlan(runningId, 'Treadmill'), makeConfig(userId))) as ToolReturn;

      expect(renderedContent(result)).toContain('LLM_ERROR');
      expect(renderedContent(result)).toContain('"Treadmill" → id is "Running"');
      expect(createSpy).not.toHaveBeenCalled();
      createSpy.mockRestore();
    });

    it('accepts "Bench Press" naming Barbell Bench Press\'s id, stored as the catalog name', async () => {
      const tool = buildTool();
      const createSpy = jest.spyOn(workoutPlanRepo, 'create');

      const result = (await tool.invoke(
        basePlan(benchPressId, 'Bench Press'),
        makeConfig(userId),
      )) as ToolReturn;

      expect(isToolReturnWithUpdate(result)).toBe(true);
      expect(createSpy).toHaveBeenCalledWith(
        userId,
        expect.objectContaining({
          planJson: expect.objectContaining({
            sessionTemplates: expect.arrayContaining([
              expect.objectContaining({
                exercises: [expect.objectContaining({ exerciseId: benchPressId, exerciseName: 'Barbell Bench Press' })],
              }),
            ]),
          }),
        }),
      );
      createSpy.mockRestore();
    });
  });
});
