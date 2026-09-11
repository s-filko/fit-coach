/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { tool } from '@langchain/core/tools';
import { z } from 'zod';

import type { TransitionRequest } from '@domain/conversation/graph/conversation.state';
import type { ConversationPhase } from '@domain/conversation/ports';
import type {
  AutoCompletedExercise,
  IEmbeddingService,
  IExerciseRepository,
  ITrainingService,
} from '@domain/training/ports';
import { SetDataSchema } from '@domain/training/set-data.types';

import type { IPendingRefMap } from '@infra/ai/graph/pending-ref-map';
import { buildSearchExercisesTool } from '@infra/ai/graph/tools/search-exercises.tool';

import { createLogger } from '@shared/logger';

const log = createLogger('training-tools');

const SESSION_TIMEOUT_MS = 2 * 60 * 60 * 1000;
const RETRO_SET_OFFSET_MS = 5 * 60 * 1000;

function formatExerciseSummary(ex: AutoCompletedExercise): string {
  const setsDetail = ex.sets
    .map(s => {
      const parts = [`Set ${s.setNumber}:`];
      if (s.reps != null) {
        parts.push(`${s.reps} reps`);
      }
      if (s.weight != null) {
        parts.push(`@ ${s.weight} ${s.weightUnit ?? 'kg'}`);
      }
      if (s.duration != null) {
        parts.push(`${s.duration}s`);
      }
      if (s.rpe != null) {
        parts.push(`| RPE ${s.rpe}`);
      }
      return '  ' + parts.join(' ');
    })
    .join('\n');
  const targetWeightStr = ex.targetWeight ? ` @ ${ex.targetWeight} kg` : '';
  const target = `Target: ${ex.targetSets ?? '?'}x${ex.targetReps ?? '?'}${targetWeightStr}`;
  return (
    `Exercise '${ex.exerciseName}' completed.\n` +
    `${target}\n` +
    `Sets performed:\n${setsDetail}\n` +
    `Total: ${ex.setsLogged}/${ex.targetSets ?? '?'} sets.\n` +
    'Summarize this exercise for the user: list the sets, analyze RPE trend, compare to target, give a coaching comment. Then announce the next exercise from SESSION PLAN.'
  );
}

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
  exerciseRepository: IExerciseRepository;
  embeddingService: IEmbeddingService;
  /** Per-user map — finish_training sets entry by userId, extractNode deletes it */
  pendingTransitions: IPendingRefMap<TransitionRequest | null>;
  /** Per-user map — agentNode sets current sessionId by userId before each model.invoke */
  currentSessionIds: IPendingRefMap<string | null>;
}

