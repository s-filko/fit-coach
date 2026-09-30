/**
 * Prompt-caching plan (BUG-051) T5 — AC-PC-6 (D5): while the provider cache is warm, budget compaction and
 * `trimHistory` wait; a hard ceiling stays as the safety net; after the TTL gap today's behaviour holds.
 *
 * Interface assumed (T5 implements to it — recorded in the plan § Evidence, T2). The caller decides "warm"
 * (previous call of the same user younger than LLM_PROMPT_CACHE_TTL_SECONDS) and passes a non-null
 * `cacheWarm` only then; the pure planners never read a clock or config:
 *   decideCompactReason({ …existing…, cacheWarm?: { hardCapTokens: number; estimatedTotalTokens: number } | null })
 *   resolveBudget({ …existing…, cacheWarm?: { hardCapTokens: number } | null })
 * `hardCapTokens` = LLM_CONTEXT_HARD_CAP_TOKENS (default 60 000, estimated tokens, config default asserted
 * in prompt-cache-config.repro.test.ts). The `inactivity` / `phase_boundary` paths are untouched.
 */
import { AIMessage, type BaseMessage, HumanMessage } from '@langchain/core/messages';

import { estimateMessages } from '../token-estimator';
import { resolveBudget } from '../budget';
import { decideCompactReason } from '../../graph/nodes/compact';

const NOW = new Date('2026-09-29T11:00:00Z');
const EPISODE_GAP_MS = 3 * 3_600_000;
const TTL_MS = 300_000;
const HARD_CAP = 60_000;

function turns(n: number): BaseMessage[] {
  const out: BaseMessage[] = [];
  for (let i = 0; i < n; i++) {
    out.push(new HumanMessage({ content: `turn ${i} user message, long enough to weigh something`, id: `h${i}` }));
    out.push(new AIMessage({ content: `turn ${i} coach reply, also long enough to weigh something`, id: `a${i}` }));
  }
  return out;
}

const history = turns(20);
const overBudget = Math.floor(estimateMessages(history) / 2);

function decide(lastAgoMs: number, extra: Record<string, unknown>) {
  return decideCompactReason({
    state: { compactReason: null, lastUserMessageAt: new Date(NOW.getTime() - lastAgoMs).toISOString() },
    history,
    now: NOW,
    gapMs: EPISODE_GAP_MS,
    historyBudget: overBudget,
    estimate: estimateMessages,
    ...extra,
  });
}

describe('AC-PC-6: budget compaction deferred while the cache is warm (D5)', () => {
  it('AC-PC-6: within the TTL, history over budget.history but total under the hard cap → no compaction', () => {
    const reason = decide(60_000, { cacheWarm: { hardCapTokens: HARD_CAP, estimatedTotalTokens: 20_000 } });
    expect(reason).toBeNull();
  });

  it('AC-PC-6: within the TTL, total over the hard cap → current behaviour (budget)', () => {
    const reason = decide(60_000, { cacheWarm: { hardCapTokens: HARD_CAP, estimatedTotalTokens: HARD_CAP + 1 } });
    expect(reason).toBe('budget');
  });

  it('AC-PC-6: cache not warm (gap ≥ TTL, caller passes null) → current behaviour (budget)', () => {
    const reason = decide(TTL_MS + 1, { cacheWarm: null });
    expect(reason).toBe('budget');
  });

  it('AC-PC-6: the inactivity trigger is untouched by the deferral (EPISODE_GAP passed)', () => {
    const reason = decide(EPISODE_GAP_MS, { cacheWarm: { hardCapTokens: HARD_CAP, estimatedTotalTokens: 20_000 } });
    expect(reason).toBe('inactivity');
  });
});

describe('AC-PC-6: trimHistory deferred while the cache is warm (D5)', () => {
  const resolve = (extra: Record<string, unknown>) =>
    resolveBudget({
      systemTokens: 50,
      facts: [],
      summaries: [],
      blocks: [],
      history,
      current: [new HumanMessage({ content: 'hi', id: 'cur' })],
      budget: { system: 10_000, longTerm: 10_000, domain: 10_000, history: overBudget, outputReserve: 100 },
      data: {},
      blockCtx: { now: NOW, timezone: null, user: null },
      estimate: estimateMessages,
      ...extra,
    });

  it('AC-PC-6: warm, total under the hard cap → history untouched, no history cut', async () => {
    const result = await resolve({ cacheWarm: { hardCapTokens: HARD_CAP } });
    expect(result.history).toEqual(history);
    expect(result.cuts).not.toContain('history');
  });

  it('AC-PC-6: warm, total over the hard cap → the existing trim runs', async () => {
    const result = await resolve({ cacheWarm: { hardCapTokens: 1 } });
    expect(result.cuts).toContain('history');
    expect(result.history.length).toBeLessThan(history.length);
  });

  it('AC-PC-6: not warm → the existing trim runs', async () => {
    const result = await resolve({ cacheWarm: null });
    expect(result.cuts).toContain('history');
  });
});
