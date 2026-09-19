/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { tool } from '@langchain/core/tools';
import { z } from 'zod';

import { llmError, ok, userError } from '@domain/conversation/tool-outcome';
import type { IExerciseRepository, IWorkoutPlanRepository } from '@domain/training/ports';
import type { MuscleGroup } from '@domain/training/types';
import type { IUserFactsService } from '@domain/user/ports';

import { rejectOnFactConflict } from './fact-constraint-guard';
import { userIdOf } from './format-exercise-summary';

export interface SaveWorkoutPlanToolDeps {
  workoutPlanRepository: IWorkoutPlanRepository;
  exerciseRepository: IExerciseRepository;
  /** P6 Task 5: hard validation against physical_constraint facts (D-G). */
  userFactsService: IUserFactsService;
}

const MUSCLE_GROUPS: [MuscleGroup, ...MuscleGroup[]] = [
  'chest',
  'back_lats',
  'back_traps',
  'shoulders_front',
  'shoulders_side',
  'shoulders_rear',
  'quads',
  'hamstrings',
  'glutes',
  'calves',
  'biceps',
  'triceps',
  'forearms',
  'abs',
  'lower_back',
  'core',
  'cardio_system',
  'full_body',
  'lower_body_endurance',
  'core_stability',
];

const ENERGY_COST = ['very_low', 'low', 'medium', 'high', 'very_high'] as const;

const sessionTemplateExerciseSchema = z.object({
  exerciseId: z.string().uuid().describe('Exact exercise UUID from the list'),
  exerciseName: z.string().describe('Exercise name in English'),
  energyCost: z.enum(ENERGY_COST),
  targetSets: z.number().int().min(1),
  targetReps: z.string().describe('Rep range, e.g. "8-10" or "12"'),
  targetWeight: z.number().optional().describe('Starting weight in kg, if applicable'),
  restSeconds: z.number().int().min(0),
  estimatedDuration: z.number().int().min(1).describe('Estimated minutes for this exercise block'),
  notes: z.string().optional(),
});

const sessionTemplateSchema = z.object({
  key: z.string().describe('Unique session key, e.g. "upper_a", "lower_b", "full_body_1"'),
  name: z.string().describe('Human-readable session name'),
  focus: z.string().describe('Focus description, e.g. "Push: chest, shoulders, triceps"'),
  energyCost: z.enum(ENERGY_COST),
  estimatedDuration: z.number().int().min(1).describe('Total session duration in minutes'),
  exercises: z.array(sessionTemplateExerciseSchema).min(1),
});

const recoveryGuidelinesSchema = z.object({
  majorMuscleGroups: z.object({
    minRestDays: z.number().int().min(0),
    maxRestDays: z.number().int().min(0),
  }),
  smallMuscleGroups: z.object({
    minRestDays: z.number().int().min(0),
    maxRestDays: z.number().int().min(0),
  }),
  highIntensity: z.object({
    minRestDays: z.number().int().min(0),
  }),
  cardio: z.object({ minRestDays: z.number().int().min(0), maxRestDays: z.number().int().min(0) }).optional(),
  functional: z.object({ minRestDays: z.number().int().min(0), maxRestDays: z.number().int().min(0) }).optional(),
  customRules: z.array(z.string()),
});

const SAVE_WORKOUT_PLAN_DESCRIPTION = [
  "Save the user's approved workout plan to the database.",
  'Call this ONLY when the user has explicitly approved the complete plan.',
  'Do NOT call this during discussion, proposal, or refinement.',
  'All fields (sessionTemplates, recoveryGuidelines, progressionRules) must be complete.',
].join(' ');

export function buildSaveWorkoutPlanTool(deps: SaveWorkoutPlanToolDeps) {
  const { workoutPlanRepository, exerciseRepository, userFactsService } = deps;

  return tool(
    async (input, config) => {
      const userId = userIdOf(config);
      if (!userId) {
        return userError('Error: could not identify user. Please try again.');
      }

      // Validate all exerciseIds exist in DB before saving, and resolve their
      // muscles in the same call for the constraint check below.
      const allIds = input.sessionTemplates.flatMap(t => t.exercises.map(e => e.exerciseId));
      const uniqueIds = [...new Set(allIds)];
      if (uniqueIds.length > 0) {
        const found = await exerciseRepository.findByIdsWithMuscles(uniqueIds);
        const foundIds = new Set(found.map(e => e.id));
        const missing = uniqueIds.filter(id => !foundIds.has(id));
        if (missing.length > 0) {
          return llmError(
            `Invalid exerciseId(s): ${missing.join(', ')}. These IDs do not exist in the exercise catalog. ` +
              'Use search_exercises to find valid exercise IDs.',
          );
        }

        // Hard validation (D-G): a physical_constraint fact's muscle group among
        // an exercise's PRIMARY muscles rejects the call — nothing is persisted.
        const rejection = await rejectOnFactConflict(userFactsService, userId, found);
        if (rejection) {
          return rejection;
        }
      }

      await workoutPlanRepository.create(userId, {
        name: input.name,
        planJson: {
          goal: input.goal,
          trainingStyle: input.trainingStyle,
          targetMuscleGroups: input.targetMuscleGroups as MuscleGroup[],
          recoveryGuidelines: input.recoveryGuidelines,
          sessionTemplates: input.sessionTemplates,
          progressionRules: input.progressionRules,
        },
        status: 'active',
      });

      return {
        outcome: ok(
          'Plan saved. Now write a brief confirmation to the user in their language — congratulate them and say you are ready to start training.',
        ),
        update: {
          pendingTransition: {
            toPhase: 'chat',
            reason: 'plan_creation_complete',
          },
        },
      };
    },
    {
      name: 'save_workout_plan',
      description: SAVE_WORKOUT_PLAN_DESCRIPTION,
      schema: z.object({
        name: z.string().describe('Plan name, e.g. "Upper-Lower Split — 4 days/week"'),
        goal: z.string().describe('Primary goal of the plan'),
        trainingStyle: z.string().describe('Training style, e.g. "Upper-Lower Split", "PPL"'),
        targetMuscleGroups: z.array(z.enum(MUSCLE_GROUPS)).describe('Primary muscle groups targeted'),
        recoveryGuidelines: recoveryGuidelinesSchema,
        sessionTemplates: z.array(sessionTemplateSchema).min(2).max(7),
        progressionRules: z.array(z.string()).min(1).describe('Specific, actionable progression rules'),
      }),
    },
  );
}
