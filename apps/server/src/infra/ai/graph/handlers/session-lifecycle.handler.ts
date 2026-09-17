/**
 * sessionLifecycleHandler (D-D): today's cleanupNode logic, verbatim —
 * activates a planning session on → training, completes a lingering one on
 * leaving training. Returns the new activeSessionId (null when cleared) for
 * commit to merge.
 */
import type { PhaseTransitionCommitted, TransitionHandler } from '@domain/conversation/events';
import type { ITrainingService, IWorkoutSessionRepository } from '@domain/training/ports';

import { createLogger } from '@shared/logger';

const log = createLogger('session-lifecycle-handler');

export function buildSessionLifecycleHandler(deps: {
  trainingService: ITrainingService;
  workoutSessionRepo: IWorkoutSessionRepository;
}): TransitionHandler {
  const { trainingService, workoutSessionRepo } = deps;

  return async (event: PhaseTransitionCommitted) => {
    if (event.activeSessionId && event.to === 'training') {
      // session_planning → training: activate the planning session
      const session = await trainingService.getSessionDetails(event.activeSessionId).catch(() => null);
      if (session?.status === 'planning') {
        await workoutSessionRepo
          .update(event.activeSessionId, { status: 'in_progress', startedAt: new Date() })
          .catch(() => null);
      }
      return { activeSessionId: event.activeSessionId };
    }

    if (event.activeSessionId && event.to !== 'training') {
      // Leaving training: complete the session only if not already finished
      const lingering = await trainingService.getSessionDetails(event.activeSessionId).catch(() => null);
      if (lingering && lingering.status !== 'completed' && lingering.status !== 'skipped') {
        await trainingService.completeSession(event.activeSessionId).catch(() => null);
      }
      log.info({ userId: event.userId, sessionId: event.activeSessionId }, 'Session cleared after transition');
      return { activeSessionId: null };
    }

    return {};
  };
}
