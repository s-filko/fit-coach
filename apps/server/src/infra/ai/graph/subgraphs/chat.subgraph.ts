/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { AIMessage, HumanMessage, SystemMessage } from '@langchain/core/messages';
import { Annotation, END, MessagesAnnotation, START, StateGraph } from '@langchain/langgraph';
import { ToolNode, toolsCondition } from '@langchain/langgraph/prebuilt';

import { type ConversationStateType, type TransitionRequest } from '@domain/conversation/graph/conversation.state';
import { IConversationContextService } from '@domain/conversation/ports';
import type { IWorkoutPlanRepository } from '@domain/training/ports';
import type { IUserService } from '@domain/user/ports';
import { User } from '@domain/user/services/user.service';

import { buildChatSystemPrompt } from '@infra/ai/graph/nodes/chat.node';
import { buildChatTools } from '@infra/ai/graph/tools/chat.tools';
import { getModel } from '@infra/ai/model.factory';

export interface ChatSubgraphDeps {
  userService: IUserService;
  workoutPlanRepo: IWorkoutPlanRepository;
  contextService: IConversationContextService;
}

// Subgraph state: MessagesAnnotation for the tool loop + parent fields we need to read/write
const ChatSubgraphState = Annotation.Root({
  ...MessagesAnnotation.spec,
  userId: Annotation<string>({ reducer: (_, v) => v, default: () => '' }),
  user: Annotation<User | null>({ reducer: (_, v) => v, default: () => null }),
  userMessage: Annotation<string>({ reducer: (_, v) => v, default: () => '' }),
  responseMessage: Annotation<string>({ reducer: (_, v) => v, default: () => '' }),
  requestedTransition: Annotation<TransitionRequest | null>({ reducer: (_, v) => v, default: () => null }),
});

type ChatSubgraphStateType = typeof ChatSubgraphState.State;

export function buildChatSubgraph(deps: ChatSubgraphDeps) {
  const { userService, workoutPlanRepo, contextService } = deps;
  const tools = buildChatTools({ userService });
  const toolNode = new ToolNode(tools);
  const model = getModel().bindTools(tools);

  const agentNode = async(state: ChatSubgraphStateType) => {
    const { userId, user, userMessage } = state;

    const [history, activePlan] = await Promise.all([
      contextService.getMessagesForPrompt(userId, 'chat'),
      workoutPlanRepo.findActiveByUserId(userId),
    ]);

    const systemPrompt = buildChatSystemPrompt(user, !!activePlan);

    const llmMessages = [
      new SystemMessage(systemPrompt),
      ...history.map((m) =>
        m.role === 'user' ? new HumanMessage(m.content) : new AIMessage(m.content),
      ),
      new HumanMessage(userMessage),
    ];

    const response = await model.invoke(llmMessages, {
      configurable: { userId },
    });

    return { messages: [response] };
  };

  const extractNode = (state: ChatSubgraphStateType): Partial<ConversationStateType> => {
    const lastMessage = state.messages[state.messages.length - 1] as AIMessage;
    const text = typeof lastMessage.content === 'string'
      ? lastMessage.content
      : (lastMessage.content as Array<{ type: string; text?: string }>)
          .filter((b) => b.type === 'text')
          .map((b) => b.text ?? '')
          .join('');

    return {
      responseMessage: text,
      user: state.user,
      requestedTransition: state.requestedTransition,
    };
  };

  const graph = new StateGraph(ChatSubgraphState)
    .addNode('agent', agentNode)
    .addNode('tools', toolNode)
    .addNode('extract', extractNode)
    .addEdge(START, 'agent')
    .addConditionalEdges('agent', toolsCondition, { tools: 'tools', [END]: 'extract' })
    .addEdge('tools', 'agent')
    .addEdge('extract', END);

  return graph.compile();
}
