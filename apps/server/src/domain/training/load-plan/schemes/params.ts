import type { SchemeGoal } from './types';

/**
 * R4.0 thresholds as named parameters (plan docs/superpowers/plans/load-facts.md § "R4.0 — sourced
 * thresholds", accepted by the owner). Each carries its citation; change only with a new source.
 */

/** Growth confirmation: 2 consecutive sessions at/over the range top. ACSM 2009 position stand
 *  (Ratamess et al., MSSE 41:687–708); NSCA "2-for-2" (Baechle & Earle, Essentials of S&C). */
export const CONFIRM_SESSIONS_DEFAULT = 2;

/** Growth step cap: ≤ ~10 % of the load, otherwise progress by reps. ACSM 2009: 2–10 % increments. */
export const STEP_CAP_PCT = 0.1;

/** Default double-progression rep ranges by goal (ACSM 2009: 8–12 hypertrophy, heavier for strength). */
export const DOUBLE_REP_RANGE: Record<SchemeGoal, { min: number; max: number }> = {
  strength: { min: 4, max: 6 },
  hypertrophy: { min: 8, max: 12 },
  general: { min: 8, max: 12 },
};

/** Default fixed reps for linear progression: 5 for strength (Rippetoe, Starting Strength convention),
 *  8 otherwise. */
export const LINEAR_FIXED_REPS: Record<SchemeGoal, number> = {
  strength: 5,
  hypertrophy: 8,
  general: 8,
};

/** e1RM-based confidence: performances needed for `high`. */
export const HIGH_CONFIDENCE_PERFORMANCES = 5;
/** Below this many performances confidence is `low`. */
export const LOW_CONFIDENCE_PERFORMANCES = 3;

/** 2-for-2 (NSCA, Baechle & Earle): the last set at the working weight beats the top of the range by at least this
 *  many reps in two consecutive sessions → add one step. */
export const TWO_FOR_TWO_SURPLUS = 2;

/** One-session growth: the last set at the working weight beats the top of the range by at least this many reps.
 *  Reasoned from APRE (Mann et al. 2010, JSCR: the next load follows the reps on the final set, more surplus → more
 *  load); a caution parameter the recommendation log (R4.4) calibrates. */
export const ONE_SESSION_SURPLUS = 3;

/** One-session growth needs the last set no harder than this RPE (RIR-based RPE, Helms et al. 2018, Front. Physiol.);
 *  an absent RPE does not block. */
export const ONE_SESSION_MAX_RPE = 8;

/** Uneven performance: drop-off at the working weight above the user's usual by more than this many reps. Reasoned
 *  parameter (the usual drop-off itself is the median of up to 5 earlier performances). */
export const UNEVEN_ABOVE_USUAL = 3;

/** Uneven performance with no usual to compare with: a drop-off above this many reps. */
export const UNEVEN_WITHOUT_NORM = 4;
