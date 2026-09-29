/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { tool } from '@langchain/core/tools';
import { z } from 'zod';

import { llmError, ok, systemError } from '@domain/conversation/tool-outcome';
import { ExerciseNotFoundError } from '@domain/training/errors';
import { isAbsent } from '@domain/training/load-facts';
import type { IExerciseRepository, ITrainingService, IWorkoutSessionRepository } from '@domain/training/ports';
import type { IUserFactsService } from '@domain/user/ports';

import { ctxOf } from '@infra/ai/graph/state';
import { loadLoadPlanEntries, planTargetRepsOf } from '@infra/ai/load-facts/load-facts.loader';
import { renderLoadPlanEntry } from '@infra/ai/prompts/blocks/training-load-plan.v1';

import { createLogger } from '@shared/logger';

import { sessionIdOf, userIdOf } from './format-exercise-summary';

const log = createLogger('training-tools');

export interface GetLoadPlanToolDeps {
  trainingService: ITrainingService;
  exerciseRepository: IExerciseRepository;
  workoutSessionRepo: IWorkoutSessionRepository;
  userFacts: IUserFactsService;
}

const GET_LOAD_PLAN_DESCRIPTION = [
  'Computed load facts for ONE exercise — reference performance, fatigue context, working weight, e1RM',
  'trend, last-exposure quality, gap in days, constraints and the equipment step. Use it when the user',
  'asks about a weight or progress for an exercise that is NOT in the LOAD PLAN block (e.g. an exercise',
  "outside today's plan). It returns facts only and recommends nothing: quote them with their dates.",
  'Identify the exercise with exerciseId when you have its exact UUID; otherwise pass the English catalog',
  'exerciseName (prefer search_exercises to get an exact exerciseId).',
  'A plain result saying there is no completed record is normal — never treat it as an error, and never',
  'tell the user they never did the exercise; say it is not in the records.',
].join(' ');

export function buildGetLoadPlanTool(deps: GetLoadPlanToolDeps) {
  const { trainingService, exerciseRepository, workoutSessionRepo, userFacts } = deps;

  return tool(
    async (input, config) => {
      const userId = userIdOf(config) ?? '';
      const sessionId = sessionIdOf(config);

      let { exerciseId } = input;
      if (!exerciseId) {
        try {
          exerciseId = await trainingService.resolveExerciseIdByName(input.exerciseName!);
        } catch (err) {
          // Same split as get_exercise_history: a genuine miss is recoverable by the model,
          // anything else (DB or embedding failure) is systemic.
          if (err instanceof ExerciseNotFoundError) {
            log.warn({ exerciseName: input.exerciseName }, 'get_load_plan: exercise name not found');
            return llmError(
              `Exercise "${input.exerciseName}" not found in the catalog.`,
              'Call search_exercises to find the correct exercise, then retry with its exerciseId.',
            );
          }
          log.error({ err, exerciseName: input.exerciseName }, 'get_load_plan: name resolution failed');
          return systemError('Could not resolve the exercise name — a database or embedding error occurred.');
        }
      }

      const runCtx = ctxOf(config as never);
      const timezone = runCtx.user?.timezone ?? null;
      const session = sessionId ? await trainingService.getSessionDetails(sessionId) : null;
      const [entry] = await loadLoadPlanEntries(
        { workoutSessionRepo, exerciseRepository, trainingService, userFacts },
        {
          userId,
          session,
          exerciseIds: [exerciseId],
          planTargetReps: planTargetRepsOf(session),
          now: runCtx.now,
          timezone,
        },
      );

      if (!entry) {
        return ok(`no completed record of ${input.exerciseName ?? 'this exercise'}`);
      }
      if (isAbsent(entry.facts.reference)) {
        return ok(`no completed record of ${entry.exercise.name}`);
      }
      return ok(renderLoadPlanEntry(entry, { now: runCtx.now, timezone, user: runCtx.user ?? null }));
    },
    {
      name: 'get_load_plan',
      description: GET_LOAD_PLAN_DESCRIPTION,
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
            .describe(
              'English catalog name of the exercise — use when its exact UUID is not known; resolved in the ' +
                'catalog. Prefer search_exercises → exerciseId when unsure of the exact catalog name.',
            ),
        })
        .refine(d => d.exerciseId !== undefined || d.exerciseName !== undefined, {
          message: 'Either exerciseId or exerciseName must be provided',
        }),
    },
  );
}
