/**
 * Prompt-caching plan (BUG-051) D8.5: the zero-LLM cache report over `llm_calls` — hit rate, the token and cost
 * split per model, and the cache breaks grouped by class and place, sorted by money lost (the list of places to
 * optimise). Read-only. `scripts/cache-report.ts` is the CLI around it.
 *
 * Provider `prompt_tokens` include both the cached-read and the cache-written tokens (T1 probe), so
 * uncached = input − read − write. Priced per model (`model-prices.ts`): read 0.1×, write 1.25× (5m TTL) or 2× (1h),
 * uncached 1× the model's input price, OUTPUT tokens at its output price — so `cost.total` is comparable with the
 * provider's bill for the same window; `cost.withoutCaching` is what the same tokens would have cost uncached.
 * A model with no price is listed in `unpricedModels` and left out of every cost figure (never guessed).
 */
import { and, asc, eq, gte, lte } from 'drizzle-orm';

import type { PromptCacheTtl } from '@infra/ai/context/cache-breakpoints';
import { type ModelPrice, priceOf } from '@infra/ai/model-prices';
import { db } from '@infra/db/drizzle';
import { llmCalls } from '@infra/db/schema';

export interface CacheReportInput {
  userId: string;
  from: Date;
  to: Date;
  /**
   * A flat USD-per-1M INPUT price for every model (output left unpriced) — the quick override. Without it each
   * model is priced from `prices` / the built-in table.
   */
  inputPricePerMTok?: number;
  /** Per-model price overrides (LLM_MODEL_PRICES), merged over the built-in table. */
  prices?: Readonly<Record<string, ModelPrice>>;
  cacheTtl?: PromptCacheTtl;
}

export interface CacheBreakGroup {
  class: 'unplanned' | 'planned' | 'unexplained_miss';
  /** The text after the first ':' of `cache_break` ('' for unexplained_miss). */
  where: string;
  count: number;
  lostTokens: number;
  lostCostUsd: number;
}

export interface CostSplit {
  read: number;
  write: number;
  uncached: number;
  output: number;
  total: number;
  /** The same tokens with nothing cached: (read + write + uncached) at the input price, plus output. */
  withoutCaching: number;
}

export interface ModelCacheReport {
  model: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  readTokens: number;
  writeTokens: number;
  uncachedTokens: number;
  /** Null for an unpriced model. */
  cost: CostSplit | null;
}

export interface CacheReport {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  readTokens: number;
  writeTokens: number;
  uncachedTokens: number;
  /** readTokens / inputTokens, 0..1 (0 with no input). */
  hitRate: number;
  /** Sum over the PRICED models. */
  cost: CostSplit;
  models: ModelCacheReport[];
  unpricedModels: string[];
  breaks: CacheBreakGroup[];
}

const READ_MULTIPLIER = 0.1;
const WRITE_MULTIPLIER: Record<PromptCacheTtl, number> = { '5m': 1.25, '1h': 2 };
const PER_MTOK = 1_000_000;

const EMPTY_COST = (): CostSplit => ({ read: 0, write: 0, uncached: 0, output: 0, total: 0, withoutCaching: 0 });

function classify(cacheBreak: string): { class: CacheBreakGroup['class']; where: string } | null {
  if (cacheBreak === 'unexplained_miss') {
    return { class: 'unexplained_miss', where: '' };
  }
  const colon = cacheBreak.indexOf(':');
  if (colon < 0) {
    return null; // 'none'
  }
  const cls = cacheBreak.slice(0, colon);
  return cls === 'unplanned' || cls === 'planned' ? { class: cls, where: cacheBreak.slice(colon + 1) } : null;
}

function costOf(m: ModelCacheReport, price: ModelPrice, writeMultiplier: number): CostSplit {
  const input = price.inputPerMTok / PER_MTOK;
  const cost: CostSplit = {
    read: m.readTokens * input * READ_MULTIPLIER,
    write: m.writeTokens * input * writeMultiplier,
    uncached: m.uncachedTokens * input,
    output: (m.outputTokens * price.outputPerMTok) / PER_MTOK,
    total: 0,
    withoutCaching: m.inputTokens * input + (m.outputTokens * price.outputPerMTok) / PER_MTOK,
  };
  cost.total = cost.read + cost.write + cost.uncached + cost.output;
  return cost;
}

