/**
 * Prompt-caching plan (BUG-051) T2 — AC-PC-11 (D8.5): `cache-report` over seeded `llm_calls` rows prints hit
 * rate, the cost split and the breaks sorted by money lost. DB-backed (`RUN_DB_TESTS=1`).
 *
 * Interface assumed (T5b implements; `scripts/cache-report.ts <userId> <from> <to>` is a thin CLI over it —
 * the module is new, so the import is the accepted red). `@infra/observability/cache-report` exports:
 *   buildCacheReport({ userId, from: Date, to: Date, inputPricePerMTok: number, cacheTtl?: '5m' | '1h' }):
 *     Promise<CacheReport>
 *   formatCacheReport(report: CacheReport): string
 *   CacheReport = {
 *     calls, inputTokens, readTokens, writeTokens,
 *     uncachedTokens,                       // input − read − write (provider prompt_tokens include both)
 *     hitRate,                              // readTokens / inputTokens, 0..1
 *     cost: { read, write, uncached, total },   // USD: read 0.1×, write 1.25× (5m) / 2× (1h), uncached 1× list price
 *     breaks: Array<{ class: 'unplanned' | 'planned' | 'unexplained_miss'; where: string; count; lostTokens;
 *                     lostCostUsd }>
 *       // where = text after the first ':' of cache_break ('' for unexplained_miss);
 *       // sorted by lostCostUsd descending; cache_break 'none'/null excluded
 *   }
 * Rows read: llm_calls of `userId` with created_at in [from, to], columns input_tokens, cache_read_tokens,
 * cache_write_tokens, cache_break, cache_break_lost_tokens.
 */
import { randomUUID } from 'node:crypto';

import { db } from '@infra/db/drizzle';
import { llmCalls } from '@infra/db/schema';

import { buildCacheReport, formatCacheReport } from '@infra/observability/cache-report';

const USER = randomUUID();
const OTHER_USER = randomUUID();
const FROM = new Date('2026-09-29T10:00:00Z');
const TO = new Date('2026-09-29T12:00:00Z');
const at = (min: number) => new Date(FROM.getTime() + min * 60_000);

interface Seed {
  userId?: string;
  createdAt: Date;
  input: number;
  read: number;
  write: number;
  brk: string | null;
  lost?: number;
}

async function seed(rows: Seed[]): Promise<void> {
  let idx = 0;
  for (const r of rows) {
    idx += 1;
    await db.insert(llmCalls).values({
      runId: randomUUID(),
      userId: r.userId ?? USER,
      callIndex: idx,
      model: 'anthropic/claude-sonnet-5.5',
      request: null,
      response: null,
      promptHashes: [],
      inputTokens: r.input,
      outputTokens: 10,
      cacheReadTokens: r.read,
      cacheWriteTokens: r.write,
      cacheBreak: r.brk,
      cacheBreakLostTokens: r.lost ?? null,
      latencyMs: 100,
      createdAt: r.createdAt,
    } as never);
  }
}

