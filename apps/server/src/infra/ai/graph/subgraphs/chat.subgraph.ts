/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { AIMessage } from '@langchain/core/messages';
import type { RunnableConfig } from '@langchain/core/runnables';
import { Annotation, END, MessagesAnnotation, START, StateGraph } from '@langchain/langgraph';
import { toolsCondition } from '@langchain/langgraph/prebuilt';

import { type ConversationStateType, type TransitionRequest } from '@domain/conversation/graph/conversation.state';
import { IConversationContextService } from '@domain/conversation/ports';
import type { IWorkoutPlanRepository, IWorkoutSessionRepository } from '@domain/training/ports';
import type { IUserService } from '@domain/user/ports';
import { User } from '@domain/user/services/user.service';

import { assembleContext } from '@infra/ai/context/assemble-context';
import { afterTools, buildToolExecutor } from '@infra/ai/graph/tool-executor';
import { NO_POLICY } from '@infra/ai/graph/tool-policy';
import { getModel } from '@infra/ai/model.factory';
import { compose } from '@infra/ai/prompts/compose';
import { CHAT_PROMPT } from '@infra/ai/prompts/phases/chat';
import { attachBudgetReport } from '@infra/ai/run-metrics';
import { buildRequestTransitionTool, buildSharedTools, buildUpdateProfileTool } from '@infra/ai/tools';

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

  const tools = [
    buildUpdateProfileTool({ userService }),
    buildRequestTransitionTool('chat'),
    ...buildSharedTools({ userService }),
  ];
  const toolNode = buildToolExecutor(tools, NO_POLICY);
  const model = getModel().bindTools(tools);

  const agentNode = async (state: ChatSubgraphStateType, config: RunnableConfig) => {
    const { userId, user, userMessage } = state;

    const [history, activePlan, recentSessions, previousSummary, lastMessageTime] = await Promise.all([
      contextService.getMessagesForPrompt(userId, 'chat'),
      workoutPlanRepo.findActiveByUserId(userId),
      workoutSessionRepo.findRecentByUserIdWithDetails(userId, 5),
      contextService.getLatestSummary(userId),
      contextService.getLastUserMessageTime(userId),
    ]);

    const systemPrompt = compose(
      CHAT_PROMPT.current.render({
        now: new Date(),
        timezone: user?.timezone ?? null,
        client: 'telegram',
        user,
        lastMessageTime,
        hasActivePlan: !!activePlan,
        recentSessions,
      }),
    );

    const { messages: llmMessages, budgetReport } = assembleContext({
      phase: 'chat',
      systemPrompt,
      previousSummary,
      history,
      userMessage,
      inFlight: state.messages ?? [],
    });
    attachBudgetReport(config.metadata?.['runId'] as string, budgetReport);

    // Pass the node's LangGraph config through so the LLM callback handler sees
    // metadata.runId (run metrics) and metadata.userId (debug logs) — metadata is
    // inherited from the route's invoke config; configurable never reaches handlers.
    const response = await model.invoke(llmMessages, config);

    return { messages: [response] };
  };

  const extractNode = async (state: ChatSubgraphStateType): Promise<Partial<ConversationStateType>> => {
    const lastMessage = state.messages[state.messages.length - 1] as AIMessage;
    const text =
      typeof lastMessage.content === 'string'
        ? lastMessage.content
        : (lastMessage.content as Array<{ type: string; text?: string }>)
            .filter(b => b.type === 'text')
            .map(b => b.text ?? '')
            .join('');

    // Read fresh user from DB to capture any fields saved by update_profile tool
    const freshUser = state.userId ? await userService.getUser(state.userId).catch(() => null) : null;

    // requestedTransition arrives through the subgraph state from the tool executor
    return {
      responseMessage: text,
      user: freshUser ?? state.user,
    };
  };

  const graph = new StateGraph(ChatSubgraphState)
    .addNode('agent', agentNode)
    .addNode('tools', toolNode)
    .addNode('extract', extractNode)
    .addEdge(START, 'agent')
    .addConditionalEdges('agent', toolsCondition, { tools: 'tools', [END]: 'extract' })
    .addConditionalEdges('tools', afterTools, { agent: 'agent', [END]: 'extract' })
    .addEdge('extract', END);

  return graph.compile();
}
