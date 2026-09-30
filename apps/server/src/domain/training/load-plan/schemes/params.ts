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
