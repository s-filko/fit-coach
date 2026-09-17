/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { AIMessage } from '@langchain/core/messages';
import type { RunnableConfig } from '@langchain/core/runnables';
import { Annotation, END, MessagesAnnotation, START, StateGraph } from '@langchain/langgraph';
import { toolsCondition } from '@langchain/langgraph/prebuilt';

import { type ConversationStateType, type TransitionRequest } from '@domain/conversation/graph/conversation.state';
import { IConversationContextService } from '@domain/conversation/ports';
import type {
  IEmbeddingService,
  IExerciseRepository,
  ITrainingService,
  IWorkoutPlanRepository,
  IWorkoutSessionRepository,
} from '@domain/training/ports';
import { SessionPlanningContextBuilder } from '@domain/training/services/session-planning-context.builder';
import type { IUserService } from '@domain/user/ports';
import type { User } from '@domain/user/services/user.service';

import { assembleContext } from '@infra/ai/context/assemble-context';
import { invokeWithRetry } from '@infra/ai/graph/invoke-with-retry';
import { afterTools, buildToolExecutor } from '@infra/ai/graph/tool-executor';
import { type ToolPolicy } from '@infra/ai/graph/tool-policy';
import { getModel } from '@infra/ai/model.factory';
import { compose } from '@infra/ai/prompts/compose';
import { SESSION_PLANNING_PROMPT } from '@infra/ai/prompts/phases/session_planning';
import { attachBudgetReport } from '@infra/ai/run-metrics';
import {
  buildRequestTransitionTool,
  buildSearchExercisesTool,
  buildSharedTools,
  buildStartTrainingSessionTool,
} from '@infra/ai/tools';

export interface SessionPlanningSubgraphDeps {
  userService: IUserService;
  contextService: IConversationContextService;
  exerciseRepository: IExerciseRepository;
  embeddingService: IEmbeddingService;
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
    embeddingService,
    workoutPlanRepository,
    workoutSessionRepository,
    trainingService,
  } = deps;

  const contextBuilder = new SessionPlanningContextBuilder(workoutPlanRepository, workoutSessionRepository);

  const phaseTools = [
    buildSearchExercisesTool({ embeddingService, exerciseRepository }),
    buildStartTrainingSessionTool({ trainingService, workoutPlanRepository, exerciseRepository }),
    buildRequestTransitionTool('session_planning'),
  ];
  const tools = [...phaseTools, ...buildSharedTools({ userService })];
  // search_exercises dedup runs once per identical args in a batch (was buildDedupToolNode)
  const policy: ToolPolicy = { perTurnDedup: ['search_exercises'], llmErrorBudget: Infinity };
  const toolExecutor = buildToolExecutor(tools, policy);
  const model = getModel().bindTools(tools);

  const agentNode = async (state: SessionPlanningSubgraphStateType, config: RunnableConfig) => {
    const { userId, user, userMessage } = state;

    // Load all context data in parallel
    const [history, context, freshUser, previousSummary] = await Promise.all([
      contextService.getMessagesForPrompt(userId, 'session_planning'),
      contextBuilder.buildContext(userId),
      userService.getUser(userId),
      contextService.getLatestSummary(userId),
    ]);

    const promptUser = freshUser ?? user;
    const systemPrompt = compose(
      SESSION_PLANNING_PROMPT.current.render({
        now: new Date(),
        timezone: promptUser?.timezone ?? null,
        client: 'telegram',
        user: promptUser,
        lastMessageTime: null,
        context,
      }),
    );

    const { messages: llmMessages, budgetReport } = assembleContext({
      phase: 'session_planning',
      systemPrompt,
      previousSummary,
      history,
      userMessage,
      inFlight: state.messages ?? [],
    });
    attachBudgetReport(config.metadata?.['runId'] as string, budgetReport);

    const response = await invokeWithRetry(model, llmMessages, config);

    return { messages: [response] };
  };

  const extractNode = async (state: SessionPlanningSubgraphStateType): Promise<Partial<ConversationStateType>> => {
    const lastMessage = state.messages[state.messages.length - 1] as AIMessage;
    const text =
      typeof lastMessage.content === 'string'
        ? lastMessage.content
        : (lastMessage.content as Array<{ type: string; text?: string }>)
            .filter(b => b.type === 'text')
            .map(b => b.text ?? '')
            .join('');

    // Read fresh user from DB to capture any profile changes during this turn
    const freshUser = state.userId ? await userService.getUser(state.userId).catch(() => null) : null;

    // requestedTransition/activeSessionId arrive through the subgraph state
    // from the tool executor
    return {
      responseMessage: text,
      user: freshUser ?? state.user,
    };
  };

  const graph = new StateGraph(SessionPlanningSubgraphState)
    .addNode('agent', agentNode)
    .addNode('tools', toolExecutor)
    .addNode('extract', extractNode)
    .addEdge(START, 'agent')
    .addConditionalEdges('agent', toolsCondition, { tools: 'tools', [END]: 'extract' })
    .addConditionalEdges('tools', afterTools, { agent: 'agent', [END]: 'extract' })
    .addEdge('extract', END);

  return graph.compile();
}
