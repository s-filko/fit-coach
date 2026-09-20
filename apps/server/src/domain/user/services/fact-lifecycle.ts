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

/** `as const` tuples (not `readonly T[]`) so `z.enum(...)` infers the literal unions. */
export const FACT_DURABILITIES = ['permanent', 'long_term', 'short'] as const satisfies readonly FactDurability[];
export const FACT_ON_EXPIRY = ['forget', 'ask_once'] as const satisfies readonly FactOnExpiry[];

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
  /** Read by {@link expiryAction} — what a short fact's expiry does. */
  onExpiry?: FactOnExpiry | null;
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

/**
 * What PERFORMING a fact's expiry means (course-check plan, expiry task):
 * - 'ask'    — an expired `ask_once` fact: one check-in question, THEN archive;
 * - 'forget' — any other expired short fact (`forget`, or no flag): archive silently;
 * - null     — not expired (or not active/short): nothing to perform.
 *
 * Staleness bound (`askWindowMs`, configuration passed as data): a question
 * about a state that expired LONGER ago than the window is noise — asking about
 * four-day-old soreness already is, a months-old tweak more so — so such an
 * `ask_once` fact is archived silently like `forget`. Strictly beyond the
 * window; the comparison is against the passed `now` (the run clock). Omitted =
 * no bound.
 *
 * Built on {@link isExpired}, so the date rule (<=, active short only) lives in
 * exactly one place. The read that finds these facts is the port's
 * `getExpiredActive`; this decides what each one gets.
 */
export function expiryAction(
  fact: LifecycleFact,
  now: Date,
  askWindowMs = Number.POSITIVE_INFINITY,
): 'ask' | 'forget' | null {
  if (!isExpired(fact, now)) {
    return null;
  }
  if (fact.onExpiry !== 'ask_once') {
    return 'forget';
  }
  const expiredFor = now.getTime() - (fact.expiresAt as Date).getTime(); // isExpired guarantees a date
  return expiredFor > askWindowMs ? 'forget' : 'ask';
}

/** The archive fields the closure moment reads. */
export interface ClosureFact {
  archivedAt: Date | null;
  archivedReason: FactArchivedReason | null;
  closedByUserAt: Date | null;
  expiresAt?: Date | null;
}

/**
 * WHEN an archived fact's subject ended — the moment the stale-evidence guard
 * (AC-FL-3) compares new evidence against: a statement no newer than this is
 * old news about the closed subject; a newer one is a genuinely new statement.
 *
 * - the user's word wins: `closed_by_user_at` (the moment they said it);
 * - an EXPIRED archive: the expiry date itself, NOT `archived_at` — archival
 *   happens whenever the course check next runs, possibly days later, and a
 *   restatement made in between must not be discarded as "older than the
 *   closure";
 * - anything else (superseded…): `archived_at`.
 */
export function closureMoment(fact: ClosureFact): Date | null {
  if (fact.closedByUserAt !== null) {
    return fact.closedByUserAt;
  }
  if (fact.archivedReason === 'expired' && fact.expiresAt != null) {
    return fact.expiresAt;
  }
  return fact.archivedAt;
}
