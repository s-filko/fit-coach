/**
 * Episode summariser v6 (fact-verification plan Task 2, D7 / AC-FV-5): v5's
 * operations with the PROVENANCE section restated for model verification —
 * `evidence` is still a verbatim user quote, facts still come only from the
 * user, numbers keep the user's units, but the prompt no longer claims the
 * operations are verified in code word-for-word. Pure: no clock, no I/O.
 */
import type { UserFact } from '@domain/user/ports';

import { renderBlock } from '@infra/ai/prompts/blocks';
import { SUMMARIZER_V6 } from '../v6';

function fact(overrides: Partial<UserFact> = {}): UserFact {
  return {
    id: '5b0f8a3e-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    userId: 'u1',
    category: 'physical_constraint',
    fact: 'Cannot overhead press, shoulder injury',
    factKey: 'cannot overhead press, shoulder injury',
    muscleGroup: 'shoulders_front',
    confirmations: 3,
    sourceTurnId: null,
    createdAt: new Date('2026-09-01T00:00:00Z'),
    updatedAt: new Date('2026-09-15T00:00:00Z'),
    durability: 'permanent',
    expiresAt: null,
    reviewAfter: null,
    phaseNote: null,
    phaseAt: null,
    onExpiry: null,
    status: 'active',
    archivedAt: null,
    archivedReason: null,
    closedByUserAt: null,
    supersedesId: null,
    context: null,
    ...overrides,
  };
}

describe('SUMMARIZER_V6 (AC-FV-5, D7)', () => {
  it('renders the five summary fields and the operations contract', () => {
    const text = renderBlock(SUMMARIZER_V6, { phase: 'chat', transcript: 'User: hi', knownFacts: [] });
    for (const field of ['topics', 'decisions', 'userState', 'trainingFeedback', 'openItems']) {
      expect(text).toContain(field);
    }
    expect(text).toContain('fact_operations');
    for (const op of ['add', 'confirm', 'update', 'retract']) {
      expect(text).toContain(op);
    }
  });

  it('renders the KNOWN active facts with their ids — the model must reference them verbatim', () => {
    const text = renderBlock(SUMMARIZER_V6, {
      phase: 'chat',
      transcript: 'User: hi',
      knownFacts: [
        fact(),
        fact({
          id: '5b0f8a3e-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          category: 'equipment',
          fact: 'Trains at home',
          muscleGroup: null,
        }),
      ],
    });
    expect(text).toContain('5b0f8a3e-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    expect(text).toContain('Cannot overhead press, shoulder injury');
    expect(text).toContain('physical_constraint');
    expect(text).toContain('permanent');
    expect(text).toContain('3× confirmed');
    expect(text).toContain('5b0f8a3e-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
  });

  it('AC-FV-5: still asks for evidence on add/update/retract and exempts confirm', () => {
    const text = renderBlock(SUMMARIZER_V6, { phase: 'chat', transcript: 'User: hi', knownFacts: [fact()] });
    expect(text).toContain('evidence');
    expect(text).toMatch(/"confirm" needs no evidence/);
  });

  it('AC-FV-5 (D7): NO claim of word-for-word code verification — model verification instead', () => {
    const text = renderBlock(SUMMARIZER_V6, { phase: 'chat', transcript: 'User: hi', knownFacts: [] });
    expect(text).not.toMatch(/verified in code/);
    expect(text).not.toMatch(/word-for-word in a User line[^]*is discarded/);
    expect(text).not.toMatch(/Every fact operation is re-checked/); // D15: only add/update/retract are
    expect(text).toMatch(/Every add, update and retract operation is re-checked by a separate verification model/);
    expect(text).toMatch(/cannot ground in the user's own words or explicit confirmation is discarded/);
  });

  it('AC-FV-5 (D7): numbers keep the user’s units — digits or words, never a figure the user did not give', () => {
    const text = renderBlock(SUMMARIZER_V6, { phase: 'chat', transcript: 'User: hi', knownFacts: [] });
    expect(text).toContain('one the user stated, in the user’s units');
    expect(text).toContain('«пять дней» may become "5 days"');
    expect(text).toContain('Never introduce a figure the user did not give');
    // Reconciled with the general "Include numbers" sentence, as in v5 (D13).
    expect(text).toMatch(/Include numbers \(weights, reps, dates\)[^]*only if the user themselves stated it/);
  });

  it('keeps the transcript as the user section, after the instructions', () => {
    const sections = SUMMARIZER_V6.render({ phase: 'training', transcript: 'User: did squats', knownFacts: [] });
    expect(sections.map(s => s.id)).toEqual(['system', 'user']);
    expect(sections[1].text).toContain('User: did squats');
    expect(sections[1].text).toContain('training');
  });

  it('is pure: the same input renders byte-identically, with no clock reads', () => {
    const ctx = { phase: 'chat' as const, transcript: 'User: hi', knownFacts: [fact()] };
    expect(renderBlock(SUMMARIZER_V6, ctx)).toBe(renderBlock(SUMMARIZER_V6, ctx));
  });
});
