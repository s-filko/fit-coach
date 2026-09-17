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
  IWorkoutSessionRepository,
} from '@domain/training/ports';
import type { IUserService } from '@domain/user/ports';
import type { User } from '@domain/user/services/user.service';

import { assembleContext } from '@infra/ai/context/assemble-context';
import { invokeWithRetry } from '@infra/ai/graph/invoke-with-retry';
import { buildTrainingToolPolicy } from '@infra/ai/graph/phases/training.spec';
import { afterTools, buildToolExecutor } from '@infra/ai/graph/tool-executor';
import { getModel } from '@infra/ai/model.factory';
import { compose } from '@infra/ai/prompts/compose';
import { TRAINING_PROMPT } from '@infra/ai/prompts/phases/training';
import { attachBudgetReport } from '@infra/ai/run-metrics';
import {
  buildCompleteCurrentExerciseTool,
  buildDeleteLastSetsTool,
  buildFinishTrainingTool,
  buildLogSetTool,
  buildSearchExercisesTool,
  buildSharedTools,
  buildUpdateLastSetTool,
} from '@infra/ai/tools';

import { createLogger } from '@shared/logger';

const log = createLogger('training-subgraph');

export interface TrainingSubgraphDeps {
  userService: IUserService;
  trainingService: ITrainingService;
  workoutSessionRepo: IWorkoutSessionRepository;
  contextService: IConversationContextService;
  exerciseRepository: IExerciseRepository;
  embeddingService: IEmbeddingService;
}

const TrainingSubgraphState = Annotation.Root({
  ...MessagesAnnotation.spec,
  userId: Annotation<string>({ reducer: (_, v) => v, default: () => '' }),
  user: Annotation<User | null>({ reducer: (_, v) => v, default: () => null }),
  userMessage: Annotation<string>({ reducer: (_, v) => v, default: () => '' }),
  responseMessage: Annotation<string>({ reducer: (_, v) => v, default: () => '' }),
  requestedTransition: Annotation<TransitionRequest | null>({ reducer: (_, v) => v, default: () => null }),
  activeSessionId: Annotation<string | null>({ reducer: (_, v) => v, default: () => null }),
});

type TrainingSubgraphStateType = typeof TrainingSubgraphState.State;

export function buildTrainingSubgraph(deps: TrainingSubgraphDeps) {
  const { userService, trainingService, workoutSessionRepo, contextService, exerciseRepository, embeddingService } =
    deps;

  const tools = [
    buildSearchExercisesTool({ embeddingService, exerciseRepository }),
    buildLogSetTool({ trainingService }),
    buildCompleteCurrentExerciseTool({ trainingService }),
    buildFinishTrainingTool({ trainingService }),
    buildDeleteLastSetsTool({ trainingService }),
    buildUpdateLastSetTool({ trainingService }),
    ...buildSharedTools({ userService }),
  ];

  // Training protections (ADR-0011): priority ordering, log_set batch dedup,
  // error budget 1, system-error stop (executor-wide) and dynamic tool
  // filtering (BUG-008 Plan A) — the policy now lives on the phase spec.
  const policy = buildTrainingToolPolicy(tools);

  const toolExecutor = buildToolExecutor(tools, policy);
  const baseModel = getModel();

  const agentNode = async (state: TrainingSubgraphStateType, config: RunnableConfig) => {
    const { userId, user, userMessage, activeSessionId } = state;

    try {
      if (!activeSessionId) {
        return {
          messages: [new AIMessage('No active training session found. Please start a session first.')],
        };
      }

      const inFlightMessages = state.messages ?? [];

      const [history, session, freshUser, previousSummary] = await Promise.all([
        contextService.getMessagesForPrompt(userId, 'training'),
        trainingService.getSessionDetails(activeSessionId),
        userService.getUser(userId),
        contextService.getLatestSummary(userId),
      ]);

      if (!session) {
        return {
          messages: [new AIMessage('Training session not found. It may have already been completed.')],
        };
      }

      const previousSession = session.sessionKey
        ? await workoutSessionRepo.findLastCompletedByUserAndKey(userId, session.sessionKey)
        : null;

      const promptUser = freshUser ?? user;
      const systemPrompt = compose(
        TRAINING_PROMPT.current.render({
          now: new Date(),
          timezone: promptUser?.timezone ?? null,
          client: 'telegram',
          user: promptUser,
          lastMessageTime: null,
          session,
          previousSession,
        }),
      );

      // Dynamic tool filtering (BUG-008 Plan A): tools the model may call given
      // the current session state; null = all. The policy owns the rule.
      const availableNames = policy.availability?.({ data: { session } }) ?? null;
      const availableTools = availableNames === null ? tools : tools.filter(t => availableNames.includes(t.name));

      if (availableTools.length < tools.length) {
        const removed = tools.filter(t => !availableTools.includes(t)).map(t => t.name);
        log.debug({ userId, sessionId: activeSessionId, removed }, 'Dynamic tools: restricted unavailable tools');
      }

      const model = baseModel.bindTools(availableTools);

      const { messages: llmMessages, budgetReport } = assembleContext({
        phase: 'training',
        systemPrompt,
        previousSummary,
        history,
        userMessage,
        inFlight: inFlightMessages,
      });
      attachBudgetReport(config.metadata?.['runId'] as string, budgetReport);

      const response = await invokeWithRetry(model, llmMessages, config);

      log.debug(
        {
          userId,
          sessionId: activeSessionId,
          hasToolCalls: Array.isArray(response.tool_calls) && response.tool_calls.length > 0,
          contentType: typeof response.content,
        },
        'LLM response',
      );

      return { messages: [response] };
    } catch (err) {
      log.error({ err, userId, sessionId: activeSessionId }, 'Unhandled error in training agentNode');
      return {
        messages: [new AIMessage('Произошла непредвиденная ошибка. Попробуй ещё раз.')],
      };
    }
  };

  const extractNode = async (state: TrainingSubgraphStateType): Promise<Partial<ConversationStateType>> => {
    const lastMessage = state.messages[state.messages.length - 1] as AIMessage;
    const text =
      typeof lastMessage.content === 'string'
        ? lastMessage.content
        : (lastMessage.content as Array<{ type: string; text?: string }>)
            .filter(b => b.type === 'text')
            .map(b => b.text ?? '')
            .join('');

    const freshUser = state.userId ? await userService.getUser(state.userId).catch(() => null) : null;

    // requestedTransition/activeSessionId arrive through the subgraph state
    // from the tool executor
    return {
      responseMessage: text,
      user: freshUser ?? state.user,
    };
  };

  const graph = new StateGraph(TrainingSubgraphState)
    .addNode('agent', agentNode)
    .addNode('tools', toolExecutor)
    .addNode('extract', extractNode)
    .addEdge(START, 'agent')
    .addConditionalEdges('agent', toolsCondition, { tools: 'tools', [END]: 'extract' })
    .addConditionalEdges('tools', afterTools, { agent: 'agent', [END]: 'extract' })
    .addEdge('extract', END);

  return graph.compile();
}
