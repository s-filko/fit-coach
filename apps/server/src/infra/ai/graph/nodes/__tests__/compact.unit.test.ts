/**
 * Pure compaction planning (BR-LLM-001..004, refactor-p4-episode-memory
 * Task 6): trigger precedence, the turn-safe cut, the short-episode rule and
 * the transcript renderer. No I/O, no clock — `now` and `estimate` come in
 * as data (BR-LLM-007).
 */
import { AIMessage, type BaseMessage, HumanMessage, ToolMessage } from '@langchain/core/messages';

import type { CompactReason } from '@domain/conversation/episode';

import { estimateMessages } from '@infra/ai/context/token-estimator';

import { decideCompactReason, isShortEpisode, planCompaction, renderTranscript } from '../compact';

const NOW = new Date('2026-09-18T12:00:00Z');
const GAP_MS = 3 * 3600 * 1000;

function human(id: string, text: string): HumanMessage {
  return new HumanMessage({ content: text, id });
}

function ai(id: string, text: string): AIMessage {
  return new AIMessage({ content: text, id, tool_calls: [] });
}

/** A turn with tool traffic — the shape the cut must never split. */
function toolTurn(prefix: string): BaseMessage[] {
  const call = new AIMessage({
    content: '',
    id: `${prefix}-call`,
    tool_calls: [{ id: `${prefix}-tc`, name: 'search_exercises', args: { query: 'chest' }, type: 'tool_call' }],
  });
  const result = new ToolMessage({ tool_call_id: `${prefix}-tc`, content: 'Found 3 exercises:', id: `${prefix}-res` });
  return [call, result];
}

describe('decideCompactReason (BR-LLM-001..003; precedence phase_boundary > inactivity > budget)', () => {
  const history = [human('h1', 'q1'), ai('a1', 'r1'), human('h2', 'q2'), ai('a2', 'r2')];

  it('phase_boundary wins over an also-met inactivity gap and budget overflow', () => {
    const reason = decideCompactReason({
      state: {
        compactReason: 'phase_boundary',
        lastUserMessageAt: new Date(NOW.getTime() - 10 * GAP_MS).toISOString(),
      },
      history,
      now: NOW,
      gapMs: GAP_MS,
      historyBudget: 1,
      estimate: estimateMessages,
    });
    expect(reason).toBe('phase_boundary');
  });

  it('BR-LLM-001: gap ≥ EPISODE_GAP with history present → inactivity (even over budget)', () => {
    const reason = decideCompactReason({
      state: { compactReason: null, lastUserMessageAt: new Date(NOW.getTime() - GAP_MS).toISOString() },
      history,
      now: NOW,
      gapMs: GAP_MS,
      historyBudget: 1,
      estimate: estimateMessages,
    });
    expect(reason).toBe('inactivity');
  });

  it('BR-LLM-003: over-budget history with a short gap → budget', () => {
    const reason = decideCompactReason({
      state: { compactReason: null, lastUserMessageAt: new Date(NOW.getTime() - 60_000).toISOString() },
      history,
      now: NOW,
      gapMs: GAP_MS,
      historyBudget: 1,
      estimate: estimateMessages,
    });
    expect(reason).toBe('budget');
  });

  it('no trigger when the gap is short and the history fits', () => {
    const reason = decideCompactReason({
      state: { compactReason: null, lastUserMessageAt: new Date(NOW.getTime() - 60_000).toISOString() },
      history,
      now: NOW,
      gapMs: GAP_MS,
      historyBudget: 1_000_000,
      estimate: estimateMessages,
    });
    expect(reason).toBeNull();
  });

  it('lastUserMessageAt === null never triggers inactivity (first run of a live thread)', () => {
    const reason = decideCompactReason({
      state: { compactReason: null, lastUserMessageAt: null },
      history,
      now: NOW,
      gapMs: 0,
      historyBudget: 1_000_000,
      estimate: estimateMessages,
    });
    expect(reason).toBeNull();
  });

  it('empty history never triggers (INV-LLM-002: compaction needs an episode to end)', () => {
    const reason = decideCompactReason({
      state: { compactReason: null, lastUserMessageAt: new Date(NOW.getTime() - 10 * GAP_MS).toISOString() },
      history: [],
      now: NOW,
      gapMs: GAP_MS,
      historyBudget: 1,
      estimate: estimateMessages,
    });
    expect(reason).toBeNull();
  });
});

