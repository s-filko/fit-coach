import { tool } from '@langchain/core/tools';
import { z } from 'zod';

import type { TransitionRequest } from '@domain/conversation/graph/conversation.state';
import type { ConversationPhase } from '@domain/conversation/ports';
import type { ITrainingService, IWorkoutPlanRepository } from '@domain/training/ports';
import { RecommendedExerciseSchema, SessionRecommendationSchema } from '@domain/training/session-planning.types';

import type { IPendingRefMap } from '@infra/ai/graph/pending-ref-map';

export interface SessionPlanningToolsDeps {
  trainingService: ITrainingService;
  workoutPlanRepository: IWorkoutPlanRepository;
  /** Per-user map — start_training_session sets entry by userId, extractNode deletes it */
  pendingTransitions: IPendingRefMap<TransitionRequest | null>;
  /** Per-user map — start_training_session sets session ID by userId, extractNode deletes it */
  pendingActiveSessionIds: IPendingRefMap<string | null>;
}

const START_TRAINING_SESSION_DESCRIPTION = [
  'Create a training session with the approved workout plan and transition to the training phase.',
  'Call this ONLY when the user has explicitly approved the session plan and is ready to start.',
  'Do NOT call this during discussion, proposal, or plan refinement.',
  'Include the complete session plan as arguments — it will be stored with the session.',
].join(' ');

const REQUEST_TRANSITION_DESCRIPTION = [
  'Request a phase transition.',
  'Use "chat" if the user explicitly cancels session planning and wants to go back to chat.',
].join(' ');

// Re-export schema for use in tests
export { RecommendedExerciseSchema, SessionRecommendationSchema };

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export function buildSessionPlanningTools(deps: SessionPlanningToolsDeps) {
  const { trainingService, workoutPlanRepository, pendingTransitions, pendingActiveSessionIds } = deps;

  const startTrainingSession = tool(
    // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
    async(input, config) => {
      const userId = (config?.configurable as Record<string, unknown>)?.['userId'] as string | undefined;
      if (!userId) {
        return 'Error: could not identify user. Please try again.';
      }

      try {
        // Resolve planId from active workout plan
        const activePlan = await workoutPlanRepository.findActiveByUserId(userId);

        const session = await trainingService.startSession(userId, {
          planId: activePlan?.id,
          sessionKey: input.sessionKey,
          status: 'planning',
          sessionPlanJson: {
            sessionKey: input.sessionKey,
            sessionName: input.sessionName,
            reasoning: input.reasoning,
            exercises: input.exercises,
            estimatedDuration: input.estimatedDuration,
            timeLimit: input.timeLimit,
            warnings: input.warnings,
            modifications: input.modifications,
          },
        });

        // Write to per-user maps — extractNode propagates to parent ConversationState
        pendingActiveSessionIds.set(userId, session.id);
        pendingTransitions.set(userId, {
          toPhase: 'training' as ConversationPhase,
          reason: 'session_planning_complete',
        });

        const exerciseCount = input.exercises.length;
        const duration = input.estimatedDuration;
        return `Session created (ID: ${session.id}). ${exerciseCount} exercises, est. ${duration} min. Let's go!`;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        return `Error creating session: ${message}. Please try again.`;
      }
    },
    {
      name: 'start_training_session',
      description: START_TRAINING_SESSION_DESCRIPTION,
      schema: SessionRecommendationSchema,
    },
  );

  const requestTransition = tool(
    // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
    async(input, config) => {
      const userId = (config?.configurable as Record<string, unknown>)?.['userId'] as string | undefined ?? '';
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

  return [startTrainingSession, requestTransition];
}
