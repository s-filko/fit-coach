import { RunnableConfig } from '@langchain/core/runnables';

import { ConversationStateType } from './conversation.state';

export interface ICompiledConversationGraph {
  invoke(
    input: Partial<ConversationStateType>,
    config: { configurable: { thread_id: string } } & Partial<RunnableConfig>,
  ): Promise<ConversationStateType>;
}
