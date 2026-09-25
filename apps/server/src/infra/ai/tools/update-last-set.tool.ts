/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { tool } from '@langchain/core/tools';
import { z } from 'zod';

import { llmError, ok, systemError } from '@domain/conversation/tool-outcome';
import type { ITrainingService } from '@domain/training/ports';

import { sessionIdOf, userIdOf } from '@infra/ai/tools/format-exercise-summary';

import { createLogger } from '@shared/logger';
import { findInErrorCauseChain } from '@shared/pg-error-cause';

const log = createLogger('training-tools');

/** Rounds to the nearest half-point; RPE is only ever meaningful in 0.5 steps. */
function roundRpeToHalf(rpe: number): number {
  return Math.round(rpe * 2) / 2;
}

/** A Postgres/driver-level failure (matched by SQLSTATE `code`, never message text) — never the model's fault. */
function isDatabaseFailure(err: unknown): boolean {
  return (
    findInErrorCauseChain(err, level =>
      typeof level.code === 'string' && /^[0-9A-Z]{5}$/.test(level.code) ? true : null,
    ) === true
  );
}

export interface UpdateLastSetToolDeps {
  trainingService: ITrainingService;
}

export function buildUpdateLastSetTool(deps: UpdateLastSetToolDeps) {
  const { trainingService } = deps;

  return tool(
    async (input, config) => {
      const userId = userIdOf(config) ?? '';
      const sessionId = sessionIdOf(config);
      if (!sessionId) {
        return systemError('No active training session found. Start a session first.');
      }

      const rpe = input.rpe != null ? roundRpeToHalf(input.rpe) : undefined;

      try {
        const result = await trainingService.updateLastSet(sessionId, input.exercise_id, {
          weight: input.weight,
          reps: input.reps,
          rpe,
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
        return ok(
          `Set ${result.setNumber} updated for exercise ${input.exercise_id}. ` +
            `Before: ${beforeStr}${result.before.rpe != null ? ` RPE ${result.before.rpe}` : ''}. ` +
            `After: ${afterStr}${result.after.rpe != null ? ` RPE ${result.after.rpe}` : ''}.`,
        );
      } catch (err) {
        if (isDatabaseFailure(err)) {
          log.error({ err, sessionId }, 'update_last_set failed: repository/DB error');
          return systemError('Could not save the update — a database error occurred. Try again.');
        }
        const message = err instanceof Error ? err.message : String(err);
        return llmError(message);
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
}
