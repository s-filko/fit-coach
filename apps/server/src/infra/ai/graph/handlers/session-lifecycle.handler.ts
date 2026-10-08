/**
 * sessionLifecycleHandler (D-D): today's cleanupNode logic, verbatim —
 * activates a planning session on → training, completes a lingering one on
 * leaving training. Returns the new activeSessionId (null when cleared) for
 * commit to merge.
 */
import type { PhaseTransitionCommitted, TransitionHandler } from '@domain/conversation/events';
import { SESSION_TIMEOUT_REASON } from '@domain/conversation/transitions';
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

    if (event.activeSessionId && event.reason === SESSION_TIMEOUT_REASON) {
      // INV-TRAINING-005: the stale session closes through the timeout path — completed_at = the
      // last activity, auto_close_reason = 'timeout' — not the explicit-finish completion below.
      await trainingService.autoCloseTimedOutSessions(event.userId);
      log.info({ userId: event.userId, sessionId: event.activeSessionId }, 'Stale session auto-closed');
      return { activeSessionId: null };
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
