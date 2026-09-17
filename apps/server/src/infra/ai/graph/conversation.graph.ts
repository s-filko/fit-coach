import type { RunnableConfig } from '@langchain/core/runnables';
import { type BaseCheckpointSaver, Command, END, START, StateGraph } from '@langchain/langgraph';

import { ConversationState, ConversationStateType } from '@domain/conversation/graph/conversation.state';
import { IConversationContextService, IConversationRunService } from '@domain/conversation/ports';
import type {
  IEmbeddingService,
  IExerciseRepository,
  ITrainingService,
  IWorkoutPlanRepository,
  IWorkoutSessionRepository,
} from '@domain/training/ports';
import type { IUserService } from '@domain/user/ports';

import { createLogger } from '@shared/logger';

import { buildPersistNode } from './nodes/persist.node';
import { generatePhaseSummary } from './nodes/phase-summary.node';
import { buildRouterNode } from './nodes/router.node';
import { buildPhaseSubgraph } from './phase-subgraph.factory';
import { buildPhaseSpecs } from './phases';

const log = createLogger('conversation-graph');

export const CONVERSATION_GRAPH_TOKEN = Symbol('ConversationGraph');

export interface ConversationGraphDeps {
  trainingService: ITrainingService;
  workoutPlanRepo: IWorkoutPlanRepository;
  workoutSessionRepo: IWorkoutSessionRepository;
  exerciseRepository: IExerciseRepository;
  embeddingService: IEmbeddingService;
  userService: IUserService;
  contextService: IConversationContextService;
  runService: IConversationRunService;
  checkpointer: BaseCheckpointSaver;
}

function routeAfterPersist(state: ConversationStateType): string {
  if (state.requestedTransition) {
    return 'transition_guard';
  }
  return END;
}

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
function buildGraph(deps: ConversationGraphDeps) {
  const { userService, trainingService, contextService, runService, workoutSessionRepo, checkpointer } = deps;

  const routerNode = buildRouterNode({ userService, trainingService, contextService });
  const persistNode = buildPersistNode(contextService, runService);

  const transitionGuardNode = async (
    state: ConversationStateType,
    config: RunnableConfig,
  ): Promise<Partial<ConversationStateType>> => {
    const { requestedTransition, phase, userId } = state;
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
      log.warn({ userId, from: phase, to: toPhase }, 'Guard blocked: transition not in allowed matrix');
      return { requestedTransition: null };
    }

    if (toPhase === 'training' && !state.activeSessionId) {
      log.warn({ userId, from: phase }, 'Guard blocked: training transition without activeSessionId');
      return { requestedTransition: null };
    }

    // Generate summary of the outgoing phase in background — does not block the transition.
    // Risk: if user sends next message before summary completes, that message won't see the summary.
    // Acceptable tradeoff: summary usually finishes in 5-10s, typical user think-time is longer.
    generatePhaseSummary(contextService, userId, phase, config).catch((err: unknown) =>
      log.error({ err, userId, phase }, 'Background phase summary failed'),
    );

    return { phase: toPhase, requestedTransition: null };
  };

  const cleanupNode = async (state: ConversationStateType): Promise<Partial<ConversationStateType>> => {
    const updates: Partial<ConversationStateType> = {};

    if (state.activeSessionId && state.phase === 'training') {
      // Transition session_planning → training: activate the planning session
      const session = await trainingService.getSessionDetails(state.activeSessionId).catch(() => null);
      if (session?.status === 'planning') {
        await workoutSessionRepo
          .update(state.activeSessionId, {
            status: 'in_progress',
            startedAt: new Date(),
          })
          .catch(() => null);
      }
    } else if (state.activeSessionId && state.phase !== 'training') {
      // Leaving training phase: complete the session only if not already finished
      const lingering = await trainingService.getSessionDetails(state.activeSessionId).catch(() => null);
      if (lingering && lingering.status !== 'completed' && lingering.status !== 'skipped') {
        await trainingService.completeSession(state.activeSessionId).catch(() => null);
      }
      updates.activeSessionId = null;
    }

    return updates;
  };

  // Router always returns Command(goto=phase) so LangGraph uses it for routing.
  // 'ends' declares all possible destinations — required when node returns Command.
  // Derived from the specs: adding a phase extends the router with no edit (INV-LLM-005).
  const specs = buildPhaseSpecs(deps);
  const routerEnds = [...specs.map(s => s.name), 'persist'];

  // Wrap routerNode to always emit a Command so that routing is driven by the node
  // itself rather than a separate conditional edge.  Timeout paths use goto='persist'
  // to short-circuit subgraph execution; all other paths use goto=state.phase.
  const routerNodeWithCommand = async (state: ConversationStateType, config: RunnableConfig) => {
    const result = await routerNode(state, config);
    if (result instanceof Command) {
      return result;
    }
    return new Command({ goto: result.phase ?? state.phase, update: result });
  };

  // The phases are data (INV-LLM-005): one node per spec, each straight into
  // 'persist'. A new phase = a new spec in buildPhaseSpecs — no builder edit.
  const graph = new StateGraph(ConversationState)
    .addNode('router', routerNodeWithCommand, { ends: routerEnds })
    .addNode('persist', persistNode)
    .addNode('transition_guard', transitionGuardNode)
    .addNode('cleanup', cleanupNode)

    .addEdge(START, 'router')
    .addConditionalEdges('persist', routeAfterPersist, {
      transition_guard: 'transition_guard',
      [END]: END,
    })
    .addEdge('transition_guard', 'cleanup')
    .addEdge('cleanup', END);
  for (const spec of specs) {
    graph.addNode(spec.name, buildPhaseSubgraph(spec, deps)).addEdge(spec.name, 'persist');
  }

  return graph.compile({ checkpointer });
}

export type CompiledConversationGraph = ReturnType<typeof buildGraph>;

export function buildConversationGraph(deps: ConversationGraphDeps): CompiledConversationGraph {
  return buildGraph(deps);
}