describe('planCompaction (AC-CC-1 — the verbatim tail; D-I — the cut never splits a turn)', () => {
  const history: BaseMessage[] = [
    ...toolTurn('t1'),
    human('h1', 'первый вопрос'),
    ...toolTurn('t2'),
    ai('a1', 'первый ответ'),
    human('h2', 'второй вопрос'),
    ...toolTurn('t3'),
    ai('a2', 'второй ответ'),
  ];
  // Layout: [t1(2), h1, t2(2), a1, h2, t3(2), a2] — turn 3 starts at h2 (index 6).
  const NOT_SHORT = { minTurns: 0, minTokens: 0 };

  it.each(['inactivity', 'phase_boundary'] as const)(
    '%s keeps the last keepTurns turns verbatim and removes only the older part',
    (reason: CompactReason) => {
      const { removed, kept } = planCompaction({
        history,
        reason,
        historyBudget: 1_000_000,
        estimate: estimateMessages,
        keepTurns: 1,
        ...NOT_SHORT,
      });

      expect(removed).toEqual(history.slice(0, 6));
      expect(kept).toEqual(history.slice(6));
    },
  );

  it('AC-CC-1: a too-short older part is kept, never dropped — nothing removed this run', () => {
    // keepTurns 2 → the older part is turn 1 (one human turn < minTurns 2, D-B).
    const { removed, kept } = planCompaction({
      history,
      reason: 'inactivity',
      historyBudget: 1_000_000,
      estimate: estimateMessages,
      keepTurns: 2,
      minTurns: 2,
      minTokens: 0,
    });

    expect(removed).toEqual([]);
    expect(kept).toEqual(history);
  });

  it('AC-CC-1: history within keepTurns turns → nothing removed (rides along verbatim)', () => {
    const { removed, kept } = planCompaction({
      history,
      reason: 'phase_boundary',
      historyBudget: 1_000_000,
      estimate: estimateMessages,
      keepTurns: 3,
      ...NOT_SHORT,
    });

    expect(removed).toEqual([]);
    expect(kept).toEqual(history);
  });

  it('tool pairs travel together: no side holds an AIMessage(tool_calls) without its ToolMessages', () => {
    const { removed, kept } = planCompaction({
      history,
      reason: 'inactivity',
      historyBudget: 1_000_000,
      estimate: estimateMessages,
      keepTurns: 2,
      ...NOT_SHORT,
    });
    for (const side of [removed, kept]) {
      for (const m of side) {
        if (m._getType() === 'ai' && (m as AIMessage).tool_calls?.length) {
          for (const call of (m as AIMessage).tool_calls!) {
            const answered = side.some(o => o._getType() === 'tool' && (o as ToolMessage).tool_call_id === call.id);
            expect(answered).toBe(true);
          }
        }
      }
    }
  });

  it('FIRST: a history ending in AIMessage(tool_calls) + ToolMessage is only cut at a HumanMessage — kept[0] is human', () => {
    const { removed, kept } = planCompaction({
      history,
      reason: 'budget',
      historyBudget: 1,
      estimate: estimateMessages,
      keepTurns: 1,
      ...NOT_SHORT,
    });

    // Budget 1 token: everything must go — the extreme case still cuts whole turns.
    expect(removed.length + kept.length).toBe(history.length);
    if (kept.length > 0) {
      expect(kept[0]._getType()).toBe('human');
    }
  });

  it('budget cut removes the minimum number of OLDEST turns until the kept history fits', () => {
    // Estimate per message ~1; give a budget that fits only the last turn.
    const lastTurn = history.slice(6);
    const budget = estimateMessages(lastTurn);
    const { removed, kept } = planCompaction({
      history,
      reason: 'budget',
      historyBudget: budget,
      estimate: estimateMessages,
      keepTurns: 1,
      ...NOT_SHORT,
    });

    expect(kept).toEqual(lastTurn);
    expect(removed).toEqual(history.slice(0, 6));
    expect(estimateMessages(kept)).toBeLessThanOrEqual(budget);
  });

  it('budget never cuts into the tail while the tail fits the budget', () => {
    // Turns here: [t1(2)] [h1, t2(2), a1] [h2, t3(2), a2] — the pre-human
    // tool prefix is its own turn — so the keepTurns-2 tail is slice(2).
    // A budget exactly the tail's size: only the prefix leaves.
    const tail = history.slice(2);
    const budget = estimateMessages(tail);
    const { removed, kept } = planCompaction({
      history,
      reason: 'budget',
      historyBudget: budget,
      estimate: estimateMessages,
      keepTurns: 2,
      ...NOT_SHORT,
    });

    expect(removed).toEqual(history.slice(0, 2));
    expect(kept).toEqual(tail);
  });

  it('budget cuts into the tail oldest-first only when the tail alone exceeds the budget', () => {
    const { removed, kept } = planCompaction({
      history,
      reason: 'budget',
      historyBudget: 1,
      estimate: estimateMessages,
      keepTurns: 2,
      ...NOT_SHORT,
    });

    expect(removed).toEqual(history);
    expect(kept).toEqual([]);
  });
});

