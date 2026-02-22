import { StateGraph } from '@langchain/langgraph';

import { ConversationState, ConversationStateType } from '@domain/conversation/graph/conversation.state';

export const CONVERSATION_GRAPH_TOKEN = Symbol('ConversationGraph');

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
function _buildGraph() {
  return new StateGraph(ConversationState)
    .addNode('passthrough', (state: ConversationStateType) => state)
    .addEdge('__start__', 'passthrough')
    .addEdge('passthrough', '__end__')
    .compile();
}

export type CompiledConversationGraph = ReturnType<typeof _buildGraph>;

export function buildConversationGraph(): CompiledConversationGraph {
  return _buildGraph();
}
