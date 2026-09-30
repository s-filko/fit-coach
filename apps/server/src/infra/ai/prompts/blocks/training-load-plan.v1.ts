/**
 * `training.load_plan` v1 (load-facts plan D2, D3, D5): computed facts about each of today's
 * exercises — reference performance, fatigue context, working weight, e1RM trend, last-exposure
 * quality, gap, constraints, equipment step. The block recommends nothing; the pure numbers come
 * from `@domain/training/load-facts`. `renderLoadPlanEntry` is the one producer: the block and the
 * `get_load_plan` tool both call it. Set text reuses `formatSetData`, dates `formatDateAge`.
 */
import {
  type FatigueFact,
  type GapDays,
  isAbsent,
  type LoadFacts,
  type Metric,
  type ReferenceFact,
  type RepRangeFact,
} from '@domain/training/load-facts';

import type { LoadPlanEntry } from '@infra/ai/load-facts/load-facts.loader';

import { type ExerciseHistoryEntry, formatDateAge } from './training-exercise-history.v1';
import { formatSetData } from './training-workout-overview.v1';
import type { ContextBlock, ContextBlockCtx } from './types';

export const LOAD_PLAN_HEADER = '=== LOAD PLAN (computed facts — no recommendation) ===';

const SEP = ' · ';
const BAND_TEXT = '±2.5 %';

export interface RenderLoadPlanOpts {
  /**
   * D2: the `session_exercises` row EXERCISE HISTORY prints for this exercise. When the reference
   * performance is that row, the block prints `sets as in EXERCISE HISTORY` instead of the sets.
   * The tool passes nothing — it has no EXERCISE HISTORY beside it.
   */
  historyRowId?: string | null;
  /** false = leave the `today:` line out (the zero-LLM report has no live session). Default true. */
  showToday?: boolean;
  /** v2 (load-plan D6): `omit` leaves the equipment facts out — the block prints them once. Default `entry`. */
  equipment?: 'entry' | 'omit';
  /** v2 (load-plan D6): `plain` words a negative drop-off as "none (reps rose)". Default `raw`. */
  dropOff?: 'raw' | 'plain';
  /** v2 (load-plan D6): print the e1RM trend's span (performances over N days). Default false. */
  e1rmSpan?: boolean;
}

function orReason<T>(metric: Metric<T>, render: (v: T) => string): string {
  return isAbsent(metric) ? metric.absent : render(metric);
}

function fatigueText(f: FatigueFact): string {
  if (f.fresh) {
    return 'fresh (1st exercise)';
  }
  const parts = f.perMuscle.map(
    m => `${m.workingSets} working sets on ${m.muscleGroup} (${m.exerciseNames.join(', ')})`,
  );
  return `after ${parts.join(', ')}`;
}

function minutesText(f: FatigueFact, suffix: string): string {
  return orReason(f.minutesIntoSession, m => `${m} min ${suffix}`);
}

function referenceLine(facts: LoadFacts, ctx: ContextBlockCtx, opts: RenderLoadPlanOpts): string {
  const ref = facts.reference;
  if (isAbsent(ref)) {
    return `reference: ${ref.absent}`;
  }
  const r = ref;
  const sameRow = opts.historyRowId != null && opts.historyRowId === r.performance.id;
  const parts = [
    formatDateAge(r.performance.performedAt, ctx),
    sameRow ? 'sets as in EXERCISE HISTORY' : r.sets.map(s => formatSetData(s.setData)).join('; '),
  ];
  if (r.rpe.length > 0) {
    parts.push(`RPE ${[...new Set(r.rpe)].join('/')}`);
  }
  if (r.feedback.length > 0) {
    parts.push([...new Set(r.feedback)].map(f => `"${f}"`).join(' '));
  }
  if (r.likeForLike !== true) {
    parts.push(`(not like-for-like: ${r.likeForLike.notLikeForLike.join(', ')})`);
  }
  if (r.warmupsEstimated) {
    parts.push('(warm-ups estimated)');
  }
  const fatigue = facts.fatigueReference;
  if (!isAbsent(fatigue)) {
    parts.push(fatigueText(fatigue), minutesText(fatigue, 'in'));
  }
  return `reference: ${parts.join(SEP)}`;
}

function todayLine(facts: LoadFacts): string {
  const f = facts.fatigueToday;
  const parts = [fatigueText(f), minutesText(f, 'into the session')];
  if (f.sameAsReference) {
    parts.push('same as reference');
  }
  return `today: ${parts.join(SEP)}`;
}

function metricsLine(facts: LoadFacts, opts: RenderLoadPlanOpts): string {
  const ww = orReason(
    facts.workingWeight,
    w => `working weight ${w.weight} ${w.unit ?? 'kg'} (${w.performances} performances / 8 wk)`,
  );
  const parts = [isAbsent(facts.workingWeight) ? `working weight: ${ww}` : ww];
  const e = facts.e1rmTrend;
  if (isAbsent(e)) {
    parts.push(`e1RM: ${e.absent}`);
  } else {
    const t = e;
    const trend =
      t.trend === 'flat'
        ? `flat ×${t.flatRun} (${BAND_TEXT})`
        : `${t.trend} (${t.changePct >= 0 ? '+' : ''}${t.changePct.toFixed(1)} %)`;
    parts.push(
      `e1RM ${t.newest.toFixed(1)} ${trend}, ${t.weeksAtWeight} wk at ${t.currentLoad} ${t.currentLoadUnit ?? 'kg'}`,
    );
    if (opts.e1rmSpan) {
      parts.push(`e1RM over ${t.performances} performances / ${t.spanDays} d`);
    }
    if (t.lowConfidence) {
      parts.push(`low confidence: ${t.lowConfidence}`);
    }
    if (t.mixedBasisExcluded > 0) {
      parts.push(`${t.mixedBasisExcluded} performance(s) with mixed per-hand/total loads left out`);
    }
  }
  const estimated =
    (!isAbsent(facts.workingWeight) && (facts.workingWeight as { warmupsEstimated: boolean }).warmupsEstimated) ||
    (!isAbsent(e) && (e as { warmupsEstimated: boolean }).warmupsEstimated);
  return `metrics: ${parts.join(SEP)}${estimated ? ' (warm-ups estimated)' : ''}`;
}

