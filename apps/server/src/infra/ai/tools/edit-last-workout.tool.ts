/* eslint-disable @typescript-eslint/explicit-function-return-type */
/**
 * edit_last_workout (BUG-053, stale-session-autoclose plan T5 / AC-SSA-5): one tool, an `action`
 * field (the manage_fact shape), edits the user's most recent FINISHED workout in place — the
 * workout stays closed and the conversation stays where it is. It owns no set logic: `add` goes
 * through `logSetWithContext` (the path `log_set` uses — the same set-data mapping, weight carry
 * and per-hand rules — with the workout's retro timestamp, BR-TRAINING-049), `update` through
 * `updateLastSet` (the conversions `update_last_set` applies), `delete` through `deleteSet`.
 */
import { tool } from '@langchain/core/tools';
import { z } from 'zod';

import { llmError, ok, systemError, userError } from '@domain/conversation/tool-outcome';
import type { ITrainingService } from '@domain/training/ports';
import { lastActivityOf, RETRO_SET_OFFSET_MS } from '@domain/training/session-timing';
import { SetDataSchema } from '@domain/training/set-data.types';
import type { WorkoutSessionWithDetails } from '@domain/training/types';

import { maybeCtxOf } from '@infra/ai/graph/state';
import { formatExerciseSets, formatSetData } from '@infra/ai/prompts/blocks/set-format';
import { userIdOf } from '@infra/ai/tools/format-exercise-summary';
import { flatSetData } from '@infra/ai/tools/set-input';

import { createLogger } from '@shared/logger';
import { isDatabaseFailure } from '@shared/pg-error-cause';
import { roundRpeToHalf } from '@shared/rpe';

const log = createLogger('training-tools');

export interface EditLastWorkoutToolDeps {
  trainingService: ITrainingService;
}

const EDIT_LAST_WORKOUT_DESCRIPTION = [
  'Edits the user’s most recent finished workout in place; the workout stays finished.',
  'action "add": adds a set to an exercise (reps, weight in kg — optional for bodyweight exercises —, durationSeconds or distanceKm), with the same validation as log_set; an exercise that is not in the workout is added to it.',
  'action "update": changes the exercise’s set setNumber (default: its last set) to the given values.',
  'action "delete": removes the exercise’s set setNumber.',
  'Without an action, the exercise’s sets in that workout are returned; without an exercise, the whole workout.',
  'The exercise is identified by exerciseId (an exact UUID) or exerciseName.',
].join(' ');

type EditInput = z.infer<typeof EditLastWorkoutSchema>;
type FinishedExercise = WorkoutSessionWithDetails['exercises'][number];

/** "Sun, Oct 4" in the user's timezone (UTC when unknown). */
const dayOf = (at: Date, timeZone?: string): string =>
  new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone }).format(at);

const workoutDay = (session: WorkoutSessionWithDetails, timeZone?: string): string =>
  dayOf(session.startedAt ?? session.createdAt, timeZone);

const sortedSets = (ex: FinishedExercise): FinishedExercise['sets'] =>
  [...ex.sets].sort((a, b) => a.setNumber - b.setNumber);

/** The exercise's header and its sets in the workout — the facts every reply ends with. */
function exerciseReply(
  ex: FinishedExercise,
  session: WorkoutSessionWithDetails,
  change: string | null,
  timeZone?: string,
): string {
  const head = `${ex.exercise.name}, ${workoutDay(session, timeZone)}${change ? `: ${change}` : ''}`;
  return `${head}\n${formatExerciseSets(sortedSets(ex), null)}`;
}

/** The whole workout, one block per exercise (no exercise given, no change). */
function workoutReply(session: WorkoutSessionWithDetails, timeZone?: string): string {
  const name = session.sessionPlanJson?.sessionName ?? session.sessionKey ?? 'workout';
  const head = `Finished workout ${name}, ${workoutDay(session, timeZone)}:`;
  if (session.exercises.length === 0) {
    return `${head}\nNo exercises logged.`;
  }
  const blocks = session.exercises.map(ex => `${ex.exercise.name}\n${formatExerciseSets(sortedSets(ex), null)}`);
  return `${head}\n${blocks.join('\n')}`;
}

