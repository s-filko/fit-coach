/**
 * Per-run LLM metrics, accumulated at the model boundary and drained when the
 * run is persisted (P0, ADR-0013 §8). Temporary home: P3 moves this into the
 * `commit` node's run context.
 *
 * `latencyMs` is wall time from `startRun` (called by the route, before the graph
 * runs) to the drain, so it is the end-to-end run latency P5.2 calibrates
 * `requestTimeout` against — not just the time spent inside model calls.
 *
 * Two maps, both capped: `runs` is keyed by our conversation runId and normally
 * dropped by `drainRunMetrics`; `callRuns` bridges LangChain's per-call run id to
 * ours between `handleChatModelStart` and `handleLLMEnd` and is dropped on read.
 * A run or call that errors before that leaves an entry behind, hence the caps.
 */
import type { BudgetReport } from '@domain/conversation/ports';

const MAX_TRACKED_RUNS = 500;
const MAX_TRACKED_CALLS = 500;

export interface RunMetrics {
  model: string | null;
  tokensIn: number;
  tokensOut: number;
  latencyMs: number;
  llmCalls: number;
  budgetReport: BudgetReport | null;
  assemblies: number;
}

interface RunAccumulator {
  model: string | null;
  tokensIn: number;
  tokensOut: number;
  startedAt: number;
  llmCalls: number;
  budgetReport: BudgetReport | null;
  assemblies: number;
}

const runs = new Map<string, RunAccumulator>();
const callRuns = new Map<string, string>();

const EMPTY: RunMetrics = {
  model: null,
  tokensIn: 0,
  tokensOut: 0,
  latencyMs: 0,
  llmCalls: 0,
  budgetReport: null,
  assemblies: 0,
};

function evictOldest(map: Map<string, unknown>, cap: number): void {
  if (map.size < cap) {
    return;
  }
  const oldest = map.keys().next();
  if (!oldest.done) {
    map.delete(oldest.value);
  }
}

function openRun(runId: string): RunAccumulator {
  const existing = runs.get(runId);
  if (existing) {
    return existing;
  }
  evictOldest(runs, MAX_TRACKED_RUNS);
  const acc: RunAccumulator = {
    model: null,
    tokensIn: 0,
    tokensOut: 0,
    startedAt: Date.now(),
    llmCalls: 0,
    budgetReport: null,
    assemblies: 0,
  };
  runs.set(runId, acc);
  return acc;
}

export function startRun(runId: string): void {
  if (!runId) {
    return;
  }
  openRun(runId);
}

export function startLlmCall(runId: string, model: string): void {
  if (!runId) {
    return;
  }
  const acc = openRun(runId);
  acc.llmCalls += 1;
  acc.model = model;
}

export function finishLlmCall(runId: string, tokensIn: number, tokensOut: number): void {
  const acc = runs.get(runId);
  if (!acc) {
    return;
  }
  acc.tokensIn += tokensIn;
  acc.tokensOut += tokensOut;
}

/**
 * Records one context assembly's report for the run (AC-1323). Last one wins
 * (D-B: the last assembly is the largest context of a run); `assemblies`
 * counts every attach so queries can separate single-call runs from tool
 * loops. An unknown runId opens the run — evals never call `startRun`.
 */
export function attachBudgetReport(runId: string, report: BudgetReport): void {
  if (!runId) {
    return;
  }
  const acc = openRun(runId);
  acc.budgetReport = report;
  acc.assemblies += 1;
}

export function bindCallToRun(llmRunId: string, runId: string): void {
  if (!llmRunId || !runId) {
    return;
  }
  evictOldest(callRuns, MAX_TRACKED_CALLS);
  callRuns.set(llmRunId, runId);
}

export function resolveCallRun(llmRunId: string): string | undefined {
  const runId = callRuns.get(llmRunId);
  if (runId !== undefined) {
    callRuns.delete(llmRunId);
  }
  return runId;
}

export function drainRunMetrics(runId: string): RunMetrics {
  const acc = runs.get(runId);
  if (!acc) {
    return { ...EMPTY };
  }
  runs.delete(runId);
  return {
    model: acc.model,
    tokensIn: acc.tokensIn,
    tokensOut: acc.tokensOut,
    latencyMs: Date.now() - acc.startedAt,
    llmCalls: acc.llmCalls,
    budgetReport: acc.budgetReport,
    assemblies: acc.assemblies,
  };
}
