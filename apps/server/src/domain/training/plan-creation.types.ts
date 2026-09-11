import { z } from 'zod';

import type { ConversationPhase } from '@domain/conversation/ports/conversation-context.ports';

/**
 * Zod schemas for LLM responses during plan_creation phase
 */

// Energy cost for exercises/sessions
export const EnergyCostSchema = z.enum(['very_low', 'low', 'medium', 'high', 'very_high']);

// Muscle groups
export const MuscleGroupSchema = z.enum([
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
]);

// Recovery guidelines
export const RecoveryGuidelinesSchema = z.object({
  majorMuscleGroups: z.object({
    minRestDays: z.number().int().min(1).max(7),
    maxRestDays: z.number().int().min(1).max(14),
  }),
  smallMuscleGroups: z.object({
    minRestDays: z.number().int().min(0).max(7),
    maxRestDays: z.number().int().min(1).max(14),
  }),
  highIntensity: z.object({
    minRestDays: z.number().int().min(1).max(7),
  }),
  cardio: z
    .object({
      minRestDays: z.number().int().min(0).max(7),
      maxRestDays: z.number().int().min(1).max(14),
    })
    .optional(),
  functional: z
    .object({
      minRestDays: z.number().int().min(0).max(7),
      maxRestDays: z.number().int().min(1).max(14),
    })
    .optional(),
  customRules: z.array(z.string()).min(1),
});

// Exercise in session template
export const SessionTemplateExerciseSchema = z.object({
  exerciseId: z.string().uuid(),
  exerciseName: z.string().min(1).optional(),
  energyCost: EnergyCostSchema,
  targetSets: z.number().int().min(1).max(10),
  targetReps: z.string().min(1), // e.g., '8-10', '12-15', '20-30'
  targetWeight: z.number().positive().optional(),
  restSeconds: z.number().int().min(0).max(600),
  estimatedDuration: z.number().int().min(1).max(60), // minutes per exercise
  notes: z.string().optional(),
});

// Session template (e.g., Upper A, Lower B)
export const SessionTemplateSchema = z.object({
  key: z.string().min(1), // e.g., 'upper_a', 'lower_b', 'full_body_a'
  name: z.string().min(1), // e.g., 'Upper A - Chest/Back'
  focus: z.string().min(1), // e.g., 'Chest and back compound movements'
  energyCost: EnergyCostSchema,
  estimatedDuration: z.number().int().min(10).max(180), // minutes
  exercises: z.array(SessionTemplateExerciseSchema).min(1).max(15),
});

// Complete workout plan
export const WorkoutPlanDraftSchema = z.object({
  name: z.string().min(1).max(100), // e.g., 'PPL 6-Day Split'
  goal: z.string().min(10).max(500), // e.g., 'Muscle gain, 4-day upper/lower split'
  trainingStyle: z.string().min(10).max(500), // e.g., 'Progressive overload, compound focus'
  targetMuscleGroups: z.array(MuscleGroupSchema).min(1).max(16),
  recoveryGuidelines: RecoveryGuidelinesSchema,
  sessionTemplates: z.array(SessionTemplateSchema).min(1).max(10),
  progressionRules: z.array(z.string().min(10)).min(1).max(10),
});

export type WorkoutPlanDraft = z.infer<typeof WorkoutPlanDraftSchema>;

// Phase transition for plan_creation
export const PlanCreationPhaseTransitionSchema = z.object({
  toPhase: z.enum(['chat', 'session_planning'] satisfies ConversationPhase[]),
  reason: z.string().optional(),
});

// LLM response schema for plan_creation phase
export const PlanCreationLLMResponseSchema = z.object({
  message: z.string().min(1),
  workoutPlan: WorkoutPlanDraftSchema.optional(),
  phaseTransition: PlanCreationPhaseTransitionSchema.optional(),
});

export type PlanCreationLLMResponse = z.infer<typeof PlanCreationLLMResponseSchema>;

/**
 * Parse LLM response for plan_creation phase
 * @throws {Error} if response is invalid
 */
export function parsePlanCreationResponse(jsonString: string): PlanCreationLLMResponse {
  try {
    const parsed = JSON.parse(jsonString) as unknown;
    return PlanCreationLLMResponseSchema.parse(parsed);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const issues = error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join(', ');
      throw new Error(`Invalid plan creation response: ${issues}`);
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to parse plan creation response: ${message}`);
  }
}
