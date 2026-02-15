import { z } from 'zod';

import { ConversationPhase } from '@domain/conversation/ports/conversation-context.ports';

/**
 * Zod schema for recommended exercise in session plan
 */
export const RecommendedExerciseSchema = z.object({
  exerciseId: z.number().int().positive(),
  exerciseName: z.string().min(1),
  targetSets: z.number().int().positive(),
  targetReps: z.string().min(1), // e.g., '8-10', '12-15'
  targetWeight: z.number().optional(),
  restSeconds: z.number().int().positive(),
  notes: z.string().optional(),
  imageUrl: z.string().url().optional(),
  videoUrl: z.string().url().optional(),
});

/**
 * Zod schema for session recommendation (workout plan)
 */
export const SessionRecommendationSchema = z.object({
  sessionKey: z.string().min(1), // e.g., 'upper_a', 'lower_b', 'custom'
  sessionName: z.string().min(1),
  reasoning: z.string().min(1),
  exercises: z.array(RecommendedExerciseSchema).min(1),
  estimatedDuration: z.number().int().positive(), // minutes
  timeLimit: z.number().int().positive().optional(), // minutes - user's available time
  warnings: z.array(z.string()).optional(),
  modifications: z.array(z.string()).optional(),
});

/**
 * Phase transition for session planning
 */
export const SessionPlanningPhaseTransitionSchema = z.object({
  toPhase: z.enum(['training', 'chat'] satisfies ConversationPhase[]),
  reason: z.string().optional(),
});

/**
 * LLM response schema for session_planning phase
 * Includes message, optional session plan, and optional phase transition
 */
export const SessionPlanningLLMResponseSchema = z.object({
  message: z.string().min(1),
  sessionPlan: SessionRecommendationSchema.optional(),
  phaseTransition: SessionPlanningPhaseTransitionSchema.optional(),
});

export type SessionPlanningLLMResponse = z.infer<typeof SessionPlanningLLMResponseSchema>;

/**
 * Parse LLM JSON response for session_planning phase
 * @throws {Error} if response is not valid JSON or doesn't match schema
 */
export function parseSessionPlanningResponse(jsonString: string): SessionPlanningLLMResponse {
  try {
    const parsed = JSON.parse(jsonString) as unknown;
    return SessionPlanningLLMResponseSchema.parse(parsed);
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new Error(`Invalid session planning response format: ${error.message}`);
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to parse session planning response: ${message}`);
  }
}

/**
 * Examples of valid session planning responses:
 *
 * 1. Collecting user context (no plan yet):
 * {
 *   "message": "Как ты себя чувствуешь сегодня? Сколько времени у тебя есть на тренировку?"
 * }
 *
 * 2. Presenting workout plan:
 * {
 *   "message": "Отлично! Вот план на сегодня: Upper A - акцент на грудь и спину.",
 *   "sessionPlan": {
 *     "sessionKey": "upper_a",
 *     "sessionName": "Upper A - Chest/Back",
 *     "reasoning": "Last trained upper body 3 days ago. Good recovery time. You're feeling energetic.",
 *     "exercises": [
 *       {
 *         "exerciseId": 1,
 *         "exerciseName": "Barbell Bench Press",
 *         "targetSets": 3,
 *         "targetReps": "8-10",
 *         "targetWeight": 70,
 *         "restSeconds": 90,
 *         "notes": "Focus on form"
 *       }
 *     ],
 *     "estimatedDuration": 60,
 *     "timeLimit": 60,
 *     "warnings": ["Make sure to warm up properly"]
 *   }
 * }
 *
 * 3. User ready to start training (MUST include sessionPlan):
 * {
 *   "message": "Отлично! Начинаем тренировку. Первое упражнение: жим лежа.",
 *   "sessionPlan": {
 *     "sessionKey": "upper_a",
 *     "sessionName": "Upper A - Chest/Back",
 *     "reasoning": "Good recovery, ready for upper body",
 *     "exercises": [
 *       {
 *         "exerciseId": 1,
 *         "exerciseName": "Barbell Bench Press",
 *         "targetSets": 3,
 *         "targetReps": "8-10",
 *         "targetWeight": 70,
 *         "restSeconds": 90
 *       }
 *     ],
 *     "estimatedDuration": 60
 *   },
 *   "phaseTransition": {
 *     "toPhase": "training",
 *     "reason": "User confirmed plan and ready to start"
 *   }
 * }
 *
 * 4. User cancels planning:
 * {
 *   "message": "Хорошо, давай потренируемся позже!",
 *   "phaseTransition": {
 *     "toPhase": "chat",
 *     "reason": "User explicitly cancelled session planning"
 *   }
 * }
 */
