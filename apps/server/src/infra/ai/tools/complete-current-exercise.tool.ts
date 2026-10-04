/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { tool } from '@langchain/core/tools';
import { z } from 'zod';

import { llmError, ok, systemError } from '@domain/conversation/tool-outcome';
import type { ITrainingService } from '@domain/training/ports';

import { formatExerciseSummary, sessionIdOf, userIdOf } from '@infra/ai/tools/format-exercise-summary';

import { createLogger } from '@shared/logger';

const log = createLogger('training-tools');

export interface CompleteCurrentExerciseToolDeps {
  trainingService: ITrainingService;
}

export function buildCompleteCurrentExerciseTool(deps: CompleteCurrentExerciseToolDeps) {
  const { trainingService } = deps;

  return tool(
    async (_input, config) => {
      const userId = userIdOf(config) ?? '';
      const sessionId = sessionIdOf(config);
      if (!sessionId) {
        log.error({ userId }, 'complete_current_exercise called without active sessionId');
        return systemError('No active training session found. Cannot complete exercise.');
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

        return ok(formatExerciseSummary(summary));
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        log.error({ err, sessionId }, 'complete_current_exercise failed');
        return llmError(message);
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
}
