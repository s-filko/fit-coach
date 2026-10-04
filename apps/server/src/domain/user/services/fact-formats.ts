/**
 * Text formats of the two stored fact categories `break` and `progression_scheme` (ADR-0009 amendment) and the small
 * vocabulary the summariser v7 / verifier v2 prompts and the compaction's apply step read. Moved here unchanged from
 * the deleted load engine (coach-simplification I1 Task 3): the fact machinery stays, the engine that consumed these
 * facts is gone. Pure — no I/O.
 */

export const BREAK_REASONS = [
  'illness',
  'injury',
  'holiday_work_no_time',
  'deliberate_deload',
  'stress_poor_sleep',
  'unknown',
] as const;
export type BreakReason = (typeof BREAK_REASONS)[number];

export interface BreakFact {
  reason: BreakReason;
  /** First day without training, `YYYY-MM-DD`. */
  from: string;
  /** Last day of the break (or the day it was asked about), `YYYY-MM-DD`. */
  to: string;
  words: string;
}

const BREAK_PATTERN = /^break reason=(\w+) from=(\d{4}-\d{2}-\d{2}) to=(\d{4}-\d{2}-\d{2})(?: — (.*))?$/s;

/** Null when the text is not a well-formed break fact (unknown class, bad or reversed dates). */
export function parseBreakFact(text: string): BreakFact | null {
  const m = BREAK_PATTERN.exec(text.trim());
  if (!m) {
    return null;
  }
  const [, reason, from, to, words] = m;
  if (!(BREAK_REASONS as readonly string[]).includes(reason) || from > to) {
    return null;
  }
  return { reason: reason as BreakReason, from, to, words: words ?? '' };
}

/** The progression schemes a `progression_scheme` fact may name: registry id → the description the prompts quote. */
export const SCHEMES = {
  double_progression: {
    id: 'double_progression',
    description:
      'Work inside a rep range. When you reach the top of the range for two sessions in a row, the weight goes up one step and the reps start again from the bottom of the range.',
  },
  linear_progression: {
    id: 'linear_progression',
    description:
      'Fixed sets and reps every workout. When you make all the reps for two sessions in a row, the weight goes up one step; the rep target does not change.',
  },
} as const;

export type SchemeId = keyof typeof SCHEMES;

export function isSchemeId(id: string): id is SchemeId {
  return Object.prototype.hasOwnProperty.call(SCHEMES, id);
}

export interface ProgressionFact {
  schemeId: SchemeId;
  words: string;
}

const PROGRESSION_PATTERN = /^progression_scheme id=(\w+)(?: — (.*))?$/s;

/** Null when the text is not a well-formed fact or names an id the registry does not know. */
export function parseProgressionFact(text: string): ProgressionFact | null {
  const m = PROGRESSION_PATTERN.exec(text.trim());
  if (!m || !isSchemeId(m[1])) {
    return null;
  }
  return { schemeId: m[1], words: m[2] ?? '' };
}
