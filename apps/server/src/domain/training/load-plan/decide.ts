import { isAbsent, type LoadFacts } from '../load-facts';

import { gapTierFacts, type GapTierInfo, type LadderStep, returnLadderStep } from './gap-tier';
import type { Confidence, ProgressionScheme, Recommendation, SchemeGoal, SchemeOutput, SchemeParams } from './schemes';
import {
  confidenceOf,
  EQUIPMENT_STEP,
  NO_RECORD_REASON,
  noRecord,
  roundLoad,
  stepDown,
  stepOf,
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
  | 'below_floor'
  | 'scheme_growth'
  | 'scheme_hold';

export const ROW_LABELS: Record<DecisionRow, string> = {
  insufficient_data: 'insufficient data',
  short_constraint: 'short constraint',
  gap_return: 'gap tier return',
  gap_rebuild: 'gap tier rebuild',
  gap_restart: 'gap tier restart',
  pre_fatigue: 'pre-fatigue delta',
  below_floor: 'last below range floor',
  scheme_growth: 'scheme growth',
  scheme_hold: 'scheme hold',
};

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
  /** Real workouts since the gap (Task 4's counter); default 0 = first rung. */
  ladderWorkoutsSince?: number;
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
  scheme: ProgressionScheme;
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
  parts: { candidate: number | null; conservative: number | null; reason: string; confidence?: Confidence },
): Decision {
  const rec = (load: number | null): Recommendation => ({ load, unit: load === null ? null : c.unit, reps: c.reps });
  const notes =
    c.step === null && parts.candidate !== null ? [`${EQUIPMENT_STEP} missing — steps cannot be computed`] : [];
  const missing = [...c.missing];
  if (notes.length > 0 && !missing.includes(EQUIPMENT_STEP)) {
    missing.push(EQUIPMENT_STEP);
  }
  const steps = parts.candidate === null ? null : (parts.candidate - c.base) / (c.step ?? Number.POSITIVE_INFINITY);
  return {
    stage,
    row,
    outcome: parts.candidate === null ? 'conservative start' : stepsWord(Math.round(steps ?? 0)),
    candidate: rec(parts.candidate),
    conservative: rec(parts.conservative),
    reason: [parts.reason, ...notes].join('; '),
    confidence: parts.confidence ?? confidenceOf(c.facts, missing),
    missing,
    tactic: 'none active',
    scheme: { id: c.scheme.id, version: c.scheme.version },
    gap: c.gap,
    ladder: c.ladder,
  };
}

function gapRow(c: Ctx): Decision | null {
  const { tier } = c.gap;
  const days = c.gap.days ?? 0;
  if (c.ladder === null) {
    return null;
  }
  const basis = `${days} d since ${c.gap.basis ?? 'last workout'}`;
  if (c.ladder.coldStart) {
    return finish(c, 'A', 'gap_restart', {
      candidate: null,
      conservative: null,
      reason: `restart tier (${basis}; general norm): history is a dated reference only — cold start`,
      confidence: 'low',
    });
  }
  const row: DecisionRow = tier === 'rebuild' ? 'gap_rebuild' : 'gap_return';
  const candidate = loadBelow(c, c.base, c.ladder.stepsBelow);
  const base = confidenceOf(c.facts, c.missing);
  return finish(c, 'A', row, {
    candidate,
    conservative: loadBelow(c, candidate, 1),
    reason: `${tier} tier (${basis}; general norm), return workout ${c.ladder.workout} of ${c.ladder.of}`,
    confidence: tier === 'rebuild' ? 'low' : oneLevelDown(base),
  });
}

function stageA(c: Ctx): Decision | null {
  const constraint = c.facts.constraints.constraints.find(x => x.durability === 'short');
  if (constraint) {
    return finish(c, 'A', 'short_constraint', {
      candidate: c.base,
      conservative: loadBelow(c, c.base, 1),
      reason: `short constraint (${constraint.text}) — no growth`,
    });
  }
  const gap = gapRow(c);
  if (gap) {
    return gap;
  }
  const delta = preFatigueDelta(c.facts);
  if (delta !== null && delta >= PRE_FATIGUE_MATERIAL_SETS) {
    const heavy = delta >= PRE_FATIGUE_HEAVY_SETS;
    const candidate = heavy ? loadBelow(c, c.base, 1) : c.base;
    return finish(c, 'A', 'pre_fatigue', {
      candidate,
      conservative: loadBelow(c, candidate, 1),
      reason: `${delta} more working sets on a shared muscle today than before the reference — ${heavy ? 'one step down' : 'hold'}`,
    });
  }
  const last = c.facts.lastExposure;
  if (!isAbsent(last) && !isAbsent(last.repsVsRange) && last.repsVsRange === 'below floor') {
    const candidate = loadBelow(c, c.base, 1);
    return finish(c, 'A', 'below_floor', {
      candidate,
      conservative: loadBelow(c, c.base, 2),
      reason: 'last exposure below the rep floor — one step down',
    });
  }
  return null;
}

export function decide(facts: LoadFacts, input: DecideInput): Decision {
  const { scheme, goal } = input;
  const params = input.params ?? scheme.defaultParams(goal);
  const gap = gapTierFacts(facts);
  const reps = targetReps(facts, params);
  const meta = { scheme: { id: scheme.id, version: scheme.version }, tactic: 'none active' as const, gap };

  if (isAbsent(facts.workingWeight)) {
    return {
      ...noRecord(reps, [WORKING_WEIGHT]),
      ...meta,
      stage: 'A',
      row: 'insufficient_data',
      outcome: 'conservative start',
      reason: NO_RECORD_REASON,
      ladder: null,
    };
  }
  const ctx: Ctx = {
    facts,
    base: facts.workingWeight.weight,
    unit: facts.workingWeight.unit,
    step: stepOf(facts),
    reps,
    missing: [],
    gap,
    ladder: returnLadderStep(gap.tier, input.ladderWorkoutsSince ?? 0),
    scheme,
  };
  if (ctx.step === null) {
    ctx.missing.push(EQUIPMENT_STEP);
  }
  const safety = stageA(ctx);
  if (safety) {
    return safety;
  }
  // Stage B: no tactic until layer 2 (U12); `tactic: none active` is printed.
  const out = scheme.decide(facts, goal, params);
  const grew = out.candidate.load !== null && out.candidate.load > ctx.base;
  return {
    ...out,
    ...meta,
    stage: 'C',
    row: grew ? 'scheme_growth' : 'scheme_hold',
    outcome: stepsWord(
      out.candidate.load === null || ctx.step === null ? 0 : Math.round((out.candidate.load - ctx.base) / ctx.step),
    ),
    ladder: ctx.ladder,
  };
}
