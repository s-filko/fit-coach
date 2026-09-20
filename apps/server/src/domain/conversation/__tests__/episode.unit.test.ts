import { EpisodeSummarySchema, EpisodeSummaryV4Schema, type EpisodeSummary } from '../episode';

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

describe('EpisodeSummaryV4Schema (fact-lifecycle Task 3, AC-FL-4 — operations, not a blind upsert)', () => {
  const base = {
    topics: ['plan discussed'],
    decisions: [],
    userState: [],
    trainingFeedback: [],
    openItems: [],
  };

  it('parses all four operations with their fields', () => {
    const summary = {
      ...base,
      factOperations: [
        {
          op: 'add',
          category: 'physical_constraint',
          fact: 'Broken wrist',
          muscleGroup: 'shoulders_front',
          durability: 'long_term',
          reviewInDays: 60,
          phaseNote: 'in a cast',
        },
        { op: 'confirm', factId: '5b0f8a3e-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
        {
          op: 'update',
          factId: '5b0f8a3e-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          fact: 'Trains at home with dumbbells up to 20kg',
          category: 'equipment',
          durability: 'permanent',
          explicitPermanent: true,
        },
        {
          op: 'retract',
          factId: '5b0f8a3e-cccc-4ccc-8ccc-cccccccccccc',
          reason: 'the user said the shoulder is fine now',
        },
      ],
    };
    expect(EpisodeSummaryV4Schema.parse(summary)).toEqual(summary);
  });

  it("keeps v3's strictness: an unknown operation or field is rejected", () => {
    expect(() =>
      EpisodeSummaryV4Schema.parse({
        ...base,
        factOperations: [{ op: 'delete', factId: '5b0f8a3e-dddd-4ddd-8ddd-dddddddddddd' }],
      }),
    ).toThrow();
    expect(() => EpisodeSummaryV4Schema.parse({ ...base, factOperations: [], extra: 1 })).toThrow();
  });

  it('fact ids must be real uuids — an invented id is a schema rejection, not a silent no-op', () => {
    expect(() =>
      EpisodeSummaryV4Schema.parse({ ...base, factOperations: [{ op: 'confirm', factId: 'fact-1' }] }),
    ).toThrow();
  });

  it('an empty operations array is the expected common answer', () => {
    expect(EpisodeSummaryV4Schema.parse({ ...base, factOperations: [] }).factOperations).toEqual([]);
  });
});
