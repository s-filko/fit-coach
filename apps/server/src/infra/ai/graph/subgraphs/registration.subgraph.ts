/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { AIMessage, HumanMessage, SystemMessage } from '@langchain/core/messages';
import { Annotation, END, MessagesAnnotation, START, StateGraph } from '@langchain/langgraph';
import { ToolNode, toolsCondition } from '@langchain/langgraph/prebuilt';

import { type ConversationStateType, type TransitionRequest } from '@domain/conversation/graph/conversation.state';
import { IConversationContextService } from '@domain/conversation/ports';
import type { IUserService } from '@domain/user/ports';
import { User } from '@domain/user/services/user.service';

import { buildRegistrationSystemPrompt } from '@infra/ai/graph/nodes/registration.node';
import { buildRegistrationTools } from '@infra/ai/graph/tools/registration.tools';
import { getModel } from '@infra/ai/model.factory';

export interface RegistrationSubgraphDeps {
  userService: IUserService;
  contextService: IConversationContextService;
}

const RegistrationSubgraphState = Annotation.Root({
  ...MessagesAnnotation.spec,
  userId: Annotation<string>({ reducer: (_, v) => v, default: () => '' }),
  user: Annotation<User | null>({ reducer: (_, v) => v, default: () => null }),
  userMessage: Annotation<string>({ reducer: (_, v) => v, default: () => '' }),
  responseMessage: Annotation<string>({ reducer: (_, v) => v, default: () => '' }),
  requestedTransition: Annotation<TransitionRequest | null>({ reducer: (_, v) => v, default: () => null }),
});

type RegistrationSubgraphStateType = typeof RegistrationSubgraphState.State;

export function buildRegistrationSubgraph(deps: RegistrationSubgraphDeps) {
  const { userService, contextService } = deps;
  const tools = buildRegistrationTools({ userService });
  const toolNode = new ToolNode(tools);
  const model = getModel().bindTools(tools);

  const agentNode = async(state: RegistrationSubgraphStateType) => {
    const { userId, user, userMessage } = state;

    const history = await contextService.getMessagesForPrompt(userId, 'registration');

    const systemPrompt = buildRegistrationSystemPrompt(user);

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

  const extractNode = (state: RegistrationSubgraphStateType): Partial<ConversationStateType> => {
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

  const graph = new StateGraph(RegistrationSubgraphState)
    .addNode('agent', agentNode)
    .addNode('tools', toolNode)
    .addNode('extract', extractNode)
    .addEdge(START, 'agent')
    .addConditionalEdges('agent', toolsCondition, { tools: 'tools', [END]: 'extract' })
    .addEdge('tools', 'agent')
    .addEdge('extract', END);

  return graph.compile();
}