const hasChange = (input: EditInput): boolean =>
  [
    input.reps,
    input.weight,
    input.durationSeconds,
    input.distanceKm,
    input.inclinePct,
    input.rpe,
    input.feedback,
    input.setKind,
  ].some(v => v != null);

export function buildEditLastWorkoutTool(deps: EditLastWorkoutToolDeps) {
  const { trainingService } = deps;

  /** The workout's exercise row for an id or a name; the catalog resolves a name the workout lacks. */
  const exerciseIdOf = async (input: EditInput, session: WorkoutSessionWithDetails): Promise<string | null> => {
    if (input.exerciseId) {
      return input.exerciseId;
    }
    if (!input.exerciseName) {
      return null;
    }
    const wanted = input.exerciseName.trim().toLowerCase();
    const inWorkout = session.exercises.find(ex => ex.exercise.name.toLowerCase() === wanted);
    return inWorkout ? inWorkout.exerciseId : trainingService.resolveExerciseIdByName(input.exerciseName);
  };

  return tool(
    async (input, config) => {
      const userId = userIdOf(config);
      if (!userId) {
        return userError('Error: could not identify user. Please try again.');
      }
      const timeZone = maybeCtxOf(config as never)?.user?.timezone ?? undefined;

      try {
        const session = await trainingService.getLastFinishedSession(userId);
        if (!session) {
          return userError('No finished workout to edit.');
        }

        if (input.action === undefined || (input.action === 'update' && !hasChange(input))) {
          return await view(input, session, timeZone);
        }

        if (input.action === 'add') {
          return await add(input, userId, session, timeZone);
        }
        const exerciseId = await exerciseIdOf(input, session);
        if (!exerciseId) {
          return llmError('Either exerciseId or exerciseName must be provided');
        }
        if (input.action === 'update') {
          const rpe = input.rpe != null ? roundRpeToHalf(input.rpe) : undefined;
          const result = await trainingService.updateLastSet(
            session.id,
            exerciseId,
            {
              weight: input.weight,
              reps: input.reps,
              rpe,
              feedback: input.feedback,
              durationSeconds: input.durationSeconds,
              distanceKm: input.distanceKm,
              inclinePct: input.inclinePct,
              setKind: input.setKind,
            },
            { setNumber: input.setNumber },
          );
          log.info(
            { audit: 'edit_last_workout', action: 'update', userId, sessionId: session.id, exerciseId, result },
            'AUDIT: finished-workout set updated',
          );
          const note = `set ${result.setNumber} updated: ${formatSetData(result.before.setData)} → ${formatSetData(result.after.setData)}`;
          return await replyAfter(session.id, exerciseId, note, timeZone);
        }
        // delete
        if (input.setNumber == null) {
          return llmError('setNumber is required to delete a set.');
        }
        const result = await trainingService.deleteSet(session.id, exerciseId, input.setNumber);
        log.info(
          { audit: 'edit_last_workout', action: 'delete', userId, sessionId: session.id, exerciseId, result },
          'AUDIT: finished-workout set deleted',
        );
        const [removed] = result.deletedSets;
        if (!removed) {
          return llmError(`Set ${input.setNumber} was not found.`);
        }
        return await replyAfter(
          session.id,
          exerciseId,
          `set ${removed.setNumber} deleted: ${formatSetData(removed.setData)}`,
          timeZone,
        );
      } catch (err) {
        if (isDatabaseFailure(err)) {
          log.error({ err }, 'edit_last_workout failed: repository/DB error');
          return systemError('Could not save the change — a database error occurred. Try again.');
        }
        const message = err instanceof Error ? err.message : 'Unknown error';
        log.error({ err }, 'edit_last_workout failed');
        return llmError(message);
      }
    },
    {
      name: 'edit_last_workout',
      description: EDIT_LAST_WORKOUT_DESCRIPTION,
      schema: EditLastWorkoutSchema,
    },
  );

  /** Re-reads the workout after a write and states the exercise's sets as they are now. */
  async function replyAfter(sessionId: string, exerciseId: string, change: string, timeZone?: string) {
    const after = await trainingService.getSessionDetails(sessionId);
    const ex = after?.exercises.find(e => e.exerciseId === exerciseId);
    if (!after || !ex) {
      return ok(`${change}.`);
    }
    return ok(exerciseReply(ex, after, change, timeZone));
  }

  async function view(input: EditInput, session: WorkoutSessionWithDetails, timeZone?: string) {
    if (!input.exerciseId && !input.exerciseName) {
      return ok(workoutReply(session, timeZone));
    }
    const exerciseId = await exerciseIdOf(input, session);
    const ex = session.exercises.find(e => e.exerciseId === exerciseId);
    if (!ex) {
      return ok(
        `${input.exerciseName ?? input.exerciseId} is not in the finished workout of ${workoutDay(session, timeZone)}.`,
      );
    }
    return ok(exerciseReply(ex, session, null, timeZone));
  }

  async function add(input: EditInput, userId: string, session: WorkoutSessionWithDetails, timeZone?: string) {
    if (!input.exerciseId && !input.exerciseName) {
      return llmError('Either exerciseId or exerciseName must be provided');
    }
    if (input.reps == null && input.durationSeconds == null && input.distanceKm == null) {
      return llmError('Either reps, durationSeconds, or distanceKm must be provided to add a set.');
    }
    const parsed = SetDataSchema.safeParse(flatSetData(input));
    if (!parsed.success) {
      return llmError(`Invalid set data: ${parsed.error.message}`);
    }
    const rpe = input.rpe != null ? roundRpeToHalf(input.rpe) : undefined;
    // BR-TRAINING-049: the added set is dated to the workout (last activity + the retro offset).
    const createdAt = new Date(lastActivityOf(session).getTime() + RETRO_SET_OFFSET_MS);

    const { set, setNumber } = await trainingService.logSetWithContext(session.id, {
      exerciseId: input.exerciseId,
      exerciseName: input.exerciseName,
      setData: parsed.data,
      rpe,
      feedback: input.feedback,
      createdAt,
      skipActivityUpdate: true,
      finishedSession: true,
      setKind: input.setKind,
      weightBasis: input.weightBasis,
      // AC-PTF-7: the service judges reps-without-weight by the exercise's weight_mode — the same
      // rule, decided before any mutation, as for log_set.
      weightOmitted: input.reps != null && input.weight == null,
    });
    log.info(
      {
        audit: 'edit_last_workout',
        action: 'add',
        userId,
        sessionId: session.id,
        setId: set.id,
        setNumber,
        setData: set.setData,
        createdAt,
      },
      'AUDIT: set added to the finished workout',
    );
    const after = await trainingService.getSessionDetails(session.id);
    const ex = after?.exercises.find(e => e.id === set.sessionExerciseId);
    const note = `set ${setNumber} added: ${formatSetData(set.setData)}`;
    return ok(after && ex ? exerciseReply(ex, after, note, timeZone) : `${note}.`);
  }
}

