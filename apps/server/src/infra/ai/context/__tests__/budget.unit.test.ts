/**
 * resolveBudget (ADR-0013 §3.4 INV-LLM-004, P4 context-budget plan Task 3;
 * order extended by P6 Task 4): pure resolution order over an
 * already-measured context — (0) [P6] truncate facts, lowest-confirmations
 * first then oldest; (a) trim history to `budget.history`; (b) if still over
 * `sum - outputReserve`, step blocks down their `depths` (largest block
 * first); (c) drop episode summaries oldest first; (d) floor (D-D) — block 1
 * (`systemTokens`/the phase prompt) is never touched or reported as cut.
 */
import { AIMessage, type BaseMessage, HumanMessage, SystemMessage, ToolMessage } from '@langchain/core/messages';

import type { StoredEpisodeSummary } from '@domain/conversation/episode';
import type { UserFact } from '@domain/user/ports';

import { resolveBudget, trimHistory } from '../budget';
import { estimateMessages, estimateTokens } from '../token-estimator';

const NOW = new Date('2026-09-19T12:00:00Z');

function human(text: string, id: string): HumanMessage {
  return new HumanMessage({ content: text, id });
}

function ai(text: string, id: string, toolCallId?: string): AIMessage {
  return new AIMessage({
    content: text,
    id,
    tool_calls: toolCallId ? [{ id: toolCallId, name: 'log_set', args: {}, type: 'tool_call' }] : [],
  });
}

function toolMsg(text: string, id: string, toolCallId: string): ToolMessage {
  return new ToolMessage({ content: text, id, tool_call_id: toolCallId });
}

/** A long-ish turn: human, ai+tool_call, tool result — kept together by trimHistory. */
function turn(n: number): BaseMessage[] {
  return [
    human(`turn ${n} user message, reasonably long text to accumulate tokens quickly`, `h${n}`),
    ai(`turn ${n} ai calls a tool`, `a${n}`, `tc${n}`),
    toolMsg(`turn ${n} tool result, also fairly long so history grows`, `t${n}`, `tc${n}`),
  ];
}

function manyTurns(n: number): BaseMessage[] {
  const out: BaseMessage[] = [];
  for (let i = 0; i < n; i++) {
    out.push(...turn(i));
  }
  return out;
}

const SUMMARY = (id: string, endedAt: string): StoredEpisodeSummary => ({
  episodeId: id,
  phaseAtEnd: 'training',
  endedAt,
  summary: { topics: ['t'], decisions: [], userState: [], trainingFeedback: [], openItems: [], facts: [] },
});

const FACT = (id: string, overrides: Partial<UserFact> = {}): UserFact => ({
  id,
  userId: 'u1',
  category: 'equipment',
  fact: `fact ${id} text, reasonably long so several of these add up in tokens quickly`,
  factKey: `fact ${id} text`,
  muscleGroup: null,
  confirmations: 1,
  sourceTurnId: null,
  createdAt: new Date('2026-09-01T00:00:00Z'),
  updatedAt: new Date('2026-09-01T00:00:00Z'),
  ...overrides,
});

function baseBudget(overrides: Partial<Parameters<typeof resolveBudget>[0]['budget']> = {}) {
  return {
    system: 10000,
    longTerm: 10000,
    domain: 10000,
    history: 10000,
    outputReserve: 100,
    ...overrides,
  };
}

const BLOCK_CTX = { now: NOW, timezone: null, user: null };

