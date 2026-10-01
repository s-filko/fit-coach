import { isAbsent, type LoadFacts } from '../load-facts';

import type { BreakReason } from './break-fact';
import {
  gapTierFacts,
  type GapTierInfo,
  LADDER,
  type LadderState,
  type LadderStep,
  returnLadderStep,
} from './gap-tier';
import type {
  Confidence,
  NextStep,
  ProgressionScheme,
  Recommendation,
  SchemeGoal,
  SchemeOutput,
  SchemeParams,
} from './schemes';
import { ONE_SESSION_MAX_RPE, ONE_SESSION_SURPLUS, UNEVEN_ABOVE_USUAL, UNEVEN_WITHOUT_NORM } from './schemes/params';
import {
  confidenceOf,
  EQUIPMENT_STEP,
  lastSetReps,
  NO_RECORD_REASON,
  noRecord,
  roundLoad,
  stepDown,
  stepOf,
  stepUp,
  targetReps,
  WORKING_WEIGHT,
} from './schemes/shared';

/**
 * Decision order (plan D4, design §3.3): Stage A safety rows, shared and before any scheme →
 * Stage B active tactic (none until layer 2) → Stage C the scheme. Pure over `LoadFacts`; the
 * matching stage and row are part of the output and are printed as the reason.
 */

export type Stage = 'A' | 'B' | 'C';
export type DecisionRow =
  | 'insufficient_data'
  | 'short_constraint'
  | 'gap_return'
  | 'gap_rebuild'
  | 'gap_restart'
  | 'pre_fatigue'
  | 'uneven_performance'
  | 'below_floor'
  | 'early_growth'
  | 'scheme_growth'
  | 'scheme_hold';

/**
 * Pre-fatigue "materially greater" (design §3.3 row 4): today's working sets on a muscle shared with
 * this exercise exceed the reference performance's by at least this many — about one exercise's worth.
 * Reasoned caution parameter, not a sourced one; the recommendation log (R4.4) calibrates it.
 */
export const PRE_FATIGUE_MATERIAL_SETS = 3;
/** With this many extra pre-fatigue sets the candidate drops one step too (two exercises' worth). */
export const PRE_FATIGUE_HEAVY_SETS = 6;

export interface DecideInput {
  scheme: ProgressionScheme;
  goal: SchemeGoal;
  /** Defaults to `scheme.defaultParams(goal)`. */
  params?: SchemeParams;
  /** Successful workouts since the CURRENT gap; default 0 = first rung. */
  ladderWorkoutsSince?: number;
  /** The ladder opened by the newest gap in the history (`ladderStateOf`) — advances while the gap is closed. */
  ladder?: LadderState | null;
  /** The reason of the break fact covering the gap (design §5 branch table); null/absent = no fact. */
  breakReason?: BreakReason | null;
}

export interface Decision extends SchemeOutput {
  stage: Stage;
  row: DecisionRow;
  /** Printed outcome of the row: "hold", "one step down", "one step up", … */
  outcome: string;
  tactic: 'none active';
  scheme: { id: string; version: number };
  gap: GapTierInfo;
  ladder: LadderStep | null;
  /** The concrete condition of the next increase — printed as the `next step:` line. */
  next: NextStep;
}

const LEVELS: Confidence[] = ['low', 'medium', 'high'];

function oneLevelDown(c: Confidence): Confidence {
  return LEVELS[Math.max(0, LEVELS.indexOf(c) - 1)];
}

/**
 * Pre-fatigue delta: the largest per-muscle increase in working sets on the muscles shared with this exercise
 * (today − reference). Per muscle, not summed — one set can load several muscles. Null when not comparable.
 */
export function preFatigueDelta(facts: LoadFacts): number | null {
  if (isAbsent(facts.fatigueReference) || facts.fatigueToday.sameAsReference) {
    return null;
  }
  const before = new Map(facts.fatigueReference.perMuscle.map(m => [m.muscleGroup, m.workingSets]));
  return facts.fatigueToday.perMuscle.reduce(
    (max, m) => Math.max(max, m.workingSets - (before.get(m.muscleGroup) ?? 0)),
    0,
  );
}

