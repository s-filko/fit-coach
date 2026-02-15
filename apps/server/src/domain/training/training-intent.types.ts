import { z } from 'zod';

/**
 * Training intent types - actions user can perform during training phase
 * LLM extracts these intents from user messages during active training session
 */

// --- SetData Schemas ---

const StrengthSetDataSchema = z.object({
  type: z.literal('strength'),
  reps: z.number().int().min(1),
  weight: z.number().min(0).optional(),
  weightUnit: z.enum(['kg', 'lbs']).optional(),
  restSeconds: z.number().int().min(0).optional(),
});

const CardioDistanceSetDataSchema = z.object({
  type: z.literal('cardio_distance'),
  distance: z.number().min(0),
  distanceUnit: z.enum(['km', 'miles', 'meters']),
  duration: z.number().int().min(0),
  pace: z.number().min(0).optional(),
  restSeconds: z.number().int().min(0).optional(),
});

const CardioDurationSetDataSchema = z.object({
  type: z.literal('cardio_duration'),
  duration: z.number().int().min(0),
  intensity: z.enum(['low', 'moderate', 'high']).optional(),
  restSeconds: z.number().int().min(0).optional(),
});

const FunctionalRepsSetDataSchema = z.object({
  type: z.literal('functional_reps'),
  reps: z.number().int().min(1),
  restSeconds: z.number().int().min(0).optional(),
});

const IsometricSetDataSchema = z.object({
  type: z.literal('isometric'),
  duration: z.number().int().min(0),
  restSeconds: z.number().int().min(0).optional(),
});

const IntervalSetDataSchema = z.object({
  type: z.literal('interval'),
  workDuration: z.number().int().min(0),
  restDuration: z.number().int().min(0),
  rounds: z.number().int().min(1).optional(),
});

const SetDataSchema = z.discriminatedUnion('type', [
  StrengthSetDataSchema,
  CardioDistanceSetDataSchema,
  CardioDurationSetDataSchema,
  FunctionalRepsSetDataSchema,
  IsometricSetDataSchema,
  IntervalSetDataSchema,
]);

// --- Log Set Intent ---

export const LogSetIntentSchema = z.object({
  type: z.literal('log_set'),
  setData: SetDataSchema,
  // Optional RPE (Rate of Perceived Exertion) 1-10
  rpe: z.number().min(1).max(10).optional(),
  // Optional user feedback about the set
  feedback: z.string().optional(),
});

export type LogSetIntent = z.infer<typeof LogSetIntentSchema>;

// --- Next Exercise Intent ---

export const NextExerciseIntentSchema = z.object({
  type: z.literal('next_exercise'),
  // Optional reason for moving to next exercise
  reason: z.string().optional(),
});

export type NextExerciseIntent = z.infer<typeof NextExerciseIntentSchema>;

// --- Skip Exercise Intent ---

export const SkipExerciseIntentSchema = z.object({
  type: z.literal('skip_exercise'),
  // Reason for skipping
  reason: z.string().optional(),
});

export type SkipExerciseIntent = z.infer<typeof SkipExerciseIntentSchema>;

// --- Finish Training Intent ---

export const FinishTrainingIntentSchema = z.object({
  type: z.literal('finish_training'),
  // Optional user feedback about the session
  feedback: z.string().optional(),
});

export type FinishTrainingIntent = z.infer<typeof FinishTrainingIntentSchema>;

// --- Request Advice Intent ---

export const RequestAdviceIntentSchema = z.object({
  type: z.literal('request_advice'),
  // What user needs advice about
  topic: z.string().optional(),
});

export type RequestAdviceIntent = z.infer<typeof RequestAdviceIntentSchema>;

// --- Modify Session Intent ---

export const ModifySessionIntentSchema = z.object({
  type: z.literal('modify_session'),
  // What user wants to change
  modification: z.string(),
});

export type ModifySessionIntent = z.infer<typeof ModifySessionIntentSchema>;

// --- Just Chat Intent ---

export const JustChatIntentSchema = z.object({
  type: z.literal('just_chat'),
  // User just wants to chat, no training action
});

export type JustChatIntent = z.infer<typeof JustChatIntentSchema>;

// --- Union of all training intents ---

export const TrainingIntentSchema = z.discriminatedUnion('type', [
  LogSetIntentSchema,
  NextExerciseIntentSchema,
  SkipExerciseIntentSchema,
  FinishTrainingIntentSchema,
  RequestAdviceIntentSchema,
  ModifySessionIntentSchema,
  JustChatIntentSchema,
]);

export type TrainingIntent = z.infer<typeof TrainingIntentSchema>;

/**
 * LLM response during training phase
 * Includes message to user and optional training intent
 */
export const LLMTrainingResponseSchema = z.object({
  message: z.string(),
  intent: TrainingIntentSchema.optional(),
  // Phase transition (e.g., finish training -> return to chat)
  phaseTransition: z.object({
    toPhase: z.enum(['chat', 'session_planning']),
    reason: z.string().optional(),
  }).optional(),
});

export type LLMTrainingResponse = z.infer<typeof LLMTrainingResponseSchema>;

/**
 * Parse LLM training response
 * @throws {Error} if response is not valid JSON or doesn't match schema
 */
export function parseTrainingResponse(jsonString: string): LLMTrainingResponse {
  try {
    const parsed = JSON.parse(jsonString) as unknown;
    return LLMTrainingResponseSchema.parse(parsed);
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new Error(`Invalid training response format: ${error.message}`);
    }
    throw new Error(`Failed to parse training response: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Examples of valid training responses:
 *
 * 1. Log a strength set:
 * {
 *   "message": "Отлично! Записал подход.",
 *   "intent": {
 *     "type": "log_set",
 *     "setData": { "type": "strength", "reps": 10, "weight": 100, "weightUnit": "kg" },
 *     "rpe": 8
 *   }
 * }
 *
 * 2. Move to next exercise:
 * {
 *   "message": "Хорошо, переходим к следующему упражнению!",
 *   "intent": {
 *     "type": "next_exercise"
 *   }
 * }
 *
 * 3. Finish training:
 * {
 *   "message": "Отличная тренировка! Все записал.",
 *   "intent": {
 *     "type": "finish_training",
 *     "feedback": "Great workout"
 *   },
 *   "phaseTransition": {
 *     "toPhase": "chat",
 *     "reason": "training_completed"
 *   }
 * }
 *
 * 4. Just chat during training:
 * {
 *   "message": "Да, сегодня отличная погода!",
 *   "intent": {
 *     "type": "just_chat"
 *   }
 * }
 */
