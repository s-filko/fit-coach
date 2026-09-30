/**
 * Prompt-caching plan (BUG-051) D8.5: the zero-LLM cache report over `llm_calls` — hit rate, the token and cost
 * split, and the cache breaks grouped by class and place, sorted by money lost (the list of places to optimise).
 * Read-only. `scripts/cache-report.ts` is the CLI around it.
 *
 * Provider `prompt_tokens` include both the cached-read and the cache-written tokens (T1 probe), so
 * uncached = input − read − write. Prices: read 0.1×, write 1.25× (5m TTL) or 2× (1h), uncached 1× list price.
 */
import { and, asc, eq, gte, lte } from 'drizzle-orm';

import { db } from '@infra/db/drizzle';
import { llmCalls } from '@infra/db/schema';

export interface CacheReportInput {
  userId: string;
  from: Date;
  to: Date;
  /** USD per 1M uncached input tokens (LLM_INPUT_PRICE_PER_MTOK). */
  inputPricePerMTok: number;
  cacheTtl?: '5m' | '1h';
}

export interface CacheBreakGroup {
  class: 'unplanned' | 'planned' | 'unexplained_miss';
  /** The text after the first ':' of `cache_break` ('' for unexplained_miss). */
  where: string;
  count: number;
  lostTokens: number;
  lostCostUsd: number;
}

export interface CacheReport {
  calls: number;
  inputTokens: number;
  readTokens: number;
  writeTokens: number;
  uncachedTokens: number;
  /** readTokens / inputTokens, 0..1 (0 with no input). */
  hitRate: number;
  cost: { read: number; write: number; uncached: number; total: number };
  breaks: CacheBreakGroup[];
}

const READ_MULTIPLIER = 0.1;
const WRITE_MULTIPLIER: Record<'5m' | '1h', number> = { '5m': 1.25, '1h': 2 };

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

export async function buildCacheReport(input: CacheReportInput): Promise<CacheReport> {
  const rows = await db
    .select({
      inputTokens: llmCalls.inputTokens,
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

  const price = input.inputPricePerMTok / 1_000_000;
  const writeMultiplier = WRITE_MULTIPLIER[input.cacheTtl ?? '5m'];
  let inputTokens = 0;
  let readTokens = 0;
  let writeTokens = 0;
  const groups = new Map<string, CacheBreakGroup>();
  for (const row of rows) {
    inputTokens += row.inputTokens ?? 0;
    readTokens += row.cacheReadTokens ?? 0;
    writeTokens += row.cacheWriteTokens ?? 0;
    const grouped = row.cacheBreak ? classify(row.cacheBreak) : null;
    if (grouped) {
      const key = `${grouped.class}\0${grouped.where}`;
      const group = groups.get(key) ?? { ...grouped, count: 0, lostTokens: 0, lostCostUsd: 0 };
      group.count += 1;
      group.lostTokens += row.cacheBreakLostTokens ?? 0;
      group.lostCostUsd = group.lostTokens * price;
      groups.set(key, group);
    }
  }
  const uncachedTokens = Math.max(0, inputTokens - readTokens - writeTokens);
  const cost = {
    read: readTokens * price * READ_MULTIPLIER,
    write: writeTokens * price * writeMultiplier,
    uncached: uncachedTokens * price,
    total: 0,
  };
  cost.total = cost.read + cost.write + cost.uncached;

  return {
    calls: rows.length,
    inputTokens,
    readTokens,
    writeTokens,
    uncachedTokens,
    hitRate: inputTokens > 0 ? readTokens / inputTokens : 0,
    cost,
    breaks: [...groups.values()].sort((a, b) => b.lostCostUsd - a.lostCostUsd || b.lostTokens - a.lostTokens),
  };
}

const usd = (n: number): string => `$${n.toFixed(4)}`;

export function formatCacheReport(report: CacheReport): string {
  const lines = [
    `Calls: ${report.calls}`,
    `Hit rate: ${(report.hitRate * 100).toFixed(1)}%  (read ${report.readTokens} of ${report.inputTokens} input tokens)`,
    `Tokens: read ${report.readTokens} · written ${report.writeTokens} · uncached ${report.uncachedTokens}`,
    `Cost: read ${usd(report.cost.read)} · write ${usd(report.cost.write)} · uncached ${usd(report.cost.uncached)} · total ${usd(report.cost.total)}`,
    '',
    'Cache breaks (by money lost):',
  ];
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