function stepsWord(steps: number): string {
  if (steps === 0) {
    return 'hold';
  }
  const n = Math.abs(steps);
  const count = n === 1 ? 'one step' : `${n} steps`;
  return steps > 0 ? `${count} up` : `${count} down`;
}

interface Ctx {
  facts: LoadFacts;
  base: number;
  unit: 'kg' | 'lbs' | null;
  step: number | null;
  reps: Recommendation['reps'];
  missing: string[];
  gap: GapTierInfo;
  ladder: LadderStep | null;
  /** The gap the ladder belongs to, as printed: "20 d since exercise" / "30 d gap before the last workout". */
  ladderBasis: string;
  breakReason: BreakReason | null;
  scheme: ProgressionScheme;
}

/** Whole load steps from `base` to `load`; 0 when either the load or the step is unknown. */
function stepsFrom(base: number, load: number | null, step: number | null): number {
  return load === null || step === null ? 0 : Math.round((load - base) / step);
}

const NO_LIGHTER = 'no lighter option — the load holds';

/** Whether `steps` whole steps down from `from` to `to` were stopped by the floor (the step is known). */
function floored(c: Ctx, from: number, to: number, steps: number): boolean {
  return c.step !== null && steps > 0 && -stepsFrom(from, to, c.step) < steps;
}

function loadBelow(c: Ctx, from: number, steps: number): number {
  let load = from;
  for (let i = 0; i < steps; i++) {
    load = stepDown(load, c.step);
  }
  return roundLoad(load);
}

function finish(
  c: Ctx,
  stage: Stage,
  row: DecisionRow,
  parts: {
    candidate: number | null;
    conservative: number | null;
    reason: string;
    confidence?: Confidence;
    next: NextStep;
  },
): Decision {
  const rec = (load: number | null): Recommendation => ({ load, unit: load === null ? null : c.unit, reps: c.reps });
  const notes =
    c.step === null && parts.candidate !== null ? [`${EQUIPMENT_STEP} missing — steps cannot be computed`] : [];
  const missing = [...c.missing];
  if (notes.length > 0 && !missing.includes(EQUIPMENT_STEP)) {
    missing.push(EQUIPMENT_STEP);
  }
  return {
    stage,
    row,
    outcome: parts.candidate === null ? 'conservative start' : stepsWord(stepsFrom(c.base, parts.candidate, c.step)),
    candidate: rec(parts.candidate),
    conservative: rec(parts.conservative),
    reason: [parts.reason, ...notes].join('; '),
    confidence: parts.confidence ?? confidenceOf(c.facts, missing),
    missing,
    tactic: 'none active',
    scheme: { id: c.scheme.id, version: c.scheme.version },
    gap: c.gap,
    ladder: c.ladder,
    next: parts.next,
  };
}

/**
 * Design §5 branch table: the reason selects the return branch, the tier its depth. No reason given (null:
 * breaks off, or no break fact considered) = the tier's standard ladder; `unknown` = one step lower.
 */
function reasonBranch(reason: BreakReason | null): { extraSteps: number; note: string | null } {
  switch (reason) {
    case 'unknown':
      return { extraSteps: 1, note: 'reason unknown — one step lower' };
    case 'illness':
      return { extraSteps: 1, note: 'illness — one step lower, well-being check before the first workout' };
    case 'stress_poor_sleep':
      return { extraSteps: 0, note: 'stress / poor sleep — caution for the first week' };
    default:
      return { extraSteps: 0, note: null };
  }
}

function gapRow(c: Ctx): Decision | null {
  if (c.ladder === null) {
    return null;
  }
  const basis = c.ladderBasis;
  if (c.ladder.coldStart) {
    return finish(c, 'A', 'gap_restart', {
      candidate: null,
      conservative: null,
      reason: `restart tier (${basis}; general norm): history is a dated reference only — cold start`,
      confidence: 'low',
      next: { kind: 'ladder', remaining: LADDER.rebuild.workouts, backTo: c.base, cold: true },
    });
  }
  const { tier } = c.ladder;
  // Post-restart rungs follow the rebuild ladder, so they are the rebuild row.
  const row: DecisionRow = tier === 'return' ? 'gap_return' : 'gap_rebuild';
  const branch = reasonBranch(c.breakReason);
  const requested = c.ladder.stepsBelow + branch.extraSteps;
  const candidate = loadBelow(c, c.base, requested);
  const base = confidenceOf(c.facts, c.missing);
  const reason = `${tier} tier (${basis}; general norm), return workout ${c.ladder.workout} of ${c.ladder.of}`;
  return finish(c, 'A', row, {
    candidate,
    conservative: loadBelow(c, candidate, 1),
    reason: branch.note
      ? `${reason}; ${floored(c, c.base, candidate, requested) ? `${branch.note.split(' — ')[0]} — ${NO_LIGHTER}` : branch.note}`
      : reason,
    confidence: tier === 'rebuild' || tier === 'restart' ? 'low' : oneLevelDown(base),
    next: { kind: 'ladder', remaining: c.ladder.of - c.ladder.workout, backTo: c.base, cold: false },
  });
}

