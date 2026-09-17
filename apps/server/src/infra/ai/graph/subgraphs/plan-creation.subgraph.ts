/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { AIMessage } from '@langchain/core/messages';
import type { RunnableConfig } from '@langchain/core/runnables';
import { Annotation, END, MessagesAnnotation, START, StateGraph } from '@langchain/langgraph';
import { toolsCondition } from '@langchain/langgraph/prebuilt';

import { type ConversationStateType, type TransitionRequest } from '@domain/conversation/graph/conversation.state';
import { IConversationContextService } from '@domain/conversation/ports';
import type { IEmbeddingService, IExerciseRepository, IWorkoutPlanRepository } from '@domain/training/ports';
import type { IUserService } from '@domain/user/ports';
import type { User } from '@domain/user/services/user.service';

import { assembleContext } from '@infra/ai/context/assemble-context';
import { invokeWithRetry } from '@infra/ai/graph/invoke-with-retry';
import { afterTools, buildToolExecutor } from '@infra/ai/graph/tool-executor';
import { type ToolPolicy } from '@infra/ai/graph/tool-policy';
import { buildPlanCreationTools } from '@infra/ai/graph/tools/plan-creation.tools';
import { buildSaveTimezoneTool } from '@infra/ai/graph/tools/timezone.tool';
import { getModel } from '@infra/ai/model.factory';
import { compose } from '@infra/ai/prompts/compose';
import { PLAN_CREATION_PROMPT } from '@infra/ai/prompts/phases/plan_creation';
import { attachBudgetReport } from '@infra/ai/run-metrics';

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

  const phaseTools = buildPlanCreationTools({
    workoutPlanRepository,
    exerciseRepository,
    embeddingService,
  });
  const tools = [...phaseTools, buildSaveTimezoneTool({ userService })];
  // search_exercises dedup runs once per identical args in a batch (was buildDedupToolNode)
  const policy: ToolPolicy = { perTurnDedup: ['search_exercises'], llmErrorBudget: Infinity };
  const toolExecutor = buildToolExecutor(tools, policy);
  const model = getModel().bindTools(tools);

  const agentNode = async (state: PlanCreationSubgraphStateType, config: RunnableConfig) => {
    const { userId, user, userMessage } = state;

    const [history, freshUser, previousSummary] = await Promise.all([
      contextService.getMessagesForPrompt(userId, 'plan_creation'),
      userService.getUser(userId),
      contextService.getLatestSummary(userId),
    ]);

    const promptUser = freshUser ?? user;
    const systemPrompt = compose(
      PLAN_CREATION_PROMPT.current.render({
        now: new Date(),
        timezone: promptUser?.timezone ?? null,
        client: 'telegram',
        user: promptUser,
        lastMessageTime: null,
      }),
    );

    const { messages: llmMessages, budgetReport } = assembleContext({
      phase: 'plan_creation',
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

    // requestedTransition arrives through the subgraph state from the tool executor
    return {
      responseMessage: text,
      user: freshUser ?? state.user,
    };
  };

  const graph = new StateGraph(PlanCreationSubgraphState)
    .addNode('agent', agentNode)
    .addNode('tools', toolExecutor)
    .addNode('extract', extractNode)
    .addEdge(START, 'agent')
    .addConditionalEdges('agent', toolsCondition, { tools: 'tools', [END]: 'extract' })
    .addConditionalEdges('tools', afterTools, { agent: 'agent', [END]: 'extract' })
    .addEdge('extract', END);

  return graph.compile();
}
