import { Command, END, START, StateGraph } from '@langchain/langgraph';
import { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres';

import { ConversationState, ConversationStateType } from '@domain/conversation/graph/conversation.state';
import { IConversationContextService } from '@domain/conversation/ports';
import type { IExerciseRepository, ITrainingService, IWorkoutPlanRepository } from '@domain/training/ports';
import type { IUserService } from '@domain/user/ports';

import { buildPersistNode } from './nodes/persist.node';
import { buildRouterNode } from './nodes/router.node';
import { buildChatSubgraph } from './subgraphs/chat.subgraph';
import { buildPlanCreationSubgraph } from './subgraphs/plan-creation.subgraph';
import { buildRegistrationSubgraph } from './subgraphs/registration.subgraph';

export const CONVERSATION_GRAPH_TOKEN = Symbol('ConversationGraph');

export interface ConversationGraphDeps {
  trainingService: ITrainingService;
  workoutPlanRepo: IWorkoutPlanRepository;
  exerciseRepository: IExerciseRepository;
  userService: IUserService;
  contextService: IConversationContextService;
  checkpointer: PostgresSaver;
}

function stubPhaseNode(phase: string) {
  return (): Partial<ConversationStateType> => ({
    responseMessage: `[Phase '${phase}' not yet implemented — coming soon]`,
  });
}

function routeAfterPersist(state: ConversationStateType): string {
  if (state.requestedTransition) {
    return 'transition_guard';
  }
  return END;
}

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
function buildGraph(deps: ConversationGraphDeps) {
  const { userService, trainingService, contextService, workoutPlanRepo, exerciseRepository, checkpointer } = deps;

  const routerNode = buildRouterNode({ userService, trainingService });
  const persistNode = buildPersistNode(contextService);
  const chatSubgraph = buildChatSubgraph({ userService, workoutPlanRepo, contextService });
  const registrationSubgraph = buildRegistrationSubgraph({ userService, contextService });
  const planCreationSubgraph = buildPlanCreationSubgraph({
    userService,
    contextService,
    exerciseRepository,
    workoutPlanRepository: workoutPlanRepo,
  });

  const transitionGuardNode = async(state: ConversationStateType): Promise<Partial<ConversationStateType>> => {
    const { requestedTransition, phase } = state;
    if (!requestedTransition) {
      return {};
    }

    const { toPhase } = requestedTransition;

    const allowed: Record<string, string[]> = {
      registration: ['chat', 'plan_creation'],
      chat: ['plan_creation', 'session_planning'],
      plan_creation: ['chat', 'session_planning'],
      session_planning: ['training', 'chat'],
      training: ['chat'],
    };

    const allowedTargets = allowed[phase] ?? [];
    if (!allowedTargets.includes(toPhase)) {
      return { requestedTransition: null };
    }

    return { phase: toPhase, requestedTransition: null };
  };

  const cleanupNode = async(state: ConversationStateType): Promise<Partial<ConversationStateType>> => {
    const updates: Partial<ConversationStateType> = {};

    if (state.activeSessionId && state.phase !== 'training') {
      await trainingService.completeSession(state.activeSessionId).catch(() => null);
      updates.activeSessionId = null;
    }

    return updates;
  };

  // Router always returns Command(goto=phase) so LangGraph uses it for routing.
  // 'ends' declares all possible destinations — required when node returns Command.
  const routerEnds = ['registration', 'chat', 'plan_creation', 'session_planning', 'training', 'persist'];

  // Wrap routerNode to always emit a Command so that routing is driven by the node
  // itself rather than a separate conditional edge.  Timeout paths use goto='persist'
  // to short-circuit subgraph execution; all other paths use goto=state.phase.
  const routerNodeWithCommand = async (state: ConversationStateType) => {
    const result = await routerNode(state);
    if (result instanceof Command) {
      return result;
    }
    return new Command({ goto: result.phase ?? state.phase, update: result });
  };

  const graph = new StateGraph(ConversationState)
    .addNode('router', routerNodeWithCommand, { ends: routerEnds })
    .addNode('registration', registrationSubgraph)
    .addNode('chat', chatSubgraph)
    .addNode('plan_creation', planCreationSubgraph)
    .addNode('session_planning', stubPhaseNode('session_planning'))
    .addNode('training', stubPhaseNode('training'))
    .addNode('persist', persistNode)
    .addNode('transition_guard', transitionGuardNode)
    .addNode('cleanup', cleanupNode)

    .addEdge(START, 'router')
    .addEdge('registration', 'persist')
    .addEdge('chat', 'persist')
    .addEdge('plan_creation', 'persist')
    .addEdge('session_planning', 'persist')
    .addEdge('training', 'persist')
    .addConditionalEdges('persist', routeAfterPersist, {
      transition_guard: 'transition_guard',
      [END]: END,
    })
    .addEdge('transition_guard', 'cleanup')
    .addEdge('cleanup', END);

  return graph.compile({ checkpointer });
}

export type CompiledConversationGraph = ReturnType<typeof buildGraph>;

export function buildConversationGraph(deps: ConversationGraphDeps): CompiledConversationGraph {
  return buildGraph(deps);
}
