import { ConversationStateType } from '@domain/conversation/graph/conversation.state';
import { IConversationContextService } from '@domain/conversation/ports';

import { createLogger } from '@shared/logger';

const log = createLogger('persist-node');

export function buildPersistNode(contextService: IConversationContextService) {
  return async function persistNode(
    state: ConversationStateType,
  ): Promise<Partial<ConversationStateType>> {
    const { userId, phase, userMessage, responseMessage } = state;

    if (!userMessage || !responseMessage) {
      return {};
    }

    try {
      await contextService.appendTurn(userId, phase, userMessage, responseMessage);
    } catch (err) {
      // Analytics failure must not break user response
      log.warn({ err, userId, phase }, 'Failed to persist conversation turn — continuing');
    }

    return {};
  };
}
