import { type BaseCheckpointSaver, END, START, StateGraph } from '@langchain/langgraph';

import { LlmGateway } from '@domain/ai/ports';
import {
  IConversationContextService,
  IConversationRunService,
  SummaryPort,
  TranscriptPort,
} from '@domain/conversation/ports';
import type {
  IEmbeddingService,
  IExerciseRepository,
  ITrainingService,
  IWorkoutPlanRepository,
  IWorkoutSessionRepository,
} from '@domain/training/ports';
import type { IUserService } from '@domain/user/ports';

import { buildCompactionFlagHandler } from './handlers/compaction-flag.handler';
import { buildSessionLifecycleHandler } from './handlers/session-lifecycle.handler';
import { buildCommitNode } from './nodes/commit.node';
import { buildPrepareNode } from './nodes/prepare.node';
import { buildRouteNode } from './nodes/route.node';
import { buildPhaseSubgraph } from './phase-subgraph.factory';
import { buildPhaseSpecs } from './phases';
import { ConversationState, RunContext } from './state';

export const CONVERSATION_GRAPH_TOKEN = Symbol('ConversationGraph');

export interface ConversationGraphDeps {
  trainingService: ITrainingService;
  workoutPlanRepo: IWorkoutPlanRepository;
  workoutSessionRepo: IWorkoutSessionRepository;
  exerciseRepository: IExerciseRepository;
  embeddingService: IEmbeddingService;
  userService: IUserService;
  /** Transitional (P4 Task 4→7): only the agent's summary read still uses it. */
  contextService: IConversationContextService;
  runService: IConversationRunService;
  transcript: TranscriptPort;
  summaries: SummaryPort;
  llmGateway: LlmGateway;
  checkpointer: BaseCheckpointSaver;
}

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
function buildGraph(deps: ConversationGraphDeps) {
  const { userService, trainingService, runService, workoutSessionRepo, checkpointer, transcript } = deps;

  const specs = buildPhaseSpecs(deps);

  // prepare routes to 'route' normally and short-circuits dead training
  // states to 'commit' (D-E); route fans out to the phase nodes; every phase
  // falls into commit. Adding a phase = adding a spec (INV-LLM-005).
  const prepareNode = buildPrepareNode({ userService, trainingService });
  const routeNode = buildRouteNode();
  const commitNode = buildCommitNode({
    transcript,
    runService,
    // D-A: the compaction flag is FIRST — it must be set even if a later
    // handler fails. The legacy phase-summary handler is gone (P4 Task 4);
    // its file dies in Task 7.
    onTransition: [buildCompactionFlagHandler(), buildSessionLifecycleHandler({ trainingService, workoutSessionRepo })],
  });

  const graph = new StateGraph(ConversationState, RunContext)
    .addNode('prepare', prepareNode, { ends: ['route', 'commit'] })
    .addNode('route', routeNode, { ends: specs.map(s => s.name) })
    .addNode('commit', commitNode)
    .addEdge(START, 'prepare')
    .addEdge('commit', END);

  for (const spec of specs) {
    graph.addNode(spec.name, buildPhaseSubgraph(spec, deps)).addEdge(spec.name, 'commit');
  }

  return graph.compile({ checkpointer });
}

export type CompiledConversationGraph = ReturnType<typeof buildGraph>;

export function buildConversationGraph(deps: ConversationGraphDeps): CompiledConversationGraph {
  return buildGraph(deps);
}
