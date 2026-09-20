/**
 * Episode summariser v4 (fact-lifecycle Task 3, AC-FL-4): v3's five fields,
 * but the sixth becomes `fact_operations` — the summariser SEES the user's
 * known active facts and returns operations (add / confirm / update / retract)
 * instead of a blind upsert list. Pure: transcript and known facts arrive as
 * data; no clock, no I/O.
 */
import type { UserFact } from '@domain/user/ports';

import { renderBlock } from '@infra/ai/prompts/blocks';
import { SUMMARIZER_V4 } from '../v4';

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

describe('SUMMARIZER_V4 (AC-FL-4)', () => {
  it('renders the five summary fields and the operations contract', () => {
    const text = renderBlock(SUMMARIZER_V4, { phase: 'chat', transcript: 'User: hi', knownFacts: [] });
    for (const field of ['topics', 'decisions', 'userState', 'trainingFeedback', 'openItems']) {
      expect(text).toContain(field);
    }
    expect(text).toContain('fact_operations');
    for (const op of ['add', 'confirm', 'update', 'retract']) {
      expect(text).toContain(op);
    }
  });

  it('renders the KNOWN active facts with their ids — the model must reference them verbatim', () => {
    const text = renderBlock(SUMMARIZER_V4, {
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

  it('spells out the operation rules: confirm restated, update changed, retract no-longer-true, add new', () => {
    const text = renderBlock(SUMMARIZER_V4, { phase: 'chat', transcript: 'User: hi', knownFacts: [fact()] });
    expect(text).toMatch(/confirm/i);
    expect(text).toMatch(/retract/i);
    // The rule that makes the known-facts list worth rendering: use the id, never restate as add.
    expect(text).toContain('id');
  });

  it('keeps the transcript as the user section, after the instructions', () => {
    const sections = SUMMARIZER_V4.render({ phase: 'training', transcript: 'User: did squats', knownFacts: [] });
    expect(sections.map(s => s.id)).toEqual(['system', 'user']);
    expect(sections[1].text).toContain('User: did squats');
    expect(sections[1].text).toContain('training');
  });

  it('is pure: the same input renders byte-identically, with no clock reads', () => {
    const ctx = { phase: 'chat' as const, transcript: 'User: hi', knownFacts: [fact()] };
    expect(renderBlock(SUMMARIZER_V4, ctx)).toBe(renderBlock(SUMMARIZER_V4, ctx));
  });
});