describe('AC-PC-11: cache-report over seeded llm_calls rows', () => {
  beforeAll(async () => {
    await seed([
      { createdAt: at(1), input: 10000, read: 0, write: 10000, brk: null },
      { createdAt: at(2), input: 10500, read: 10000, write: 500, brk: 'none' },
      { createdAt: at(3), input: 10600, read: 10500, write: 100, brk: 'none' },
      { createdAt: at(4), input: 10700, read: 0, write: 10700, brk: 'unplanned:system:facts', lost: 10500 },
      { createdAt: at(5), input: 10800, read: 0, write: 0, brk: 'unexplained_miss', lost: 10700 },
      { createdAt: at(6), input: 11000, read: 10700, write: 300, brk: 'planned:hard_cap', lost: 500 },
      // must be excluded: outside the window, and another user's
      {
        createdAt: new Date(FROM.getTime() - 3_600_000),
        input: 99999,
        read: 0,
        write: 99999,
        brk: 'unplanned:tools',
        lost: 99999,
      },
      {
        userId: OTHER_USER,
        createdAt: at(3),
        input: 88888,
        read: 0,
        write: 88888,
        brk: 'unplanned:tools',
        lost: 88888,
      },
    ]);
  });

  it('AC-PC-11: hit rate, token split and cost split of the window (list price $3/M, 5m TTL)', async () => {
    const report = await buildCacheReport({ userId: USER, from: FROM, to: TO, inputPricePerMTok: 3, cacheTtl: '5m' });
    expect(report.calls).toBe(6);
    expect(report.inputTokens).toBe(63_600);
    expect(report.readTokens).toBe(31_200);
    expect(report.writeTokens).toBe(21_600);
    expect(report.uncachedTokens).toBe(10_800);
    expect(report.hitRate).toBeCloseTo(31_200 / 63_600, 6);
    expect(report.cost.read).toBeCloseTo((31_200 * 0.3) / 1e6, 8);
    expect(report.cost.write).toBeCloseTo((21_600 * 3.75) / 1e6, 8);
    expect(report.cost.uncached).toBeCloseTo((10_800 * 3) / 1e6, 8);
    expect(report.cost.total).toBeCloseTo(report.cost.read + report.cost.write + report.cost.uncached, 8);
  });

  it('AC-PC-11: breaks grouped by class and where, sorted by money lost, none/null excluded', async () => {
    const report = await buildCacheReport({ userId: USER, from: FROM, to: TO, inputPricePerMTok: 3, cacheTtl: '5m' });
    expect(report.breaks.map(b => [b.class, b.where, b.count, b.lostTokens])).toEqual([
      ['unexplained_miss', '', 1, 10_700],
      ['unplanned', 'system:facts', 1, 10_500],
      ['planned', 'hard_cap', 1, 500],
    ]);
    expect(report.breaks[0]!.lostCostUsd).toBeCloseTo((10_700 * 3) / 1e6, 8);
  });

  it('AC-PC-11: the printed report shows the hit rate and lists the breaks in that order', async () => {
    const report = await buildCacheReport({ userId: USER, from: FROM, to: TO, inputPricePerMTok: 3, cacheTtl: '5m' });
    const text = formatCacheReport(report);
    expect(text).toMatch(/hit rate/i);
    expect(text).toContain('49.1%');
    const miss = text.indexOf('unexplained_miss');
    const facts = text.indexOf('system:facts');
    const cap = text.indexOf('hard_cap');
    expect(miss).toBeGreaterThan(-1);
    expect(facts).toBeGreaterThan(miss);
    expect(cap).toBeGreaterThan(facts);
  });

  it('AC-PC-11: per-model list prices incl. output tokens, comparable with a bill; an unpriced model is left out, never guessed', async () => {
    const user = randomUUID();
    const rows = [
      { model: 'anthropic/claude-sonnet-5.5', input: 10000, output: 1000, read: 8000, write: 1000 },
      { model: 'anthropic/claude-haiku-4.5', input: 4000, output: 200, read: 0, write: 0 },
      { model: 'vendor/unknown-model', input: 500, output: 50, read: 0, write: 0 },
    ];
    let idx = 0;
    for (const r of rows) {
      idx += 1;
      await db.insert(llmCalls).values({
        runId: randomUUID(),
        userId: user,
        callIndex: idx,
        model: r.model,
        request: null,
        response: null,
        promptHashes: [],
        inputTokens: r.input,
        outputTokens: r.output,
        cacheReadTokens: r.read,
        cacheWriteTokens: r.write,
        latencyMs: 100,
        createdAt: at(10),
      } as never);
    }
    const report = await buildCacheReport({ userId: user, from: FROM, to: TO, cacheTtl: '5m' });
    const sonnet = report.models.find(m => m.model === 'anthropic/claude-sonnet-5.5')!;
    // sonnet ($2/$10 per 1M, fitted to the BUG-051 charge): read 8000×0.2 + write 1000×2.5 + uncached 1000×2 + output 1000×10
    expect(sonnet.cost!.read).toBeCloseTo((8000 * 0.2) / 1e6, 8);
    expect(sonnet.cost!.write).toBeCloseTo((1000 * 2.5) / 1e6, 8);
    expect(sonnet.cost!.uncached).toBeCloseTo((1000 * 2) / 1e6, 8);
    expect(sonnet.cost!.output).toBeCloseTo((1000 * 10) / 1e6, 8);
    expect(sonnet.cost!.withoutCaching).toBeCloseTo((10000 * 2 + 1000 * 10) / 1e6, 8);
    const haiku = report.models.find(m => m.model === 'anthropic/claude-haiku-4.5')!;
    expect(haiku.cost!.total).toBeCloseTo((4000 * 1 + 200 * 5) / 1e6, 8);
    expect(report.unpricedModels).toEqual(['vendor/unknown-model']);
    expect(report.cost.total).toBeCloseTo(sonnet.cost!.total + haiku.cost!.total, 8);
    expect(report.outputTokens).toBe(1250);
    const text = formatCacheReport(report);
    expect(text).toContain('vendor/unknown-model');
    expect(text).toContain('no price');
  });

  it('AC-PC-11: a per-model price override (LLM_MODEL_PRICES) wins over the built-in table', async () => {
    const user = randomUUID();
    await db.insert(llmCalls).values({
      runId: randomUUID(),
      userId: user,
      callIndex: 1,
      model: 'vendor/unknown-model',
      request: null,
      response: null,
      promptHashes: [],
      inputTokens: 1000,
      outputTokens: 100,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      latencyMs: 100,
      createdAt: at(11),
    } as never);
    const report = await buildCacheReport({
      userId: user,
      from: FROM,
      to: TO,
      prices: { 'vendor/unknown-model': { inputPerMTok: 2, outputPerMTok: 10 } },
    });
    expect(report.unpricedModels).toEqual([]);
    expect(report.cost.total).toBeCloseTo((1000 * 2 + 100 * 10) / 1e6, 8);
  });
});
