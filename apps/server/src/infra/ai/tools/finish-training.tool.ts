/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { tool } from '@langchain/core/tools';
import { z } from 'zod';

import { llmError, ok, systemError } from '@domain/conversation/tool-outcome';
import type { ITrainingService } from '@domain/training/ports';
import { isStale, lastActivityOf } from '@domain/training/session-timing';

import { sessionIdOf, userIdOf } from '@infra/ai/tools/format-exercise-summary';

import { createLogger } from '@shared/logger';

const log = createLogger('training-tools');

export interface FinishTrainingToolDeps {
  trainingService: ITrainingService;
}

export function buildFinishTrainingTool(deps: FinishTrainingToolDeps) {
  const { trainingService } = deps;

  return tool(
    async (input, config) => {
      const userId = userIdOf(config) ?? '';
      const sessionId = sessionIdOf(config);
      if (!sessionId) {
        log.error({ userId }, 'finish_training called without active sessionId');
        return systemError('No active training session found. Cannot complete session.');
      }

      try {
        const currentSession = await trainingService.getSessionDetails(sessionId);
        const stale = currentSession ? isStale(currentSession, new Date()) : false;
        // BUG-043: completeSession clamps completedAt to startedAt.
        const completedAt = stale && currentSession ? lastActivityOf(currentSession) : undefined;
        const session = await trainingService.completeSession(sessionId, undefined, completedAt);
        const duration = session.durationMinutes ?? 0;

        log.info(
          {
            audit: 'finish_training',
            userId,
            sessionId,
            durationMinutes: duration,
            isStale: stale,
            completedAt: completedAt ?? null,
            feedback: input.feedback ?? null,
          },
          'AUDIT: training session finished',
        );

        const feedbackNote = input.feedback ? ` Feedback: "${input.feedback}".` : '';
        return {
          outcome: ok(`Session completed in ${duration} min.${feedbackNote}`),
          update: {
            pendingTransition: {
              toPhase: 'chat',
              reason: 'training_completed',
            },
          },
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        log.error({ err, sessionId }, 'finish_training failed');
        return llmError(message);
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
}
