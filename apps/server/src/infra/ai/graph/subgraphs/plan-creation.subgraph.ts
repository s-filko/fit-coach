/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { AIMessage, HumanMessage, mergeMessageRuns, SystemMessage } from '@langchain/core/messages';
import { Annotation, END, MessagesAnnotation, START, StateGraph } from '@langchain/langgraph';
import { toolsCondition } from '@langchain/langgraph/prebuilt';

import { type ConversationStateType, type TransitionRequest } from '@domain/conversation/graph/conversation.state';
import { IConversationContextService } from '@domain/conversation/ports';
import type { IEmbeddingService, IExerciseRepository, IWorkoutPlanRepository } from '@domain/training/ports';
import type { IUserService } from '@domain/user/ports';
import type { User } from '@domain/user/services/user.service';

import { buildDedupToolNode } from '@infra/ai/graph/dedup-tool-node';
import { invokeWithRetry } from '@infra/ai/graph/invoke-with-retry';
import { buildPlanCreationSystemPrompt } from '@infra/ai/graph/nodes/plan-creation.node';
import { PendingRefMap } from '@infra/ai/graph/pending-ref-map';
import { buildPlanCreationTools } from '@infra/ai/graph/tools/plan-creation.tools';
import { buildSaveTimezoneTool } from '@infra/ai/graph/tools/timezone.tool';
import { getModel } from '@infra/ai/model.factory';

export interface PlanCreationSubgraphDeps {
  userService: IUserService;
  contextService: IConversationContextService;
  exerciseRepository: IExerciseRepository;
  embeddingService: IEmbeddingService;
  workoutPlanRepository: IWorkoutPlanRepository;
}

const PlanCreationSubgraphState = Annotation.Root({
  ...MessagesAnnotation.spec,
  userId: Annotation<string>({ reducer: (_, v) => v, default: () => '' }),
  user: Annotation<User | null>({ reducer: (_, v) => v, default: () => null }),
  userMessage: Annotation<string>({ reducer: (_, v) => v, default: () => '' }),
  responseMessage: Annotation<string>({ reducer: (_, v) => v, default: () => '' }),
  requestedTransition: Annotation<TransitionRequest | null>({ reducer: (_, v) => v, default: () => null }),
});

type PlanCreationSubgraphStateType = typeof PlanCreationSubgraphState.State;

export function buildPlanCreationSubgraph(deps: PlanCreationSubgraphDeps) {
  const { userService, contextService, exerciseRepository, embeddingService, workoutPlanRepository } = deps;

  /**
   * Per-user map: tools set entry by userId, extractNode reads and deletes it.
   * A Map keyed by userId is safe when the graph is a singleton shared across
   * concurrent requests — single-value refs would cause a race condition.
   */
  const pendingTransitions = new PendingRefMap<TransitionRequest | null>();

  const phaseTools = buildPlanCreationTools({
    workoutPlanRepository,
    exerciseRepository,
    embeddingService,
    pendingTransitions,
  });
  const tools = [...phaseTools, buildSaveTimezoneTool({ userService })];
  const dedupToolNode = buildDedupToolNode(tools);
  const model = getModel().bindTools(tools);

  const agentNode = async (state: PlanCreationSubgraphStateType) => {
    const { userId, user, userMessage } = state;

    const [history, freshUser, previousSummary] = await Promise.all([
      contextService.getMessagesForPrompt(userId, 'plan_creation'),
      userService.getUser(userId),
      contextService.getLatestSummary(userId),
    ]);

    const systemPrompt = buildPlanCreationSystemPrompt(freshUser ?? user);

    const inFlightMessages = state.messages ?? [];

    const summaryMessages = previousSummary
      ? [new SystemMessage(`CONTEXT FROM PREVIOUS CONVERSATION:\n${previousSummary}`)]
      : [];

    const llmMessages = mergeMessageRuns([
      new SystemMessage(systemPrompt),
      ...summaryMessages,
      ...history.map(m => (m.role === 'user' ? new HumanMessage(m.content) : new AIMessage(m.content))),
      new HumanMessage(userMessage),
      ...inFlightMessages,
    ]);

    const response = await invokeWithRetry(model, llmMessages, userId);

    return { messages: [response] };
  };

  const extractNode = async (state: PlanCreationSubgraphStateType): Promise<Partial<ConversationStateType>> => {
    const lastMessage = state.messages[state.messages.length - 1] as AIMessage;
    const text =
      typeof lastMessage.content === 'string'
        ? lastMessage.content
        : (lastMessage.content as Array<{ type: string; text?: string }>)
            .filter(b => b.type === 'text')
            .map(b => b.text ?? '')
            .join('');

    // Read fresh user from DB to capture any changes during this turn
    const freshUser = state.userId ? await userService.getUser(state.userId).catch(() => null) : null;

    // Consume the pending transition set by tools — read and delete atomically
    const transition = pendingTransitions.get(state.userId) ?? null;
    pendingTransitions.delete(state.userId);

    return {
      responseMessage: text,
      user: freshUser ?? state.user,
      requestedTransition: transition,
    };
  };

  const graph = new StateGraph(PlanCreationSubgraphState)
    .addNode('agent', agentNode)
    .addNode('tools', dedupToolNode)
    .addNode('extract', extractNode)
    .addEdge(START, 'agent')
    .addConditionalEdges('agent', toolsCondition, { tools: 'tools', [END]: 'extract' })
    .addEdge('tools', 'agent')
    .addEdge('extract', END);

  return graph.compile();
}
