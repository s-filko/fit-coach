/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { AIMessage, HumanMessage, SystemMessage } from '@langchain/core/messages';
import { Annotation, END, MessagesAnnotation, START, StateGraph } from '@langchain/langgraph';
import { ToolNode, toolsCondition } from '@langchain/langgraph/prebuilt';

import { type ConversationStateType, type TransitionRequest } from '@domain/conversation/graph/conversation.state';
import { IConversationContextService } from '@domain/conversation/ports';
import type { IWorkoutPlanRepository, IWorkoutSessionRepository } from '@domain/training/ports';
import type { IUserService } from '@domain/user/ports';
import { User } from '@domain/user/services/user.service';

import { buildChatSystemPrompt } from '@infra/ai/graph/nodes/chat.node';
import { PendingRefMap } from '@infra/ai/graph/pending-ref-map';
import { buildChatTools } from '@infra/ai/graph/tools/chat.tools';
import { getModel } from '@infra/ai/model.factory';

export interface ChatSubgraphDeps {
  userService: IUserService;
  workoutPlanRepo: IWorkoutPlanRepository;
  workoutSessionRepo: IWorkoutSessionRepository;
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
  const { userService, workoutPlanRepo, workoutSessionRepo, contextService } = deps;

  /**
   * Per-user map: request_transition tool sets entry by userId, extractNode reads and
   * deletes it. A Map keyed by userId is safe when the graph is a singleton shared
   * across concurrent requests — single-value refs would cause a race condition.
   */
  const pendingTransitions = new PendingRefMap<TransitionRequest | null>();

  const tools = buildChatTools({ userService, pendingTransitions });
  const toolNode = new ToolNode(tools);
  const model = getModel().bindTools(tools);

  const agentNode = async(state: ChatSubgraphStateType) => {
    const { userId, user, userMessage } = state;

    const [history, activePlan, recentSessions] = await Promise.all([
      contextService.getMessagesForPrompt(userId, 'chat'),
      workoutPlanRepo.findActiveByUserId(userId),
      workoutSessionRepo.findRecentByUserIdWithDetails(userId, 5),
    ]);

    const systemPrompt = buildChatSystemPrompt(user, !!activePlan, recentSessions);

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

  const extractNode = async(state: ChatSubgraphStateType): Promise<Partial<ConversationStateType>> => {
    const lastMessage = state.messages[state.messages.length - 1] as AIMessage;
    const text = typeof lastMessage.content === 'string'
      ? lastMessage.content
      : (lastMessage.content as Array<{ type: string; text?: string }>)
          .filter((b) => b.type === 'text')
          .map((b) => b.text ?? '')
          .join('');

    // Read fresh user from DB to capture any fields saved by update_profile tool
    const freshUser = state.userId
      ? await userService.getUser(state.userId).catch(() => null)
      : null;

    // Consume the pending transition set by request_transition tool — read and delete atomically
    const transition = pendingTransitions.get(state.userId) ?? null;
    pendingTransitions.delete(state.userId);

    return {
      responseMessage: text,
      user: freshUser ?? state.user,
      requestedTransition: transition,
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
