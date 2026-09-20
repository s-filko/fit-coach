/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { tool } from '@langchain/core/tools';

import { llmError, ok, userError } from '@domain/conversation/tool-outcome';
import type { IExerciseRepository, ITrainingService, IWorkoutPlanRepository } from '@domain/training/ports';
import { SessionRecommendationSchema } from '@domain/training/session-planning.types';
import type { IUserFactsService } from '@domain/user/ports';

import { ctxOf } from '@infra/ai/graph/state';

import { guardFactConstraints } from './fact-constraint-guard';
import { userIdOf } from './format-exercise-summary';

export interface StartTrainingSessionToolDeps {
  trainingService: ITrainingService;
  workoutPlanRepository: IWorkoutPlanRepository;
  exerciseRepository: IExerciseRepository;
  /** P6 Task 5: hard validation against physical_constraint facts (D-G). */
  userFactsService: IUserFactsService;
}

const START_TRAINING_SESSION_DESCRIPTION = [
  'Create a training session with the approved workout plan and transition to the training phase.',
  'Call this ONLY when the user has explicitly approved the session plan and is ready to start.',
  'Do NOT call this during discussion, proposal, or plan refinement.',
  'Include the complete session plan as arguments — it will be stored with the session.',
].join(' ');

export function buildStartTrainingSessionTool(deps: StartTrainingSessionToolDeps) {
  const { trainingService, workoutPlanRepository, exerciseRepository, userFactsService } = deps;

  return tool(
    async (input, config) => {
      const userId = userIdOf(config);
      if (!userId) {
        return userError('Error: could not identify user. Please try again.');
      }

      // Validate all exerciseIds exist in DB before creating the session, and
      // resolve their muscles in the same call for the constraint check below.
      let advisory: string | null = null;
      const allIds = input.exercises.map((e: { exerciseId: string }) => e.exerciseId);
      const uniqueIds = [...new Set(allIds)];
      if (uniqueIds.length > 0) {
        const found = await exerciseRepository.findByIdsWithMuscles(uniqueIds);
        const foundIds = new Set(found.map(e => e.id));
        const missing = uniqueIds.filter(id => !foundIds.has(id));
        if (missing.length > 0) {
          return llmError(
            `Invalid exerciseId(s): ${missing.join(', ')}. These IDs do not exist in the exercise catalog. ` +
              'Use search_exercises to find valid exercise IDs, then retry.',
          );
        }

        // Constraint guard (D-G, narrowed by AC-FL-6): a PERMANENT constraint's
        // muscle group among an exercise's PRIMARY muscles rejects the call —
        // nothing is persisted. Any other conflict is an advisory on the result.
        const verdict = await guardFactConstraints(userFactsService, userId, found, ctxOf(config as never).now);
        if (verdict.rejection) {
          return verdict.rejection;
        }
        ({ advisory } = verdict);
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

        const exerciseCount = input.exercises.length;
        const duration = input.estimatedDuration;
        return {
          outcome: ok(
            [
              `Session created (ID: ${session.id}).`,
              `${exerciseCount} exercises, est. ${duration} min.`,
              ...(advisory === null ? [] : [`\n${advisory}\n`]),
              'Now write a brief energetic message to the user in their language',
              '— confirm the session started and motivate them for the workout.',
            ].join(' '),
          ),
          update: {
            pendingTransition: {
              toPhase: 'training',
              reason: 'session_planning_complete',
            },
            activeSessionId: session.id,
          },
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        return userError(`Error creating session: ${message}. Please try again.`);
      }
    },
    {
      name: 'start_training_session',
      description: START_TRAINING_SESSION_DESCRIPTION,
      schema: SessionRecommendationSchema,
    },
  );
}