function constraintRow(c: Ctx): Decision | null {
  const constraint = c.facts.constraints.constraints.find(x => x.durability === 'short');
  return constraint
    ? finish(c, 'A', 'short_constraint', {
        candidate: c.base,
        conservative: loadBelow(c, c.base, 1),
        reason: `short constraint (${constraint.text}) — no growth`,
        next: { kind: 'constraint' },
      })
    : null;
}

/** The lower candidate is the more conservative one (no load = a cold start, the lowest); a tie keeps the first. */
function moreConservative(a: Decision, b: Decision): Decision {
  return (b.candidate.load ?? Number.NEGATIVE_INFINITY) < (a.candidate.load ?? Number.NEGATIVE_INFINITY) ? b : a;
}

/**
 * Uneven performance (item 6): the drop-off at the working weight (first − last set reps) is far above the user's usual
 * — more than `usual + 3`, or more than 4 when there is no norm. The performance then counts neither for growth nor
 * for a step down. Null = even (or no drop-off to judge).
 */
function unevenDropOff(facts: LoadFacts): { value: number; usual: number | null; maxDrop: number } | null {
  const last = facts.lastExposure;
  if (isAbsent(last) || isAbsent(last.dropOff)) {
    return null;
  }
  const { value, usual } = last.dropOff;
  const maxDrop = usual === null ? UNEVEN_WITHOUT_NORM : usual + UNEVEN_ABOVE_USUAL;
  return value > maxDrop ? { value, usual, maxDrop } : null;
}

function stageA(c: Ctx): Decision | null {
  // Fix-S: a short constraint and a gap row can both match; the more conservative of the two is the decision.
  const safety = [constraintRow(c), gapRow(c)].filter((d): d is Decision => d !== null);
  if (safety.length > 0) {
    return safety.reduce(moreConservative);
  }
  const delta = preFatigueDelta(c.facts);
  if (delta !== null && delta >= PRE_FATIGUE_MATERIAL_SETS) {
    const heavy = delta >= PRE_FATIGUE_HEAVY_SETS;
    const candidate = heavy ? loadBelow(c, c.base, 1) : c.base;
    const stepWord = floored(c, c.base, candidate, 1) ? NO_LIGHTER : 'one step down';
    const move = heavy ? stepWord : 'hold';
    return finish(c, 'A', 'pre_fatigue', {
      candidate,
      conservative: loadBelow(c, candidate, 1),
      reason: `${delta} more working sets on a shared muscle today than before the reference — ${move}`,
      next: { kind: 'pre_fatigue', load: c.base },
    });
  }
  const uneven = unevenDropOff(c.facts);
  if (uneven !== null) {
    return finish(c, 'A', 'uneven_performance', {
      candidate: c.base,
      conservative: loadBelow(c, c.base, 1),
      reason: `uneven sets at the working weight: reps fell by ${uneven.value} from the first to the last set (usual ${uneven.usual ?? 'not known'}) — the opening set was probably too light for this load; the performance counts neither for growth nor for a step down — hold`,
      next: { kind: 'uneven', load: c.base, maxDrop: uneven.maxDrop },
    });
  }
  const last = c.facts.lastExposure;
  if (!isAbsent(last) && !isAbsent(last.repsVsRange) && last.repsVsRange === 'below floor') {
    const candidate = loadBelow(c, c.base, 1);
    return finish(c, 'A', 'below_floor', {
      candidate,
      conservative: loadBelow(c, c.base, 2),
      reason: `last exposure below the rep floor — ${floored(c, c.base, candidate, 1) ? NO_LIGHTER : 'one step down'}`,
      next: { kind: 'step_down', backTo: c.base, atLoad: candidate, reps: c.reps.min },
    });
  }
  return null;
}