function rangeText(range: Metric<RepRangeFact>): string {
  if (isAbsent(range)) {
    return range.absent;
  }
  const r = range;
  const span = r.min === r.max ? `${r.min}` : `${r.min}–${r.max}`;
  return `range ${span} (${r.source === 'today' ? "today's plan" : "reference performance's plan"})`;
}

function dropOffText(drop: { value: number; usual: number | null }, opts: RenderLoadPlanOpts): string {
  const value = opts.dropOff === 'plain' && drop.value < 0 ? 'none (reps rose)' : `${drop.value}`;
  return `drop-off ${value}${drop.usual === null ? '' : ` vs your usual ${drop.usual}`}`;
}

function qualityLine(facts: LoadFacts, opts: RenderLoadPlanOpts): string {
  const q = facts.lastExposure;
  if (isAbsent(q)) {
    return `quality: ${q.absent}`;
  }
  const quality = q;
  const ref = facts.reference as ReferenceFact;
  const reps = ref.sets.flatMap(s => ('reps' in s.setData ? [s.setData.reps] : []));
  const lastReps = reps.length > 0 ? `last ${reps.join(', ')}` : null;
  const parts: string[] = [];
  if (isAbsent(quality.repsVsRange)) {
    parts.push(...[lastReps, quality.repsVsRange.absent].filter((p): p is string => p !== null));
  } else {
    parts.push(`${lastReps ?? 'last'} vs ${rangeText(facts.repRange)} — ${quality.repsVsRange as string}`);
  }
  const drop = quality.dropOff;
  parts.push(
    isAbsent(drop) ? `drop-off: ${drop.absent}` : dropOffText(drop as { value: number; usual: number | null }, opts),
  );
  return `quality: ${parts.join(SEP)}`;
}

function gapText(label: string, g: GapDays): string {
  return `${label} ${orReason(g, v => `${v.days} d`)}`;
}

function gapLine(entry: LoadPlanEntry): string {
  const g = entry.facts.gap;
  const primary = [...new Set(entry.exercise.muscles.filter(m => m.involvement === 'primary').map(m => m.muscleGroup))];
  return `gap: ${[
    gapText('exercise', g.exercise),
    gapText(`primary muscles (${primary.join(', ')})`, g.primaryMuscles),
    gapText('any workout', g.anyWorkout),
  ].join(SEP)}`;
}

function constraintsLine(facts: LoadFacts, opts: RenderLoadPlanOpts): string {
  const c = facts.constraints;
  const constraints =
    c.constraints.length === 0
      ? 'none'
      : c.constraints.map(x => `${x.text} (${x.muscleGroup}, ${x.durability})`).join('; ');
  const equipment = c.equipment.length === 0 ? 'none' : c.equipment.join('; ');
  return opts.equipment === 'omit'
    ? `constraints: ${constraints}`
    : `constraints: ${constraints}${SEP}equipment facts: ${equipment}`;
}

function stepLine(facts: LoadFacts): string {
  return `step: ${orReason(facts.equipmentStep, s => `${s.step} ${s.unit}${s.perHand ? ' per hand' : ''} (${s.basis})`)}`;
}

function dataLine(facts: LoadFacts): string {
  const d = facts.dataSufficiency;
  return `data: ${d.last56Days} performances in 8 wk, ${d.allTime} all-time`;
}

/** One exercise's entry: header plus the eight fact lines. Never recommends a weight. */
export function renderLoadPlanEntry(entry: LoadPlanEntry, ctx: ContextBlockCtx, opts: RenderLoadPlanOpts = {}): string {
  const { facts } = entry;
  const lines = [
    `${facts.exerciseName} [ID:${facts.exerciseId}]`,
    referenceLine(facts, ctx, opts),
    ...(opts.showToday === false ? [] : [todayLine(facts)]),
    metricsLine(facts, opts),
    ...(isAbsent(facts.reference) ? [] : [qualityLine(facts, opts)]),
    gapLine(entry),
    constraintsLine(facts, opts),
    stepLine(facts),
    dataLine(facts),
  ];
  return lines.map((l, i) => (i === 0 ? l : `  ${l}`)).join('\n');
}

export interface TrainingLoadPlanData {
  loadPlan: LoadPlanEntry[];
  exerciseHistory: ExerciseHistoryEntry[];
}

/**
 * `=== LOAD PLAN ===` — one entry per today's exercise (plan order, then off-plan started), placed
 * after RECENT WORKOUTS (D5). Null when there is nothing to show.
 */
export const TRAINING_LOAD_PLAN_V1: ContextBlock<TrainingLoadPlanData> = {
  id: 'training.load_plan',
  version: 'v1',
  render(data, ctx) {
    if (data.loadPlan.length === 0) {
      return null;
    }
    const historyRowOf = new Map(data.exerciseHistory.map(h => [h.exerciseId, h.performance?.id ?? null]));
    const entries = data.loadPlan.map(e =>
      renderLoadPlanEntry(e, ctx, { historyRowId: historyRowOf.get(e.exercise.id) ?? null }),
    );
    return `${LOAD_PLAN_HEADER}\n\n${entries.join('\n\n')}`;
  },
};
