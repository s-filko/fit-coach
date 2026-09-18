import { existsSync, readFileSync, writeFileSync } from 'node:fs';

import { BaseCallbackHandler } from '@langchain/core/callbacks/base';

/**
 * Cost metering for every model-backed eval run (D-Q, owner requirement
 * 2026-09-18): the ledger is the only place the cost of a run survives (eval
 * runs use the stub run service, nothing reaches the DB), and the owner needs
 * the estimate *before* pressing the button.
 */

export interface CostRecord {
  requests: number;
  tokensIn: number;
  tokensOut: number;
}

interface LlmUsage {
  promptTokens?: number;
  completionTokens?: number;
  prompt_tokens?: number;
  completion_tokens?: number;
}

/**
 * Rides `extraCallbacks` of one eval run. Mirrors run-metrics.ts token
 * extraction (`llmOutput.tokenUsage`), with the openai-style `usage` shape as
 * a fallback; counts only calls it started.
 */
export class CostRecorder extends BaseCallbackHandler {
  name = 'EvalCostRecorder';

  private requests = 0;
  private tokensIn = 0;
  private tokensOut = 0;
  private readonly openCalls = new Set<string>();

  handleChatModelStart(_llm: unknown, _messages: unknown, llmRunId: string): void {
    this.openCalls.add(llmRunId);
    this.requests += 1;
  }

  handleLLMEnd(output: { llmOutput?: { tokenUsage?: LlmUsage; usage?: LlmUsage } }, llmRunId: string): void {
    if (!this.openCalls.has(llmRunId)) {
      return;
    }
    this.openCalls.delete(llmRunId);
    const usage = output.llmOutput?.tokenUsage ?? output.llmOutput?.usage;
    this.tokensIn += usage?.promptTokens ?? usage?.prompt_tokens ?? 0;
    this.tokensOut += usage?.completionTokens ?? usage?.completion_tokens ?? 0;
  }

  record(): CostRecord {
    return { requests: this.requests, tokensIn: this.tokensIn, tokensOut: this.tokensOut };
  }
}

/** Pure: totals across records. */
export function summarizeCost(records: CostRecord[]): CostRecord {
  return records.reduce(
    (acc, r) => ({
      requests: acc.requests + r.requests,
      tokensIn: acc.tokensIn + r.tokensIn,
      tokensOut: acc.tokensOut + r.tokensOut,
    }),
    { requests: 0, tokensIn: 0, tokensOut: 0 },
  );
}

export interface RunEstimate {
  avgTokensPerRequest: number | null;
  estimatedTokens: number;
  note?: string;
}

/** Pre-run estimate: planned requests × the ledger's running average tokens/request. */
export function estimateRun(plannedRequests: number, ledger: CostRecord[]): RunEstimate {
  const totals = summarizeCost(ledger);
  if (totals.requests === 0) {
    return { avgTokensPerRequest: null, estimatedTokens: 0, note: 'no history — first metered run' };
  }
  const avg = (totals.tokensIn + totals.tokensOut) / totals.requests;
  return { avgTokensPerRequest: avg, estimatedTokens: Math.round(avg * plannedRequests) };
}

/**
 * Estimated % of weekly quota implied by the plan (D-Q): the ledger's average
 * quota delta per request × planned requests, over the owner-set weekly limit.
 * Null when there is no completed row or no limit — printed as unknown.
 */
export function estimateWeeklyPct(plannedRequests: number, ledgerText: string, weeklyLimit?: number): number | null {
  if (weeklyLimit === undefined || weeklyLimit === 0) {
    return null;
  }
  let requests = 0;
  let delta = 0;
  for (const line of ledgerText.split('\n')) {
    if (!line.startsWith('| 2')) {
      continue;
    }
    const cells = line.split('|').map(c => c.trim());
    const rowRequests = Number(cells[4]);
    const rowDelta = Number(cells[9]);
    if (Number.isFinite(rowRequests) && Number.isFinite(rowDelta)) {
      requests += rowRequests;
      delta += rowDelta;
    }
  }
  if (requests === 0) {
    return null;
  }
  return (((delta / requests) * plannedRequests) / weeklyLimit) * 100;
}

