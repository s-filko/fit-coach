/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { AIMessage, HumanMessage, SystemMessage } from '@langchain/core/messages';
import { Annotation, END, MessagesAnnotation, START, StateGraph } from '@langchain/langgraph';
import { ToolNode, toolsCondition } from '@langchain/langgraph/prebuilt';

import { type ConversationStateType, type TransitionRequest } from '@domain/conversation/graph/conversation.state';
import { IConversationContextService } from '@domain/conversation/ports';
import type { IExerciseRepository, IWorkoutPlanRepository } from '@domain/training/ports';
import type { IUserService } from '@domain/user/ports';
import type { User } from '@domain/user/services/user.service';

import { buildPlanCreationSystemPrompt } from '@infra/ai/graph/nodes/plan-creation.node';
import { buildPlanCreationTools } from '@infra/ai/graph/tools/plan-creation.tools';
import { getModel } from '@infra/ai/model.factory';

export interface PlanCreationSubgraphDeps {
  userService: IUserService;
  contextService: IConversationContextService;
  exerciseRepository: IExerciseRepository;
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
  const { userService, contextService, exerciseRepository, workoutPlanRepository } = deps;

  /**
   * Mutable closure ref: tools write their pending transition here instead of
   * returning a Command (which would break ToolNode's ToolMessage flow and cause
   * an infinite recursion loop). extractNode reads this ref once and clears it.
   */
  const pendingTransition: { value: TransitionRequest | null } = { value: null };

  const tools = buildPlanCreationTools({ workoutPlanRepository, pendingTransition });
  const toolNode = new ToolNode(tools);
  const model = getModel().bindTools(tools);

  const agentNode = async(state: PlanCreationSubgraphStateType) => {
    const { userId, user, userMessage } = state;

    const [history, exercises] = await Promise.all([
      contextService.getMessagesForPrompt(userId, 'plan_creation'),
      exerciseRepository.findAllWithMuscles(),
    ]);

    // Fetch fresh user so the prompt always has the latest profile
    const freshUser = await userService.getUser(userId);
    const systemPrompt = buildPlanCreationSystemPrompt(freshUser ?? user, exercises);

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

  const extractNode = async(state: PlanCreationSubgraphStateType): Promise<Partial<ConversationStateType>> => {
    const lastMessage = state.messages[state.messages.length - 1] as AIMessage;
    const text = typeof lastMessage.content === 'string'
      ? lastMessage.content
      : (lastMessage.content as Array<{ type: string; text?: string }>)
          .filter((b) => b.type === 'text')
          .map((b) => b.text ?? '')
          .join('');

    // Read fresh user from DB to capture any changes during this turn
    const freshUser = state.userId
      ? await userService.getUser(state.userId).catch(() => null)
      : null;

    // Consume the pending transition set by save_workout_plan or request_transition tools
    const transition = pendingTransition.value;
    pendingTransition.value = null;

    return {
      responseMessage: text,
      user: freshUser ?? state.user,
      requestedTransition: transition,
    };
  };

  const graph = new StateGraph(PlanCreationSubgraphState)
    .addNode('agent', agentNode)
    .addNode('tools', toolNode)
    .addNode('extract', extractNode)
    .addEdge(START, 'agent')
    .addConditionalEdges('agent', toolsCondition, { tools: 'tools', [END]: 'extract' })
    .addEdge('tools', 'agent')
    .addEdge('extract', END);

  return graph.compile();
}
