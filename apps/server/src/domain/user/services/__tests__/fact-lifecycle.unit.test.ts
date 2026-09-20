/**
 * fact-lifecycle (fact-lifecycle plan Task 1, AC-FL-1): the pure owner of the
 * durability classes — per-class bounds clamping, the `permanent` gate, and
 * the expiry/review predicates. Every function takes `now` as data; the module
 * must never read the clock itself.
 */
import {
  FACT_LIFECYCLE_BOUNDS,
  PermanentFactRefusal,
  closureMoment,
  expiryAction,
  isActiveForPrompt,
  isExpired,
  isReviewDue,
  permanentAllowed,
  resolveLifecycle,
} from '../fact-lifecycle';

const NOW = new Date('2026-09-20T12:00:00Z');
const DAY_MS = 86_400_000;

function daysLater(days: number): Date {
  return new Date(NOW.getTime() + days * DAY_MS);
}

describe('FACT_LIFECYCLE_BOUNDS (the single source of the class numbers)', () => {
  it('pins the owner-approved bounds: short 1–14 days, long-term 2 weeks–6 months', () => {
    expect(FACT_LIFECYCLE_BOUNDS.short).toEqual({ minDays: 1, maxDays: 14 });
    expect(FACT_LIFECYCLE_BOUNDS.longTerm).toEqual({ minDays: 14, maxDays: 182 });
    expect(FACT_LIFECYCLE_BOUNDS.permanentMinConfirmations).toBeGreaterThanOrEqual(2);
  });
});

describe('resolveLifecycle — per-class bounds clamping', () => {
  it('short: a TTL inside 1–14 days is kept verbatim, expiry computed from the passed `now`', () => {
    const resolved = resolveLifecycle({ durability: 'short', ttlDays: 7 }, NOW, { confirmations: 1 });
    expect(resolved).toEqual({
      durability: 'short',
      expiresAt: daysLater(7),
      reviewAfter: null,
      onExpiry: 'forget',
    });
  });

  it('short: a TTL below the minimum is clamped up to 1 day', () => {
    const resolved = resolveLifecycle({ durability: 'short', ttlDays: 0 }, NOW, { confirmations: 1 });
    expect(resolved.expiresAt).toEqual(daysLater(1));
  });

  it('short: a TTL above the maximum is clamped down to 14 days', () => {
    const resolved = resolveLifecycle({ durability: 'short', ttlDays: 90 }, NOW, { confirmations: 1 });
    expect(resolved.expiresAt).toEqual(daysLater(14));
  });

  it('short: a missing TTL keeps the full bounded window (14 days) — never dropped early', () => {
    const resolved = resolveLifecycle({ durability: 'short' }, NOW, { confirmations: 1 });
    expect(resolved.expiresAt).toEqual(daysLater(14));
  });

  it('short: on_expiry=ask_once is carried through, forget is the default', () => {
    expect(resolveLifecycle({ durability: 'short', onExpiry: 'ask_once' }, NOW, { confirmations: 1 }).onExpiry).toBe(
      'ask_once',
    );
    expect(resolveLifecycle({ durability: 'short' }, NOW, { confirmations: 1 }).onExpiry).toBe('forget');
  });

  it('long_term: a review date inside 14–182 days is kept verbatim', () => {
    const resolved = resolveLifecycle({ durability: 'long_term', reviewInDays: 90 }, NOW, { confirmations: 1 });
    expect(resolved).toEqual({
      durability: 'long_term',
      expiresAt: null,
      reviewAfter: daysLater(90),
      onExpiry: null,
    });
  });

  it('long_term: a review date below 2 weeks is clamped up to 14 days', () => {
    const resolved = resolveLifecycle({ durability: 'long_term', reviewInDays: 3 }, NOW, { confirmations: 1 });
    expect(resolved.reviewAfter).toEqual(daysLater(14));
  });

  it('long_term: a review date beyond 6 months is clamped down to 182 days', () => {
    const resolved = resolveLifecycle({ durability: 'long_term', reviewInDays: 400 }, NOW, { confirmations: 1 });
    expect(resolved.reviewAfter).toEqual(daysLater(182));
  });

  it('permanent carries no dates of any kind', () => {
    const resolved = resolveLifecycle({ durability: 'permanent', ttlDays: 5, reviewInDays: 30 }, NOW, {
      explicit: true,
      confirmations: 1,
    });
    expect(resolved.expiresAt).toBeNull();
    expect(resolved.reviewAfter).toBeNull();
    expect(resolved.onExpiry).toBeNull();
  });
});

describe('the permanent gate', () => {
  it('permanentAllowed: refused without the explicit flag below the confirmation threshold', () => {
    expect(permanentAllowed({ confirmations: FACT_LIFECYCLE_BOUNDS.permanentMinConfirmations - 1 })).toBe(false);
  });

  it('permanentAllowed: the explicit user statement allows it regardless of confirmations', () => {
    expect(permanentAllowed({ explicit: true, confirmations: 0 })).toBe(true);
  });

  it('permanentAllowed: enough confirmations allow it without an explicit statement', () => {
    expect(permanentAllowed({ confirmations: FACT_LIFECYCLE_BOUNDS.permanentMinConfirmations })).toBe(true);
  });

  it('resolveLifecycle refuses permanent without the gate (typed error, not a silent downgrade)', () => {
    expect(() => resolveLifecycle({ durability: 'permanent' }, NOW, { confirmations: 1 })).toThrow(
      PermanentFactRefusal,
    );
  });

  it('resolveLifecycle allows permanent with the gate and still emits no dates', () => {
    const resolved = resolveLifecycle({ durability: 'permanent' }, NOW, { explicit: true, confirmations: 1 });
    expect(resolved.durability).toBe('permanent');
    expect(resolved.expiresAt).toBeNull();
  });

  it('the gate never applies to short or long_term', () => {
    expect(() => resolveLifecycle({ durability: 'short' }, NOW, { confirmations: 0 })).not.toThrow();
    expect(() => resolveLifecycle({ durability: 'long_term' }, NOW, { confirmations: 0 })).not.toThrow();
  });
});

