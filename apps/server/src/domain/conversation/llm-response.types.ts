import { z } from 'zod';

import { ConversationPhase } from './ports/conversation-context.ports';

/**
 * Phase transition instruction from LLM
 * LLM decides when to transition between phases based on user intent
 */
export const PhaseTransitionSchema = z.object({
  toPhase: z.enum(['chat', 'plan_creation', 'session_planning', 'training'] satisfies ConversationPhase[]),
  reason: z.string().optional(),
  // Session ID for training phase or recommended session for planning
  sessionId: z.string().uuid().optional(),
});

export type PhaseTransition = z.infer<typeof PhaseTransitionSchema>;

/**
 * Profile update data from chat phase
 * Allows user to update their profile without leaving chat
 */
export const ProfileUpdateSchema = z.object({
  age: z.number().int().positive().optional(),
  gender: z.enum(['male', 'female']).optional(),
  height: z.number().positive().optional(),
  weight: z.number().positive().optional(),
  fitnessLevel: z.enum(['beginner', 'intermediate', 'advanced']).optional(),
  fitnessGoal: z.string().optional(),
});

export type ProfileUpdate = z.infer<typeof ProfileUpdateSchema>;

/**
 * Structured LLM response with optional phase transition and profile update
 * Used in all conversation phases to allow LLM to control flow
 */
export const LLMConversationResponseSchema = z.object({
  // Message to show to user
  message: z.string(),
  // Optional phase transition instruction
  phaseTransition: PhaseTransitionSchema.optional(),
  // Optional profile update (chat phase only)
  profileUpdate: ProfileUpdateSchema.optional(),
});

export type LLMConversationResponse = z.infer<typeof LLMConversationResponseSchema>;

/**
 * Parse LLM JSON response into structured format
 * @throws {Error} if response is not valid JSON or doesn't match schema
 */
export function parseLLMResponse(jsonString: string): LLMConversationResponse {
  try {
    const parsed = JSON.parse(jsonString) as unknown;
    return LLMConversationResponseSchema.parse(parsed);
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new Error(`Invalid LLM response format: ${error.message}`);
    }
    throw new Error(`Failed to parse LLM response: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Examples of valid LLM responses:
 *
 * 1. Simple chat message (no phase transition):
 * {
 *   "message": "Hey! How are you?"
 * }
 *
 * 2. Start planning session:
 * {
 *   "message": "Great! Let's plan a workout.",
 *   "phaseTransition": {
 *     "toPhase": "session_planning",
 *     "reason": "user_requested_workout"
 *   }
 * }
 *
 * 3. Cancel planning, return to chat:
 * {
 *   "message": "No problem, let's train later!",
 *   "phaseTransition": {
 *     "toPhase": "chat",
 *     "reason": "user_cancelled"
 *   }
 * }
 *
 * 4. Start training with recommended session:
 * {
 *   "message": "Great! Starting workout: Push Day.",
 *   "phaseTransition": {
 *     "toPhase": "training",
 *     "sessionId": "550e8400-e29b-41d4-a716-446655440000"
 *   }
 * }
 *
 * 5. Finish training, return to chat:
 * {
 *   "message": "Excellent work! Workout complete.",
 *   "phaseTransition": {
 *     "toPhase": "chat",
 *     "reason": "training_completed"
 *   }
 * }
 */
