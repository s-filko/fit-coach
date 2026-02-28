/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { AIMessage, HumanMessage, SystemMessage } from '@langchain/core/messages';
import { Annotation, END, MessagesAnnotation, START, StateGraph } from '@langchain/langgraph';
import { ToolNode, toolsCondition } from '@langchain/langgraph/prebuilt';

import { type ConversationStateType, type TransitionRequest } from '@domain/conversation/graph/conversation.state';
import { IConversationContextService } from '@domain/conversation/ports';
import type { IExerciseRepository, ITrainingService, IWorkoutPlanRepository, IWorkoutSessionRepository } from '@domain/training/ports';
import { SessionPlanningContextBuilder } from '@domain/training/services/session-planning-context.builder';
import type { IUserService } from '@domain/user/ports';
import type { User } from '@domain/user/services/user.service';

import { buildSessionPlanningSystemPrompt } from '@infra/ai/graph/nodes/session-planning.node';
import { PendingRefMap } from '@infra/ai/graph/pending-ref-map';
import { buildSessionPlanningTools } from '@infra/ai/graph/tools/session-planning.tools';
import { getModel } from '@infra/ai/model.factory';

export interface SessionPlanningSubgraphDeps {
  userService: IUserService;
  contextService: IConversationContextService;
  exerciseRepository: IExerciseRepository;
  workoutPlanRepository: IWorkoutPlanRepository;
  workoutSessionRepository: IWorkoutSessionRepository;
  trainingService: ITrainingService;
}

const SessionPlanningSubgraphState = Annotation.Root({
  ...MessagesAnnotation.spec,
  userId: Annotation<string>({ reducer: (_, v) => v, default: () => '' }),
  user: Annotation<User | null>({ reducer: (_, v) => v, default: () => null }),
  userMessage: Annotation<string>({ reducer: (_, v) => v, default: () => '' }),
  responseMessage: Annotation<string>({ reducer: (_, v) => v, default: () => '' }),
  requestedTransition: Annotation<TransitionRequest | null>({ reducer: (_, v) => v, default: () => null }),
  // activeSessionId propagates to parent ConversationState when start_training_session is called
  activeSessionId: Annotation<string | null>({ reducer: (_, v) => v, default: () => null }),
});

type SessionPlanningSubgraphStateType = typeof SessionPlanningSubgraphState.State;

export function buildSessionPlanningSubgraph(deps: SessionPlanningSubgraphDeps) {
  const {
    userService,
    contextService,
    exerciseRepository,
    workoutPlanRepository,
    workoutSessionRepository,
    trainingService,
  } = deps;

  /**
   * Per-user maps: tools set entries by userId, extractNode reads and deletes them.
   * Maps keyed by userId are safe when the graph is a singleton shared across concurrent
   * requests — single-value refs would cause a race condition between users.
   */
  const pendingTransitions = new PendingRefMap<TransitionRequest | null>();
  const pendingActiveSessionIds = new PendingRefMap<string | null>();

  const contextBuilder = new SessionPlanningContextBuilder(
    workoutPlanRepository,
    workoutSessionRepository,
  );

  const tools = buildSessionPlanningTools({
    trainingService,
    workoutPlanRepository,
    pendingTransitions,
    pendingActiveSessionIds,
  });
  const toolNode = new ToolNode(tools);
  const model = getModel().bindTools(tools);

  const agentNode = async(state: SessionPlanningSubgraphStateType) => {
    const { userId, user, userMessage } = state;

    // Load all context data in parallel
    const [history, context, exercises, freshUser] = await Promise.all([
      contextService.getMessagesForPrompt(userId, 'session_planning'),
      contextBuilder.buildContext(userId),
      exerciseRepository.findAllWithMuscles(),
      userService.getUser(userId),
    ]);

    const systemPrompt = buildSessionPlanningSystemPrompt(freshUser ?? user, context, exercises);

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

  const extractNode = async(state: SessionPlanningSubgraphStateType): Promise<Partial<ConversationStateType>> => {
    const lastMessage = state.messages[state.messages.length - 1] as AIMessage;
    const text = typeof lastMessage.content === 'string'
      ? lastMessage.content
      : (lastMessage.content as Array<{ type: string; text?: string }>)
          .filter((b) => b.type === 'text')
          .map((b) => b.text ?? '')
          .join('');

    // Read fresh user from DB to capture any profile changes during this turn
    const freshUser = state.userId
      ? await userService.getUser(state.userId).catch(() => null)
      : null;

    // Consume both per-user map entries set by tools — read and delete atomically
    const transition = pendingTransitions.get(state.userId) ?? null;
    pendingTransitions.delete(state.userId);

    const activeSessionId = pendingActiveSessionIds.get(state.userId) ?? null;
    pendingActiveSessionIds.delete(state.userId);

    return {
      responseMessage: text,
      user: freshUser ?? state.user,
      requestedTransition: transition,
      // Only update activeSessionId if start_training_session was called
      ...(activeSessionId !== null ? { activeSessionId } : {}),
    };
  };

  const graph = new StateGraph(SessionPlanningSubgraphState)
    .addNode('agent', agentNode)
    .addNode('tools', toolNode)
    .addNode('extract', extractNode)
    .addEdge(START, 'agent')
    .addConditionalEdges('agent', toolsCondition, { tools: 'tools', [END]: 'extract' })
    .addEdge('tools', 'agent')
    .addEdge('extract', END);

  return graph.compile();
}
