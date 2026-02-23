import { ConversationStateType } from '@domain/conversation/graph/conversation.state';

// TODO: remove — replaced by chat subgraph in Step 3
export function buildChatNode(deps: unknown) {
  void deps;
  return (): Partial<ConversationStateType> => ({
    responseMessage: '[Chat phase not yet implemented]',
  });
}
