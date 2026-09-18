import type { ConversationPhase } from '../phases';

export type ConversationRunOutcome = 'ok' | 'llm_unavailable' | 'core_error' | 'budget_exhausted';

/**
 * Estimated-token accounting of one context assembly (ADR-0013 §3.4, reporting half).
 * Numbers are estimator output (see `estimator`), not provider counts — compare with
 * `tokensIn` to calibrate. The post-tool nudge is inserted after assembly and is not
 * counted. P2 reports only; budgets and trimming arrive in P4.
 */
export interface BudgetReport {
  estimator: string; // TOKEN_ESTIMATOR_ID
  system: number; // block 1: the rendered phase prompt (domain data is inside it until P3)
  summary: number; // previous-summary frame, 0 when absent or not in the phase layout
  history: number; // interleaved turns, or the history_frame block (training)
  user: number; // the current human message
  inFlight: number; // this run's AI tool-call messages and tool results
  toolResults: number; // training's tool-results block, 0 elsewhere
  total: number; // sum of the six above
  messages: number; // messages in the array handed to the model (before the post-tool nudge)
  historyTurns: number; // history messages loaded from the transcript
  assemblies?: number; // filled at persist: how many assemblies this run made (tool loops)
}

/** One recorded conversation run — ADR-0013 §8. `model` is null for runs that failed before any model call (D-F). */
export interface ConversationRunRecord {
  runId: string;
  userId: string;
  phaseIn: ConversationPhase;
  phaseOut: ConversationPhase | null;
  model: string | null;
  trigger: 'user_message' | 'system';
  client: 'telegram' | 'webapp';
  promptVersions: Record<string, string>;
  tokensIn: number | null;
  tokensOut: number | null;
  latencyMs: number;
  toolCalls: Array<{ name: string; argsHash: string; outcomeKind: string }> | null;
  transition: { toPhase: string; reason?: string } | null;
  outcome: ConversationRunOutcome;
  budgetReport: BudgetReport | null;
}

export const CONVERSATION_RUN_SERVICE_TOKEN = Symbol('ConversationRunService');

export interface IConversationRunService {
  recordRun(record: ConversationRunRecord): Promise<void>;
}

/**
 * ConversationRunPort (ADR-0013 §11): what the app layer calls to run one
 * conversation turn. The route talks to this port, never to the graph.
 */
export interface RunInput {
  userId: string;
  text: string;
  client?: 'telegram' | 'webapp';
  trigger?: 'user_message' | 'system';
}

export interface RunResult {
  text: string;
  phase: ConversationPhase;
  runId: string;
}

export const CONVERSATION_RUN_PORT_TOKEN = Symbol('ConversationRunPort');

export interface ConversationRunPort {
  run(input: RunInput): Promise<RunResult>;
  /**
   * Wipes the user's conversation memory (D-F): the checkpointed thread
   * (messages channel and episode state) is deleted and a system note lands
   * in the transcript. The route talks to this port only.
   */
  clearContext(userId: string): Promise<void>;
}
