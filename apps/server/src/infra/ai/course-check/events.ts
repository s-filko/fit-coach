// The course-check event predicate (course-check plan Task 1, AC-FL-5): the
// check fires by EVENT, not per turn. Pure: every input arrives as data, the
// gap threshold threaded from the episode config (never re-read from env —
// same discipline as the time-gap note and compaction's inactivity trigger).
//
// The two events, in words:
// - `fingerprint_changed` — the inputs moved (facts set, goal, phase, active
//   plan; or nothing stored yet). "Entering planning" and "before a durable
//   write" arrive HERE: phase and activePlanId are fingerprint components, so
//   the first run after either changes is a fingerprint change — edge-triggered
//   by comparison with the stored directive, which is exactly why an ordinary
//   turn stays free.
// - `long_gap` — the first run after `gapMs` of silence. Time passed even
//   though nothing moved: review dates may have come due, the world aged, and
//   the owner's "сверка курса" is due on return.
//
// Everything else returns null — no model call, the run costs what it costs
// today. No I/O, no clock reads: `now` and `lastUserMessageAt` are data.
import type { CourseCheckFailure, StoredCourseDirective } from './directive';

export type CourseCheckEvent = 'fingerprint_changed' | 'long_gap';

export interface CourseCheckEventInput {
  /** courseCheckFingerprint of this run's inputs. */
  fingerprint: string;
  /** state.courseDirective — null when no directive has been generated yet. */
  stored: Pick<StoredCourseDirective, 'fingerprint'> | null;
  /** The run clock (ctx.now). */
  now: Date;
  /** The previous run's stamp (state.lastUserMessageAt) — still set at prepare time. */
  lastUserMessageAt: Date | null;
  /** EPISODE_GAP_HOURS × 3_600_000, threaded from the episode config. */
  gapMs: number;
  /** state.courseCheckFailure — the last failed attempt; null when the last one succeeded. */
  failure: CourseCheckFailure | null;
  /** COURSE_CHECK_RETRY_COOLDOWN_MINUTES in ms, threaded as data like `gapMs`. */
  cooldownMs: number;
}

/**
 * True while a failed attempt on THIS fingerprint is still cooling down. Only
 * the same fingerprint is covered: changed inputs are a new question.
 */
function coolingDown(input: CourseCheckEventInput): boolean {
  const { failure, fingerprint, now, cooldownMs } = input;
  if (failure === null || failure.fingerprint !== fingerprint) {
    return false;
  }
  return now.getTime() - new Date(failure.at).getTime() < cooldownMs;
}

/**
 * The event that fires the check this run, or null. Fingerprint first: a
 * changed fingerprint explains itself, and nothing-stored is its edge case. A
 * failed attempt on the same fingerprint backs off for the cooldown — the
 * stored directive keeps rendering, the run costs what it costs today.
 */
export function courseCheckEvent(input: CourseCheckEventInput): CourseCheckEvent | null {
  if (coolingDown(input)) {
    return null;
  }
  if (input.stored === null || input.stored.fingerprint !== input.fingerprint) {
    return 'fingerprint_changed';
  }
  if (input.lastUserMessageAt !== null && input.now.getTime() - input.lastUserMessageAt.getTime() >= input.gapMs) {
    return 'long_gap';
  }
  return null;
}
