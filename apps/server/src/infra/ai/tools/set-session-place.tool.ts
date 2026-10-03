/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { tool } from '@langchain/core/tools';
import { z } from 'zod';

import { llmError, ok, systemError } from '@domain/conversation/tool-outcome';
import type { ITrainingService } from '@domain/training/ports';

import { sessionIdOf, userIdOf } from '@infra/ai/tools/format-exercise-summary';

import { createLogger } from '@shared/logger';

const log = createLogger('training-tools');

export interface SetSessionPlaceToolDeps {
  trainingService: ITrainingService;
}

/**
 * set-kind plan Task 2 (D6): the narrow "I'm at a different gym today" tool — writes
 * `workout_sessions.place` for the ACTIVE session, in the user's own words. No inference, no
 * asking: the model calls it only when the user named or corrected the place themselves
 * (the prompt's v8 TOOLS entry says exactly this).
 */
export function buildSetSessionPlaceTool(deps: SetSessionPlaceToolDeps) {
  const { trainingService } = deps;

  return tool(
    async (input, config) => {
      const userId = userIdOf(config) ?? '';
      const sessionId = sessionIdOf(config);
      if (!sessionId) {
        log.error({ userId }, 'set_session_place called without active sessionId');
        return systemError('No active training session found. Cannot set place.');
      }

      try {
        const session = await trainingService.setSessionPlace(sessionId, input.place);
        log.info({ audit: 'set_session_place', userId, sessionId, place: session.place }, 'AUDIT: session place set');
        // A plain outcome — this tool requests no state change.
        return ok(`Place recorded for this session: ${session.place}. Acknowledge it briefly in the user's language.`);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        log.error({ err, sessionId }, 'set_session_place failed');
        return llmError(message);
      }
    },
    {
      name: 'set_session_place',
      description: [
        "Record where today's training session is happening.",
        'Call when the user names or corrects the place (e.g. "я сегодня в другом зале", "мы сегодня в Fitness House"), typically after the session already started.',
        "Provide place as free text in the user's own words.",
        'Do NOT bring this up on your own.',
      ].join(' '),
      schema: z.object({
        place: z
          .string()
          .min(1)
          .describe("Where the session happens, in the user's own words (e.g. 'дома', 'Fitness House на Ленина')."),
      }),
    },
  );
}
