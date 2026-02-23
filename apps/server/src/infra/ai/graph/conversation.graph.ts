import { END, START, StateGraph } from '@langchain/langgraph';
import { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres';

import { ConversationState, ConversationStateType } from '@domain/conversation/graph/conversation.state';
import { IConversationContextService } from '@domain/conversation/ports';
import type { ITrainingService, IWorkoutPlanRepository } from '@domain/training/ports';
import type { IPromptService, IUserService } from '@domain/user/ports';

import { buildPersistNode } from './nodes/persist.node';
import { buildRouterNode } from './nodes/router.node';
import { buildChatSubgraph } from './subgraphs/chat.subgraph';

export const CONVERSATION_GRAPH_TOKEN = Symbol('ConversationGraph');

export interface ConversationGraphDeps {
  promptService: IPromptService;
  trainingService: ITrainingService;
  workoutPlanRepo: IWorkoutPlanRepository;
  userService: IUserService;
  contextService: IConversationContextService;
  checkpointer: PostgresSaver;
}

function stubPhaseNode(phase: string) {
  return (): Partial<ConversationStateType> => ({
    responseMessage: `[Phase '${phase}' not yet implemented — coming soon]`,
  });
}

function routeToPhase(state: ConversationStateType): string {
  // Router returned early response (e.g. session timeout) — skip phase, go to persist
  if (state.responseMessage && !state.userMessage) {
    return 'persist';
  }
  return state.phase;
}

function routeAfterPersist(state: ConversationStateType): string {
  if (state.requestedTransition) {
    return 'transition_guard';
  }
  return END;
}

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
function buildGraph(deps: ConversationGraphDeps) {
  const { userService, trainingService, contextService, workoutPlanRepo, checkpointer } = deps;

  const routerNode = buildRouterNode({ userService, trainingService });
  const persistNode = buildPersistNode(contextService);
  const chatSubgraph = buildChatSubgraph({ userService, workoutPlanRepo, contextService });

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

  const graph = new StateGraph(ConversationState)
    .addNode('router', routerNode)
    .addNode('registration', stubPhaseNode('registration'))
    .addNode('chat', chatSubgraph)
    .addNode('plan_creation', stubPhaseNode('plan_creation'))
    .addNode('session_planning', stubPhaseNode('session_planning'))
    .addNode('training', stubPhaseNode('training'))
    .addNode('persist', persistNode)
    .addNode('transition_guard', transitionGuardNode)
    .addNode('cleanup', cleanupNode)

    .addEdge(START, 'router')
    .addConditionalEdges('router', routeToPhase, {
      registration: 'registration',
      chat: 'chat',
      plan_creation: 'plan_creation',
      session_planning: 'session_planning',
      training: 'training',
      persist: 'persist',
    })
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