/** The reference performance's load: the load used in most of its working sets, the heavier on a tie. */
function referenceLoad(facts: LoadFacts): { weight: number; unit: 'kg' | 'lbs' | null } | null {
  if (isAbsent(facts.reference)) {
    return null;
  }
  const counts = new Map<number, { count: number; unit: 'kg' | 'lbs' | null }>();
  for (const { setData } of facts.reference.sets) {
    if (setData.type === 'strength' && setData.weight !== undefined && setData.weight > 0) {
      const seen = counts.get(setData.weight);
      counts.set(setData.weight, { count: (seen?.count ?? 0) + 1, unit: setData.weightUnit ?? null });
    }
  }
  const [best] = [...counts.entries()].sort(([wa, a], [wb, b]) => b.count - a.count || wb - wa);
  return best ? { weight: best[0], unit: best[1].unit } : null;
}

/**
 * Stage A "insufficient data" (no working weight). With a reference that carried a load, the number is the
 * reference's (one step down after a break tier) with one step lower as the conservative option, low confidence,
 * and the reason says why; with no reference there is no number and no conservative option.
 */
function insufficientData(
  facts: LoadFacts,
  reps: Recommendation['reps'],
  gap: GapTierInfo,
  meta: Pick<Decision, 'scheme' | 'tactic' | 'gap'>,
  why: string,
): Decision {
  const base = { ...meta, stage: 'A' as const, row: 'insufficient_data' as const, ladder: null };
  const ref = referenceLoad(facts);
  if (isAbsent(facts.reference) || ref === null) {
    return {
      ...noRecord(reps, [WORKING_WEIGHT]),
      ...base,
      outcome: 'no number',
      reason: NO_RECORD_REASON,
      next: { kind: 'no_number' },
    };
  }
  const step = stepOf(facts);
  const afterBreak = gap.tier === 'return' || gap.tier === 'rebuild' || gap.tier === 'restart';
  const candidate = afterBreak ? stepDown(ref.weight, step) : ref.weight;
  const rec = (load: number): Recommendation => ({ load, unit: ref.unit, reps });
  const tierName = `${gap.tier} tier (${gap.days ?? 0} d since ${gap.basis ?? 'last workout'}, general norm)`;
  const heldByFloor = afterBreak && step !== null && candidate === ref.weight;
  const tier = !afterBreak ? '' : `; ${tierName} — ${heldByFloor ? NO_LIGHTER : 'one step below it'}`;
  const stepNote = step === null ? [`${EQUIPMENT_STEP} missing — steps cannot be computed`] : [];
  let outcome = 'reference load';
  if (afterBreak) {
    outcome = heldByFloor ? 'reference load, no lighter option' : 'one step below the reference';
  }
  return {
    ...base,
    outcome,
    candidate: rec(candidate),
    conservative: rec(stepDown(candidate, step)),
    reason: [
      `${why}; last performance ${ref.weight} ${ref.unit ?? 'kg'} ${facts.reference.daysAgo} d ago used as the reference${tier}`,
      ...stepNote,
    ].join('; '),
    confidence: 'low',
    missing: step === null ? [WORKING_WEIGHT, EQUIPMENT_STEP] : [WORKING_WEIGHT],
    next: { kind: 'insufficient', why },
  };
}

function repsText(reps: number[]): string {
  return reps.every(r => r === reps[0]) ? `${reps.length}×${reps[0]}` : `${reps.join(', ')} reps`;
}

/**
 * Item 5, one-session growth (APRE-style): the LAST set at the working weight of the newest performance beat the range
 * top by `ONE_SESSION_SURPLUS` reps, its RPE ≤ 8 or absent, recovered (gap tier `rest`; a short constraint, a gap row,
 * material pre-fatigue and an uneven performance already ended in Stage A) → one step up, never more, with the range
 * reps. Conservative = the working weight, confidence at most medium. Range schemes only (a fixed-rep scheme has no
 * "above the range"); null = the scheme's answer stands.
 */
