/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { tool } from '@langchain/core/tools';
import { z } from 'zod';

import type { ConversationPhase } from '@domain/conversation/phases';
import { llmError, ok, userError } from '@domain/conversation/tool-outcome';
import type { IExerciseRepository, ITrainingService, IWorkoutPlanRepository } from '@domain/training/ports';
import { buildSessionRecommendationSchema } from '@domain/training/session-planning.types';
import type { RecommendedExercise } from '@domain/training/types';
import type { IUserFactsService } from '@domain/user/ports';

import { HANDOFF_REGISTERED_TEXT } from '@infra/ai/graph/handoff';
import { ctxOf } from '@infra/ai/graph/state';

import { checkExerciseNamesAgainstCatalog } from './exercise-name-check';
import { guardFactConstraints } from './fact-constraint-guard';
import { userIdOf } from './format-exercise-summary';

export interface StartTrainingSessionToolDeps {
  trainingService: ITrainingService;
  workoutPlanRepository: IWorkoutPlanRepository;
  exerciseRepository: IExerciseRepository;
  /** P6 Task 5: hard validation against physical_constraint facts (D-G). */
  userFactsService: IUserFactsService;
  /**
   * transition-handoff plan Task 1 (D-5): when 'training' is a configured
   * hand-off target, the closing text drops "write a message to the user" —
   * the phase subgraph ends right after this tool, so the model never gets a
   * turn to act on that instruction. Absent/empty = today's wording.
   */
  transitionHandoffTargets?: ReadonlySet<ConversationPhase>;
}

const START_TRAINING_SESSION_DESCRIPTION = [
  'Create a training session with the approved workout plan and transition to the training phase.',
  'Call this ONLY when the user has explicitly approved the session plan and is ready to start.',
  'Do NOT call this during discussion, proposal, or plan refinement.',
  'Include the complete session plan as arguments — it will be stored with the session.',
  // set-kind plan Task 2 (D6): the place argument — recorded only when the user names it.
  'Optional `place`: where the workout happens, free text in the user\'s own words ("дома", "Fitness House на Ленина").',
  'Pass it ONLY if the user named the place themselves — never ask and never guess.',
].join(' ');

/**
 * set-kind plan Task 2 (D6): the tool's schema = the domain plan schema + the optional
 * `place` argument. Kept local so `SessionRecommendationSchema` (the stored plan's shape)
 * stays place-free.
 */
const StartTrainingSessionSchema = buildSessionRecommendationSchema({ dropTargetWeight: true }).extend({
  place: z.string().min(1).optional(),
});

export function buildStartTrainingSessionTool(deps: StartTrainingSessionToolDeps) {
  const { trainingService, workoutPlanRepository, exerciseRepository, userFactsService } = deps;
  const isHandoff = deps.transitionHandoffTargets?.has('training') ?? false;

  return tool(
    async (input, config) => {
      const userId = userIdOf(config);
      if (!userId) {
        return userError('Error: could not identify user. Please try again.');
      }

      // Validate all exerciseIds exist in DB before creating the session, and
      // resolve their muscles in the same call for the constraint check below.
      let advisory: string | null = null;
      let correctedExercises = input.exercises;
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

        // Plan name/id check (training-history-lookup plan D5): reject before any state changes
        // when a plan entry's name shares no word with its id's catalog name; otherwise the stored
        // name is the catalog's, not whatever the plan called it.
        const catalogNameById = new Map(found.map(e => [e.id, e.name]));
        const nameCheck = checkExerciseNamesAgainstCatalog(input.exercises, catalogNameById);
        if (nameCheck.rejection) {
          return nameCheck.rejection;
        }
        correctedExercises = nameCheck.corrected;

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
          // set-kind plan Task 2 (D6): present only when the user named the place.
          ...(input.place ? { place: input.place } : {}),
          sessionPlanJson: {
            sessionKey: input.sessionKey,
            sessionName: input.sessionName,
            reasoning: input.reasoning,
            // The conditional schema's inferred type carries the dropped-variant union — the
            // stored shape is the domain one either way (targetWeight simply absent when dropped).
            exercises: correctedExercises as RecommendedExercise[],
            estimatedDuration: input.estimatedDuration,
            timeLimit: input.timeLimit,
            warnings: input.warnings,
            modifications: input.modifications,
          },
        });

        const exerciseCount = input.exercises.length;
        const duration = input.estimatedDuration;
        const closingText = isHandoff
          ? HANDOFF_REGISTERED_TEXT
          : 'Now write a brief energetic message to the user in their language — confirm the session started and motivate them for the workout.';
        return {
          outcome: ok(
            [
              `Session created (ID: ${session.id}).`,
              `${exerciseCount} exercises, est. ${duration} min.`,
              ...(advisory === null ? [] : [`\n${advisory}\n`]),
              closingText,
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
      schema: StartTrainingSessionSchema,
    },
  );
}
