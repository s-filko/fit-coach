import { classifySets, parseRepRange, type PerformanceInput } from '../load-facts';

import type { LadderPerformance } from './gap-tier';

/**
 * A workout "in range with reserve" (design §5, ladder rule): every working set at or above the rep floor
 * of the performance's own target range, and any recorded RPE within the reserve limit. No range known or no
 * RPE recorded never counts as a miss — the ladder must not stall on missing data (RPE fill rate is measured
 * by the zero-LLM report first, R4.0).
 */

/** RPE ≤ 8 leaves about two reps in reserve (Zourdos et al. 2016, JSCR 30:267–275; a convention, not a gate). */
export const RESERVE_RPE_MAX = 8;

export function performanceSuccess(p: Pick<PerformanceInput, 'sets' | 'targetReps'>): boolean {
  const { working } = classifySets(p.sets);
  const range = parseRepRange(p.targetReps);
  const reps = working.flatMap(s => ('reps' in s.setData ? [s.setData.reps] : []));
  if (range && reps.length > 0 && Math.min(...reps) < range.min) {
    return false;
  }
  return working.every(s => s.rpe === null || s.rpe <= RESERVE_RPE_MAX);
}

/** The exercise's real performances (≥ 1 working set, today's session excluded) as ladder input. */
export function ladderPerformancesOf(performances: PerformanceInput[], todaySessionId: string): LadderPerformance[] {
  return performances
    .filter(p => p.sessionId !== todaySessionId && classifySets(p.sets).working.length > 0)
    .map(p => ({ performedAt: p.performedAt, success: performanceSuccess(p) }));
}