function earlyGrowth(c: Ctx, params: SchemeParams, out: SchemeOutput): SchemeOutput | null {
  const history = c.facts.repHistory;
  if (isAbsent(history) || params.fixedReps !== undefined || c.gap.tier !== 'rest') {
    return null;
  }
  const [newest] = history.entries;
  const last = newest ? lastSetReps(newest) : null;
  const { reps } = out.candidate;
  if (!newest || last === null || last < reps.max + ONE_SESSION_SURPLUS) {
    return null;
  }
  if (newest.lastSetRpe !== null && newest.lastSetRpe > ONE_SESSION_MAX_RPE) {
    return null;
  }
  const growth = stepUp(c.base, c.step, params.stepCapPct);
  if (growth.kind !== 'grow') {
    return null;
  }
  const unit = c.unit ?? 'kg';
  const rpe = newest.lastSetRpe === null ? '' : ` at RPE ${newest.lastSetRpe}`;
  return {
    candidate: { load: growth.load, unit: c.unit, reps },
    conservative: { load: c.base, unit: c.unit, reps },
    reason: `last set at the working weight ${last} reps${rpe} (range top ${reps.max} + ${ONE_SESSION_SURPLUS} or more; ${repsText(newest.repsAtWorkingWeight)} at ${c.base} ${unit} ${newest.daysAgo} d ago); recovered (${c.gap.days ?? 0} d since ${c.gap.basis ?? 'last workout'}, no short constraint, no material pre-fatigue) — one step up`,
    confidence: LEVELS[Math.min(LEVELS.indexOf('medium'), LEVELS.indexOf(confidenceOf(c.facts, out.missing)))],
    missing: out.missing,
    next: { kind: 'after_growth', load: growth.load, reps: reps.max },
  };
}

function rowOf(early: boolean, grew: boolean): DecisionRow {
  if (early) {
    return 'early_growth';
  }
  return grew ? 'scheme_growth' : 'scheme_hold';
}

export function decide(facts: LoadFacts, input: DecideInput): Decision {
  const { scheme, goal } = input;
  const params = input.params ?? scheme.defaultParams(goal);
  const gap = gapTierFacts(facts);
  const reps = targetReps(facts, params);
  const meta = { scheme: { id: scheme.id, version: scheme.version }, tactic: 'none active' as const, gap };

  if (isAbsent(facts.workingWeight)) {
    return insufficientData(facts, reps, gap, meta, facts.workingWeight.absent);
  }
  const ctx: Ctx = {
    facts,
    base: facts.workingWeight.weight,
    unit: facts.workingWeight.unit,
    step: stepOf(facts),
    reps,
    missing: [],
    gap,
    ladder: null,
    ladderBasis: '',
    breakReason: input.breakReason ?? null,
    scheme,
  };
  // The current gap wins; else the ladder the newest past gap opened, while it still has rungs.
  const current = returnLadderStep(gap.tier, input.ladderWorkoutsSince ?? 0);
  if (current) {
    ctx.ladder = current;
    ctx.ladderBasis = `${gap.days ?? 0} d since ${gap.basis ?? 'last workout'}`;
  } else if (input.ladder) {
    ctx.ladder = returnLadderStep(input.ladder.tier, input.ladder.workoutsSince);
    ctx.ladderBasis = `${input.ladder.gapDays} d gap before the last workout`;
  }
  if (ctx.step === null) {
    ctx.missing.push(EQUIPMENT_STEP);
  }
  const safety = stageA(ctx);
  if (safety) {
    return safety;
  }
  // Stage B: no tactic until layer 2 (U12); `tactic: none active` is printed.
  const schemeOut = scheme.decide(facts, goal, params);
  const grew = schemeOut.candidate.load !== null && schemeOut.candidate.load > ctx.base;
  const early = grew ? null : earlyGrowth(ctx, params, schemeOut);
  const out = early ?? schemeOut;
  return {
    ...out,
    ...meta,
    stage: 'C',
    row: rowOf(early !== null, grew),
    outcome: stepsWord(stepsFrom(ctx.base, out.candidate.load, ctx.step)),
    ladder: ctx.ladder,
  };
}
