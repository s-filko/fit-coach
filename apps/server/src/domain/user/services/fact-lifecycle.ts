// fact-lifecycle (fact-lifecycle plan Task 1, AC-FL-1) — the pure owner of the
// owner's durability model (2026-09-20): code owns the bounds, the model owns
// the judgement. This module clamps a durability assignment into its legal
// date window, gates `permanent`, and answers the expiry/review predicates.
//
// Pure (BR-LLM-007 discipline): no I/O, and NO clock reads — every function
// that needs a moment receives `now: Date` as data from the caller (the run
// clock, never the DB clock). `Date.now()` / `new Date()` are forbidden here.

// The lifecycle value types live here (with the bounds that give them
// meaning); the port re-exports them so consumers need only one import path.

/** The owner's durability classes (2026-09-20). */
export type FactDurability = 'permanent' | 'long_term' | 'short';

/** What happens when a short fact expires: forgotten silently, or asked about once. */
export type FactOnExpiry = 'forget' | 'ask_once';

/** A fact is active or archived — archiving is the only soft closure (AC-FL-2). */
export type FactStatus = 'active' | 'archived';

/** Why a fact was archived. */
export type FactArchivedReason = 'user_closed' | 'expired' | 'superseded';

/** The single source of the class numbers — clamp bounds and the permanent gate threshold. */
export const FACT_LIFECYCLE_BOUNDS = {
  /** Short (DOMS, bad sleep, food poisoning): a TTL of 1–14 days. */
  short: { minDays: 1, maxDays: 14 },
  /** Long-term (fracture, surgery, months-long recovery): reviewed 2 weeks–6 months out. */
  longTerm: { minDays: 14, maxDays: 182 },
  /** `permanent` without an explicit user statement needs this many confirmations. */
  permanentMinConfirmations: 3,
} as const;

const DAY_MS = 86_400_000;

/** Thrown when `permanent` is asserted without the explicit flag or enough confirmations. */
export class PermanentFactRefusal extends Error {
  constructor() {
    super(
      `A permanent fact needs an explicit user statement or at least ${FACT_LIFECYCLE_BOUNDS.permanentMinConfirmations} confirmations`,
    );
    this.name = 'PermanentFactRefusal';
  }
}

/** What the judgement side (model or tool input) asserts about one fact's lifetime. */
export interface LifecycleAssignment {
  durability: FactDurability;
  /** short: days from `now` until the fact expires (clamped to 1–14). */
  ttlDays?: number;
  /** long_term: days from `now` until the review date (clamped to 14–182). */
  reviewInDays?: number;
  /** short only: what to do when the fact expires. */
  onExpiry?: FactOnExpiry;
}

/** The clamped, storage-ready dates for one fact — `null` wherever the class carries no date. */
export interface ResolvedLifecycle {
  durability: FactDurability;
  expiresAt: Date | null;
  reviewAfter: Date | null;
  onExpiry: FactOnExpiry | null;
}

/** The `permanent` gate: an explicit user statement, or this many confirmations. */
export function permanentAllowed(gate: { explicit?: boolean; confirmations: number }): boolean {
  return gate.explicit === true || gate.confirmations >= FACT_LIFECYCLE_BOUNDS.permanentMinConfirmations;
}

function clampDays(days: number, minDays: number, maxDays: number): number {
  return Math.min(maxDays, Math.max(minDays, days));
}

/**
 * Clamps one durability assignment into its legal window, computed from the
 * passed `now` — never a clock read. A short TTL missing from the input keeps
 * the full 14-day window (never dropped earlier than the class allows); a
 * missing long-term review date lands on the class minimum (2 weeks). Throws
 * {@link PermanentFactRefusal} for `permanent` when the gate does not open.
 */
export function resolveLifecycle(
  assignment: LifecycleAssignment,
  now: Date,
  gate: { explicit?: boolean; confirmations: number },
): ResolvedLifecycle {
  if (assignment.durability === 'permanent') {
    if (!permanentAllowed(gate)) {
      throw new PermanentFactRefusal();
    }
    // Permanent carries no dates of any kind — a date asserted alongside it is dropped.
    return { durability: 'permanent', expiresAt: null, reviewAfter: null, onExpiry: null };
  }
  if (assignment.durability === 'short') {
    const ttlDays = clampDays(
      assignment.ttlDays ?? FACT_LIFECYCLE_BOUNDS.short.maxDays,
      FACT_LIFECYCLE_BOUNDS.short.minDays,
      FACT_LIFECYCLE_BOUNDS.short.maxDays,
    );
    return {
      durability: 'short',
      expiresAt: new Date(now.getTime() + ttlDays * DAY_MS),
      reviewAfter: null,
      onExpiry: assignment.onExpiry ?? 'forget',
    };
  }
  const reviewInDays = clampDays(
    assignment.reviewInDays ?? FACT_LIFECYCLE_BOUNDS.longTerm.minDays,
    FACT_LIFECYCLE_BOUNDS.longTerm.minDays,
    FACT_LIFECYCLE_BOUNDS.longTerm.maxDays,
  );
  return {
    durability: 'long_term',
    expiresAt: null,
    reviewAfter: new Date(now.getTime() + reviewInDays * DAY_MS),
    onExpiry: null,
  };
}

/** The predicate inputs — the lifecycle slice of a `UserFact` row (fields optional so partial rows fit). */
export interface LifecycleFact {
  status: FactStatus;
  durability: FactDurability;
  expiresAt?: Date | null;
  reviewAfter?: Date | null;
}

/**
 * A short fact is expired at and after its `expiresAt` (<=), against the passed
 * `now`. Archive wins over the date: an archived row is never "expired", it is
 * archived — the two closures are distinct (AC-FL-2/AC-FL-3 build on this).
 */
export function isExpired(fact: LifecycleFact, now: Date): boolean {
  return (
    fact.status === 'active' &&
    fact.durability === 'short' &&
    fact.expiresAt != null &&
    fact.expiresAt.getTime() <= now.getTime()
  );
}

/** A long-term fact's review date has arrived (<=) — the coach asks, with a specific question. */
export function isReviewDue(fact: LifecycleFact, now: Date): boolean {
  return (
    fact.status === 'active' &&
    fact.durability === 'long_term' &&
    fact.reviewAfter != null &&
    fact.reviewAfter.getTime() <= now.getTime()
  );
}

/** The prompt/constraint-read contract: active AND not expired (AC-FL-1). */
export function isActiveForPrompt(fact: LifecycleFact, now: Date): boolean {
  return fact.status === 'active' && !isExpired(fact, now);
}
