import { type BaseCheckpointSaver, END, START, StateGraph } from '@langchain/langgraph';

import { LlmGateway } from '@domain/ai/ports';
import type { ConversationPhase } from '@domain/conversation/phases';
import { IConversationRunService, SummaryPort, TranscriptPort } from '@domain/conversation/ports';
import type {
  IEmbeddingService,
  IExerciseRepository,
  ITrainingService,
  IWorkoutPlanRepository,
  IWorkoutSessionRepository,
} from '@domain/training/ports';
import type { IUserFactsService, IUserService } from '@domain/user/ports';

import {
  buildCourseCheckStep,
  DEFAULT_EXPIRY_ASK_WINDOW_MS,
  DEFAULT_RETRY_COOLDOWN_MS,
} from '@infra/ai/course-check/course-check.step';

import type { TokenBudgetOverride } from '@config/llm-budget-overrides';

import { buildCompactionFlagHandler } from './handlers/compaction-flag.handler';
import { buildSessionLifecycleHandler } from './handlers/session-lifecycle.handler';
import { buildCommitNode } from './nodes/commit.node';
import { buildCompactStep, type EpisodeTunables } from './nodes/compact.node';
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
  runService: IConversationRunService;
  transcript: TranscriptPort;
  summaries: SummaryPort;
  /**
   * Facts: compaction applies the summariser's operations; conversation writes
   * go through manage_fact (fact-lifecycle Tasks 2-3).
   */
  userFacts: IUserFactsService;
  llmGateway: LlmGateway;
  /** The D-L episode tunables, resolved from env at the composition root. */
  episodeConfig: EpisodeTunables;
  /**
   * AC-FL-5 (course-check plan Task 1): COURSE_CHECK_ENABLED, resolved once at
   * the composition root. Optional so existing test fixtures keep compiling;
   * absent means enabled (the layer is the shipped behaviour).
   */
  courseCheckEnabled?: boolean;
  /**
   * COURSE_CHECK_RETRY_COOLDOWN_MINUTES in ms — how long a failed check is not
   * retried on the same fingerprint. Optional like the switch; absent = 15 min.
   */
  courseCheckRetryCooldownMs?: number;
  /**
   * COURSE_CHECK_EXPIRY_ASK_WINDOW_DAYS in ms — an ask_once fact expired longer
   * ago than this is archived silently, never asked about. Absent = 7 days.
   */
  courseCheckExpiryAskWindowMs?: number;
  /** LLM_BUDGET_<PHASE>_<PART> overrides (P4 context-budget plan Task 3), resolved once here. */
  budgetOverrides?: Record<string, TokenBudgetOverride>;
  checkpointer: BaseCheckpointSaver;
}

/** Applies a phase's LLM_BUDGET_* override (partial) over its PhaseSpec.budget default. */
export function withBudgetOverrides(
  specs: ReturnType<typeof buildPhaseSpecs>,
  overrides: Record<string, TokenBudgetOverride>,
) {
  return specs.map(spec => {
    const override = overrides[spec.name];
    return override ? { ...spec, budget: { ...spec.budget, ...override } } : spec;
  });
}

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
function buildGraph(deps: ConversationGraphDeps) {
  const { userService, trainingService, runService, workoutSessionRepo, checkpointer, transcript } = deps;
  const { llmGateway, summaries, userFacts, episodeConfig } = deps;

  const specs = withBudgetOverrides(buildPhaseSpecs(deps), deps.budgetOverrides ?? {});

  // D-D: the BR-LLM-003 trigger reads PhaseSpec.budget.history; an unknown
  // phase never overflows (the trigger is a comparison, enforcement is the
  // context-budget plan).
  const budgetFor = (phase: ConversationPhase): number =>
    specs.find(s => s.name === phase)?.budget.history ?? Number.POSITIVE_INFINITY;
  const compactStep = buildCompactStep({ llmGateway, summaries, userFacts, config: episodeConfig, budgetFor });
  // AC-FL-5: the course-check step — same gap threshold as compaction and the
  // time-gap note (threaded from episodeConfig, never re-read from env).
  const courseCheckStep = buildCourseCheckStep({
    llmGateway,
    userFacts,
    trainingService,
    config: {
      enabled: deps.courseCheckEnabled ?? true,
      gapMs: episodeConfig.gapMs,
      retryCooldownMs: deps.courseCheckRetryCooldownMs ?? DEFAULT_RETRY_COOLDOWN_MS,
      expiryAskWindowMs: deps.courseCheckExpiryAskWindowMs ?? DEFAULT_EXPIRY_ASK_WINDOW_MS,
    },
  });

  // prepare routes to 'route' normally and short-circuits dead training
  // states to 'commit' (D-E); route fans out to the phase nodes; every phase
  // falls into commit. Adding a phase = adding a spec (INV-LLM-005).
  const prepareNode = buildPrepareNode({
    userService,
    trainingService,
    compact: compactStep,
    courseCheck: courseCheckStep,
  });
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
    .addNode('prepare', prepareNode, { ends: ['route', 'commit', END] })
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
