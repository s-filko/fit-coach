/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { tool } from '@langchain/core/tools';
import { z } from 'zod';

import type { TransitionRequest } from '@domain/conversation/graph/conversation.state';
import type { ConversationPhase } from '@domain/conversation/ports';
import type { ITrainingService } from '@domain/training/ports';
import { SetDataSchema } from '@domain/training/set-data.types';

import type { IPendingRefMap } from '@infra/ai/graph/pending-ref-map';

import { createLogger } from '@shared/logger';

const log = createLogger('training-tools');

/**
 * Prefix for errors caused by infrastructure/configuration issues.
 * agentNode detects this prefix and exits immediately without retry.
 */
export const SYSTEM_ERROR_PREFIX = 'SYSTEM_ERROR:';

/**
 * Prefix for errors caused by incorrect LLM arguments.
 * agentNode allows 1 retry before giving up.
 */
export const LLM_ERROR_PREFIX = 'LLM_ERROR:';

export interface TrainingToolsDeps {
  trainingService: ITrainingService;
  /** Per-user map — finish_training sets entry by userId, extractNode deletes it */
  pendingTransitions: IPendingRefMap<TransitionRequest | null>;
  /** Per-user map — agentNode sets current sessionId by userId before each model.invoke */
  currentSessionIds: IPendingRefMap<string | null>;
}

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export function buildTrainingTools(deps: TrainingToolsDeps) {
  const { trainingService, pendingTransitions, currentSessionIds } = deps;

  const logSet = tool(
    async (input, config) => {
      const userId = ((config?.configurable as Record<string, unknown>)?.['userId'] as string | undefined) ?? '';
      const sessionId = currentSessionIds.get(userId) ?? null;
      if (!sessionId) {
        log.error({ userId }, 'log_set called without active sessionId');
        return `${SYSTEM_ERROR_PREFIX} No active training session found. Cannot log set.`;
      }

      // Build setData from flat fields — avoids LLM confusion with nested object schemas
      const setData = (() => {
        if (input.durationSeconds != null) {
          return { type: 'cardio_duration' as const, duration: input.durationSeconds };
        }
        if (input.reps != null && input.weight != null) {
          return { type: 'strength' as const, reps: input.reps, weight: input.weight, weightUnit: 'kg' as const };
        }
        if (input.reps != null) {
          return { type: 'functional_reps' as const, reps: input.reps };
        }
        return { type: 'strength' as const, reps: 0, weight: 0, weightUnit: 'kg' as const };
      })();

      const parsed = SetDataSchema.safeParse(setData);
      if (!parsed.success) {
        return `${LLM_ERROR_PREFIX} Invalid set data: ${parsed.error.message}`;
      }

      try {
        const { set, setNumber, autoCompleted } = await trainingService.logSetWithContext(sessionId, {
          exerciseId: input.exerciseId,
          exerciseName: input.exerciseName,
          setData: parsed.data,
          rpe: input.rpe,
          feedback: input.feedback,
        });

        const { type } = set.setData;
        let summary = '';
        if (type === 'strength') {
          const d = set.setData;
          summary = `${d.reps} reps${d.weight != null ? ` @ ${d.weight} ${d.weightUnit ?? 'kg'}` : ''}`;
        } else {
          summary = type;
        }

        const rpeNote = input.rpe != null ? ` | RPE ${input.rpe}` : '';
        const setConfirmation = `Set ${setNumber} logged: ${summary}${rpeNote}.`;

        log.info(
          {
            audit: 'log_set',
            userId,
            sessionId,
            setId: set.id,
            exerciseId: input.exerciseId,
            setNumber,
            setData: set.setData,
            rpe: set.rpe,
            autoCompleted: autoCompleted ?? null,
          },
          'AUDIT: set logged',
        );

        if (autoCompleted) {
          const prevStatus = autoCompleted.setsLogged > 0 ? 'completed' : 'skipped';
          return (
            `Exercise '${autoCompleted.exerciseName}' auto-${prevStatus} ` +
            `(${autoCompleted.setsLogged} sets). ${setConfirmation}`
          );
        }

        return setConfirmation;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        log.error({ err, sessionId }, 'log_set failed');
        return `${LLM_ERROR_PREFIX} ${message}`;
      }
    },
    {
      name: 'log_set',
      description: [
        'Log a completed set for the current exercise.',
        'Always provide exerciseId (from SESSION PLAN or exercise catalog).',
        'For strength/weighted exercises: provide reps and weight (in kg).',
        'For bodyweight exercises: provide reps only.',
        'For cardio: provide durationSeconds.',
        'setNumber is computed automatically — do NOT pass it.',
        'Call once per set. For multiple sets reported at once, call log_set multiple times.',
      ].join(' '),
      schema: z
        .object({
          exerciseId: z
            .number()
            .int()
            .positive()
            .optional()
            .describe('Exercise ID from the session plan. Preferred over exerciseName.'),
          exerciseName: z.string().optional().describe('Exercise name — only if exerciseId is unknown.'),
          reps: z.number().int().positive().optional().describe('Number of repetitions performed.'),
          weight: z
            .number()
            .positive()
            .optional()
            .describe('Weight used in kilograms (kg). Omit for bodyweight exercises.'),
          durationSeconds: z
            .number()
            .int()
            .positive()
            .optional()
            .describe('Duration in seconds — only for cardio exercises.'),
          rpe: z.number().min(1).max(10).optional().describe('Rate of Perceived Exertion (1–10).'),
          feedback: z.string().optional().describe('Any user comment about this set.'),
          order: z
            .number()
            .int()
            .min(1)
            .optional()
            .describe(
              'Execution order when logging multiple sets in one response. First set = 1, second = 2, etc. Required when calling log_set more than once per response.',
            ),
        })
        .refine(d => d.exerciseId !== undefined || d.exerciseName !== undefined, {
          message: 'Either exerciseId or exerciseName must be provided',
        })
        .refine(d => d.reps !== undefined || d.durationSeconds !== undefined, {
          message: 'Either reps or durationSeconds must be provided',
        }),
    },
  );

  const nextExercise = tool(
    async (input, config) => {
      const userId = ((config?.configurable as Record<string, unknown>)?.['userId'] as string | undefined) ?? '';
      const sessionId = currentSessionIds.get(userId) ?? null;
      if (!sessionId) {
        log.error({ userId }, 'next_exercise called without active sessionId');
        return `${SYSTEM_ERROR_PREFIX} No active training session found. Cannot complete exercise.`;
      }

      try {
        // ADR-0011 Fix 2.3: optional exerciseId to navigate directly to a specific exercise
        if (input.exercise_id != null) {
          const exercise = await trainingService.startNextExercise(sessionId, input.exercise_id);
          if (!exercise) {
            return `${LLM_ERROR_PREFIX} Exercise ${input.exercise_id} not found in session.`;
          }
          return `Navigated to exercise ${exercise.exerciseId}.`;
        }

        await trainingService.completeCurrentExercise(sessionId);
        return 'Exercise marked as complete. Ready for the next one.';
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        log.error({ err, sessionId }, 'next_exercise failed');
        return `${LLM_ERROR_PREFIX} ${message}`;
      }
    },
    {
      name: 'next_exercise',
      description: [
        'Mark the current in-progress exercise as completed and move on.',
        'Call this only after the user has finished all sets of the current exercise.',
        'Do NOT call this to start the very first exercise of a session.',
        'Optionally provide exercise_id to jump to a specific exercise by its numeric ID.',
      ].join(' '),
      schema: z.object({
        exercise_id: z
          .number()
          .int()
          .optional()
          .describe('Optional numeric ID of a specific exercise to navigate to directly'),
      }),
    },
  );

  const skipExercise = tool(
    async (input, config) => {
      const userId = ((config?.configurable as Record<string, unknown>)?.['userId'] as string | undefined) ?? '';
      const sessionId = currentSessionIds.get(userId) ?? null;
      if (!sessionId) {
        log.error({ userId }, 'skip_exercise called without active sessionId');
        return `${SYSTEM_ERROR_PREFIX} No active training session found. Cannot skip exercise.`;
      }

      try {
        await trainingService.skipCurrentExercise(sessionId, input.reason);
        return `Exercise skipped${input.reason ? ` (${input.reason})` : ''}. Moving to the next one.`;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        log.error({ err, sessionId }, 'skip_exercise failed');
        return `${LLM_ERROR_PREFIX} ${message}`;
      }
    },
    {
      name: 'skip_exercise',
      description:
        'Skip the current exercise. Use when user explicitly wants to skip it (equipment busy, pain, preference).',
      schema: z.object({
        reason: z.string().optional().describe('Reason for skipping the exercise.'),
      }),
    },
  );

  const finishTraining = tool(
    async (input, config) => {
      const userId = ((config?.configurable as Record<string, unknown>)?.['userId'] as string | undefined) ?? '';
      const sessionId = currentSessionIds.get(userId) ?? null;
      if (!sessionId) {
        log.error({ userId }, 'finish_training called without active sessionId');
        return `${SYSTEM_ERROR_PREFIX} No active training session found. Cannot complete session.`;
      }

      try {
        const session = await trainingService.completeSession(sessionId);
        const duration = session.durationMinutes ?? 0;

        pendingTransitions.set(userId, {
          toPhase: 'chat' as ConversationPhase,
          reason: 'training_completed',
        });

        const feedbackNote = input.feedback ? ` Feedback: "${input.feedback}".` : '';
        return `Session completed in ${duration} min.${feedbackNote} Great work!`;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        log.error({ err, sessionId }, 'finish_training failed');
        return `${LLM_ERROR_PREFIX} ${message}`;
      }
    },
    {
      name: 'finish_training',
      description: [
        'Complete the training session and return to chat.',
        'Call only when the user confirms they are done training (all exercises complete or early finish).',
        'Do NOT call before explicit user confirmation.',
      ].join(' '),
      schema: z.object({
        feedback: z.string().optional().describe('Optional session feedback from the user.'),
      }),
    },
  );

  // -------------------------------------------------------------------------
  // ADR-0011 Phase 2: Correction tools
  // -------------------------------------------------------------------------

  const deleteLastSets = tool(
    async (input, config) => {
      const userId = ((config?.configurable as Record<string, unknown>)?.['userId'] as string | undefined) ?? '';
      const sessionId = currentSessionIds.get(userId) ?? null;
      if (!sessionId) {
        return `${SYSTEM_ERROR_PREFIX} No active training session found. Start a session first.`;
      }

      const count = input.count ?? 1;
      try {
        const result = await trainingService.deleteLastSets(sessionId, input.exercise_id, count);
        const deleted = result.deletedSets
          .map(s => `Set ${s.setNumber}: ${JSON.stringify(s.setData)}${s.rpe != null ? ` RPE ${s.rpe}` : ''}`)
          .join(', ');
        log.info(
          {
            audit: 'delete_last_sets',
            userId,
            sessionId,
            exerciseId: input.exercise_id,
            count,
            deletedSets: result.deletedSets,
          },
          'AUDIT: sets deleted',
        );
        return `Deleted ${result.deletedSets.length} set(s) for exercise ${input.exercise_id}: ${deleted}.`;
      } catch (err) {
        return `${LLM_ERROR_PREFIX} ${(err as Error).message}`;
      }
    },
    {
      name: 'delete_last_sets',
      description:
        'Delete the last N logged sets for a given exercise in the current session. ' +
        'Use this when the user says a set was logged by mistake or wants to correct a logging error. ' +
        'Default count is 1 (deletes only the most recent set).',
      schema: z.object({
        exercise_id: z.number().describe('The numeric ID of the exercise whose sets should be deleted'),
        count: z
          .number()
          .int()
          .min(1)
          .max(10)
          .optional()
          .describe('How many of the most recent sets to delete (default: 1)'),
      }),
    },
  );

  const updateLastSet = tool(
    async (input, config) => {
      const userId = ((config?.configurable as Record<string, unknown>)?.['userId'] as string | undefined) ?? '';
      const sessionId = currentSessionIds.get(userId) ?? null;
      if (!sessionId) {
        return `${SYSTEM_ERROR_PREFIX} No active training session found. Start a session first.`;
      }

      try {
        const result = await trainingService.updateLastSet(sessionId, input.exercise_id, {
          weight: input.weight,
          reps: input.reps,
          rpe: input.rpe,
          feedback: input.feedback,
        });
        const beforeStr = JSON.stringify(result.before.setData);
        const afterStr = JSON.stringify(result.after.setData);
        log.info(
          {
            audit: 'update_last_set',
            userId,
            sessionId,
            exerciseId: input.exercise_id,
            setNumber: result.setNumber,
            before: result.before,
            after: result.after,
          },
          'AUDIT: set updated',
        );
        return (
          `Set ${result.setNumber} updated for exercise ${input.exercise_id}. ` +
          `Before: ${beforeStr}${result.before.rpe != null ? ` RPE ${result.before.rpe}` : ''}. ` +
          `After: ${afterStr}${result.after.rpe != null ? ` RPE ${result.after.rpe}` : ''}.`
        );
      } catch (err) {
        return `${LLM_ERROR_PREFIX} ${(err as Error).message}`;
      }
    },
    {
      name: 'update_last_set',
      description:
        'Correct the last logged set for a given exercise — update weight, reps, RPE, or feedback. ' +
        'Use this when the user says they entered wrong numbers. ' +
        'Only provide the fields you want to change; others remain unchanged.',
      schema: z.object({
        exercise_id: z.number().describe('The numeric ID of the exercise whose last set should be updated'),
        weight: z.number().optional().describe('New weight in kg (if correcting weight)'),
        reps: z.number().int().optional().describe('New rep count (if correcting reps)'),
        rpe: z.number().min(1).max(10).optional().describe('New RPE value (if correcting perceived exertion)'),
        feedback: z.string().optional().describe('Updated feedback note from the user'),
      }),
    },
  );

  return [logSet, nextExercise, skipExercise, finishTraining, deleteLastSets, updateLastSet];
}
