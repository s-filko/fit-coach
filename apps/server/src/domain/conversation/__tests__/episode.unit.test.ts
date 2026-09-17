import { EpisodeSummarySchema, type EpisodeSummary } from '../episode';

describe('EpisodeSummarySchema (ADR-0013 §3.3, D-C)', () => {
  it('round-trips a full summary', () => {
    const summary: EpisodeSummary = {
      topics: ['plan creation'],
      decisions: ['3-day split agreed'],
      userState: ['prefers mornings'],
      trainingFeedback: ['bench felt heavy'],
      openItems: ['day 2 not planned yet'],
    };
    expect(EpisodeSummarySchema.parse(summary)).toEqual(summary);
  });

  it('allows every list empty (a short but summarised episode)', () => {
    expect(
      EpisodeSummarySchema.parse({ topics: [], decisions: [], userState: [], trainingFeedback: [], openItems: [] }),
    ).toEqual({
      topics: [],
      decisions: [],
      userState: [],
      trainingFeedback: [],
      openItems: [],
    });
  });

  it('rejects extra keys (P6 reads this structure without re-parsing prose)', () => {
    expect(() =>
      EpisodeSummarySchema.parse({
        topics: [],
        decisions: [],
        userState: [],
        trainingFeedback: [],
        openItems: [],
        style: 'nice',
      }),
    ).toThrow();
  });

  it('rejects a non-string list member', () => {
    expect(() =>
      EpisodeSummarySchema.parse({ topics: [1], decisions: [], userState: [], trainingFeedback: [], openItems: [] }),
    ).toThrow();
  });
});