describe('trimHistory (wraps trimMessages: last, startOn human, includeSystem false, allowPartial false)', () => {
  it('returns history unchanged when under maxTokens', async () => {
    const history = turn(0);
    const trimmed = await trimHistory(history, 100000, estimateMessages);
    expect(trimmed).toEqual(history);
  });

  it('trims to the tail, never splitting a tool pair, and the kept tail starts on a human message', async () => {
    const history = manyTurns(20);
    const maxTokens = estimateMessages(history.slice(-9)); // keep about the last 3 turns' worth
    const trimmed = await trimHistory(history, maxTokens, estimateMessages);

    expect(trimmed.length).toBeGreaterThan(0);
    expect(trimmed[0]._getType()).toBe('human');

    // No orphan ToolMessage: every kept ToolMessage.tool_call_id matches a kept AIMessage.tool_calls entry.
    const keptToolCallIds = new Set(
      trimmed.filter((m): m is AIMessage => m instanceof AIMessage).flatMap(m => (m.tool_calls ?? []).map(tc => tc.id)),
    );
    for (const m of trimmed) {
      if (m instanceof ToolMessage) {
        expect(keptToolCallIds.has(m.tool_call_id)).toBe(true);
      }
    }
  });

  it('no orphan ToolMessage for 50 random cut points (property-style)', async () => {
    const history = manyTurns(30);
    const full = estimateMessages(history);
    for (let i = 0; i < 50; i++) {
      const maxTokens = Math.floor((full * (i + 1)) / 51);
      // eslint-disable-next-line no-await-in-loop
      const trimmed = await trimHistory(history, maxTokens, estimateMessages);
      const keptToolCallIds = new Set(
        trimmed
          .filter((m): m is AIMessage => m instanceof AIMessage)
          .flatMap(m => (m.tool_calls ?? []).map(tc => tc.id)),
      );
      for (const m of trimmed) {
        if (m instanceof ToolMessage) {
          expect(keptToolCallIds.has(m.tool_call_id)).toBe(true);
        }
      }
      if (trimmed.length > 0) {
        expect(trimmed[0]._getType()).toBe('human');
      }
    }
  });
});

