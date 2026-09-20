/**
 * USER_FACTS_V2 (fact-lifecycle plan Task 1, AC-FL-1): v1's shape plus the
 * lifecycle metadata the coach needs to tell yesterday from six months ago —
 * each fact carries its absolute date and confirmation count, and a long-term
 * fact shows its phase note. Still pure: the input rows are already-loaded
 * data; expired/archived facts never reach the block (the repository filters
 * them — the block never sees them, and the tests pin that it renders what
 * it is given, nothing more).
 */
import type { UserFact } from '@domain/user/ports';

import { renderBlock } from '../index';
import { USER_FACTS_V2 } from '../user-facts.v2';

function fact(overrides: Partial<UserFact> = {}): UserFact {
  return {
    id: 'f1',
    userId: 'u1',
    category: 'equipment',
    fact: 'Trains at home with dumbbells only',
    factKey: 'trains at home with dumbbells only',
    muscleGroup: null,
    confirmations: 1,
    sourceTurnId: null,
    createdAt: new Date('2026-09-01T00:00:00Z'),
    updatedAt: new Date('2026-09-01T00:00:00Z'),
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

describe('USER_FACTS_V2 (AC-FL-1: date + confirmations + phase note per fact)', () => {
  it('renders nothing — not an empty heading — for zero facts', () => {
    expect(renderBlock(USER_FACTS_V2, { facts: [] })).toBe('');
  });

  it('shows each fact with its absolute updated date and confirmation count', () => {
    const text = renderBlock(USER_FACTS_V2, {
      facts: [fact({ updatedAt: new Date('2026-09-18T09:30:00Z'), confirmations: 3 })],
    });
    expect(text).toContain('## User Facts');
    expect(text).toContain('3× confirmed');
    expect(text).toContain('updated 2026-09-18');
  });

  it('dates are absolute UTC calendar days — no relative "yesterday", no clock', () => {
    const text = renderBlock(USER_FACTS_V2, {
      facts: [fact({ fact: 'Sore legs after squats', updatedAt: new Date('2026-03-02T23:30:00Z') })],
    });
    expect(text).toContain('updated 2026-03-02');
  });

  it('a long_term fact carries its phase note', () => {
    const text = renderBlock(USER_FACTS_V2, {
      facts: [
        fact({
          category: 'physical_constraint',
          fact: 'Broken wrist',
          durability: 'long_term',
          phaseNote: 'in a cast since 2026-09-10',
          updatedAt: new Date('2026-09-15T10:00:00Z'),
        }),
      ],
    });
    expect(text).toContain('in a cast since 2026-09-10');
    expect(text).toContain('updated 2026-09-15');
  });

  it('a phase note on a non-long_term fact is not rendered', () => {
    const text = renderBlock(USER_FACTS_V2, {
      facts: [fact({ durability: 'short', phaseNote: 'should not appear' })],
    });
    expect(text).not.toContain('should not appear');
  });

  it('keeps v1 grouping and the muscle group in parens', () => {
    const facts: UserFact[] = [
      fact({ id: 'f1', category: 'equipment', fact: 'Has a barbell' }),
      fact({ id: 'f2', category: 'equipment', fact: 'Has dumbbells' }),
      fact({
        id: 'f3',
        category: 'physical_constraint',
        fact: 'Bad shoulder',
        muscleGroup: 'shoulders_front',
        durability: 'short',
        expiresAt: new Date('2026-09-25T00:00:00Z'),
      }),
    ];
    const text = renderBlock(USER_FACTS_V2, { facts });
    expect(text.split('equipment:').length - 1).toBe(1);
    expect(text).toContain('physical_constraint:');
    expect(text).toContain('(shoulders_front)');
  });

  it('is pure: same input twice renders byte-identically', () => {
    const facts = [fact()];
    expect(renderBlock(USER_FACTS_V2, { facts })).toBe(renderBlock(USER_FACTS_V2, { facts }));
  });
});
