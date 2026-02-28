import { Command } from '@langchain/langgraph';

import { ConversationStateType } from '@domain/conversation/graph/conversation.state';
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
  ): Promise<Partial<ConversationStateType> | Command> {
    const { userId } = state;

    // Always reset requestedTransition to prevent stale blocked transitions
    const updates: Partial<ConversationStateType> = { requestedTransition: null };

    // Load fresh user from DB
    const user = await userService.getUser(userId);
    if (!user) {
      throw new Error(`User ${userId} not found`);
    }
    updates.user = user;

    // Handle training phase — check if active session has ended or timed out.
    // Use Command(goto='persist') to skip the training subgraph entirely and jump
    // directly to persist, which is the native LangGraph way to short-circuit routing.
    if (state.phase === 'training' && state.activeSessionId) {
      const session = await trainingService.getSessionDetails(state.activeSessionId).catch(() => null);

      const isSessionEnded = !session
        || session.status === 'completed'
        || session.status === 'skipped';

      if (isSessionEnded) {
        log.info({ userId, sessionId: state.activeSessionId, status: session?.status }, 'Session ended — returning to chat');
        return new Command({
          goto: 'persist',
          update: {
            ...updates,
            phase: 'chat',
            activeSessionId: null,
            responseMessage: 'Your training session has been completed. Ready for a new workout?',
          },
        });
      }

      // Check idle timeout
      const lastActivity = session.lastActivityAt ?? session.updatedAt ?? session.createdAt;
      const idleMs = Date.now() - new Date(lastActivity).getTime();
      if (idleMs > SESSION_TIMEOUT_MS) {
        log.info({ userId, sessionId: state.activeSessionId, idleMs }, 'Session idle timeout — auto-completing');
        await trainingService.completeSession(state.activeSessionId).catch(() => null);
        return new Command({
          goto: 'persist',
          update: {
            ...updates,
            phase: 'chat',
            activeSessionId: null,
            responseMessage: 'Your training session was automatically completed due to inactivity. Ready for a new workout?',
          },
        });
      }
    }

    // Training phase without an active session: no mechanism to recover inside the subgraph,
    // so fall back to chat immediately to prevent the user from getting stuck.
    if (state.phase === 'training' && !state.activeSessionId) {
      log.warn({ userId }, 'Training phase without activeSessionId — falling back to chat');
      return new Command({
        goto: 'persist',
        update: {
          ...updates,
          phase: 'chat',
          activeSessionId: null,
          responseMessage: 'Your training session could not be resumed. You can plan a new session whenever you\'re ready.',
        },
      });
    }

    // Sync phase with profile status.
    // Default phase from checkpointer is 'registration'. If profile is already complete,
    // advance to 'chat'. This also covers the case where 'incomplete' profileStatus was
    // migrated to 'registration' but the user is actually done.
    if (state.phase === 'registration' && userService.isRegistrationComplete(user)) {
      updates.phase = 'chat';
    }

    // If profile is not complete, always stay in registration regardless of stored phase
    if (!userService.isRegistrationComplete(user) && state.phase !== 'registration') {
      updates.phase = 'registration';
    }

    return updates;
  };
}
