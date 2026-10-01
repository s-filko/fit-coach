import { capacityOf, isAbsent, type LoadFacts, type RepRange } from '../../load-facts';

import { HIGH_CONFIDENCE_PERFORMANCES, LOW_CONFIDENCE_PERFORMANCES } from './params';
import type { Confidence, NextStep, Recommendation, SchemeOutput, SchemeParams } from './types';

/** Fact names used in `missing` and printed in fallback lines. */
export const WORKING_WEIGHT = 'workingWeight';
export const EQUIPMENT_STEP = 'equipmentStep';
export const E1RM_TREND = 'e1rmTrend';
export const LAST_EXPOSURE = 'lastExposure';

/** Printed when there is no number to give: no working weight AND no reference load — the coach invents no option. */
export const NO_RECORD_REASON = 'no record, no reference load';

export function targetReps(facts: LoadFacts, params: SchemeParams): RepRange {
  if (params.fixedReps !== undefined) {
    return { min: params.fixedReps, max: params.fixedReps };
  }
  if (!isAbsent(facts.repRange)) {
    return { min: facts.repRange.min, max: facts.repRange.max };
  }
  return { ...params.repRange };
}

/** Stage A "data insufficient" answer with nothing to base a number on: no load, no conservative option. */
export function noRecord(reps: RepRange, missing: string[]): SchemeOutput {
  const rec: Recommendation = { load: null, unit: null, reps };
  return {
    candidate: rec,
    conservative: { ...rec },
    reason: NO_RECORD_REASON,
    confidence: 'low',
    missing,
    next: { kind: 'no_number' },
  };
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

/** A step off the 0.25 kg grid (a from-history 2.27 kg) lands on 0.1 kg — the resolution the step was fitted at. */
export function roundToStep(value: number, step: number | null): number {
  const onGrid = step === null || Math.abs(step * 4 - Math.round(step * 4)) < 1e-9;
  return onGrid ? roundLoad(value) : Math.round(value * 10) / 10;
}

/**
 * One step lighter: the step when it is known (floored, `stepDown`); with an UNKNOWN step the nearest load the client
 * actually recorded below `load` (never a made-up step), else the load itself.
 */
export function lighterLoad(facts: LoadFacts, load: number, step: number | null): number {
  if (step !== null) {
    return stepDown(load, step);
  }
  const below = facts.recordedLoads.filter(l => l < load - 1e-9);
  return below.length > 0 ? below[below.length - 1] : load;
}

/** Round to the load grid so repeated float steps never drift (2.5-kg plates). */
export function roundLoad(value: number): number {
  const PRECISION = 1000;
  return Math.round(value * PRECISION) / PRECISION;
}

/**
 * `grow`: one step up within the cap. `capped`: the step is over the cap but is still the smallest increment the
 * equipment has — offered with reps reset to the floor when the growth condition is met (NSCA: use the smallest
 * available increment). `no-step`: no equipment step known.
 */
export type Growth = { kind: 'grow'; load: number } | { kind: 'capped'; load: number } | { kind: 'no-step' };

/** Load after one step, or why there is none: no step known, or the step exceeds the cap. */
export function stepUp(base: number, step: number | null, capPct: number, capApplies = true): Growth {
  if (step === null) {
    return { kind: 'no-step' };
  }
  if (capApplies && step > base * capPct + Number.EPSILON) {
    return { kind: 'capped', load: roundToStep(base + step, step) };
  }
  return { kind: 'grow', load: roundToStep(base + step, step) };
}

/**
 * One step lighter, floored: when the step would take the load to zero or below there is no lighter option,
 * so the load itself is returned — a candidate or conservative is never ≤ 0. No known step = no step.
 */
export function stepDown(load: number, step: number | null): number {
  const lighter = roundToStep(load - (step ?? 0), step);
  return lighter > 0 ? lighter : load;
}

/**
 * Whether the "step ≤ ~10 % of the load" cap applies (ruling O-2: not to machines, own weight unknown;
 * cables keep it, W-32).
 */
export function capAppliesOf(facts: LoadFacts): boolean {
  return isAbsent(facts.equipmentStep) ? true : facts.equipmentStep.capApplies;
}

/**
 * The reason of a growth the cap would have blocked (run 3): the growth condition is met, the equipment's smallest step
 * is over the cap, so that smallest step is offered with the reps reset to the floor — never a dead end.
 */
export function cappedNote(base: number, step: number, capPct: number, floor: number): string {
  const pct = Math.round((step / base) * 100);
  return `the step (${step} kg, ${pct} % of ${base} kg) is over the ${Math.round(capPct * 100)} % cap but the growth condition is met: the smallest step, reps reset to the floor ${floor}`;
}

/** The note a growth reason carries when the cap was waived and the step is large next to the displayed load. */
export function smallStepNote(facts: LoadFacts, base: number, step: number | null, capPct: number): string {
  return !capAppliesOf(facts) && step !== null && step > base * capPct + Number.EPSILON
    ? ' (a relatively small step: the machine adds its own weight to the displayed load)'
    : '';
}

/** A short constraint that blocks growth: on a PRIMARY muscle (a secondary-only one does not, ruling G-17). */
export function blockingConstraint(facts: LoadFacts): LoadFacts['constraints']['constraints'][number] | undefined {
  return facts.constraints.constraints.find(c => c.durability === 'short' && c.onPrimary !== false);
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
  /**
   * Set → growth is judged on the sets at the working weight (rep history): the last such set must beat the range top
   * by this many reps in `confirmSessions` consecutive performances (2-for-2). Unset (linear) or no rep history →
   * the last-exposure + e1RM-trend confirmation below.
   */
  surplusReps?: number;
}

/** The last set at the working weight of a performance entry, or null when it used another load. */
export function lastSetReps(entry: { repsAtWorkingWeight: number[] }): number | null {
  return entry.repsAtWorkingWeight.length > 0 ? entry.repsAtWorkingWeight[entry.repsAtWorkingWeight.length - 1] : null;
}

type RepEntry = { repsAtWorkingWeight: number[]; lastSetRpe: number | null };

/** Capacity (reps + reps in reserve) of the last set at the working weight; null when it used another load. */
export function lastSetCapacity(entry: RepEntry): number | null {
  const reps = lastSetReps(entry);
  return reps === null ? null : capacityOf(reps, entry.lastSetRpe);
}

/** "12 reps", or "12 reps at RPE 8 (counts as 14)" when the effort was recorded. */
export function lastSetText(entry: RepEntry): string {
  const reps = lastSetReps(entry);
  if (reps === null) {
    return 'no set at the working weight in the newest performance';
  }
  return entry.lastSetRpe === null
    ? `${reps} reps`
    : `${reps} reps at RPE ${entry.lastSetRpe} (counts as ${capacityOf(reps, entry.lastSetRpe)})`;
}

/** Consecutive newest performances at the working weight in which EVERY set reached `reps`. */
function floorRun(entries: RepEntry[], reps: number): number {
  let run = 0;
  while (run < entries.length && entries[run].repsAtWorkingWeight.length > 0) {
    if (entries[run].repsAtWorkingWeight.some(r => r < reps)) {
      break;
    }
    run++;
  }
  return run;
}

/** Consecutive newest performances whose last set at the working weight had a capacity of at least `reps`. */
function surplusRun(entries: RepEntry[], reps: number): number {
  let run = 0;
  while (run < entries.length && (lastSetCapacity(entries[run]) ?? -1) >= reps) {
    run++;
  }
  return run;
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
  const hold = (why: string, next: NextStep = { kind: 'hold', why }): SchemeOutput => ({
    candidate: make(base),
    conservative: make(lighterLoad(facts, base, step)),
    reason: [why, ...notes].join('; '),
    confidence: confidenceOf(facts, missing),
    missing,
    next,
  });
  const grown = (load: number, why: string, resetReps = false): SchemeOutput => ({
    candidate: resetReps ? { load, unit, reps: { min: reps.min, max: reps.min } } : make(load),
    conservative: make(base),
    reason: why,
    confidence: confidenceOf(facts, missing),
    missing,
    next: { kind: 'after_growth', load, reps: reps.max },
  });

  const shortConstraint = blockingConstraint(facts);
  if (shortConstraint) {
    return hold(`short constraint (${shortConstraint.text}) — no growth`, { kind: 'constraint' });
  }
  if (rule.surplusReps !== undefined && !isAbsent(facts.repHistory)) {
    return decideFromRepHistory(facts, params, rule.surplusReps, {
      base,
      step,
      reps,
      hold,
      grown,
      capApplies: capAppliesOf(facts),
      smallStep: smallStepNote(facts, base, step, params.stepCapPct),
    });
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
  // Fixed reps (linear): "make all the reps twice in a row" is read from the rep history — the e1RM flat run is not
  // monotone in reps (a stronger newest session breaks "flat"), the rep history is.
  const seen =
    params.fixedReps !== undefined && !isAbsent(facts.repHistory)
      ? floorRun(facts.repHistory.entries, params.fixedReps)
      : confirmations(facts);
  if (seen === null) {
    missing.push(E1RM_TREND);
    return hold(`${E1RM_TREND} missing — cannot count confirming sessions`);
  }
  if (seen < params.confirmSessions) {
    return hold(`${rule.successLabel}, confirmation ${seen} of ${params.confirmSessions}`);
  }
  const growth = stepUp(base, step, params.stepCapPct, capAppliesOf(facts));
  if (growth.kind === 'grow') {
    return grown(
      growth.load,
      `${rule.successLabel} for ${params.confirmSessions} sessions — one step up${smallStepNote(facts, base, step, params.stepCapPct)}`,
    );
  }
  if (growth.kind === 'capped') {
    return grown(
      growth.load,
      `${rule.successLabel} for ${params.confirmSessions} sessions — ${cappedNote(base, step ?? 0, params.stepCapPct, reps.min)}`,
      true,
    );
  }
  return hold(`${rule.successLabel}; no load step known`);
}

interface RepGrowthCtx {
  base: number;
  step: number | null;
  reps: RepRange;
  hold: (why: string, next?: NextStep) => SchemeOutput;
  grown: (load: number, why: string, resetReps?: boolean) => SchemeOutput;
  capApplies: boolean;
  smallStep: string;
}

/**
 * 2-for-2 on the sets at the working weight (load-plan-fixes item 5; NSCA): the last set at the working weight beat
 * the range top by `surplus` reps in `confirmSessions` consecutive performances → one capped step up. Otherwise hold,
 * and the next step names how many sessions are still missing. Safety rows (below floor, uneven, gaps, pre-fatigue)
 * already ran in Stage A.
 */
function decideFromRepHistory(facts: LoadFacts, params: SchemeParams, surplus: number, c: RepGrowthCtx): SchemeOutput {
  const { entries } = facts.repHistory as Extract<LoadFacts['repHistory'], { entries: unknown }>;
  const needReps = c.reps.max + surplus;
  const seen = surplusRun(entries, needReps);
  const lastText = entries[0] ? lastSetText(entries[0]) : 'no set at the working weight in the newest performance';
  const growth = stepUp(c.base, c.step, params.stepCapPct, c.capApplies);
  if (seen >= params.confirmSessions && growth.kind === 'grow') {
    return c.grown(
      growth.load,
      `last set at the working weight ≥ ${needReps} reps (range top ${c.reps.max} + ${surplus}) in ${seen} sessions in a row — one step up${c.smallStep}`,
    );
  }
  if (seen >= params.confirmSessions && growth.kind === 'capped') {
    return c.grown(
      growth.load,
      `last set at the working weight ≥ ${needReps} reps (range top ${c.reps.max} + ${surplus}) in ${seen} sessions in a row — ${cappedNote(c.base, c.step ?? 0, params.stepCapPct, c.reps.min)}`,
      true,
    );
  }
  if (growth.kind === 'no-step') {
    return c.hold(`last set at the working weight ${lastText}; no load step known`, {
      kind: 'hold',
      why: 'no load step known',
    });
  }
  const missing = params.confirmSessions - seen;
  const why =
    seen > 0
      ? `last set at the working weight reached ${needReps}+ reps, confirmation ${seen} of ${params.confirmSessions}`
      : `last set at the working weight ${lastText}; growth needs ≥ ${needReps} reps (range top ${c.reps.max} + ${surplus}) in ${params.confirmSessions} sessions in a row — hold`;
  return c.hold(why, { kind: 'growth', sessions: missing, reps: needReps, load: growth.load });
}
