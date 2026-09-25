import type { StoredEpisodeSummary } from '@domain/conversation/episode';

import { formatInUserTz } from '@shared/date-utils';

import { EPISODE_SUMMARIES_V2, episodeParagraph } from '../episode-summaries.v2';

const NOW = new Date('2026-09-19T10:00:00.000Z');

const BASE_SUMMARY: StoredEpisodeSummary = {
  episodeId: '11111111-1111-4111-8111-111111111111',
  phaseAtEnd: 'training',
  endedAt: '2026-09-18T18:00:00.000Z',
  summary: {
    topics: ['training plan discussed'],
    decisions: ['upper/lower split, 3 sessions per week'],
    userState: ['mild shoulder discomfort reported'],
    trainingFeedback: [],
    openItems: [],
    facts: [],
  },
};

describe('episodeParagraph (D-D — facts must not leak into the rendered episode block)', () => {
  it('renders byte-identically for a summary with facts and the same summary without them', () => {
    const withoutFacts = episodeParagraph(BASE_SUMMARY, NOW, null);

    const withFacts: StoredEpisodeSummary = {
      ...BASE_SUMMARY,
      summary: {
        ...BASE_SUMMARY.summary,
        facts: [
          {
            category: 'physical_constraint',
            fact: "Can't do overhead press, shoulder injury",
            muscleGroup: 'shoulders_front',
          },
          { category: 'equipment', fact: 'Trains at home with dumbbells only' },
        ],
      },
    };
    const withFactsRendered = episodeParagraph(withFacts, NOW, null);

    expect(withFactsRendered).toBe(withoutFacts);
  });

  it('never contains the literal fact text, category, or muscleGroup values from facts', () => {
    const withFacts: StoredEpisodeSummary = {
      ...BASE_SUMMARY,
      summary: {
        ...BASE_SUMMARY.summary,
        facts: [{ category: 'physical_constraint', fact: 'UNIQUE_FACT_TOKEN_XYZ', muscleGroup: 'lower_back' }],
      },
    };
    const rendered = episodeParagraph(withFacts, NOW, null);
    expect(rendered).not.toContain('UNIQUE_FACT_TOKEN_XYZ');
    expect(rendered).not.toContain('lower_back');
  });
});

/**
 * AC-SI-5c (session-investigation-0925, BUG-038 part 2): promoted from
 * compaction-churn.repro.test.ts. Live bug: same-day episodes all rendered
 * the identical "training (today)" label — their order was unknowable.
 */
describe('episodeParagraph — same-day entries carry a local time (AC-SI-5c, F7 + F6)', () => {
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

    const paragraph = episodeParagraph(summary, new Date('2026-09-25T09:33:00.000Z'), timezone);

    expect(paragraph).toContain(expectedLocalTime);
  });

  it('three same-day episodes stay distinguishable — live bug: all three read "training (today)"', () => {
    const now = new Date('2026-09-25T09:33:00.000Z');
    const morning: StoredEpisodeSummary = { ...BASE, episodeId: 'e1', endedAt: '2026-09-25T00:00:00.000Z' };
    const midday: StoredEpisodeSummary = { ...BASE, episodeId: 'e2', endedAt: '2026-09-25T02:00:00.000Z' };
    const afternoon: StoredEpisodeSummary = { ...BASE, episodeId: 'e3', endedAt: '2026-09-25T04:00:00.000Z' };

    const [p1, p2, p3] = [morning, midday, afternoon].map(s => episodeParagraph(s, now, timezone));

    expect(new Set([p1, p2, p3]).size).toBe(3);
  });

  it('older entries keep their existing labels — yesterday / N days ago, no time appended', () => {
    // now is 2026-09-19 in Asia/Manila (18:00 local); pick endedAt values well
    // inside their target local calendar day so the UTC offset can't shift them.
    const now = new Date('2026-09-19T10:00:00.000Z');
    const yesterday: StoredEpisodeSummary = { ...BASE, endedAt: '2026-09-18T02:00:00.000Z' }; // 09-18 10:00 local
    const daysAgo: StoredEpisodeSummary = { ...BASE, endedAt: '2026-09-10T02:00:00.000Z' }; // 09-10 10:00 local

    expect(episodeParagraph(yesterday, now, timezone)).toContain('(yesterday)');
    expect(episodeParagraph(daysAgo, now, timezone)).toContain('(9 days ago)');
  });

  it('the block renderer (EPISODE_SUMMARIES_V2) carries the same local-time labels, not bare "today"', () => {
    const now = new Date('2026-09-25T09:33:00.000Z');
    const morning: StoredEpisodeSummary = { ...BASE, episodeId: 'e1', endedAt: '2026-09-25T00:00:00.000Z' };
    const afternoon: StoredEpisodeSummary = { ...BASE, episodeId: 'e3', endedAt: '2026-09-25T04:00:00.000Z' };
    const expectedMorningTime = formatInUserTz(new Date(morning.endedAt), timezone).time;
    const expectedAfternoonTime = formatInUserTz(new Date(afternoon.endedAt), timezone).time;

    const sections = EPISODE_SUMMARIES_V2.render({ summaries: [morning, afternoon], now, timezone });
    const text = sections.map(s => s.text).join('\n');

    expect(text).toContain(expectedMorningTime);
    expect(text).toContain(expectedAfternoonTime);
  });
});