/** Delta as a percentage of the owner-set weekly limit; null when no limit is known. */
export function pctOfWeekly(delta: number, weeklyLimit: number | undefined): number | null {
  if (weeklyLimit === undefined || weeklyLimit === 0) {
    return null;
  }
  return (delta / weeklyLimit) * 100;
}

export interface LedgerRow {
  date: string;
  command: string;
  scope: string;
  requests: number;
  tokensIn: number;
  tokensOut: number;
  quotaBefore: string;
  quotaAfter: string;
  delta: string;
  pctWeekly: string;
}

const LEDGER_HEADER =
  '| date | command | scope | requests | tokens in | tokens out | quota before | quota after | delta | % weekly |';

function rowLine(row: LedgerRow): string {
  return `| ${row.date} | ${row.command} | ${row.scope} | ${row.requests} | ${row.tokensIn} | ${row.tokensOut} | ${row.quotaBefore} | ${row.quotaAfter} | ${row.delta} | ${row.pctWeekly} |`;
}

/** Appends one row to the committed markdown ledger (creates the file with a header if absent). */
export function appendLedgerRow(path: string, row: LedgerRow): void {
  const existing = existsSync(path) ? readFileSync(path, 'utf8') : '';
  if (!existing.includes(LEDGER_HEADER)) {
    writeFileSync(
      path,
      `${existing.trim()}\n\n${LEDGER_HEADER}\n|---|---|---|---|---|---|---|---|---|---|\n`.trimStart(),
      'utf8',
    );
  }
  const current = readFileSync(path, 'utf8');
  writeFileSync(path, `${current.trimEnd()}\n${rowLine(row)}\n`, 'utf8');
}

/** Sums requests/tokens over the ledger's data rows (for the running average). */
export function parseLedgerTable(text: string): CostRecord[] {
  const records: CostRecord[] = [];
  for (const line of text.split('\n')) {
    if (!line.startsWith('| 2')) {
      continue;
    }
    const cells = line.split('|').map(c => c.trim());
    // | date | command | scope | requests | tokensIn | tokensOut | ...
    const requests = Number(cells[4]);
    const tokensIn = Number(cells[5]);
    const tokensOut = Number(cells[6]);
    if (Number.isFinite(requests) && Number.isFinite(tokensIn) && Number.isFinite(tokensOut)) {
      records.push({ requests, tokensIn, tokensOut });
    }
  }
  return records;
}

/**
 * Fills the last row's `quota after` (and derives delta + % of weekly) after
 * the owner reads the dashboard — `npm run evals:ledger -- --after <n>`.
 * The weekly limit comes from `EVALS_WEEKLY_LIMIT` (owner sets it from the
 * plan's stated weekly cap, in the dashboard's units).
 */
export function completeLastRow(path: string, opts: { quotaAfter: number; weeklyLimit?: number }): void {
  const text = readFileSync(path, 'utf8');
  const lines = text.split('\n');
  const lastRowIndex = lines.reduce((last, line, i) => (line.startsWith('| 2') ? i : last), -1);
  if (lastRowIndex < 0) {
    throw new Error(`No ledger row to complete at ${path}`);
  }
  const cells = lines[lastRowIndex]!.split('|').map(c => c.trim());
  const quotaBefore = Number(cells[7]);
  if (!Number.isFinite(quotaBefore)) {
    throw new Error(`Last ledger row has a non-numeric quota before: ${cells[7]}`);
  }
  const delta = opts.quotaAfter - quotaBefore;
  const pct = pctOfWeekly(delta, opts.weeklyLimit);
  cells[8] = String(opts.quotaAfter);
  cells[9] = String(delta);
  cells[10] = pct === null ? '?' : `${pct.toFixed(1)}%`;
  // Rejoin with markdown spacing — the row must keep the table's format.
  lines[lastRowIndex] = `| ${cells.slice(1, -1).join(' | ')} |`;
  writeFileSync(path, `${lines.join('\n').trimEnd()}\n`, 'utf8');
}
