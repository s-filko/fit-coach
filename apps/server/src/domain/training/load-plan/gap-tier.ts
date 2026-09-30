import { calendarDaysAgo } from '@shared/date-utils';

import { type GapDays, isAbsent, type LoadFacts } from '../load-facts';

/**
 * Gap tiers and the return ladder (plan D5, design §5) from the R4.0 table
 * (docs/superpowers/plans/load-facts.md § "R4.0 — sourced thresholds", accepted by the owner).
 * Population defaults, printed as "general norm"; personal thresholds are not in this plan.
 */

export interface SourcedParam {
  value: number;
  /** Where the number comes from, and how it is labelled. */
  citation: string;
}

export const GAP_TIER_PARAMS = {
  /** Tier `rest` → `rest_with_question`: more than this many days. */
  restWithQuestionAboveDays: {
    value: 7,
    citation:
      'coaching convention (weekly frequency norm); ACSM 2009 recommends 2–3 sessions/week per muscle group (Ratamess et al., MSSE 41:687–708)',
  },
  /** Tier `return`: first workout one step down. Caution parameter, labelled as such. */
  returnFromDays: {
    value: 14,
    citation:
      'caution parameter: conservative margin under the ~3-week strength-retention figure (Mujika & Padilla 2000, Sports Med 30:79–87)',
  },
  /** Tier `rebuild`: working weight stale, a ladder of several workouts. */
  rebuildFromDays: {
    value: 28,
    citation:
      'Mujika & Padilla 2000 (Sports Med 30:79–87): maximal strength largely retained ~3–4 weeks; Ogasawara et al. 2013 (Eur J Appl Physiol): 3-week breaks did not blunt gains; margin applied',
  },
  /** Tier `restart`: history is a dated reference only, cold start. */
  restartFromDays: {
    value: 84,
    citation:
      'detraining reviews: marked strength and hypertrophy loss beyond ~8–12 weeks (range; still to be verified against the papers)',
  },
} as const satisfies Record<string, SourcedParam>;

export type GapTier = 'rest' | 'rest_with_question' | 'return' | 'rebuild' | 'restart';

export function gapTierOf(days: number): GapTier {
  if (days >= GAP_TIER_PARAMS.restartFromDays.value) {
    return 'restart';
  }
  if (days >= GAP_TIER_PARAMS.rebuildFromDays.value) {
    return 'rebuild';
  }
  if (days >= GAP_TIER_PARAMS.returnFromDays.value) {
    return 'return';
  }
  return days > GAP_TIER_PARAMS.restWithQuestionAboveDays.value ? 'rest_with_question' : 'rest';
}

export interface GapTierInfo {
  tier: GapTier;
  days: number | null;
  /** Which gap fact the tier was read from. */
  basis: 'exercise' | 'primary muscles' | 'any workout' | null;
}

function daysOf(g: GapDays): number | null {
  return isAbsent(g) ? null : g.days;
}

/** The tier from metric 7: the exercise's own gap, else its primary muscles', else any workout's. */
export function gapTierFacts(facts: LoadFacts): GapTierInfo {
  const candidates: [GapTierInfo['basis'], number | null][] = [
    ['exercise', daysOf(facts.gap.exercise)],
    ['primary muscles', daysOf(facts.gap.primaryMuscles)],
    ['any workout', daysOf(facts.gap.anyWorkout)],
  ];
  for (const [basis, days] of candidates) {
    if (days !== null) {
      return { tier: gapTierOf(days), days, basis };
    }
  }
  return { tier: 'rest', days: null, basis: null };
}

/** Return ladder, R4.0 "convention, low confidence": `return` 1–2 workouts, `rebuild` 3, `restart` = cold start. */
export const LADDER: Record<'return' | 'rebuild', { workouts: number; startStepsBelow: number }> = {
  return: { workouts: 2, startStepsBelow: 1 },
  rebuild: { workouts: 3, startStepsBelow: 2 },
};

export interface LadderStep {
  tier: 'return' | 'rebuild' | 'restart';
  /** 1-based rung: the workout this is, since the gap. */
  workout: number;
  of: number;
  /** Load steps below the working weight for this rung (0 = back at the working weight). */
  stepsBelow: number;
  coldStart: boolean;
}

/**
 * The rung for the next workout. `workoutsSince` is the counter of successful real workouts since the gap
 * (`ladderStateOf`); 0 = the first rung. After a `restart` the first workout is the cold start, the ones
 * after it follow the rebuild ladder. Null = not in a ladder (tier below `return`, or the ladder is finished).
 */
export function returnLadderStep(tier: GapTier, workoutsSince = 0): LadderStep | null {
  if (tier === 'restart') {
    if (workoutsSince === 0) {
      return { tier, workout: 1, of: 0, stepsBelow: 0, coldStart: true };
    }
    const after = returnLadderStep('rebuild', workoutsSince - 1);
    return after && { ...after, tier };
  }
  if (tier !== 'return' && tier !== 'rebuild') {
    return null;
  }
  const { workouts, startStepsBelow } = LADDER[tier];
  if (workoutsSince >= workouts) {
    return null;
  }
  return {
    tier,
    workout: workoutsSince + 1,
    of: workouts,
    stepsBelow: Math.max(0, startStepsBelow - workoutsSince),
    coldStart: false,
  };
}

/** One real performance of the exercise, with whether it counts as a rung (`performanceSuccess`). */
export interface LadderPerformance {
  performedAt: Date;
  success: boolean;
}

/** Where the user stands in the ladder opened by the newest gap in the history. */
export interface LadderState {
  /** The tier of that gap. */
  tier: 'return' | 'rebuild' | 'restart';
  gapDays: number;
  /** The last performance before the gap, and the first one after it. */
  gapStart: Date;
  gapEnd: Date;
  /** Successful workouts since the gap — the rungs done; a miss does not advance it. */
  workoutsSince: number;
  /** All performances since the gap, successful or not. */
  performancesSince: number;
}

/**
 * The counter of real workouts since the newest gap (≥ the `return` threshold between two consecutive
 * performances). Null when the history holds no such gap. The open gap up to now is `gapTierFacts`' business.
 */
export function ladderStateOf(performances: LadderPerformance[], tz: string | null): LadderState | null {
  const desc = [...performances].sort((a, b) => b.performedAt.getTime() - a.performedAt.getTime());
  for (let i = 0; i + 1 < desc.length; i++) {
    const gapDays = calendarDaysAgo(desc[i + 1].performedAt, desc[i].performedAt, tz);
    if (gapDays >= GAP_TIER_PARAMS.returnFromDays.value) {
      const since = desc.slice(0, i + 1);
      return {
        tier: gapTierOf(gapDays) as LadderState['tier'],
        gapDays,
        gapStart: desc[i + 1].performedAt,
        gapEnd: desc[i].performedAt,
        workoutsSince: since.filter(p => p.success).length,
        performancesSince: since.length,
      };
    }
  }
  return null;
}
