import { ConversationStateType } from '@domain/conversation/graph/conversation.state';
import { ConversationPhase } from '@domain/conversation/ports';
import type { ITrainingService } from '@domain/training/ports';
import type { IUserService } from '@domain/user/ports';

import { createLogger } from '@shared/logger';

const log = createLogger('router-node');

const SESSION_TIMEOUT_MS = 2 * 60 * 60 * 1000;

export interface RouterNodeDeps {
  userService: IUserService;
  trainingService: ITrainingService;
}

export function buildRouterNode(deps: RouterNodeDeps) {
  const { userService, trainingService } = deps;

  return async function routerNode(
    state: ConversationStateType,
  ): Promise<Partial<ConversationStateType>> {
    const { userId } = state;

    // Always reset requestedTransition to prevent stale blocked transitions
    const updates: Partial<ConversationStateType> = { requestedTransition: null };

    // Load fresh user from DB
    const user = await userService.getUser(userId);
    if (!user) {
      throw new Error(`User ${userId} not found`);
    }
    updates.user = user;

    // Handle training phase — check if active session has timed out
    if (state.phase === 'training' && state.activeSessionId) {
      const session = await trainingService.getSessionDetails(state.activeSessionId).catch(() => null);

      const isSessionEnded = !session
        || session.status === 'completed'
        || session.status === 'skipped';

      if (isSessionEnded) {
        log.info({ userId, sessionId: state.activeSessionId, status: session?.status }, 'Session ended — returning to chat');
        updates.phase = 'chat';
        updates.activeSessionId = null;
        updates.responseMessage = 'Your training session has been completed. Ready for a new workout? 💪';
        return updates;
      }

      // Check idle timeout
      const lastActivity = session.lastActivityAt ?? session.updatedAt ?? session.createdAt;
      const idleMs = Date.now() - new Date(lastActivity).getTime();
      if (idleMs > SESSION_TIMEOUT_MS) {
        log.info({ userId, sessionId: state.activeSessionId, idleMs }, 'Session idle timeout — auto-completing');
        await trainingService.completeSession(state.activeSessionId).catch(() => null);
        updates.phase = 'chat';
        updates.activeSessionId = null;
        updates.responseMessage = 'Your training session was automatically completed due to inactivity. Ready for a new workout? 💪';
        return updates;
      }
    }

    // Determine phase for new users (checkpointer default phase = 'registration')
    // For existing users whose profile is complete, override to 'chat' only on first invocation
    if (!state.userId) {
      // New thread: determine from profile
      const phase: ConversationPhase = userService.isRegistrationComplete(user) ? 'chat' : 'registration';
      updates.phase = phase;
    }

    return updates;
  };
}
