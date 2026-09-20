/**
 * courseCheckFingerprint (course-check plan Task 1, AC-FL-5): the identity of
 * the course-check INPUTS — facts set + stated goal + phase + active plan — as
 * one stable hash. The directive is reused while the fingerprint holds, so
 * these tests pin exactly what a fingerprint change IS: anything that changes
 * what the check would decide (a fact born/closed/aged, the goal, the phase,
 * the plan), and nothing that does not (order, confirmations, render-only
 * dates).
 *
 * "Entering planning" and "before a durable write" fire THROUGH the
 * fingerprint: phase and activePlanId are components, so the first run after
 * either changes sees a different fingerprint — edge-triggered by comparison,
 * never re-derived per turn.
 */
import type { UserFact } from '@domain/user/ports';

import { courseCheckFingerprint } from '../fingerprint';

const NOW = new Date('2026-09-21T12:00:00Z');

function fact(overrides: Partial<UserFact> = {}): UserFact {
  return {
    id: 'f1',
    userId: 'u1',
    category: 'physical_constraint',
    fact: 'Left shoulder aches when pressing',
    factKey: 'left shoulder aches when pressing',
    muscleGroup: 'shoulders_front',
    confirmations: 2,
    sourceTurnId: null,
    createdAt: new Date('2026-09-01T00:00:00Z'),
    updatedAt: new Date('2026-09-10T00:00:00Z'),
    durability: 'long_term',
    expiresAt: null,
    reviewAfter: new Date('2026-09-25T00:00:00Z'),
    phaseNote: 'tweaked three weeks ago',
    phaseAt: new Date('2026-09-01T00:00:00Z'),
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

function input(overrides: Partial<Parameters<typeof courseCheckFingerprint>[0]> = {}) {
  return {
    facts: [fact()],
    goal: 'Build muscle, train 3× a week',
    phase: 'chat' as const,
    activePlanId: null,
    now: NOW,
    ...overrides,
  };
}

describe('courseCheckFingerprint (AC-FL-5)', () => {
  it('is stable across calls and independent of fact order', () => {
    const a = courseCheckFingerprint(input());
    const b = courseCheckFingerprint(input({ facts: [fact(), fact({ id: 'f2', factKey: 'k2' })] }));
    const reversed = courseCheckFingerprint(input({ facts: [fact({ id: 'f2', factKey: 'k2' }), fact()] }));
    expect(courseCheckFingerprint(input())).toBe(a);
    expect(reversed).toBe(b);
  });

  it('changes when the fact set changes — a fact added or removed', () => {
    const base = courseCheckFingerprint(input());
    const added = courseCheckFingerprint(input({ facts: [fact(), fact({ id: 'f2', factKey: 'k2' })] }));
    const empty = courseCheckFingerprint(input({ facts: [] }));
    expect(added).not.toBe(base);
    expect(empty).not.toBe(base);
    expect(empty).not.toBe(added);
  });

  it('changes when a fact ages across a class boundary — durability or its dates', () => {
    const base = courseCheckFingerprint(input());
    expect(courseCheckFingerprint(input({ facts: [fact({ durability: 'short' })] }))).not.toBe(base);
    expect(
      courseCheckFingerprint(input({ facts: [fact({ reviewAfter: new Date('2026-10-25T00:00:00Z') })] })),
    ).not.toBe(base);
    expect(courseCheckFingerprint(input({ facts: [fact({ expiresAt: new Date('2026-09-30T00:00:00Z') })] }))).not.toBe(
      base,
    );
  });

  it('changes when a fact is corrected IN PLACE — same id, new text / muscle / phase note', () => {
    // A conversational correction by factId rewrites the same row (the repository
    // updates by id even though the new text normalises to a new key) — the id
    // and dates alone would let a stale directive outlive the correction.
    const base = courseCheckFingerprint(input());
    expect(courseCheckFingerprint(input({ facts: [fact({ fact: 'Left shoulder is fine, only stiff' })] }))).not.toBe(
      base,
    );
    expect(courseCheckFingerprint(input({ facts: [fact({ muscleGroup: 'shoulders_rear' })] }))).not.toBe(base);
    expect(courseCheckFingerprint(input({ facts: [fact({ phaseNote: 'back to light pressing' })] }))).not.toBe(base);
    expect(courseCheckFingerprint(input({ facts: [fact({ category: 'exercise_dislike' })] }))).not.toBe(base);
  });

  it('changes when a long-term review date ARRIVES — only the clock moves (isReviewDue, never restated)', () => {
    const dueAt = new Date('2026-09-21T11:00:00Z');
    const facts = [fact({ reviewAfter: dueAt })];
    const beforeDue = courseCheckFingerprint(input({ facts, now: new Date('2026-09-21T10:00:00Z') }));
    const stillBefore = courseCheckFingerprint(input({ facts, now: new Date('2026-09-21T10:30:00Z') }));
    const afterDue = courseCheckFingerprint(input({ facts, now: new Date('2026-09-21T11:30:00Z') }));
    const laterStillDue = courseCheckFingerprint(input({ facts, now: new Date('2026-09-22T09:00:00Z') }));

    // Same fact, same dates, same everything — the flip alone moves the hash, once.
    expect(stillBefore).toBe(beforeDue);
    expect(afterDue).not.toBe(beforeDue);
    expect(laterStillDue).toBe(afterDue);
  });

  it('changes when the goal, the phase or the active plan changes', () => {
    const base = courseCheckFingerprint(input());
    expect(courseCheckFingerprint(input({ goal: 'Cut fat for summer' }))).not.toBe(base);
    // "Entering planning": the phase component is what fires the check there.
    expect(courseCheckFingerprint(input({ phase: 'plan_creation' }))).not.toBe(base);
    expect(courseCheckFingerprint(input({ activePlanId: 'plan-1' }))).not.toBe(base);
  });

  it('ignores what does not change the decision — confirmations, updatedAt, order-only noise', () => {
    const base = courseCheckFingerprint(input());
    expect(courseCheckFingerprint(input({ facts: [fact({ confirmations: 7 })] }))).toBe(base);
    expect(courseCheckFingerprint(input({ facts: [fact({ updatedAt: new Date('2026-09-20T00:00:00Z') })] }))).toBe(
      base,
    );
  });

  describe('expired ask_once facts (expiry performed)', () => {
    const due = () =>
      fact({
        id: 'due-1',
        durability: 'short',
        reviewAfter: null,
        expiresAt: new Date('2026-09-19T00:00:00Z'),
        onExpiry: 'ask_once',
      });

    it('a fact BECOMING due changes the fingerprint — a real input change that fires the check once', () => {
      const base = courseCheckFingerprint(input());
      expect(courseCheckFingerprint(input({ expiredAsk: [due()] }))).not.toBe(base);
    });

    it('the SETTLED hash (nothing due) equals a run that never had one — so the next turn matches the stored one and does not refire', () => {
      expect(courseCheckFingerprint(input({ expiredAsk: [] }))).toBe(courseCheckFingerprint(input()));
    });

    it('is order-free in the due list, and stable turn to turn while the same fact is due', () => {
      const a = due();
      const b = { ...due(), id: 'due-2' };
      expect(courseCheckFingerprint(input({ expiredAsk: [a, b] }))).toBe(
        courseCheckFingerprint(input({ expiredAsk: [b, a] })),
      );
      expect(courseCheckFingerprint(input({ expiredAsk: [a] }))).toBe(
        courseCheckFingerprint(input({ expiredAsk: [a] })),
      );
    });
  });
});