export function buildTrainingTools(deps: TrainingToolsDeps) {
  const { trainingService, exerciseRepository, embeddingService, pendingTransitions, currentSessionIds } = deps;
  const searchExercises = buildSearchExercisesTool({ embeddingService, exerciseRepository });

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
        if (input.distanceKm != null) {
          return {
            type: 'cardio_distance' as const,
            distance: input.distanceKm,
            distanceUnit: 'km' as const,
            duration: input.durationSeconds ?? 0,
            ...(input.inclinePct != null && { inclinePct: input.inclinePct }),
          };
        }
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
        const session = await trainingService.getSessionDetails(sessionId);
        const lastActivity = session?.lastActivityAt ?? session?.updatedAt ?? session?.createdAt;
        const lastActivityDate = lastActivity ? new Date(lastActivity) : new Date();
        const sessionIdleMs = Date.now() - lastActivityDate.getTime();
        const isRetro = sessionIdleMs > SESSION_TIMEOUT_MS;

        let retroCreatedAt: Date | undefined;
        if (isRetro) {
          retroCreatedAt = new Date(lastActivityDate.getTime() + RETRO_SET_OFFSET_MS);
        }

        const { set, setNumber, autoCompleted } = await trainingService.logSetWithContext(sessionId, {
          exerciseId: input.exerciseId,
          exerciseName: input.exerciseName,
          setData: parsed.data,
          rpe: input.rpe,
          feedback: input.feedback,
          createdAt: retroCreatedAt,
          skipActivityUpdate: isRetro,
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
        const retroNote = isRetro ? ' (retro-logged)' : '';
        const setConfirmation = `Set ${setNumber} logged: ${summary}${rpeNote}${retroNote}.`;

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
            isRetro,
            retroCreatedAt: retroCreatedAt ?? null,
            autoCompleted: autoCompleted ?? null,
          },
          'AUDIT: set logged',
        );

        if (autoCompleted) {
          const prevSummary = formatExerciseSummary(autoCompleted);
          return `${setConfirmation}\n\n${prevSummary}`;
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
        'For cardio duration (bike, elliptical): provide durationSeconds only.',
        'For cardio distance (treadmill, running): provide distanceKm. durationSeconds is optional — if unknown, log without it and ask the user. Optionally: inclinePct (treadmill only).',
        'setNumber is computed automatically — do NOT pass it.',
        'Call once per set. For multiple sets reported at once, call log_set multiple times.',
      ].join(' '),
      schema: z
        .object({
          exerciseId: z
            .string()
            .uuid()
            .optional()
            .describe('Exercise UUID from the session plan. Preferred over exerciseName.'),
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
            .describe('Duration in seconds — for cardio exercises.'),
          distanceKm: z
            .number()
            .positive()
            .optional()
            .describe(
              'Distance in km — only for cardio_distance exercises (treadmill, running). Triggers cardio_distance set type when combined with durationSeconds.',
            ),
          inclinePct: z
            .number()
            .min(0)
            .max(30)
            .optional()
            .describe('Treadmill incline in percent (0–30). Only for treadmill. Do NOT use for strength exercises.'),
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
        .refine(d => d.reps !== undefined || d.durationSeconds !== undefined || d.distanceKm !== undefined, {
          message: 'Either reps, durationSeconds, or distanceKm must be provided',
        }),
    },
  );

  const completeCurrentExercise = tool(
    async (_input, config) => {
      const userId = ((config?.configurable as Record<string, unknown>)?.['userId'] as string | undefined) ?? '';
      const sessionId = currentSessionIds.get(userId) ?? null;
      if (!sessionId) {
        log.error({ userId }, 'complete_current_exercise called without active sessionId');
        return `${SYSTEM_ERROR_PREFIX} No active training session found. Cannot complete exercise.`;
      }

      try {
        const summary = await trainingService.completeCurrentExercise(sessionId);

        log.info(
          {
            audit: 'complete_exercise',
            userId,
            sessionId,
            exerciseId: summary.exerciseId,
            setsLogged: summary.setsLogged,
          },
          'AUDIT: exercise completed',
        );

        return formatExerciseSummary(summary);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        log.error({ err, sessionId }, 'complete_current_exercise failed');
        return `${LLM_ERROR_PREFIX} ${message}`;
      }
    },
    {
      name: 'complete_current_exercise',
      description: [
        'Mark the current in-progress exercise as completed.',
        'Call ONLY when the user explicitly says they are done with this exercise',
        '("next", "done with this", "moving on", "following exercise").',
        'Do NOT call automatically after the planned number of sets — wait for the user.',
      ].join(' '),
      schema: z.object({}),
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
        const currentSession = await trainingService.getSessionDetails(sessionId);
        const lastActivity = currentSession?.lastActivityAt ?? currentSession?.updatedAt ?? currentSession?.createdAt;
        const lastActivityDate = lastActivity ? new Date(lastActivity) : undefined;
        const sessionIdleMs = lastActivityDate ? Date.now() - lastActivityDate.getTime() : 0;
        const isStale = sessionIdleMs > SESSION_TIMEOUT_MS;

        const completedAt = isStale ? lastActivityDate : undefined;
        const session = await trainingService.completeSession(sessionId, undefined, completedAt);
        const duration = session.durationMinutes ?? 0;

        pendingTransitions.set(userId, {
          toPhase: 'chat' as ConversationPhase,
          reason: 'training_completed',
        });

        log.info(
          {
            audit: 'finish_training',
            userId,
            sessionId,
            durationMinutes: duration,
            isStale,
            completedAt: completedAt ?? null,
            feedback: input.feedback ?? null,
          },
          'AUDIT: training session finished',
        );

        const feedbackNote = input.feedback ? ` Feedback: "${input.feedback}".` : '';
        return [
          `Session completed in ${duration} min.${feedbackNote}`,
          'Now congratulate the user in their language',
          '— summarize the workout briefly and wish them recovery.',
        ].join(' ');
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
        'Call when: (1) user confirms they are done training, OR (2) session is stale and user wants to move on.',
        'Do NOT call before explicit user confirmation or clear intent to start a new topic.',
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
        const message = err instanceof Error ? err.message : String(err);
        return `${LLM_ERROR_PREFIX} ${message}`;
      }
    },
    {
      name: 'delete_last_sets',
      description:
        'Delete the last N logged sets for a given exercise in the current session. ' +
        'Use this when the user says a set was logged by mistake or wants to correct a logging error. ' +
        'Default count is 1 (deletes only the most recent set).',
      schema: z.object({
        exercise_id: z.string().uuid().describe('The UUID of the exercise whose sets should be deleted'),
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
          durationSeconds: input.durationSeconds,
          distanceKm: input.distanceKm,
          inclinePct: input.inclinePct,
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
        const message = err instanceof Error ? err.message : String(err);
        return `${LLM_ERROR_PREFIX} ${message}`;
      }
    },
    {
      name: 'update_last_set',
      description:
        'Correct the last logged set for a given exercise — update weight, reps, RPE, feedback, or cardio fields. ' +
        'Use this when the user says they entered wrong numbers, or to add missing duration to a cardio_distance set logged without time. ' +
        'Only provide the fields you want to change; others remain unchanged.',
      schema: z.object({
        exercise_id: z.string().uuid().describe('The UUID of the exercise whose last set should be updated'),
        weight: z.number().optional().describe('New weight in kg (if correcting weight)'),
        reps: z.number().int().optional().describe('New rep count (if correcting reps)'),
        rpe: z.number().min(1).max(10).optional().describe('New RPE value (if correcting perceived exertion)'),
        feedback: z.string().optional().describe('Updated feedback note from the user'),
        durationSeconds: z
          .number()
          .int()
          .positive()
          .optional()
          .describe('Duration in seconds — use to add missing time to a cardio_distance set'),
        distanceKm: z
          .number()
          .positive()
          .optional()
          .describe('Distance in km — use to correct distance on a cardio_distance set'),
        inclinePct: z
          .number()
          .min(0)
          .max(30)
          .optional()
          .describe('Treadmill incline in percent — use to add/correct incline on a cardio_distance set'),
      }),
    },
  );

  return [searchExercises, logSet, completeCurrentExercise, finishTraining, deleteLastSets, updateLastSet];
}
