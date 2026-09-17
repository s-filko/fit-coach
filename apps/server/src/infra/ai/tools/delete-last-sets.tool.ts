/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { tool } from '@langchain/core/tools';
import { z } from 'zod';

import { llmError, ok, systemError } from '@domain/conversation/tool-outcome';
import type { ITrainingService } from '@domain/training/ports';

import { sessionIdOf } from '@infra/ai/tools/format-exercise-summary';

import { createLogger } from '@shared/logger';

const log = createLogger('training-tools');

export interface DeleteLastSetsToolDeps {
  trainingService: ITrainingService;
}

export function buildDeleteLastSetsTool(deps: DeleteLastSetsToolDeps) {
  const { trainingService } = deps;

  return tool(
    async (input, config) => {
      const userId = ((config?.configurable as Record<string, unknown>)?.['userId'] as string | undefined) ?? '';
      const sessionId = sessionIdOf(config);
      if (!sessionId) {
        return systemError('No active training session found. Start a session first.');
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
        return ok(`Deleted ${result.deletedSets.length} set(s) for exercise ${input.exercise_id}: ${deleted}.`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return llmError(message);
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
}