export async function buildCacheReport(input: CacheReportInput): Promise<CacheReport> {
  const rows = await db
    .select({
      model: llmCalls.model,
      inputTokens: llmCalls.inputTokens,
      outputTokens: llmCalls.outputTokens,
      cacheReadTokens: llmCalls.cacheReadTokens,
      cacheWriteTokens: llmCalls.cacheWriteTokens,
      cacheBreak: llmCalls.cacheBreak,
      cacheBreakLostTokens: llmCalls.cacheBreakLostTokens,
    })
    .from(llmCalls)
    .where(
      and(eq(llmCalls.userId, input.userId), gte(llmCalls.createdAt, input.from), lte(llmCalls.createdAt, input.to)),
    )
    .orderBy(asc(llmCalls.createdAt));

  const priceFor = (model: string): ModelPrice | null =>
    input.inputPricePerMTok !== undefined
      ? { inputPerMTok: input.inputPricePerMTok, outputPerMTok: 0 }
      : priceOf(model, input.prices);
  const writeMultiplier = WRITE_MULTIPLIER[input.cacheTtl ?? '5m'];

  const byModel = new Map<string, ModelCacheReport>();
  const groups = new Map<string, CacheBreakGroup>();
  for (const row of rows) {
    const m = byModel.get(row.model) ?? {
      model: row.model,
      calls: 0,
      inputTokens: 0,
      outputTokens: 0,
      readTokens: 0,
      writeTokens: 0,
      uncachedTokens: 0,
      cost: null,
    };
    m.calls += 1;
    m.inputTokens += row.inputTokens ?? 0;
    m.outputTokens += row.outputTokens ?? 0;
    m.readTokens += row.cacheReadTokens ?? 0;
    m.writeTokens += row.cacheWriteTokens ?? 0;
    byModel.set(row.model, m);

    const grouped = row.cacheBreak ? classify(row.cacheBreak) : null;
    if (grouped) {
      const key = `${grouped.class}\0${grouped.where}`;
      const group = groups.get(key) ?? { ...grouped, count: 0, lostTokens: 0, lostCostUsd: 0 };
      group.count += 1;
      const lost = row.cacheBreakLostTokens ?? 0;
      group.lostTokens += lost;
      group.lostCostUsd += (lost * (priceFor(row.model)?.inputPerMTok ?? 0)) / PER_MTOK;
      groups.set(key, group);
    }
  }

  const models = [...byModel.values()];
  const total = EMPTY_COST();
  const unpricedModels: string[] = [];
  for (const m of models) {
    m.uncachedTokens = Math.max(0, m.inputTokens - m.readTokens - m.writeTokens);
    const price = priceFor(m.model);
    if (price === null) {
      unpricedModels.push(m.model);
      continue;
    }
    m.cost = costOf(m, price, writeMultiplier);
    for (const key of Object.keys(total) as Array<keyof CostSplit>) {
      total[key] += m.cost[key];
    }
  }
  const sum = (pick: (m: ModelCacheReport) => number): number => models.reduce((n, m) => n + pick(m), 0);
  const inputTokens = sum(m => m.inputTokens);
  const readTokens = sum(m => m.readTokens);

  return {
    calls: rows.length,
    inputTokens,
    outputTokens: sum(m => m.outputTokens),
    readTokens,
    writeTokens: sum(m => m.writeTokens),
    uncachedTokens: sum(m => m.uncachedTokens),
    hitRate: inputTokens > 0 ? readTokens / inputTokens : 0,
    cost: total,
    models,
    unpricedModels,
    breaks: [...groups.values()].sort((a, b) => b.lostCostUsd - a.lostCostUsd || b.lostTokens - a.lostTokens),
  };
}

const usd = (n: number): string => `$${n.toFixed(4)}`;

export function formatCacheReport(report: CacheReport): string {
  const lines = [
    `Calls: ${report.calls}`,
    `Hit rate: ${(report.hitRate * 100).toFixed(1)}%  (read ${report.readTokens} of ${report.inputTokens} input tokens)`,
    `Tokens: read ${report.readTokens} · written ${report.writeTokens} · uncached ${report.uncachedTokens} · output ${report.outputTokens}`,
    `Cost: read ${usd(report.cost.read)} · write ${usd(report.cost.write)} · uncached ${usd(report.cost.uncached)} · output ${usd(report.cost.output)} · total ${usd(report.cost.total)}`,
    `Same tokens without caching: ${usd(report.cost.withoutCaching)}`,
  ];
  if (report.models.length > 1 || report.unpricedModels.length > 0) {
    lines.push('', 'By model:');
    for (const m of report.models) {
      lines.push(
        `  ${m.model.padEnd(36)} ${String(m.calls).padStart(4)} calls  ${m.cost ? usd(m.cost.total) : 'unpriced'}`,
      );
    }
  }
  if (report.unpricedModels.length > 0) {
    lines.push(
      `  (left out of the cost figures — no price: ${report.unpricedModels.join(', ')}; set LLM_MODEL_PRICES or --price)`,
    );
  }
  lines.push('', 'Cache breaks (by money lost):');
  if (report.breaks.length === 0) {
    lines.push('  none');
  }
  for (const b of report.breaks) {
    const label = b.where === '' ? b.class : `${b.class} ${b.where}`;
    lines.push(
      `  ${label.padEnd(36)} ×${String(b.count).padEnd(4)} ${String(b.lostTokens).padStart(8)} tokens  ${usd(b.lostCostUsd)}`,
    );
  }
  return lines.join('\n');
}
