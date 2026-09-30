/**
 * Prompt-caching plan D5 (review R2/R3): ONE warm predicate and ONE hard-cap measure, shared by the compact step
 * and the assembler — no band where one defers and the other trims.
 */
import { AIMessage, HumanMessage } from '@langchain/core/messages';

import { decideCompactReason } from '../../graph/nodes/compact';
import { resolveBudget } from '../budget';
import { conversationTokens, warmCacheOf } from '../cache-warmth';
import { estimateMessages } from '../token-estimator';

const NOW = new Date('2026-09-30T12:00:00Z');
const ago = (ms: number): string => new Date(NOW.getTime() - ms).toISOString();
const TUNABLES = { cacheTtlMs: 300_000, hardCapTokens: 60_000 };

describe('warmCacheOf (AC-PC-6)', () => {
  it('AC-PC-6: previous message younger than the TTL → warm with the cap', () => {
    expect(warmCacheOf(TUNABLES, ago(60_000), NOW)).toEqual({ hardCapTokens: 60_000 });
  });

  it('AC-PC-6: at/after the TTL, never seen, or no cache tunables (LLM_PROMPT_CACHE=off) → null', () => {
    expect(warmCacheOf(TUNABLES, ago(300_000), NOW)).toBeNull();
    expect(warmCacheOf(TUNABLES, null, NOW)).toBeNull();
    expect(warmCacheOf({}, ago(1000), NOW)).toBeNull();
    expect(warmCacheOf({ cacheTtlMs: 300_000 }, ago(1000), NOW)).toBeNull();
  });

  it('AC-PC-6: tunables are not read until a previous message exists', () => {
    expect(warmCacheOf(undefined as never, null, NOW)).toBeNull();
  });
});

describe('one hard-cap measure for the compact step and the assembler (AC-PC-6, review R3)', () => {
  const history = Array.from({ length: 24 }, (_, i) =>
    i % 2 === 0
      ? new HumanMessage({ content: `вопрос ${i} `.repeat(30), id: `h${i}` })
      : new AIMessage({ content: `ответ ${i} `.repeat(30), id: `a${i}` }),
  );
  const current = [new HumanMessage({ content: 'дальше', id: 'cur' })];
  const measure = conversationTokens(history, current, estimateMessages);
  const tinyBudget = { system: 1, longTerm: 1, domain: 1, history: 1, outputReserve: 1 };

  const compactDecision = (cap: number) =>
    decideCompactReason({
      state: { compactReason: null, lastUserMessageAt: ago(1000) },
      history,
      now: NOW,
      gapMs: 3 * 3_600_000,
      historyBudget: 1,
      estimate: estimateMessages,
      cacheWarm: { hardCapTokens: cap, estimatedTotalTokens: measure },
    });
  const assemblerCuts = async (cap: number) =>
    (
      await resolveBudget({
        systemTokens: 10,
        facts: [],
        summaries: [],
        blocks: [],
        data: {},
        blockCtx: { now: NOW, timezone: null, user: null },
        history,
        current,
        budget: tinyBudget,
        estimate: estimateMessages,
        cacheWarm: { hardCapTokens: cap },
      })
    ).cuts;

  it('AC-PC-6: measure exactly at the cap → both defer', async () => {
    expect(compactDecision(measure)).toBeNull();
    expect(await assemblerCuts(measure)).toEqual([]);
  });

  it('AC-PC-6: one token over the cap → both act', async () => {
    expect(compactDecision(measure - 1)).toBe('budget');
    expect((await assemblerCuts(measure - 1)).length).toBeGreaterThan(0);
  });
});
