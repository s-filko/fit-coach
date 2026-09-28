// The course-check input fingerprint (course-check plan Task 1, AC-FL-5): the
// identity of everything the check decides on — facts set + stated goal +
// phase + active plan — as one stable hash. The directive is reused while the
// fingerprint holds, so the fingerprint IS the cost contract: an ordinary turn
// recomputes it (a hash, not a call) and reuses the stored directive.
//
// "Entering planning" and "before a durable write" fire through the
// fingerprint, not as separate flags: `phase` and `activePlanId` are
// components, so the first run after either changes sees a different hash —
// edge-triggered by comparison, never re-derived per turn.
//
// Pure (BR-LLM-007 discipline): no I/O, no clock reads — `now` arrives as
// data. The one crypto use (`createHash`) is deterministic over the input
// (same precedent as commit.node's args hash).
import { createHash } from 'node:crypto';

import type { ConversationPhase } from '@domain/conversation/phases';
import type { UserFact } from '@domain/user/ports';
import { isReviewDue } from '@domain/user/services/fact-lifecycle';

export interface CourseCheckFingerprintInput {
  /** getForPrompt output at the run clock — active, not expired, order-free (sorted by id). */
  facts: UserFact[];
  /** user.fitnessGoal — the stated goal. */
  goal: string | null;
  /** The run's effective phase. */
  phase: ConversationPhase;
  /** trainingService.getActivePlan(userId)?.id — the plan the course rides on. */
  activePlanId: string | null;
  /** The run clock — decides whether a review date has arrived (isReviewDue, never restated). */
  now: Date;
  /**
   * Expired `ask_once` facts still due their one question (expiryAction 'ask').
   * A fact BECOMING due is a real input change and fires the check once. The
   * step stores the SETTLED fingerprint — this list emptied, as it is once the
   * question has been put and the facts archived — so the next run's hash
   * matches and the check does not refire. Absent = none due.
   */
  expiredAsk?: UserFact[];
}

/**
 * One fact's fingerprint slice: everything that changes what the check would
 * decide about it — identity, meaning (text, category, muscle, phase note: a
 * conversational correction by factId rewrites the SAME row, so the id alone
 * would let a stale directive outlive the correction), class, its dates, and
 * whether its review date has arrived at `now`. Confirmations and updatedAt
 * deliberately excluded: a confirm restates the same meaning, it does not
 * change the course.
 */
function factComponent(fact: UserFact, now: Date): string {
  return [
    fact.id,
    fact.category,
    fact.fact,
    fact.muscleGroup ?? '',
    fact.phaseNote ?? '',
    fact.durability,
    fact.expiresAt?.getTime() ?? '',
    fact.reviewAfter?.getTime() ?? '',
    isReviewDue(fact, now) ? 'review_due' : '',
  ].join('|');
}

/** Id order for the canonical form — the fingerprint never depends on fact order. */
function byId(a: UserFact, b: UserFact): number {
  if (a.id < b.id) {
    return -1;
  }
  if (a.id > b.id) {
    return 1;
  }
  return 0;
}

/** Stable sha1 over the canonical JSON of the inputs — order-free in the fact list. */
export function courseCheckFingerprint(input: CourseCheckFingerprintInput): string {
  const facts = [...input.facts].sort(byId);
  return createHash('sha1')
    .update(
      JSON.stringify({
        facts: facts.map(f => factComponent(f, input.now)),
        expiredAsk: [...(input.expiredAsk ?? [])].sort(byId).map(f => factComponent(f, input.now)),
        goal: input.goal,
        phase: input.phase,
        activePlanId: input.activePlanId,
      }),
    )
    .digest('hex');
}
