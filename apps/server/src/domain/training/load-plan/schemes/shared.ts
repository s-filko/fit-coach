import { isAbsent, type LoadFacts, type RepRange } from '../../load-facts';

import { HIGH_CONFIDENCE_PERFORMANCES, LOW_CONFIDENCE_PERFORMANCES } from './params';
import type { Confidence, Recommendation, SchemeOutput, SchemeParams } from './types';

/** Fact names used in `missing` and printed in fallback lines. */
export const WORKING_WEIGHT = 'workingWeight';
export const EQUIPMENT_STEP = 'equipmentStep';
export const E1RM_TREND = 'e1rmTrend';
export const LAST_EXPOSURE = 'lastExposure';

export const NO_RECORD_REASON = 'no record — conservative start';

export function targetReps(facts: LoadFacts, params: SchemeParams): RepRange {
  if (params.fixedReps !== undefined) {
    return { min: params.fixedReps, max: params.fixedReps };
  }
  if (!isAbsent(facts.repRange)) {
    return { min: facts.repRange.min, max: facts.repRange.max };
  }
  return { ...params.repRange };
}

/** Stage A "data insufficient" answer: no load, the coach starts conservatively. */
export function noRecord(reps: RepRange, missing: string[]): SchemeOutput {
  const rec: Recommendation = { load: null, unit: null, reps };
  return { candidate: rec, conservative: { ...rec }, reason: NO_RECORD_REASON, confidence: 'low', missing };
}

export function confidenceOf(facts: LoadFacts, missing: string[]): Confidence {
  if (isAbsent(facts.workingWeight) || missing.length > 0) {
    return 'low';
  }
  const n = facts.workingWeight.performances;
  const machine = !isAbsent(facts.e1rmTrend) && facts.e1rmTrend.lowConfidence === 'machine';
  if (n < LOW_CONFIDENCE_PERFORMANCES) {
    return 'low';
  }
  return n >= HIGH_CONFIDENCE_PERFORMANCES && !machine ? 'high' : 'medium';
}

/** Round to the load grid so repeated float steps never drift (2.5-kg plates). */
export function roundLoad(value: number): number {
  const PRECISION = 1000;
  return Math.round(value * PRECISION) / PRECISION;
}

export type Growth = { kind: 'grow'; load: number } | { kind: 'reps-only' } | { kind: 'no-step' };

/** Load after one step, or why there is none: no step known, or the step exceeds the cap. */
export function stepUp(base: number, step: number | null, capPct: number): Growth {
  if (step === null) {
    return { kind: 'no-step' };
  }
  if (step > base * capPct + Number.EPSILON) {
    return { kind: 'reps-only' };
  }
  return { kind: 'grow', load: roundLoad(base + step) };
}

/**
 * One step lighter, floored: when the step would take the load to zero or below there is no lighter option,
 * so the load itself is returned — a candidate or conservative is never ≤ 0. No known step = no step.
 */
export function stepDown(load: number, step: number | null): number {
  const lighter = roundLoad(load - (step ?? 0));
  return lighter > 0 ? lighter : load;
}

export function stepOf(facts: LoadFacts): number | null {
  return isAbsent(facts.equipmentStep) ? null : facts.equipmentStep.step;
}

/** Consecutive performances the trend shows at the current strength; 0 when the trend is absent. */
export function confirmations(facts: LoadFacts): number | null {
  return isAbsent(facts.e1rmTrend) ? null : facts.e1rmTrend.flatRun;
}

export interface ProgressionRule {
  /** Whether the last exposure counts as a success that may lead to growth. */
  succeeded(repsVsRange: 'below floor' | 'in range' | 'at or above top'): boolean;
  /** Printed name of the success condition, e.g. "at the range top". */
  successLabel: string;
}

/**
 * The shared growth decision of the range/fixed-rep schemes: safety first (short constraint,
 * below floor), then confirmation, then one capped step. Unmet requirements land in `missing`
 * and in the reason — never a silent branch.
 */
export function decideProgression(facts: LoadFacts, params: SchemeParams, rule: ProgressionRule): SchemeOutput {
  const reps = targetReps(facts, params);
  if (isAbsent(facts.workingWeight)) {
    return noRecord(reps, [WORKING_WEIGHT]);
  }
  const { weight: base, unit } = facts.workingWeight;
  const step = stepOf(facts);
  const make = (load: number): Recommendation => ({ load, unit, reps });
  const missing: string[] = [];
  const notes: string[] = [];
  if (step === null) {
    missing.push(EQUIPMENT_STEP);
    notes.push(`${EQUIPMENT_STEP} missing — the load is held`);
  }
  const hold = (why: string): SchemeOutput => ({
    candidate: make(base),
    conservative: make(stepDown(base, step)),
    reason: [why, ...notes].join('; '),
    confidence: confidenceOf(facts, missing),
    missing,
  });

  const shortConstraint = facts.constraints.constraints.find(c => c.durability === 'short');
  if (shortConstraint) {
    return hold(`short constraint (${shortConstraint.text}) — no growth`);
  }
  if (isAbsent(facts.lastExposure) || isAbsent(facts.lastExposure.repsVsRange)) {
    missing.push(LAST_EXPOSURE);
    return hold(`${LAST_EXPOSURE} missing — the load is held`);
  }
  const vsRange = facts.lastExposure.repsVsRange;
  if (vsRange === 'below floor') {
    return hold('last exposure below the rep floor — hold');
  }
  if (!rule.succeeded(vsRange)) {
    return hold(`last exposure ${vsRange}; growth needs ${rule.successLabel} — hold`);
  }
  const seen = confirmations(facts);
  if (seen === null) {
    missing.push(E1RM_TREND);
    return hold(`${E1RM_TREND} missing — cannot count confirming sessions`);
  }
  if (seen < params.confirmSessions) {
    return hold(`${rule.successLabel}, confirmation ${seen} of ${params.confirmSessions}`);
  }
  const growth = stepUp(base, step, params.stepCapPct);
  if (growth.kind === 'grow') {
    return {
      candidate: make(growth.load),
      conservative: make(base),
      reason: `${rule.successLabel} for ${params.confirmSessions} sessions — one step up`,
      confidence: confidenceOf(facts, missing),
      missing,
    };
  }
  if (growth.kind === 'reps-only') {
    const pct = Math.round(params.stepCapPct * 100);
    return hold(`${rule.successLabel}; one step exceeds ${pct} % of the load — progress by reps, not load`);
  }
  return hold(`${rule.successLabel}; no load step known`);
}
