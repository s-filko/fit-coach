import type { StoredEpisodeSummary } from '@domain/conversation/episode';

import { episodeParagraph } from '../episode-summaries.v1';

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
