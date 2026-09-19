import { EpisodeSummarySchema, type EpisodeSummary } from '../episode';

describe('EpisodeSummarySchema (ADR-0013 §3.3, D-C)', () => {
  it('round-trips a full summary', () => {
    const summary: EpisodeSummary = {
      topics: ['plan creation'],
      decisions: ['3-day split agreed'],
      userState: ['prefers mornings'],
      trainingFeedback: ['bench felt heavy'],
      openItems: ['day 2 not planned yet'],
      facts: [],
    };
    expect(EpisodeSummarySchema.parse(summary)).toEqual(summary);
  });

  it('allows every list empty (a short but summarised episode)', () => {
    expect(
      EpisodeSummarySchema.parse({
        topics: [],
        decisions: [],
        userState: [],
        trainingFeedback: [],
        openItems: [],
        facts: [],
      }),
    ).toEqual({
      topics: [],
      decisions: [],
      userState: [],
      trainingFeedback: [],
      openItems: [],
      facts: [],
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
        facts: [],
        style: 'nice',
      }),
    ).toThrow();
  });

  it('rejects a non-string list member', () => {
    expect(() =>
      EpisodeSummarySchema.parse({
        topics: [1],
        decisions: [],
        userState: [],
        trainingFeedback: [],
        openItems: [],
        facts: [],
      }),
    ).toThrow();
  });

  describe('facts (P6 Task 2, owner decision 2026-09-17)', () => {
    const base = { topics: [], decisions: [], userState: [], trainingFeedback: [], openItems: [] };

    it('accepts a payload with facts, including an optional muscleGroup', () => {
      const summary = {
        ...base,
        facts: [
          {
            category: 'physical_constraint',
            fact: "Can't do overhead press, shoulder injury",
            muscleGroup: 'shoulders_front',
          },
          { category: 'equipment', fact: 'Trains at home with dumbbells only' },
        ],
      };
      expect(EpisodeSummarySchema.parse(summary)).toEqual(summary);
    });

    it('allows an empty facts array (nothing durable this episode)', () => {
      expect(EpisodeSummarySchema.parse({ ...base, facts: [] }).facts).toEqual([]);
    });

    it('rejects an unknown category (hard failure, not silent data loss)', () => {
      expect(() =>
        EpisodeSummarySchema.parse({ ...base, facts: [{ category: 'made_up_category', fact: 'x' }] }),
      ).toThrow();
    });

    it('rejects an unknown key on a fact entry', () => {
      expect(() =>
        EpisodeSummarySchema.parse({
          ...base,
          facts: [{ category: 'equipment', fact: 'has a rack', confidence: 0.9 }],
        }),
      ).toThrow();
    });

    it('rejects a fact entry missing the fact text', () => {
      expect(() => EpisodeSummarySchema.parse({ ...base, facts: [{ category: 'equipment' }] })).toThrow();
    });
  });
});
