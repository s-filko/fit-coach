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

  /**
   * Mutable closure ref: tools write their pending transition here instead of
   * returning a Command (which would break ToolNode's ToolMessage flow and cause
   * an infinite recursion loop). extractNode reads this ref once and clears it.
   */
  const pendingTransition: { value: TransitionRequest | null } = { value: null };

  const tools = buildRegistrationTools({ userService, pendingTransition });
  const toolNode = new ToolNode(tools);
  const model = getModel().bindTools(tools);

  const agentNode = async(state: RegistrationSubgraphStateType) => {
    const { userId, user, userMessage } = state;

    const history = await contextService.getMessagesForPrompt(userId, 'registration');

    // Fetch fresh user before each LLM call so the prompt reflects tool-saved fields
    const freshUser = await userService.getUser(userId);
    const systemPrompt = buildRegistrationSystemPrompt(freshUser ?? user);

    // state.messages holds AIMessage(tool_calls) + ToolMessages from the current turn.
    // These are NOT in DB history yet (persist runs after subgraph finishes).
    // Including them lets the LLM see tool results and stop calling tools.
    const inFlightMessages = state.messages ?? [];

    const llmMessages = [
      new SystemMessage(systemPrompt),
      ...history.map((m) =>
        m.role === 'user' ? new HumanMessage(m.content) : new AIMessage(m.content),
      ),
      new HumanMessage(userMessage),
      ...inFlightMessages,
    ];

    const response = await model.invoke(llmMessages, {
      configurable: { userId },
    });

    return { messages: [response] };
  };

  const extractNode = async(state: RegistrationSubgraphStateType): Promise<Partial<ConversationStateType>> => {
    const lastMessage = state.messages[state.messages.length - 1] as AIMessage;
    const text = typeof lastMessage.content === 'string'
      ? lastMessage.content
      : (lastMessage.content as Array<{ type: string; text?: string }>)
          .filter((b) => b.type === 'text')
          .map((b) => b.text ?? '')
          .join('');

    // Read fresh user from DB to capture any fields saved by tools during this turn
    const freshUser = state.userId
      ? await userService.getUser(state.userId).catch(() => null)
      : null;

    // Consume the pending transition set by complete_registration tool
    const transition = pendingTransition.value;
    pendingTransition.value = null;

    return {
      responseMessage: text,
      user: freshUser ?? state.user,
      requestedTransition: transition,
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