const EditLastWorkoutSchema = z.object({
  action: z.enum(['add', 'update', 'delete']).optional().describe('What to do; omitted returns the sets.'),
  exerciseId: z.string().uuid().optional().describe('Exercise UUID — an exact id from the context or search results.'),
  exerciseName: z.string().optional().describe('Exercise name, when the exact UUID is not known.'),
  setNumber: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe('The set to update (default: the last set) or delete (required).'),
  reps: z.number().int().positive().optional().describe('Number of repetitions.'),
  weight: z
    .number()
    .min(0)
    .optional()
    .describe('Weight in kilograms; 0 = bodyweight. Required for exercises that use a weight.'),
  durationSeconds: z.number().int().positive().optional().describe('Duration in seconds (cardio, isometric holds).'),
  distanceKm: z.number().positive().optional().describe('Distance in km (cardio_distance exercises).'),
  inclinePct: z.number().min(0).max(30).optional().describe('Treadmill incline in percent (0–30).'),
  rpe: z.number().min(1).max(10).optional().describe('Rate of Perceived Exertion (1–10).'),
  feedback: z.string().optional().describe('The user’s comment about the set.'),
  setKind: z.enum(['warmup', 'working']).optional().describe('Whether the set is a warm-up or a working set.'),
  weightBasis: z
    .enum(['total'])
    .optional()
    .describe('For a dumbbell/kettlebell exercise: the weight given is a combined/total figure, not per hand.'),
});