/**
 * AC-SI-5a (session-investigation-0925, BUG-038 part 1): promoted from
 * compaction-churn.repro.test.ts. Live bug: the budget branch cut to
 * "just fits" with no headroom, so near the history cap almost every
 * following run re-triggered compaction (F7).
 */
describe('planCompaction — budget lowWaterMark (AC-SI-5a: headroom after a budget cut)', () => {
  const NOW_5A = new Date('2026-09-25T09:33:00.000Z');
  const HISTORY_BUDGET = 8000;
  const LOW_WATER = 0.6; // EPISODE_BUDGET_LOW_WATER default

  function humanId(id: string, text: string): HumanMessage {
    return new HumanMessage({ content: text, id });
  }

  /** One ordinary training turn (~300 estimated tokens). */
  function ordinaryTurn(i: number): BaseMessage[] {
    return [
      humanId(`h${i}`, 'x'.repeat(600)),
      new AIMessage({ id: `a${i}`, content: 'y'.repeat(600), tool_calls: [] }),
    ];
  }

  it('omitted lowWaterMark reproduces the old just-fits behaviour: the very next ordinary turn re-triggers', () => {
    let history: BaseMessage[] = [];
    let i = 0;
    let compactedOnce = false;
    let guard = 0;
    while (!compactedOnce) {
      guard += 1;
      if (guard > 1000) {
        throw new Error('did not reach a first budget compaction within 1000 turns — check turn sizing');
      }
      const withTurn = [...history, ...ordinaryTurn(i++)];
      if (estimateMessages(withTurn) > HISTORY_BUDGET) {
        const { kept } = planCompaction({
          history: withTurn,
          reason: 'budget',
          historyBudget: HISTORY_BUDGET,
          estimate: estimateMessages,
          keepTurns: 4,
          minTurns: 0,
          minTokens: 0,
          // no lowWaterMark — old just-fits behaviour.
        });
        history = kept;
        compactedOnce = true;
      } else {
        history = withTurn;
      }
    }

    const nextTurn = [...history, ...ordinaryTurn(i)];
    expect(estimateMessages(nextTurn)).toBeGreaterThan(HISTORY_BUDGET);
  });

  it('after the first budget compaction with EPISODE_BUDGET_LOW_WATER headroom, 5 following ordinary turns compact at most once more', () => {
    let history: BaseMessage[] = [];
    let i = 0;

    // Prime the history up to and including the first budget compaction.
    let compactedOnce = false;
    let guard = 0;
    while (!compactedOnce) {
      guard += 1;
      if (guard > 1000) {
        throw new Error('did not reach a first budget compaction within 1000 turns — check turn sizing');
      }
      const withTurn = [...history, ...ordinaryTurn(i++)];
      const reason = decideCompactReason({
        state: { compactReason: null, lastUserMessageAt: null },
        history: withTurn,
        now: NOW_5A,
        gapMs: Number.MAX_SAFE_INTEGER,
        historyBudget: HISTORY_BUDGET,
        estimate: estimateMessages,
      });
      if (reason === 'budget') {
        const { kept } = planCompaction({
          history: withTurn,
          reason: 'budget',
          historyBudget: HISTORY_BUDGET,
          estimate: estimateMessages,
          keepTurns: 4,
          minTurns: 0,
          minTokens: 0,
          lowWaterMark: LOW_WATER,
        });
        history = kept;
        compactedOnce = true;
      } else {
        history = withTurn;
      }
    }

    const RUNS_TO_OBSERVE = 5;
    let compactionsObserved = 0;
    for (let run = 0; run < RUNS_TO_OBSERVE; run++) {
      const withTurn = [...history, ...ordinaryTurn(i++)];
      const reason = decideCompactReason({
        state: { compactReason: null, lastUserMessageAt: null },
        history: withTurn,
        now: NOW_5A,
        gapMs: Number.MAX_SAFE_INTEGER,
        historyBudget: HISTORY_BUDGET,
        estimate: estimateMessages,
      });
      if (reason === 'budget') {
        compactionsObserved++;
        const { kept } = planCompaction({
          history: withTurn,
          reason: 'budget',
          historyBudget: HISTORY_BUDGET,
          estimate: estimateMessages,
          keepTurns: 4,
          minTurns: 0,
          minTokens: 0,
          lowWaterMark: LOW_WATER,
        });
        history = kept;
      } else {
        history = withTurn;
      }
    }

    expect(compactionsObserved).toBeLessThanOrEqual(1);
  });
});

