import { END, START, StateGraph } from '@langchain/langgraph';
import { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres';

import { ConversationState, ConversationStateType } from '@domain/conversation/graph/conversation.state';
import { IConversationContextService } from '@domain/conversation/ports';
import type { ITrainingService, IWorkoutPlanRepository } from '@domain/training/ports';
import type { IPromptService, IUserService } from '@domain/user/ports';

import { buildPersistNode } from './nodes/persist.node';
import { buildRouterNode } from './nodes/router.node';

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
  // If router returned an early response (e.g. timeout), go straight to persist
  if (state.responseMessage && !state.userMessage) {
    return 'persist';
  }
  return state.phase;
}

function routeAfterPersist(state: ConversationStateType): string {
  const transition = state.requestedTransition;
  if (transition) {
    return 'transition_guard';
  }
  return END;
}

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
function buildGraph(deps: ConversationGraphDeps) {
  const { userService, trainingService, contextService, checkpointer } = deps;

  const routerNode = buildRouterNode({ userService, trainingService });
  const persistNode = buildPersistNode(contextService);

  const transitionGuardNode = async (state: ConversationStateType): Promise<Partial<ConversationStateType>> => {
    const { requestedTransition, phase, activeSessionId } = state;
    if (!requestedTransition) {
      return {};
    }

    const { toPhase } = requestedTransition;

    // Transition rules (ported from ChatService.validatePhaseTransition — was dead code)
    const allowed: Record<string, string[]> = {
      registration: ['chat'],
      chat: ['plan_creation', 'session_planning', 'training'],
      plan_creation: ['chat'],
      session_planning: ['training', 'chat'],
      training: ['chat'],
    };

    const allowedTargets = allowed[phase] ?? [];
    if (!allowedTargets.includes(toPhase)) {
      return { requestedTransition: null };
    }

    // training → chat requires active session to be completed (cleanup handles it)
    if (phase === 'training' && toPhase === 'chat' && activeSessionId) {
      return { phase: toPhase, requestedTransition: null };
    }

    return { phase: toPhase, requestedTransition: null };
  };

  const cleanupNode = async (state: ConversationStateType): Promise<Partial<ConversationStateType>> => {
    const updates: Partial<ConversationStateType> = {};

    // After transitioning OUT of training, ensure session is completed
    if (state.activeSessionId) {
      // Only clear if we've moved away from training phase
      if (state.phase !== 'training') {
        await trainingService.completeSession(state.activeSessionId).catch(() => null);
        updates.activeSessionId = null;
      }
    }

    // When entering training phase from session_planning, session is already 'planning' status
    // The first training node invocation will update it to 'in_progress'

    return updates;
  };

  const graph = new StateGraph(ConversationState)
    .addNode('router', routerNode)
    .addNode('registration', stubPhaseNode('registration'))
    .addNode('chat', stubPhaseNode('chat'))
    .addNode('plan_creation', stubPhaseNode('plan_creation'))
    .addNode('session_planning', stubPhaseNode('session_planning'))
    .addNode('training', stubPhaseNode('training'))
    .addNode('persist', persistNode)
    .addNode('transition_guard', transitionGuardNode)
    .addNode('cleanup', cleanupNode)

    // Entry
    .addEdge(START, 'router')
    // Router → dispatch to phase or early exit
    .addConditionalEdges('router', routeToPhase, {
      registration: 'registration',
      chat: 'chat',
      plan_creation: 'plan_creation',
      session_planning: 'session_planning',
      training: 'training',
      persist: 'persist',
    })
    // All phases → persist
    .addEdge('registration', 'persist')
    .addEdge('chat', 'persist')
    .addEdge('plan_creation', 'persist')
    .addEdge('session_planning', 'persist')
    .addEdge('training', 'persist')
    // Persist → transition guard or end
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
