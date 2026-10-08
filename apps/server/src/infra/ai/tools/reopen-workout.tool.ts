/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { tool } from '@langchain/core/tools';
import { z } from 'zod';

import { ok, userError } from '@domain/conversation/tool-outcome';
import { ActiveSessionExistsError, NoCompletedSessionError } from '@domain/training/errors';
import type { ITrainingService } from '@domain/training/ports';
import type { WorkoutSessionWithDetails } from '@domain/training/types';

import { maybeCtxOf } from '@infra/ai/graph/state';
import { userIdOf } from '@infra/ai/tools/format-exercise-summary';

export interface ReopenWorkoutToolDeps {
  trainingService: ITrainingService;
}

const REOPEN_WORKOUT_DESCRIPTION = [
  'Reopens the user’s most recent finished workout so sets can be added or corrected;',
  'the sets already logged are kept.',
].join(' ');

/** "Thu Oct 8" / "09:54" in the user's timezone (UTC when unknown) — facts for the reply. */
const dayOf = (at: Date, timeZone?: string): string =>
  new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone }).format(at);

const timeOf = (at: Date, timeZone?: string): string =>
  new Intl.DateTimeFormat('en-US', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone }).format(at);

/** The factual reopen line (BUG-053 T2): which workout, its window, how much of it is logged. */
export function reopenWorkoutSummary(session: WorkoutSessionWithDetails, timeZone?: string): string {
  const name = session.sessionPlanJson?.sessionName ?? session.sessionKey ?? 'workout';
  const anchor = session.startedAt ?? session.createdAt;
  const started = session.startedAt ? `started ${timeOf(session.startedAt, timeZone)}` : 'start time unknown';
  const last = `last activity ${timeOf(session.lastActivityAt, timeZone)}`;
  const withSets = session.exercises.filter(ex => ex.sets.length > 0).length;
  const progress =
    session.exercises.length === 0
      ? 'no exercises logged'
      : `${withSets} of ${session.exercises.length} exercises logged`;
  return `Workout ${name} (${dayOf(anchor, timeZone)}) reopened (${started}, ${last}; ${progress}).`;
}

export function buildReopenWorkoutTool(deps: ReopenWorkoutToolDeps) {
  const { trainingService } = deps;

  return tool(
    async (_input, config) => {
      const userId = userIdOf(config);
      if (!userId) {
        return userError('Error: could not identify user. Please try again.');
      }
      const timeZone = maybeCtxOf(config as never)?.user?.timezone ?? undefined;

      try {
        const session = await trainingService.reopenLastSession(userId);
        return {
          outcome: ok(reopenWorkoutSummary(session, timeZone)),
          update: {
            pendingTransition: { toPhase: 'training', reason: 'workout_reopened' },
            activeSessionId: session.id,
          },
        };
      } catch (err) {
        // Business refusals (ADR-0013 §6): a valid call the rule says no to — the model relays
        // the domain message to the user; nothing about the arguments could fix it.
        if (err instanceof ActiveSessionExistsError || err instanceof NoCompletedSessionError) {
          return userError(err.message);
        }
        return userError('Error reopening the workout. Please try again.');
      }
    },
    {
      name: 'reopen_workout',
      description: REOPEN_WORKOUT_DESCRIPTION,
      schema: z.object({}),
    },
  );
}
