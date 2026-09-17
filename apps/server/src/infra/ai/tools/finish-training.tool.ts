/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { tool } from '@langchain/core/tools';
import { z } from 'zod';

import { llmError, ok, systemError } from '@domain/conversation/tool-outcome';
import type { ITrainingService } from '@domain/training/ports';

import { SESSION_TIMEOUT_MS, sessionIdOf } from '@infra/ai/tools/format-exercise-summary';

import { createLogger } from '@shared/logger';

const log = createLogger('training-tools');

export interface FinishTrainingToolDeps {
  trainingService: ITrainingService;
}

export function buildFinishTrainingTool(deps: FinishTrainingToolDeps) {
  const { trainingService } = deps;

  return tool(
    async (input, config) => {
      const userId = ((config?.configurable as Record<string, unknown>)?.['userId'] as string | undefined) ?? '';
      const sessionId = sessionIdOf(config);
      if (!sessionId) {
        log.error({ userId }, 'finish_training called without active sessionId');
        return systemError('No active training session found. Cannot complete session.');
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
        return {
          outcome: ok(
            [
              `Session completed in ${duration} min.${feedbackNote}`,
              'Now congratulate the user in their language',
              '— summarize the workout briefly and wish them recovery.',
            ].join(' '),
          ),
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