describe('planCompaction — manual (/compact keeps NO tail)', () => {
  const history: BaseMessage[] = [
    human('h1', 'первый вопрос'),
    ai('a1', 'первый ответ'),
    human('h2', 'второй вопрос'),
    ...toolTurn('t2'),
    ai('a2', 'второй ответ'),
  ];
  const base = { history, reason: 'manual' as const, historyBudget: 1_000_000, estimate: estimateMessages };

  it('removes everything up to now, however large keepTurns is — an explicit command is not a surprise truncation', () => {
    const { removed, kept } = planCompaction({ ...base, keepTurns: 6, minTurns: 0, minTokens: 0 });

    expect(removed).toEqual(history);
    expect(kept).toEqual([]);
  });

  it('the same history under an automatic trigger DOES keep its tail', () => {
    const { removed, kept } = planCompaction({
      ...base,
      reason: 'inactivity',
      keepTurns: 1,
      minTurns: 0,
      minTokens: 0,
    });

    expect(kept).toEqual(history.slice(2));
    expect(removed).toEqual(history.slice(0, 2));
  });

  it('keeps the min-turns / min-tokens guard: a too-short conversation removes nothing', () => {
    expect(planCompaction({ ...base, keepTurns: 0, minTurns: 3, minTokens: 0 })).toEqual({
      removed: [],
      kept: history,
    });
    expect(planCompaction({ ...base, keepTurns: 0, minTurns: 0, minTokens: 1_000_000 })).toEqual({
      removed: [],
      kept: history,
    });
  });

  it('an empty channel removes nothing', () => {
    expect(planCompaction({ ...base, history: [], keepTurns: 0, minTurns: 0, minTokens: 0 })).toEqual({
      removed: [],
      kept: [],
    });
  });
});

describe('isShortEpisode (D-B — too short to summarise: compaction defers)', () => {
  const oneTurn: BaseMessage[] = [human('h1', 'ок'), ai('a1', 'хорошо')];
  const twoTurns: BaseMessage[] = [...oneTurn, human('h2', 'а план?'), ai('a2', 'вот план')];

  it('fewer than minTurns human turns → short', () => {
    expect(isShortEpisode(oneTurn, { minTurns: 2, minTokens: 0, estimate: estimateMessages })).toBe(true);
    expect(isShortEpisode(twoTurns, { minTurns: 2, minTokens: 0, estimate: estimateMessages })).toBe(false);
  });

  it('fewer than minTokens estimated tokens → short (a long-enough single turn with minTurns 1 is NOT)', () => {
    const longTurn: BaseMessage[] = [human('h1', 'д'.repeat(4000)), ai('a1', 'ответ')];
    // D-B is an OR: one turn still makes it short when minTurns is 2.
    expect(isShortEpisode(longTurn, { minTurns: 2, minTokens: 300, estimate: estimateMessages })).toBe(true);
    expect(isShortEpisode(longTurn, { minTurns: 1, minTokens: 300, estimate: estimateMessages })).toBe(false);
    expect(isShortEpisode(oneTurn, { minTurns: 0, minTokens: 300, estimate: estimateMessages })).toBe(true);
  });
});

describe('renderTranscript (summariser v2 input)', () => {
  it('renders users, assistants, tool calls as [tool_call name(args)] and truncates tool results at 500 chars', () => {
    const longResult = 'x'.repeat(800);
    const transcript = renderTranscript([
      human('h1', 'найди упражнения'),
      ...toolTurn('t1'),
      ai('a1', 'Предлагаю жим'),
      new ToolMessage({ tool_call_id: 'other', content: longResult, id: 'res2' }),
    ]);

    expect(transcript).toContain('User: найди упражнения');
    expect(transcript).toContain('[tool_call search_exercises({"query":"chest"})]');
    expect(transcript).toContain('Tool result: ');
    expect(transcript).toContain('Assistant: Предлагаю жим');
    // The 800-char result contributes at most 500 characters.
    const resultLine = transcript.split('\n').find(l => l.startsWith('Tool result: x'))!;
    expect(resultLine.length).toBe('Tool result: '.length + 500);
    expect(resultLine.endsWith('xxxxx')).toBe(true);
  });
});
