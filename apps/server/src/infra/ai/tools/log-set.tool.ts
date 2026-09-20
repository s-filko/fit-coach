/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { tool } from '@langchain/core/tools';
import { z } from 'zod';

import { llmError, ok, systemError } from '@domain/conversation/tool-outcome';
import type { ITrainingService } from '@domain/training/ports';
import { SetDataSchema } from '@domain/training/set-data.types';

import {
  formatExerciseSummary,
  RETRO_SET_OFFSET_MS,
  SESSION_TIMEOUT_MS,
  sessionIdOf,
} from '@infra/ai/tools/format-exercise-summary';

import { createLogger } from '@shared/logger';

import { userIdOf } from './format-exercise-summary';

const log = createLogger('training-tools');

export interface LogSetToolDeps {
  trainingService: ITrainingService;
}

export function buildLogSetTool(deps: LogSetToolDeps) {
  const { trainingService } = deps;

  return tool(
    async (input, config) => {
      const userId = userIdOf(config) ?? '';
      const sessionId = sessionIdOf(config);
      if (!sessionId) {
        log.error({ userId }, 'log_set called without active sessionId');
        return systemError('No active training session found. Cannot log set.');
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
        return llmError(`Invalid set data: ${parsed.error.message}`);
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
          return ok(`${setConfirmation}\n\n${prevSummary}`);
        }

        return ok(setConfirmation);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        log.error({ err, sessionId }, 'log_set failed');
        return llmError(message);
      }
    },
    {
      name: 'log_set',
      description: [
        'Log a completed set for the current exercise.',
        'Identify the exercise with exerciseId ONLY when you have its exact UUID — copied verbatim from the SESSION PLAN or from a search_exercises result ("ID:..." line).',
        'If the exercise is not in the plan and you do not have its exact UUID, pass exerciseName instead (the server resolves it in the catalog) — never invent or guess a UUID.',
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
            .describe(
              'Exercise UUID copied verbatim from the session plan or search_exercises results. Never invent one.',
            ),
          exerciseName: z
            .string()
            .optional()
            .describe(
              'Exercise name — use when the exercise is not in the session plan and its exact UUID is unknown.',
            ),
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
}
