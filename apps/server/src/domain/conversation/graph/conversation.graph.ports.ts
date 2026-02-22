import { ConversationStateType } from './conversation.state';

export interface ICompiledConversationGraph {
  invoke(input: Partial<ConversationStateType>): Promise<ConversationStateType>;
}
