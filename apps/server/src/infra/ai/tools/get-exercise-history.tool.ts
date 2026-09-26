/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { tool } from '@langchain/core/tools';
import { z } from 'zod';

import { llmError, ok } from '@domain/conversation/tool-outcome';
import type { IExerciseRepository, ITrainingService, IWorkoutSessionRepository } from '@domain/training/ports';

import { ctxOf } from '@infra/ai/graph/state';
import { formatDateAge } from '@infra/ai/prompts/blocks/training-exercise-history.v1';
import { formatExerciseSets } from '@infra/ai/prompts/blocks/training-workout-overview.v1';
import type { ContextBlockCtx } from '@infra/ai/prompts/blocks/types';

import { createLogger } from '@shared/logger';

import { sessionIdOf, userIdOf } from './format-exercise-summary';

const log = createLogger('training-tools');

const DEFAULT_LIMIT = 3;
const MAX_LIMIT = 5;

export interface GetExerciseHistoryToolDeps {
  trainingService: ITrainingService;
  exerciseRepository: IExerciseRepository;
  workoutSessionRepo: IWorkoutSessionRepository;
}

const GET_EXERCISE_HISTORY_DESCRIPTION = [
  "Look up an exercise's real completed history — use this when the user asks about an exercise that is",
  'NOT shown in EXERCISE HISTORY or RECENT WORKOUTS (e.g. "how much did I bench last time?" for an exercise',
  "not in today's plan).",
  'Identify the exercise with exerciseId when you have its exact UUID, or exerciseName otherwise (resolved',
  'in the catalog, same as log_set). If the name cannot be resolved, call search_exercises first.',
  'Returns up to `limit` (default 3, max 5) past performances, newest first, each dated and with its sets.',
  'A plain result saying there is no completed record is normal — never treat it as an error, and never',
  'tell the user they never did the exercise; say it is not in the records.',
].join(' ');

export function buildGetExerciseHistoryTool(deps: GetExerciseHistoryToolDeps) {
  const { trainingService, exerciseRepository, workoutSessionRepo } = deps;

  return tool(
    async (input, config) => {
      const userId = userIdOf(config) ?? '';
      const sessionId = sessionIdOf(config) ?? '';
      const limit = Math.min(input.limit ?? DEFAULT_LIMIT, MAX_LIMIT);

      let { exerciseId } = input;
      if (!exerciseId) {
        try {
          exerciseId = await trainingService.resolveExerciseIdByName(input.exerciseName!);
        } catch (err) {
          log.warn({ err, exerciseName: input.exerciseName }, 'get_exercise_history: name resolution failed');
          return llmError(
            `Exercise "${input.exerciseName}" not found in the catalog.`,
            'Call search_exercises to find the correct exercise, then retry with its exerciseId.',
          );
        }
      }

      const exercise = await exerciseRepository.findById(exerciseId);
      const exerciseName = exercise?.name ?? input.exerciseName ?? 'Exercise';

      const performances = await workoutSessionRepo.findRecentPerformancesForExercise(
        userId,
        exerciseId,
        sessionId,
        limit,
      );

      if (performances.length === 0) {
        return ok(`no completed record of ${exerciseName}`);
      }

      const runCtx = ctxOf(config as never);
      const ctx: ContextBlockCtx = {
        now: runCtx.now,
        timezone: runCtx.user?.timezone ?? null,
        user: runCtx.user ?? null,
      };

      const blocks = performances.map(p => {
        const when = formatDateAge(p.completedAt, ctx);
        return `${when}\n${formatExerciseSets(p.sessionExercise.sets, p.sessionExercise.userFeedback)}`;
      });

      return ok(
        `${exerciseName} [ID:${exerciseId}] — last ${performances.length} performance(s):\n\n${blocks.join('\n\n')}`,
      );
    },
    {
      name: 'get_exercise_history',
      description: GET_EXERCISE_HISTORY_DESCRIPTION,
      schema: z
        .object({
          exerciseId: z
            .string()
            .uuid()
            .optional()
            .describe('Exercise UUID copied verbatim from the session plan or a search_exercises result.'),
          exerciseName: z
            .string()
            .optional()
            .describe('Exercise name — use when its exact UUID is not known; resolved in the catalog.'),
          limit: z
            .number()
            .int()
            .min(1)
            .max(MAX_LIMIT)
            .optional()
            .describe(`Number of past performances to return (default ${DEFAULT_LIMIT}, max ${MAX_LIMIT}).`),
        })
        .refine(d => d.exerciseId !== undefined || d.exerciseName !== undefined, {
          message: 'Either exerciseId or exerciseName must be provided',
        }),
    },
  );
}
