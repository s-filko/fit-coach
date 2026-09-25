/**
 * REPRODUCTION (RED) — AC-SI-5 / F7 (session-investigation-0925). Runs only via an explicit
 * --testMatch; promoted into compact.unit.test.ts / compact.node.unit.test.ts / the episode-summaries
 * block test when the fix lands. See docs/superpowers/plans/session-investigation-0925.md Task 3.
 *
 * F7: budget compaction has no low-water mark — `planCompaction('budget')` removes the minimum
 * number of oldest turns until the kept history just barely fits, so near the 8000-token dev cap
 * almost every subsequent run re-triggers compaction. The summariser's transcript input also names
 * no exercise (only the exerciseId UUID reaches it), and same-day `## Previous episodes` entries
 * carry no local time, so their order is unknowable (live: three entries all "training (today)").
 */
import { AIMessage, type BaseMessage, HumanMessage, ToolMessage } from '@langchain/core/messages';

import type { StoredEpisodeSummary } from '@domain/conversation/episode';

import { estimateMessages } from '@infra/ai/context/token-estimator';
import { EPISODE_SUMMARIES_V1, episodeParagraph } from '@infra/ai/prompts/blocks';

import { formatInUserTz } from '@shared/date-utils';

import { decideCompactReason, planCompaction, renderTranscript } from '../compact';

const NOW = new Date('2026-09-25T09:33:00.000Z');
/** dev's PhaseSpec.budget.history (ANCHORS: history budget 8000 in dev). */
const HISTORY_BUDGET = 8000;
/** Never let inactivity fire — this reproduction is about the budget trigger only. */
const NO_INACTIVITY_GAP_MS = Number.MAX_SAFE_INTEGER;

function human(id: string, text: string): HumanMessage {
  return new HumanMessage({ content: text, id });
}

/** One ordinary training turn (~300 estimated tokens — inside the plan's 200-400 range). */
function ordinaryTurn(i: number): BaseMessage[] {
  return [
    new HumanMessage({ id: `h${i}`, content: 'x'.repeat(600) }),
    new AIMessage({ id: `a${i}`, content: 'y'.repeat(600), tool_calls: [] }),
  ];
}

describe('AC-SI-5a: budget compaction needs a low-water mark (F7)', () => {
  it('after the first budget compaction, ordinary turns near the cap do not re-trigger every run', () => {
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
        now: NOW,
        gapMs: NO_INACTIVITY_GAP_MS,
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
        });
        history = kept;
        compactedOnce = true;
      } else {
        history = withTurn;
      }
    }

    // AC-SI-5a: N following runs, each adding one ordinary turn, should compact
    // at most once more (a low-water mark would leave headroom after the fix).
    // Without one, planCompaction stops exactly at "just fits", so the very
    // next ordinary turn crosses the cap again — every run compacts.
    const RUNS_TO_OBSERVE = 5;
    let compactionsObserved = 0;
    for (let run = 0; run < RUNS_TO_OBSERVE; run++) {
      const withTurn = [...history, ...ordinaryTurn(i++)];
      const reason = decideCompactReason({
        state: { compactReason: null, lastUserMessageAt: null },
        history: withTurn,
        now: NOW,
        gapMs: NO_INACTIVITY_GAP_MS,
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
        });
        history = kept;
      } else {
        history = withTurn;
      }
    }

    expect(compactionsObserved).toBeLessThanOrEqual(1);
  });
});

describe('AC-SI-5b: the summariser transcript must name the exercise, not just its UUID (F7)', () => {
  it('renderTranscript of a log_set call made with exerciseId only carries no exercise name', () => {
    const exerciseId = '11111111-1111-4111-8111-111111111111';
    const exerciseName = 'Lat Pulldown';

    // The exact shape the graph appends for a set logged by UUID (log-set.tool.ts): the tool call
    // args carry exerciseId only (no exerciseName — the model already had the UUID), and the
    // confirmation names no exercise either (ANCHORS: 'Set N logged: 12 reps @ 55 kg.').
    const removed: BaseMessage[] = [
      human('h1', 'ещё подход'),
      new AIMessage({
        id: 'a1',
        content: '',
        tool_calls: [{ id: 'tc1', name: 'log_set', args: { exerciseId, reps: 12, weight: 55 }, type: 'tool_call' }],
      }),
      new ToolMessage({ id: 'res1', tool_call_id: 'tc1', content: 'Set 2 logged: 12 reps @ 55 kg.' }),
    ];

    const transcript = renderTranscript(removed);

    // AC-SI-5b: the summariser must be able to name the exercise it is summarising.
    expect(transcript).toContain(exerciseName);
  });
});

describe('AC-SI-5c: same-day "## Previous episodes" entries must carry a local time (F7 + F6)', () => {
  const timezone = 'Asia/Manila';

  const BASE: StoredEpisodeSummary = {
    episodeId: '22222222-2222-4222-8222-222222222222',
    phaseAtEnd: 'training',
    endedAt: '',
    summary: {
      topics: ['upper body training'],
      decisions: [],
      userState: [],
      trainingFeedback: [],
      openItems: [],
      facts: [],
    },
  };

  it('a same-day episode paragraph includes a local time of day, not just "today"', () => {
    // 08:00 in Asia/Manila (UTC+8) — same calendar day as NOW there.
    const endedAt = '2026-09-25T00:00:00.000Z';
    const summary: StoredEpisodeSummary = { ...BASE, endedAt };
    const expectedLocalTime = formatInUserTz(new Date(endedAt), timezone).time;

    const paragraph = episodeParagraph(summary, NOW, timezone);

    expect(paragraph).toContain(expectedLocalTime);
  });

  it('three same-day episodes stay distinguishable — live bug: all three read "training (today)"', () => {
    const morning: StoredEpisodeSummary = { ...BASE, episodeId: 'e1', endedAt: '2026-09-25T00:00:00.000Z' };
    const midday: StoredEpisodeSummary = { ...BASE, episodeId: 'e2', endedAt: '2026-09-25T02:00:00.000Z' };
    const afternoon: StoredEpisodeSummary = { ...BASE, episodeId: 'e3', endedAt: '2026-09-25T04:00:00.000Z' };

    const [p1, p2, p3] = [morning, midday, afternoon].map(s => episodeParagraph(s, NOW, timezone));

    // Today, all three currently render the identical label — the live defect.
    expect(new Set([p1, p2, p3]).size).toBe(3);
  });

  it('the block renderer (EPISODE_SUMMARIES_V1) carries the same local-time labels, not bare "today"', () => {
    const morning: StoredEpisodeSummary = { ...BASE, episodeId: 'e1', endedAt: '2026-09-25T00:00:00.000Z' };
    const afternoon: StoredEpisodeSummary = { ...BASE, episodeId: 'e3', endedAt: '2026-09-25T04:00:00.000Z' };
    const expectedMorningTime = formatInUserTz(new Date(morning.endedAt), timezone).time;
    const expectedAfternoonTime = formatInUserTz(new Date(afternoon.endedAt), timezone).time;

    const sections = EPISODE_SUMMARIES_V1.render({ summaries: [morning, afternoon], now: NOW, timezone });
    const text = sections.map(s => s.text).join('\n');

    expect(text).toContain(expectedMorningTime);
    expect(text).toContain(expectedAfternoonTime);
  });
});