describe('isExpired / isReviewDue / isActiveForPrompt — predicates against a passed `now`', () => {
  it('isExpired: true at and after expiresAt (<=), false one millisecond before', () => {
    const expiresAt = new Date(NOW.getTime() + DAY_MS);
    const fact = { status: 'active', durability: 'short', expiresAt } as const;
    expect(isExpired(fact, new Date(NOW.getTime() + DAY_MS))).toBe(true);
    expect(isExpired(fact, new Date(NOW.getTime() + DAY_MS + 1))).toBe(true);
    expect(isExpired(fact, new Date(NOW.getTime() + DAY_MS - 1))).toBe(false);
  });

  it('isExpired: never for a null expiresAt or a non-short fact', () => {
    expect(isExpired({ status: 'active', durability: 'short', expiresAt: null }, NOW)).toBe(false);
    expect(
      isExpired({ status: 'active', durability: 'long_term', expiresAt: new Date(NOW.getTime() - DAY_MS) }, NOW),
    ).toBe(false);
  });

  it('isExpired: an archived fact is not "expired" — archive wins over the date', () => {
    const fact = { status: 'archived', durability: 'short', expiresAt: new Date(NOW.getTime() - DAY_MS) } as const;
    expect(isExpired(fact, NOW)).toBe(false);
  });

  it('isReviewDue: true at and after reviewAfter, false before; never for a null date or non-long_term', () => {
    const due = new Date(NOW.getTime() + DAY_MS);
    const fact = { status: 'active', durability: 'long_term', reviewAfter: due } as const;
    expect(isReviewDue(fact, new Date(NOW.getTime() + DAY_MS))).toBe(true);
    expect(isReviewDue(fact, new Date(NOW.getTime() + DAY_MS - 1))).toBe(false);
    expect(isReviewDue({ status: 'active', durability: 'long_term', reviewAfter: null }, NOW)).toBe(false);
    expect(
      isReviewDue({ status: 'active', durability: 'short', reviewAfter: new Date(NOW.getTime() - DAY_MS) }, NOW),
    ).toBe(false);
  });

  it('isReviewDue: never for an archived fact', () => {
    const fact = {
      status: 'archived',
      durability: 'long_term',
      reviewAfter: new Date(NOW.getTime() - DAY_MS),
    } as const;
    expect(isReviewDue(fact, NOW)).toBe(false);
  });

  it('isActiveForPrompt: active+unexpired only — archived or expired facts are out', () => {
    const live = { status: 'active', durability: 'short', expiresAt: new Date(NOW.getTime() + DAY_MS) } as const;
    const expired = { status: 'active', durability: 'short', expiresAt: new Date(NOW.getTime() - DAY_MS) } as const;
    const archived = { status: 'archived', durability: 'permanent', expiresAt: null } as const;
    expect(isActiveForPrompt(live, NOW)).toBe(true);
    expect(isActiveForPrompt(expired, NOW)).toBe(false);
    expect(isActiveForPrompt(archived, NOW)).toBe(false);
  });
});

describe('expiryAction — what performing an expiry means', () => {
  const expired = { status: 'active', durability: 'short', expiresAt: daysLater(-1) } as const;

  it('an expired ask_once fact is asked, then archived', () => {
    expect(expiryAction({ ...expired, onExpiry: 'ask_once' }, NOW)).toBe('ask');
  });

  it('an expired forget fact — or one with no flag — is archived silently', () => {
    expect(expiryAction({ ...expired, onExpiry: 'forget' }, NOW)).toBe('forget');
    expect(expiryAction({ ...expired, onExpiry: null }, NOW)).toBe('forget');
  });

  it('uses isExpired’s edge: at expiresAt exactly it is due, one millisecond before it is not', () => {
    const fact = { status: 'active', durability: 'short', onExpiry: 'ask_once', expiresAt: NOW } as const;
    expect(expiryAction(fact, NOW)).toBe('ask');
    expect(expiryAction(fact, new Date(NOW.getTime() - 1))).toBeNull();
  });

  it('nothing to perform for an unexpired, archived or non-short fact', () => {
    expect(expiryAction({ ...expired, onExpiry: 'ask_once', expiresAt: daysLater(1) }, NOW)).toBeNull();
    expect(expiryAction({ ...expired, onExpiry: 'ask_once', status: 'archived' }, NOW)).toBeNull();
    expect(
      expiryAction({ status: 'active', durability: 'long_term', onExpiry: 'ask_once', expiresAt: daysLater(-1) }, NOW),
    ).toBeNull();
  });
});

describe('closureMoment — when an archived fact’s subject ended (the AC-FL-3 stale-evidence guard reads it)', () => {
  const base = { archivedAt: daysLater(-1), archivedReason: null, closedByUserAt: null, expiresAt: null } as const;

  it('the user’s word wins: closed_by_user_at', () => {
    expect(closureMoment({ ...base, archivedReason: 'user_closed', closedByUserAt: daysLater(-3) })).toEqual(
      daysLater(-3),
    );
  });

  it('an EXPIRED archive counts from the expiry date, not from when the archive happened to run', () => {
    expect(closureMoment({ ...base, archivedReason: 'expired', expiresAt: daysLater(-4) })).toEqual(daysLater(-4));
  });

  it('a superseded archive counts from archived_at', () => {
    expect(closureMoment({ ...base, archivedReason: 'superseded' })).toEqual(daysLater(-1));
  });
});
