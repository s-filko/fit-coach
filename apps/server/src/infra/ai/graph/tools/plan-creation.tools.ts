import { tool } from '@langchain/core/tools';
import { z } from 'zod';

import type { TransitionRequest } from '@domain/conversation/graph/conversation.state';
import type { ConversationPhase } from '@domain/conversation/ports';
import type { IWorkoutPlanRepository } from '@domain/training/ports';
import type { MuscleGroup } from '@domain/training/types';

import type { IPendingRefMap } from '@infra/ai/graph/pending-ref-map';

export interface PlanCreationToolsDeps {
  workoutPlanRepository: IWorkoutPlanRepository;
  /** Per-user map — tools set entry by userId, extractNode deletes it */
  pendingTransitions: IPendingRefMap<TransitionRequest | null>;
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
  exerciseId: z.number().int().describe('Exact numeric exercise ID from the list'),
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

const REQUEST_TRANSITION_DESCRIPTION = [
  'Request a phase transition.',
  'Use "chat" if the user explicitly cancels plan creation and wants to go back to chat.',
].join(' ');

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export function buildPlanCreationTools(deps: PlanCreationToolsDeps) {
  const { workoutPlanRepository, pendingTransitions } = deps;

  const saveWorkoutPlan = tool(
    // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
    async (input, config) => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const userId = (config?.configurable as Record<string, unknown>)?.['userId'] as string | undefined;
      if (!userId) {
        return 'Error: could not identify user. Please try again.';
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

      pendingTransitions.set(userId, {
        toPhase: 'chat' as ConversationPhase,
        reason: 'plan_creation_complete',
      });

      return 'Workout plan saved successfully!';
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

  const requestTransition = tool(
    // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
    async (input, config) => {
      const userId = ((config?.configurable as Record<string, unknown>)?.['userId'] as string | undefined) ?? '';
      pendingTransitions.set(userId, {
        toPhase: input.toPhase as ConversationPhase,
        reason: input.reason ?? 'user_cancelled',
      });

      return `Transition to ${input.toPhase} requested.`;
    },
    {
      name: 'request_transition',
      description: REQUEST_TRANSITION_DESCRIPTION,
      schema: z.object({
        toPhase: z.enum(['chat']).describe('Target phase'),
        reason: z.string().optional().describe('Brief reason for the transition'),
      }),
    },
  );

  return [saveWorkoutPlan, requestTransition];
}