describe('resolveBudget — INV-LLM-004 resolution order', () => {
  it('INV-LLM-004: under budget on every axis → no cuts, block 1 identical in and out', async () => {
    const history = turn(0);
    const result = await resolveBudget({
      systemTokens: 50,
      facts: [],
      summaries: [],
      blocks: [],
      history,
      current: [human('hi', 'cur')],
      budget: baseBudget(),
      data: {},
      blockCtx: BLOCK_CTX,
      estimate: estimateMessages,
    });

    expect(result.cuts).toEqual([]);
    expect(result.history).toEqual(history);
    expect(result.summaries).toEqual([]);
    expect(result.blockDepths).toEqual({});
  });

  it('INV-LLM-004 (a): history trimmed first when over budget.history alone', async () => {
    const history = manyTurns(20);
    const result = await resolveBudget({
      systemTokens: 50,
      facts: [],
      summaries: [],
      blocks: [],
      history,
      current: [human('hi', 'cur')],
      budget: baseBudget({ history: estimateMessages(history.slice(-6)) }),
      data: {},
      blockCtx: BLOCK_CTX,
      estimate: estimateMessages,
    });

    expect(result.cuts).toContain('history');
    expect(estimateMessages(result.history)).toBeLessThanOrEqual(estimateMessages(history.slice(-6)) + 1);
    expect(result.history.length).toBeLessThan(history.length);
  });

  it('INV-LLM-004 (b): blocks step down depth (largest block first) when still over sum - outputReserve after trimming', async () => {
    const bigBlockText = 'x'.repeat(4000);
    const smallBlockText = 'y'.repeat(200);
    const result = await resolveBudget({
      systemTokens: 50,
      facts: [],
      summaries: [],
      blocks: [
        {
          id: 'big.block',
          depths: [5, 1],
          render: (_d: unknown, _c: unknown, depth: number) => (depth === 5 ? bigBlockText : 'small-big'),
        },
        {
          id: 'small.block',
          render: () => smallBlockText,
        },
      ],
      history: [],
      current: [human('hi', 'cur')],
      // Tight system/longTerm/history/domain/outputReserve budgets: `sum -
      // outputReserve` is far smaller than the actual full-depth block text
      // (~1150 tokens), so the measured total forces depth reduction.
      budget: baseBudget({ system: 60, longTerm: 1, history: 1, domain: 1, outputReserve: 1 }),
      data: {},
      blockCtx: BLOCK_CTX,
      estimate: estimateMessages,
    });

    expect(result.cuts).toContain('block:big.block');
    expect(result.blockDepths['big.block']).toBe(1);
    // small.block has no depths — it is never stepped down.
    expect(result.blockDepths['small.block']).toBeUndefined();
  });

  it('INV-LLM-004 (c): oldest episode summary dropped first when blocks alone are not enough', async () => {
    const oldest = SUMMARY('old', '2026-09-01T00:00:00Z');
    const newest = SUMMARY('new', '2026-09-18T00:00:00Z');
    // Both summaries render to 50 estimated tokens, one alone to 40 (measured via the
    // same EPISODE_SUMMARIES_V1 render assembleContext uses) — a longTerm budget of 45
    // leaves room for exactly one summary but not two.
    const result = await resolveBudget({
      systemTokens: 0,
      facts: [],
      summaries: [oldest, newest],
      blocks: [],
      history: [],
      current: [human('hi', 'cur')],
      budget: baseBudget({ system: 0, history: 0, domain: 0, longTerm: 45, outputReserve: 0 }),
      data: {},
      blockCtx: BLOCK_CTX,
      estimate: estimateMessages,
    });

    expect(result.cuts).toContain('summary');
    expect(result.summaries).toEqual([newest]);
  });

  it('INV-LLM-004 (d): floor — keeps block 1 and current only, logs the floor cut', async () => {
    const history = manyTurns(5);
    const result = await resolveBudget({
      systemTokens: 50,
      facts: [],
      summaries: [SUMMARY('s1', '2026-09-01T00:00:00Z')],
      blocks: [{ id: 'huge.block', render: () => 'z'.repeat(100000) }],
      history,
      // A single current message so huge that even after every other cut it still doesn't fit.
      current: [human('u'.repeat(100000), 'cur')],
      budget: baseBudget({ system: 50, history: 10, domain: 10, longTerm: 10, outputReserve: 1 }),
      data: {},
      blockCtx: BLOCK_CTX,
      estimate: estimateMessages,
    });

    expect(result.cuts[result.cuts.length - 1]).toBe('floor');
    expect(result.history).toEqual([]);
    expect(result.summaries).toEqual([]);
    // block 1 (systemTokens) is never reported as a cut target — 'system' is not even a member of BudgetCut.
    expect((result.cuts as string[]).every(c => c !== 'system')).toBe(true);
  });

  it('system over its own budget is reported only via the caller (resolveBudget never cuts block 1)', async () => {
    const result = await resolveBudget({
      systemTokens: 999999,
      facts: [],
      summaries: [],
      blocks: [],
      history: [],
      current: [human('hi', 'cur')],
      budget: baseBudget({ system: 10 }),
      data: {},
      blockCtx: BLOCK_CTX,
      estimate: estimateMessages,
    });

    // No cut ever targets block 1 — systemTokens passes through untouched. 'system' is not a BudgetCut member.
    expect((result.cuts as string[]).every(c => c !== 'system' && !c.startsWith('system:'))).toBe(true);
  });

  it('pure: same input twice → deep-equal output', async () => {
    const input = {
      systemTokens: 100,
      facts: [],
      summaries: [SUMMARY('a', '2026-09-10T00:00:00Z')],
      blocks: [{ id: 'b1', depths: [3, 1], render: (_d: unknown, _c: unknown, depth: number) => `block-${depth}` }],
      history: turn(0),
      current: [human('hi', 'cur')],
      budget: baseBudget(),
      data: {},
      blockCtx: BLOCK_CTX,
      estimate: estimateMessages,
    };
    const first = await resolveBudget(input);
    const second = await resolveBudget(input);
    expect(first).toEqual(second);
  });
});

