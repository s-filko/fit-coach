import { z } from 'zod';

import { ConversationPhase } from '@domain/conversation/ports/conversation-context.ports';

/**
 * Zod schema for recommended exercise in session plan
 */
export const RecommendedExerciseSchema = z.object({
  exerciseId: z.number().int().positive(),
  exerciseName: z.string().min(1).optional(),
  targetSets: z.number().int().positive(),
  targetReps: z.string().min(1), // e.g., '8-10', '12-15'
  // LLM may send null, "BW", or a number — normalize to number | undefined
  targetWeight: z
    .union([z.number(), z.string(), z.null()])
    .optional()
    .transform((v) => {
      if (v === null || v === undefined) { return undefined; }
      if (typeof v === 'string') {
        const n = parseFloat(v);
        return isNaN(n) ? undefined : n;
      }
      return v;
    }),
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
 * Phase transition for session planning.
 * Only "training" (user confirmed plan) and "chat" (user cancelled) are valid transitions.
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
  sessionPlan: SessionRecommendationSchema.nullable().optional().transform((v) => v ?? undefined),
  phaseTransition: SessionPlanningPhaseTransitionSchema.nullable().optional().transform((v) => v ?? undefined),
});

export type SessionPlanningLLMResponse = z.infer<typeof SessionPlanningLLMResponseSchema>;

/**
 * Parse LLM JSON response for session_planning phase.
 *
 * phaseTransition is optional — its absence means "stay in session_planning".
 * If LLM sends an invalid phaseTransition (e.g. toPhase: "planning"), we strip it
 * and return the rest of the response, since losing the user-facing message
 * over a bad optional field is worse than ignoring the invalid transition.
 *
 * @returns parsed response with `droppedPhaseTransition` flag when transition was stripped
 * @throws {Error} if message or other required fields are invalid
 */
export function parseSessionPlanningResponse(
  jsonString: string,
): SessionPlanningLLMResponse & { droppedPhaseTransition?: boolean } {
  const raw = JSON.parse(jsonString) as Record<string, unknown>;

  const result = SessionPlanningLLMResponseSchema.safeParse(raw);
  if (result.success) {
    return result.data;
  }

  // Check if the ONLY errors are in phaseTransition
  const allErrorsInPhaseTransition = result.error.issues.every(
    (issue) => issue.path[0] === 'phaseTransition',
  );

  if (allErrorsInPhaseTransition && raw['phaseTransition'] !== undefined) {
    // Strip the invalid phaseTransition and re-parse
    const { phaseTransition: _dropped, ...rest } = raw;
    const retryResult = SessionPlanningLLMResponseSchema.safeParse(rest);
    if (retryResult.success) {
      return { ...retryResult.data, droppedPhaseTransition: true };
    }
  }

  // Non-phaseTransition errors — throw as before
  throw new Error(`Invalid session planning response format: ${result.error.message}`);
}

/**
 * Examples of valid session planning responses:
 *
 * 1. Collecting user context (no plan yet):
 * {
 *   "message": "How are you feeling today? How much time do you have for the workout?"
 * }
 *
 * 2. Presenting workout plan:
 * {
 *   "message": "Great! Here's today's plan: Upper A — chest and back focus.",
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
 *   "message": "Let's go! Starting the workout. First exercise: Barbell Bench Press.",
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
 *   "message": "No problem, let's train later!",
 *   "phaseTransition": {
 *     "toPhase": "chat",
 *     "reason": "User explicitly cancelled session planning"
 *   }
 * }
 */
