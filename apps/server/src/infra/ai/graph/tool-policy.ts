/**
 * ToolPolicy — the per-phase knobs of the shared tool executor
 * (ADR-0013 §4.2). Pure helpers only: ordering, batch dedup, search key.
 * Moved verbatim from training.subgraph.ts (ADR-0011 Fix 1.1/1.2) and
 * dedup-tool-node.ts; their unit tests moved with them unchanged.
 */
import { LLM_ERROR_PREFIX } from '@infra/ai/tools/outcome';

/** Minimal structural type both ToolCall and test stubs satisfy. */
export interface ToolCallLike {
  name: string;
  args: Record<string, unknown>;
  id?: string;
}

/**
 * What the agent node hands `availability`: the phase's loaded render data
 * (`PhaseSpec.loadContext`'s `data`; training reads its `session` field).
 * Loosely typed — the policy lambda installed by the training spec narrows
 * it to the domain shapes.
 */
export interface AvailabilityInput {
  data: unknown;
}

export interface ToolPolicy {
  /**
   * Execution priority (lower first); unknown tools last. Secondary key:
   * `args.order` within `log_set`.
   */
  ordering?: Record<string, number>;
  /**
   * Tools whose identical-args calls in one batch are all rejected with the
   * batch-duplicate LLM_ERROR (today: log_set).
   */
  batchDedup?: readonly string[];
  /**
   * Tools whose identical calls in one batch run once; later ones reuse the
   * first result (today: search_exercises).
   */
  perTurnDedup?: readonly string[];
  /**
   * Max `llm_error` tool results per run before the executor ends the run
   * with the catalog message. Infinity = today's unbounded loop.
   */
  llmErrorBudget: number;
  /**
   * Names the model may call now, given what the agent node loaded; null =
   * all. Called by the agent node (D-H).
   */
  availability?: (input: AvailabilityInput) => readonly string[] | null;
}

/** Phases with no training-only protections — today's four non-training subgraphs. */
export const NO_POLICY: ToolPolicy = { llmErrorBudget: Infinity };

/** Execution priority for training tools. Lower number = runs first. (Moved from training.subgraph.ts.) */
export const TRAINING_TOOL_PRIORITY: Record<string, number> = {
  search_exercises: 0,
  log_set: 1,
  complete_current_exercise: 2,
  delete_last_sets: 3,
  update_last_set: 3,
  finish_training: 4,
};

/**
 * Sorts tool calls by execution priority, then by the `order` field within log_set calls.
 * Unknown tools are assigned the lowest priority (treated as last).
 */
export function sortToolCallsByPriority<T extends ToolCallLike>(calls: T[], ordering?: Record<string, number>): T[] {
  const priority = ordering ?? TRAINING_TOOL_PRIORITY;
  return [...calls].sort((a, b) => {
    const pa = priority[a.name] ?? 99;
    const pb = priority[b.name] ?? 99;
    if (pa !== pb) {
      return pa - pb;
    }
    // Within same priority (both log_set), sort by the `order` field
    if (a.name === 'log_set' && b.name === 'log_set') {
      return ((a.args as { order?: number }).order ?? 999) - ((b.args as { order?: number }).order ?? 999);
    }
    return 0;
  });
}

/**
 * Returns the IDs of all calls to `names` tools that have identical arguments
 * (including the `order` field) within the same batch. If any two calls are
 * identical, ALL of them are returned so the entire duplicate group is rejected.
 *
 * Generalised by tool name from findDuplicateLogSets (training.subgraph.ts);
 * the log_set wrapper below keeps the ADR-0011 tests passing unchanged.
 */
export function findDuplicateCalls<T extends ToolCallLike>(calls: T[], names: readonly string[]): string[] {
  const targetNames = new Set(names);
  const targetCalls = calls.filter(c => targetNames.has(c.name));
  if (targetCalls.length < 2) {
    return [];
  }

  // Fingerprint: all args including `order` — calls with different order values
  // are treated as intentionally distinct (the LLM explicitly ordered them).
  const fingerprint = (call: T): string => JSON.stringify(call.args, Object.keys(call.args).sort());

  const groups = new Map<string, string[]>();
  for (const call of targetCalls) {
    const key = fingerprint(call);
    const group = groups.get(key) ?? [];
    group.push(call.id ?? '');
    groups.set(key, group);
  }

  const duplicateIds: string[] = [];
  for (const ids of groups.values()) {
    if (ids.length > 1) {
      duplicateIds.push(...ids);
    }
  }
  return duplicateIds;
}

/** ADR-0011 Fix 1.2 wrapper: batch dedup for log_set. */
export function findDuplicateLogSets<T extends ToolCallLike>(calls: T[]): string[] {
  return findDuplicateCalls(calls, ['log_set']);
}

/**
 * The rejection text for a batch-duplicate group. For `log_set` this is
 * byte-identical to the string training.subgraph.ts built inline (the
 * `LLM_ERROR:` prefix is added by the executor's serialisation).
 */
export function BATCH_DUPLICATE_MESSAGE(name: string): string {
  return (
    `Duplicate ${name} calls detected: two or more calls have identical arguments ` +
    'in the same response. To log multiple identical sets, add a unique order field to each call ' +
    `(order=1, order=2). To log a single set, send only one ${name} call.`
  );
}

/** For `log_set` the rendered rejection must equal today's full string. */
export function batchDuplicateToolResult(name: string): string {
  return `${LLM_ERROR_PREFIX} ${BATCH_DUPLICATE_MESSAGE(name)}`;
}

/**
 * Per-turn dedup cache key for search-like tools (moved verbatim from
 * dedup-tool-node.ts buildSearchKey).
 */
export function buildSearchKey(args: Record<string, unknown>): string {
  return JSON.stringify({
    q: String(args['query'] ?? '')
      .toLowerCase()
      .trim(),
    c: args['category'] ?? null,
    e: args['equipment'] ?? null,
    m: args['muscleGroup'] ?? null,
    l: args['limit'] ?? null,
  });
}
