/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { tool } from '@langchain/core/tools';
import { z } from 'zod';

import type { TransitionRequest } from '@domain/conversation/graph/conversation.state';
import type { ConversationPhase } from '@domain/conversation/ports';
import type {
  IEmbeddingService,
  IExerciseRepository,
  ITrainingService,
  IWorkoutPlanRepository,
} from '@domain/training/ports';
import { RecommendedExerciseSchema, SessionRecommendationSchema } from '@domain/training/session-planning.types';

import type { IPendingRefMap } from '@infra/ai/graph/pending-ref-map';
import { buildSearchExercisesTool } from '@infra/ai/graph/tools/search-exercises.tool';

export interface SessionPlanningToolsDeps {
  trainingService: ITrainingService;
  workoutPlanRepository: IWorkoutPlanRepository;
  exerciseRepository: IExerciseRepository;
  embeddingService: IEmbeddingService;
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

export function buildSessionPlanningTools(deps: SessionPlanningToolsDeps) {
  const {
    trainingService,
    workoutPlanRepository,
    exerciseRepository,
    embeddingService,
    pendingTransitions,
    pendingActiveSessionIds,
  } = deps;
  const searchExercises = buildSearchExercisesTool({ embeddingService, exerciseRepository });

  const startTrainingSession = tool(
    async (input, config) => {
      const userId = (config?.configurable as Record<string, unknown>)?.['userId'] as string | undefined;
      if (!userId) {
        return 'Error: could not identify user. Please try again.';
      }

      // Validate all exerciseIds exist in DB before creating the session
      const allIds = input.exercises.map((e: { exerciseId: number }) => e.exerciseId);
      const uniqueIds = [...new Set(allIds)];
      if (uniqueIds.length > 0) {
        const found = await exerciseRepository.findByIds(uniqueIds);
        const foundIds = new Set(found.map(e => e.id));
        const missing = uniqueIds.filter(id => !foundIds.has(id));
        if (missing.length > 0) {
          return `LLM_ERROR: Invalid exerciseId(s): ${missing.join(', ')}. These IDs do not exist in the exercise catalog. Use search_exercises to find valid exercise IDs, then retry.`;
        }
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
        return [
          `Session created (ID: ${session.id}).`,
          `${exerciseCount} exercises, est. ${duration} min.`,
          'Now write a brief energetic message to the user in their language',
          '— confirm the session started and motivate them for the workout.',
        ].join(' ');
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
    async (input, config) => {
      const userId = ((config?.configurable as Record<string, unknown>)?.['userId'] as string | undefined) ?? '';
      pendingTransitions.set(userId, {
        toPhase: input.toPhase as ConversationPhase,
        reason: input.reason ?? 'user_cancelled',
      });

      return `Transition to ${input.toPhase} registered. Write a brief closing message to the user in their language.`;
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

  return [searchExercises, startTrainingSession, requestTransition];
}