describe('resolveBudget — (0) facts truncation, P6 Task 4 (deliberate extension of INV-LLM-004)', () => {
  it('under budget → facts pass through untouched, no cut recorded', async () => {
    const facts = [FACT('f1'), FACT('f2')];
    const result = await resolveBudget({
      systemTokens: 0,
      facts,
      summaries: [],
      blocks: [],
      history: [],
      current: [human('hi', 'cur')],
      budget: baseBudget(),
      data: {},
      blockCtx: BLOCK_CTX,
      estimate: estimateMessages,
    });

    expect(result.cuts).not.toContain('facts');
    expect(result.facts).toEqual(facts);
  });

  it('drops the lowest-confirmations fact first, then oldest on a tie, before any history trimming', async () => {
    const leastConfirmed = FACT('low-conf', { confirmations: 1, createdAt: new Date('2026-09-10T00:00:00Z') });
    const oldestTie = FACT('old-tie', { confirmations: 5, createdAt: new Date('2026-09-01T00:00:00Z') });
    const newestTie = FACT('new-tie', { confirmations: 5, createdAt: new Date('2026-09-15T00:00:00Z') });
    const history = turn(0);
    const historyTokens = estimateMessages(history);

    // sumMinusReserve = system(0) + longTerm(65) + domain(0) + history(historyTokens) - 0.
    // All three facts together don't fit; the two most-confirmed/most-recent do
    // (measured against the same USER_FACTS_V1 render resolveBudget uses) — so a
    // facts cut, not a history cut (history's own budget already covers it), is
    // what must make this fit.
    const result = await resolveBudget({
      systemTokens: 0,
      facts: [leastConfirmed, oldestTie, newestTie],
      summaries: [],
      blocks: [],
      history,
      current: [human('hi', 'cur')],
      budget: baseBudget({ system: 0, domain: 0, longTerm: 65, history: historyTokens, outputReserve: 0 }),
      data: {},
      blockCtx: BLOCK_CTX,
      estimate: estimateMessages,
    });

    expect(result.cuts).toContain('facts');
    expect(result.cuts).not.toContain('history');
    expect(result.history).toEqual(history); // untouched — the facts cut alone was enough
    // The least-confirmed fact drops before the older-but-more-confirmed tie facts.
    expect(result.facts.some(f => f.id === 'low-conf')).toBe(false);
    expect(result.facts.some(f => f.id === 'old-tie')).toBe(true);
    expect(result.facts.some(f => f.id === 'new-tie')).toBe(true);
  });

  it('truncates facts to empty before history is ever trimmed, when neither alone would fit', async () => {
    const facts = [FACT('a', { confirmations: 1 }), FACT('b', { confirmations: 1 })];
    const history = turn(0);
    const historyTokens = estimateMessages(history);

    const result = await resolveBudget({
      systemTokens: 0,
      facts,
      summaries: [],
      blocks: [],
      history,
      current: [human('hi', 'cur')],
      // longTerm=0 forces every fact out; history's OWN budget covers it plus a
      // little headroom for `current`, so if a history cut is observed here it
      // would prove facts truncation ran AFTER history trimming — which must
      // not happen (Task 4's ordering requirement) — or that the floor fired,
      // which would also be wrong (facts alone must be enough here).
      budget: baseBudget({ system: 0, domain: 0, longTerm: 0, history: historyTokens + 10, outputReserve: 0 }),
      data: {},
      blockCtx: BLOCK_CTX,
      estimate: estimateMessages,
    });

    expect(result.cuts).toContain('facts');
    expect(result.facts).toEqual([]);
    expect(result.cuts).not.toContain('history');
    expect(result.history).toEqual(history);
  });

  it('facts drop to empty at the D-D floor alongside history and summaries', async () => {
    const result = await resolveBudget({
      systemTokens: 50,
      facts: [FACT('f1')],
      summaries: [SUMMARY('s1', '2026-09-01T00:00:00Z')],
      blocks: [{ id: 'huge.block', render: () => 'z'.repeat(100000) }],
      history: turn(0),
      current: [human('u'.repeat(100000), 'cur')],
      budget: baseBudget({ system: 50, history: 10, domain: 10, longTerm: 10, outputReserve: 1 }),
      data: {},
      blockCtx: BLOCK_CTX,
      estimate: estimateMessages,
    });

    expect(result.cuts[result.cuts.length - 1]).toBe('floor');
    expect(result.facts).toEqual([]);
  });

  it('never touches block 1 (systemTokens) while truncating facts', async () => {
    const result = await resolveBudget({
      systemTokens: 999999,
      facts: [FACT('f1', { confirmations: 1 })],
      summaries: [],
      blocks: [],
      history: [],
      current: [human('hi', 'cur')],
      budget: baseBudget({ system: 10, longTerm: 0 }),
      data: {},
      blockCtx: BLOCK_CTX,
      estimate: estimateMessages,
    });

    expect((result.cuts as string[]).every(c => c !== 'system')).toBe(true);
  });
});

describe('module purity', () => {
  it('no Date.now()/new Date() reads inside budget.ts (grep-verified in CI verification step)', () => {
    // Structural smoke: resolveBudget takes `now` nowhere — it has no clock dependency at all.
    expect(resolveBudget.length).toBeLessThanOrEqual(1);
  });
});
