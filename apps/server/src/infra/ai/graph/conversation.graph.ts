import { StateGraph } from '@langchain/langgraph';

import { LLMService } from '@domain/ai/ports';
import { ConversationState, ConversationStateType } from '@domain/conversation/graph/conversation.state';
import type { ITrainingService, IWorkoutPlanRepository } from '@domain/training/ports';
import type { IPromptService, IUserService } from '@domain/user/ports';

import { buildChatNode } from './nodes/chat.node';

export const CONVERSATION_GRAPH_TOKEN = Symbol('ConversationGraph');

export interface ConversationGraphDeps {
  promptService: IPromptService;
  llmService: LLMService;
  trainingService: ITrainingService;
  workoutPlanRepo: IWorkoutPlanRepository;
  userService: IUserService;
}

function stubNode(phase: string) {
  return (): Partial<ConversationStateType> => {
    throw new Error(`[LangGraph] Phase '${phase}' not yet migrated — stub node`);
  };
}

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
function _buildGraph(deps: ConversationGraphDeps) {
  const chatNode = buildChatNode(deps);

  return new StateGraph(ConversationState)
    .addNode('chat', chatNode)
    .addNode('plan_creation', stubNode('plan_creation'))
    .addNode('session_planning', stubNode('session_planning'))
    .addNode('training', stubNode('training'))
    .addNode('registration', stubNode('registration'))
    .addConditionalEdges('__start__', (state: ConversationStateType) => state.phase, {
      chat: 'chat',
      plan_creation: 'plan_creation',
      session_planning: 'session_planning',
      training: 'training',
      registration: 'registration',
    })
    .addEdge('chat', '__end__')
    .addEdge('plan_creation', '__end__')
    .addEdge('session_planning', '__end__')
    .addEdge('training', '__end__')
    .addEdge('registration', '__end__')
    .compile();
}

export type CompiledConversationGraph = ReturnType<typeof _buildGraph>;

export function buildConversationGraph(deps: ConversationGraphDeps): CompiledConversationGraph {
  return _buildGraph(deps);
}
