import type { TokenBudget } from '../episode';
import type { ConversationPhase } from '../phases';

export type ConversationRunOutcome = 'ok' | 'llm_unavailable' | 'core_error' | 'budget_exhausted';

/**
 * Estimated-token accounting of one context assembly (ADR-0013 §3.4, reporting
 * AND enforcement half since the context-budget plan). Numbers are estimator
 * output (see `estimator`), not provider counts — compare with `tokensIn` to
 * calibrate. The post-tool nudge is inserted after assembly and is not
 * counted. `budget` and `cuts` (Task 3) record what INV-LLM-004's
 * `resolveBudget` did to fit the run inside `PhaseSpec.budget`, if anything —
 * `history`/`domain`/`blocks`/`total` below are already POST-cut when a cut
 * happened.
 */
export interface BudgetReport {
  estimator: string; // TOKEN_ESTIMATOR_ID
  system: number; // block 1: the rendered phase prompt — domain data moved to block 3 (context-budget plan Task 2)
  /**
   * block 2a: the rendered `## User Facts` block (P6 Task 4), 0 when the user
   * has no facts. Billed against `budget.longTerm`.
   */
  longTerm: number;
  summary: number; // the rendered `## Previous episodes` block, 0 when there are no episode summaries (D-H)
  /**
   * block 3: the rendered domain context blocks (ADR-0013 §4.2 `contextBlocks`,
   * P4 context-budget plan Task 2, D-A/D-B), AT THE DEPTH `resolveBudget`
   * chose (full depth unless INV-LLM-004 stepped one down — Task 3). 0 when
   * the phase has none or all rendered null this run.
   */
  domain: number;
  /** Per-block token/depth breakdown, spec order, AFTER any Task 3 depth cut. */
  blocks: Array<{ id: string; tokens: number; depth: number }>;
  history: number; // history messages before this run's HumanMessage (D-H), AFTER any Task 3 trim
  user: number; // the current human message
  inFlight: number; // this run's AI tool-call messages and tool results
  /** Always 0 since P4 (D-H): tool results ride the channel; the field stays for baseline comparability. */
  toolResults: number;
  total: number; // sum of system + summary + domain + history + user + inFlight + toolResults
  messages: number; // messages in the array handed to the model (before the post-tool nudge)
  historyTurns: number; // HumanMessages in history
  assemblies?: number; // filled at persist: how many assemblies this run made (tool loops)
  /** PhaseSpec.budget for this run — D-C. Absent only for pre-Task-3 report shapes (baseline comparability). */
  budget?: TokenBudget;
  /**
   * What INV-LLM-004's resolveBudget cut, in order, empty when nothing was
   * cut (D-C). `'facts'` (P6 Task 4) truncates the `## User Facts` list
   * BEFORE history is trimmed — a deliberate extension of the invariant's
   * published order (facts are the cheapest thing to shorten). `'floor'`
   * (D-D) means block 1 and `current` only survived.
   */
  cuts?: Array<'facts' | 'history' | `block:${string}` | 'summary' | 'floor'>;
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
  /**
   * `path` (transition-handoff plan Task 2, D-2): the phases visited by a
   * same-run hand-off, first to last (e.g. `['session_planning',
   * 'training']`) — absent on a run with no hop. No migration: the column is
   * jsonb.
   */
  transition: { toPhase: string; reason?: string; path?: ConversationPhase[] } | null;
  outcome: ConversationRunOutcome;
  budgetReport: BudgetReport | null;
  /**
   * INV-LLM-009: the cause of a non-'ok' run — the thrown value's class name and a
   * truncated message, set for every failure path that reaches the adapter's
   * catch. Optional (not just nullable) so an 'ok' run's record, built by the
   * commit node, never has to name them: absent is null at the DB row.
   */
  errorClass?: string | null;
  errorMessage?: string | null;
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

/**
 * What a manual `/compact` did: `compacted` — the conversation so far was
 * folded into memory; `nothing_to_compact` — it was too short, nothing was
 * touched and no model was called.
 */
export type CompactOutcome = 'compacted' | 'nothing_to_compact';

export const CONVERSATION_RUN_PORT_TOKEN = Symbol('ConversationRunPort');

export interface ConversationRunPort {
  run(input: RunInput): Promise<RunResult>;
  /**
   * Wipes the user's conversation memory (D-F): the checkpointed thread
   * (messages channel and episode state) is deleted and a system note lands
   * in the transcript. The route talks to this port only.
   */
  clearContext(userId: string): Promise<void>;
  /**
   * Manual compaction (`/compact`): runs the existing compaction with reason
   * `manual` over the WHOLE conversation — the episode summary is written and
   * the summariser's fact operations are applied — and does nothing else (no
   * reply, no transcript rows, `lastUserMessageAt` untouched). Throws a typed
   * error (`LlmUnavailableError` / `CoreError` / `ThreadBusyError`) on failure,
   * with nothing removed — unlike the automatic triggers, which degrade.
   */
  compact(userId: string): Promise<CompactOutcome>;
}
