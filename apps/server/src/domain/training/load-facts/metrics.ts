import { calendarDaysAgo } from '@shared/date-utils';

import { workingSets } from '../sets';
import type { MuscleGroup } from '../types';

import { parseRepRange } from './rep-range';
import {
  type ConstraintsFact,
  type DataSufficiency,
  type E1rmTrendFact,
  type EffortFact,
  type EquipmentStepFact,
  type ExerciseInput,
  type FatigueFact,
  type GapDays,
  type GapFact,
  type IndicativeLoadFact,
  isAbsent,
  type LastExposureFact,
  type LoadFacts,
  type LoadFactsContext,
  type Metric,
  type NotLikeForLikeReason,
  type OtherSetInput,
  type PerformanceInput,
  type ReferenceFact,
  type RepHistoryFact,
  type RepRange,
  type RepRangeFact,
  type RepsVsRange,
  type SetInput,
  type TodayInput,
  type VolumeFact,
  type WorkingWeightFact,
  type WorkoutSummaryInput,
} from './types';

// --- Parameters (D6–D9) ---

const WINDOW_DAYS = 56;
const WORKING_WEIGHT_K = 5;
const RECURRING_PERFORMANCES = 2;
const E1RM_WINDOW = 5;
const E1RM_MIN_PERFORMANCES = 3;
const E1RM_MAX_REPS = 10;
const TREND_BAND = 0.025;
const BAND_EPSILON = 1e-9;
const WARMUP_FRACTION = 0.6;
const REP_TOLERANCE = 2;
const NORM_WINDOW = 5;
const NORM_MIN = 3;
const MS_PER_MINUTE = 60_000;
const DAYS_PER_WEEK = 7;
const EPLEY_DIVISOR = 30;
const HALF = 2;
const MAX_RPE = 10;
/** Reps in reserve counted toward capacity stop at 3 — the plain answer "3+" maps to RPE 7 (EFFORT_RPE_BY_ANSWER). */
const MAX_RESERVE = 3;
/** RPE at or below this is "three or more reps left" (RPE ≤ 7): a stop below the floor is an early stop. */
const EARLY_STOP_MAX_RPE = 7;
const PERCENT = 100;

const STEP_BY_EQUIPMENT = { barbell: 2.5, dumbbell: 2, machine: 5, cable: 5 } as const;

const NO_RECORD = 'no completed record';
const NO_RANGE = 'no rep range';

// --- Shared helpers ---

function absent(reason: string): { absent: string } {
  return { absent: reason };
}

function notApplicable(exercise: ExerciseInput): { absent: string } {
  return absent(`n/a for ${exercise.exerciseType}`);
}

interface LoadedSet {
  weight: number;
  reps: number;
  rpe: number | null;
  unit: 'kg' | 'lbs' | null;
  perHand: boolean;
}

/** A strength set with a positive weight, or null (load metrics only ever see these). */
function loadOf(set: Pick<SetInput, 'setData'> & { rpe?: number | null }): LoadedSet | null {
  const d = set.setData;
  if (d.type !== 'strength' || d.weight === undefined || d.weight <= 0) {
    return null;
  }
  return {
    weight: d.weight,
    reps: d.reps,
    rpe: set.rpe ?? null,
    unit: d.weightUnit ?? null,
    perHand: d.perHand === true,
  };
}

/** Reps of a rep-counted set (strength, functional_reps), else null. */
/**
 * Capacity of a set = reps + reps in reserve, RIR = 10 − RPE (Helms et al. 2016/2018: RPE 10 = no reps left, 8 = two).
 * No RPE → the reps themselves (nothing is inferred); RPE above 10 counts as 10.
 */
export function capacityOf(reps: number, rpe: number | null): number {
  return rpe === null ? reps : reps + Math.min(MAX_RESERVE, Math.max(0, MAX_RPE - rpe));
}

/** Capacity of a rep-counted set, else null. */
function capacityOfSet(set: SetInput): number | null {
  const reps = repsOf(set);
  return reps === null ? null : capacityOf(reps, set.rpe);
}

function repsOf(set: SetInput): number | null {
  const d = set.setData;
  return d.type === 'strength' || d.type === 'functional_reps' ? d.reps : null;
}

function byTime<T extends { createdAt: Date }>(sets: T[]): T[] {
  return [...sets].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
}

function normalizePlace(place: string | null): string | null {
  const t = (place ?? '').trim().toLowerCase();
  return t.length > 0 ? t : null;
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / HALF);
  return s.length % HALF ? s[mid] : (s[mid - 1] + s[mid]) / HALF;
}

function epley(weight: number, reps: number): number {
  return weight * (1 + reps / EPLEY_DIVISOR);
}

/**
 * D7: working sets of one performance. Explicit `warmup` never counts, explicit `working` always
 * does; a legacy NULL strength set under 60 % of the performance's top weight is an *estimated*
 * warm-up (`estimated` is true only when that heuristic actually dropped a set).
 */
export function classifySets<T extends Pick<SetInput, 'setData' | 'setKind' | 'createdAt'>>(
  sets: T[],
): { working: T[]; estimated: boolean } {
  const candidates = workingSets(sets);
  const top = Math.max(0, ...candidates.map(s => loadOf(s)?.weight ?? 0));
  let estimated = false;
  const working = candidates.filter(s => {
    const load = s.setKind ? null : loadOf(s);
    if (load && load.weight < WARMUP_FRACTION * top) {
      estimated = true;
      return false;
    }
    return true;
  });
  return { working: byTime(working), estimated };
}

interface RealPerformance {
  p: PerformanceInput;
  working: SetInput[];
  estimated: boolean;
  daysAgo: number;
}

/** Real performances (≥ 1 working set), today's session excluded, newest first. */
function realPerformances(
  perfs: PerformanceInput[],
  todaySessionId: string,
  now: Date,
  tz: string | null,
): RealPerformance[] {
  return perfs
    .filter(p => p.sessionId !== todaySessionId)
    .map(p => ({ p, ...classifySets(p.sets), daysAgo: calendarDaysAgo(p.performedAt, now, tz) }))
    .filter(r => r.working.length > 0)
    .sort((a, b) => b.p.performedAt.getTime() - a.p.performedAt.getTime());
}

function loadedSets(r: RealPerformance): LoadedSet[] {
  return r.working.map(loadOf).filter((l): l is LoadedSet => l !== null);
}

function isMixedBasis(loads: LoadedSet[]): boolean {
  return new Set(loads.map(l => l.perHand)).size > 1;
}

interface LoadPerformance extends RealPerformance {
  loads: LoadedSet[];
}

/** Performances with weighted working sets; per-hand/total mixes are split off and counted. */
function loadPerformances(reals: RealPerformance[]): { usable: LoadPerformance[]; mixedBasisExcluded: number } {
  const withLoads = reals.map(r => ({ ...r, loads: loadedSets(r) })).filter(r => r.loads.length > 0);
  const usable = withLoads.filter(r => !isMixedBasis(r.loads));
  return { usable, mixedBasisExcluded: withLoads.length - usable.length };
}

// --- Metric 1 ---

export function computeDataSufficiency(
  perfs: PerformanceInput[],
  todaySessionId: string,
  now: Date,
  tz: string | null,
  allTime: number | undefined,
): DataSufficiency {
  const reals = realPerformances(perfs, todaySessionId, now, tz);
  return {
    last56Days: reals.filter(r => r.daysAgo <= WINDOW_DAYS).length,
    allTime: allTime ?? reals.length,
  };
}

// --- Metric 2 (D6) ---

function topWorkingSet(working: SetInput[]): SetInput {
  return working.reduce((best, s) => {
    const a = loadOf(s);
    const b = loadOf(best);
    const better =
      a && b
        ? a.weight > b.weight || (a.weight === b.weight && a.reps > b.reps)
        : (repsOf(s) ?? 0) > (repsOf(best) ?? 0);
    return better ? s : best;
  });
}

function likeForLikeFailures(r: RealPerformance, today: TodayInput, range: RepRange | null): NotLikeForLikeReason[] {
  const failures: NotLikeForLikeReason[] = [];
  const mine = normalizePlace(today.place);
  const theirs = normalizePlace(r.p.place);
  if (mine && theirs && mine !== theirs) {
    failures.push('place');
  }
  const topReps = repsOf(topWorkingSet(r.working));
  if (range && topReps !== null && (topReps < range.min - REP_TOLERANCE || topReps > range.max + REP_TOLERANCE)) {
    failures.push('reps');
  }
  return failures;
}

export function computeReference(
  perfs: PerformanceInput[],
  today: TodayInput,
  range: RepRange | null,
  now: Date,
  tz: string | null,
): Metric<ReferenceFact> {
  const candidates = realPerformances(perfs, today.sessionId, now, tz);
  if (candidates.length === 0) {
    return absent(NO_RECORD);
  }
  const scored = candidates.map(c => ({ c, failures: likeForLikeFailures(c, today, range) }));
  const pick = scored.find(s => s.failures.length === 0) ?? scored[0];
  const { c, failures } = pick;
  return {
    performance: c.p,
    daysAgo: c.daysAgo,
    sets: c.working,
    likeForLike: failures.length === 0 ? true : { notLikeForLike: failures },
    warmupsEstimated: c.estimated,
    rpe: c.working.map(s => s.rpe).filter((v): v is number => v !== null),
    feedback: c.working.map(s => s.userFeedback).filter((v): v is string => !!v),
  };
}

// --- Metric 3 ---

/** D7 per other exercise of the session: explicit kinds first, legacy NULL sets by the < 60 % rule. */
function workingOtherSets(others: OtherSetInput[]): OtherSetInput[] {
  const byExercise = new Map<string, OtherSetInput[]>();
  for (const o of others) {
    byExercise.set(o.exerciseRowId, [...(byExercise.get(o.exerciseRowId) ?? []), o]);
  }
  return [...byExercise.values()].flatMap(sets => classifySets(sets).working);
}

export function computeFatigue(
  exercise: ExerciseInput,
  slice: Pick<TodayInput, 'startedAt' | 'sets' | 'otherSets'>,
  now: Date,
): FatigueFact {
  const own = byTime(slice.sets);
  const cutoff = own[0]?.createdAt ?? now;
  const earlier = workingOtherSets(slice.otherSets)
    .filter(o => o.createdAt.getTime() < cutoff.getTime())
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const muscles = [...new Set(exercise.muscles.map(m => m.muscleGroup))];
  const perMuscle = muscles
    .map(muscleGroup => {
      const sets = earlier.filter(o => o.muscles.some(m => m.muscleGroup === muscleGroup));
      return { muscleGroup, workingSets: sets.length, exerciseNames: [...new Set(sets.map(s => s.exerciseName))] };
    })
    .filter(m => m.workingSets > 0)
    .sort((a, b) => b.workingSets - a.workingSets || a.muscleGroup.localeCompare(b.muscleGroup));
  return { perMuscle, fresh: perMuscle.length === 0, minutesIntoSession: minutesIntoSession(slice, own, cutoff) };
}

function minutesIntoSession(
  slice: Pick<TodayInput, 'startedAt' | 'otherSets'>,
  own: SetInput[],
  end: Date,
): Metric<number> {
  const stamps = [...own, ...slice.otherSets].map(s => s.createdAt.getTime());
  const start = slice.startedAt?.getTime() ?? (stamps.length > 0 ? Math.min(...stamps) : null);
  if (start === null) {
    return absent('no session start');
  }
  return Math.max(0, Math.round((end.getTime() - start) / MS_PER_MINUTE));
}

function sameFatigue(a: FatigueFact, b: FatigueFact): boolean {
  const key = (f: FatigueFact): string =>
    f.perMuscle
      .map(m => `${m.muscleGroup}:${m.workingSets}`)
      .sort()
      .join(',');
  return key(a) === key(b);
}

// --- Metric 4 ---

export function computeWorkingWeight(
  perfs: PerformanceInput[],
  todaySessionId: string,
  range: RepRange | null,
  exercise: ExerciseInput,
  now: Date,
  tz: string | null,
): Metric<WorkingWeightFact> {
  if (exercise.exerciseType !== 'strength') {
    return notApplicable(exercise);
  }
  const inWindow = realPerformances(perfs, todaySessionId, now, tz).filter(r => r.daysAgo <= WINDOW_DAYS);
  const { usable, mixedBasisExcluded } = loadPerformances(inWindow);
  const used = usable.slice(0, WORKING_WEIGHT_K);
  if (used.length < HALF) {
    return absent(`insufficient: ${used.length} performances / 8 wk`);
  }
  if (!range) {
    return absent(NO_RANGE);
  }
  const best = pickWorkingLoad(used, range.min, equipmentStepOf(exercise, perfs, todaySessionId, now, tz));
  if (!best) {
    return absent('no load reached the rep floor');
  }
  return {
    weight: best.weight,
    unit: best.unit,
    performances: used.length,
    warmupsEstimated: used.some(r => r.estimated),
    mixedBasisExcluded,
    ...(best.estimatedFrom ? { estimatedFrom: best.estimatedFrom } : {}),
  };
}

/**
 * Indirect estimate (owner-approved 2026-10-01): when the newest performance fell short of the floor at a heavier load
 * (60×6, 55×7 for 8–10) no load "reached" it, yet the sets say what would. Epley e1RM of the working sets up to
 * `E1RM_MAX_REPS` reps (reliable below ~10, Reynolds 2006) — the LOWEST of them, the cautious reading, so a too-heavy
 * opener does not lift it — converted to the load for the range MIN reps and rounded DOWN to the equipment step. No
 * known step → no estimate. `from` names the set it was read from.
 */
function indirectEstimate(
  newest: LoadPerformance,
  floor: number,
  stepFact: Metric<{ step: number }>,
): { weight: number; unit: 'kg' | 'lbs' | null; from: { weight: number; reps: number } } | null {
  if (isAbsent(stepFact)) {
    return null;
  }
  // Capacity (reps + reps in reserve) is what the set shows; no formula above E1RM_MAX_REPS of it.
  const sets = newest.loads.filter(l => capacityOf(l.reps, l.rpe) >= 1 && capacityOf(l.reps, l.rpe) <= E1RM_MAX_REPS);
  if (sets.length === 0) {
    return null;
  }
  const e1rm = (l: LoadedSet): number => epley(l.weight, capacityOf(l.reps, l.rpe));
  const lowest = sets.reduce((a, b) => (e1rm(b) < e1rm(a) ? b : a));
  // Only a set that fell short of the floor asks for a lighter load; a set that reached it is already what the reached
  // load says (80×10 for 8–12 must not be "estimated" up to 82.5).
  if (capacityOf(lowest.reps, lowest.rpe) >= floor) {
    return null;
  }
  // The target is the floor, but never above the reps the formula is trusted for (a 12–15 range targets 10 reps).
  const load = e1rm(lowest) / (1 + Math.min(floor, E1RM_MAX_REPS) / EPLEY_DIVISOR);
  const weight = roundDownToStep(load, stepFact.step);
  return weight > 0 ? { weight, unit: lowest.unit, from: { weight: lowest.weight, reps: lowest.reps } } : null;
}

/**
 * The working-weight reading of one set of performances: the reached load, or the indirect estimate from the NEWEST
 * performance when it is higher (a short set asked for a lighter load than the one tried, but heavier than anything
 * reached). One place for both `computeWorkingWeight` and `computeIndicativeLoad`.
 */
function pickWorkingLoad(
  used: LoadPerformance[],
  floor: number,
  step: Metric<{ step: number }>,
): { weight: number; unit: 'kg' | 'lbs' | null; estimatedFrom?: { weight: number; reps: number } } | null {
  const reached = qualifyingLoad(used, floor);
  const estimate = indirectEstimate(used[0], floor, step);
  if (estimate !== null && (!reached || estimate.weight > reached.weight)) {
    return { weight: estimate.weight, unit: estimate.unit, estimatedFrom: estimate.from };
  }
  return reached ? { weight: reached.weight, unit: reached.unit } : null;
}

/** Round down to the load grid; the epsilon keeps an exact grid value (55.0000000001 or 54.99999999) on its step. */
function roundDownToStep(load: number, step: number): number {
  const GRID_EPSILON = 1e-6;
  return Math.round(Math.floor(load / step + GRID_EPSILON) * step * 1000) / 1000;
}

/**
 * The working weight = the highest ELIGIBLE load among those at which every set at that load reached the floor.
 * Eligible: the load RECURS (appears in the sets of at least `RECURRING_PERFORMANCES` performances) — so one stray
 * heavier set in a single older session (replay C1, a lone 5 kg set before four 2.5 kg sessions) is not the working
 * weight — or the NEWEST performance reached it (the owner moved up and the weight follows, item 4). When no load
 * recurs at all (a pyramid, singles) every reached load is eligible. Recurrence counts presence, not success, and a
 * reached load is only ever added by more reps — so more reps never lower the working weight (W-22 (1), W-23). Nothing
 * eligible → null; the indirect estimate (a short set) or "no load reached the floor" speaks instead.
 */
function qualifyingLoad(used: LoadPerformance[], floor: number): LoadedSet | null {
  const reached = used.map(r =>
    r.loads.filter(l => r.loads.filter(o => o.weight === l.weight).every(o => capacityOf(o.reps, o.rpe) >= floor)),
  );
  const presence = (weight: number): number => used.filter(r => r.loads.some(l => l.weight === weight)).length;
  const highest = (sets: LoadedSet[]): LoadedSet | null =>
    sets.reduce<LoadedSet | null>((best, l) => (!best || l.weight > best.weight ? l : best), null);
  const anyRecurs = used.some(r => r.loads.some(l => presence(l.weight) >= RECURRING_PERFORMANCES));
  const recurring = reached.flat().filter(l => presence(l.weight) >= RECURRING_PERFORMANCES);
  return highest([...recurring, ...(reached[0] ?? []), ...(anyRecurs ? [] : reached.flat())]);
}

// --- Metric 5 ---

function bestE1rm(r: LoadPerformance): number | null {
  const sets = r.loads.filter(l => l.reps >= 1 && l.reps <= E1RM_MAX_REPS);
  return sets.length > 0 ? Math.max(...sets.map(l => epley(l.weight, l.reps))) : null;
}

function topLoad(r: LoadPerformance): number {
  return Math.max(...r.loads.map(l => l.weight));
}

export function computeE1rmTrend(
  perfs: PerformanceInput[],
  todaySessionId: string,
  exercise: ExerciseInput,
  now: Date,
  tz: string | null,
): Metric<E1rmTrendFact> {
  if (exercise.exerciseType !== 'strength') {
    return notApplicable(exercise);
  }
  const { usable, mixedBasisExcluded } = loadPerformances(realPerformances(perfs, todaySessionId, now, tz));
  const scored = usable
    .map(r => ({ r, e1rm: bestE1rm(r) }))
    .filter((s): s is { r: LoadPerformance; e1rm: number } => s.e1rm !== null);
  if (scored.length < E1RM_MIN_PERFORMANCES) {
    return absent(`insufficient: ${scored.length} performances`);
  }
  const window = scored.slice(0, E1RM_WINDOW);
  const newest = window[0].e1rm;
  const oldest = window[window.length - 1].e1rm;
  const change = (newest - oldest) / oldest;
  const within = (v: number): boolean => Math.abs(v - newest) / newest <= TREND_BAND + BAND_EPSILON;
  let flatRun = 0;
  while (flatRun < window.length && within(window[flatRun].e1rm)) {
    flatRun++;
  }
  const trend = trendOf(change);
  return {
    newest,
    oldest,
    changePct: change * 100,
    trend,
    flatRun,
    currentLoad: topLoad(usable[0]),
    currentLoadUnit: usable[0].loads.find(l => l.weight === topLoad(usable[0]))?.unit ?? null,
    weeksAtWeight: weeksAtCurrentWeight(usable, tz),
    performances: window.length,
    spanDays: calendarDaysAgo(window[window.length - 1].r.p.performedAt, window[0].r.p.performedAt, tz),
    lowConfidence: exercise.equipment === 'machine' || exercise.equipment === 'cable' ? 'machine' : null,
    warmupsEstimated: window.some(s => s.r.estimated),
    mixedBasisExcluded,
  };
}

function trendOf(change: number): E1rmTrendFact['trend'] {
  if (change > TREND_BAND + BAND_EPSILON) {
    return 'rising';
  }
  return change < -TREND_BAND - BAND_EPSILON ? 'falling' : 'flat';
}

function weeksAtCurrentWeight(usable: LoadPerformance[], tz: string | null): number {
  const load = topLoad(usable[0]);
  let end = 0;
  while (end + 1 < usable.length && topLoad(usable[end + 1]) === load) {
    end++;
  }
  const days = calendarDaysAgo(usable[end].p.performedAt, usable[0].p.performedAt, tz);
  return Math.floor(days / DAYS_PER_WEEK);
}

// --- Metric 4a (insufficient-data path) ---

/**
 * What the newest single performance points to (golden-table ruling G-11): its qualifying load (the highest load at
 * which every set at that load reached the floor) or the indirect estimate from a short set, whichever is higher — a
 * failed opener (60×6 before 55×7, 45×12) is never the recommendation. No minimum count, no window: this serves the
 * insufficient-data path, where the reference load is what the coach has.
 */
export function computeIndicativeLoad(
  perfs: PerformanceInput[],
  todaySessionId: string,
  range: RepRange | null,
  exercise: ExerciseInput,
  now: Date,
  tz: string | null,
): Metric<IndicativeLoadFact> {
  if (exercise.exerciseType !== 'strength') {
    return notApplicable(exercise);
  }
  if (!range) {
    return absent(NO_RANGE);
  }
  const [newest] = loadPerformances(realPerformances(perfs, todaySessionId, now, tz)).usable;
  if (!newest) {
    return absent(NO_RECORD);
  }
  const picked = pickWorkingLoad([newest], range.min, equipmentStepOf(exercise, perfs, todaySessionId, now, tz));
  if (picked) {
    return picked;
  }
  // Nothing reached the floor and no estimate (unknown step): the newest performance's most-used load (heavier on tie).
  const counts = new Map<number, { count: number; unit: 'kg' | 'lbs' | null }>();
  for (const l of newest.loads) {
    counts.set(l.weight, { count: (counts.get(l.weight)?.count ?? 0) + 1, unit: l.unit });
  }
  const [best] = [...counts.entries()].sort(([wa, a], [wb, b]) => b.count - a.count || wb - wa);
  return best ? { weight: best[0], unit: best[1].unit } : absent('no load reached the rep floor');
}

// --- Metric 4b ---

/**
 * Sets at the working weight per performance (load-plan-fixes items 5–7), the same performances as metric 4, newest
 * first: the evidence for the growth rule. A set at another load (a probe, a too-heavy opener) is not in it.
 */
export function computeRepHistory(
  perfs: PerformanceInput[],
  todaySessionId: string,
  workingWeight: Metric<WorkingWeightFact>,
  exercise: ExerciseInput,
  now: Date,
  tz: string | null,
): Metric<RepHistoryFact> {
  if (exercise.exerciseType !== 'strength') {
    return notApplicable(exercise);
  }
  if (isAbsent(workingWeight)) {
    return absent('no working weight');
  }
  const inWindow = realPerformances(perfs, todaySessionId, now, tz).filter(r => r.daysAgo <= WINDOW_DAYS);
  const used = loadPerformances(inWindow).usable.slice(0, WORKING_WEIGHT_K);
  return {
    weight: workingWeight.weight,
    unit: workingWeight.unit,
    entries: used.map(r => {
      const atWeight = r.working.filter(s => loadOf(s)?.weight === workingWeight.weight);
      return {
        daysAgo: r.daysAgo,
        repsAtWorkingWeight: atWeight.map(s => repsOf(s) ?? 0),
        lastSetRpe: atWeight[atWeight.length - 1]?.rpe ?? null,
      };
    }),
  };
}

// --- Metric 10 (context only) ---

/**
 * Volume load (Σ reps × load of the working sets) of the newest performance against the previous one. Printed as
 * context (load-plan-fixes item 8); no decision reads it. Mixed per-hand/total performances are left out, as in
 * metrics 4–5; the performances are not limited to the 56-day window — their ages are printed.
 */
export function computeVolume(
  perfs: PerformanceInput[],
  todaySessionId: string,
  exercise: ExerciseInput,
  now: Date,
  tz: string | null,
): Metric<VolumeFact> {
  if (exercise.exerciseType !== 'strength') {
    return notApplicable(exercise);
  }
  const { usable } = loadPerformances(realPerformances(perfs, todaySessionId, now, tz));
  if (usable.length < HALF) {
    return absent('fewer than 2 performances with a load');
  }
  const [newest, previous] = usable.map(r => ({
    volume: r.loads.reduce((sum, l) => sum + l.reps * l.weight, 0),
    daysAgo: r.daysAgo,
  }));
  return {
    unit: usable[0].loads[0].unit,
    newest,
    previous,
    changePct: ((newest.volume - previous.volume) / previous.volume) * PERCENT,
  };
}

// --- Metric 6 ---

/** Sets at `weight` when there are any (a set at another load is a probe); else all sets, as before. */
function atLoad(working: SetInput[], weight: number | undefined): SetInput[] {
  const own = weight === undefined ? [] : working.filter(s => loadOf(s)?.weight === weight);
  return own.length > 0 ? own : working;
}

/**
 * Sets at exactly `weight`; with a known working weight and none at it, nothing — the effort rows judge sets AT the
 * working weight only (a probe, or a session at another load, is not an early stop or a miss at this one). Without a
 * working weight, all sets, as before.
 */
function onlyAtLoad(working: SetInput[], weight: number | undefined): SetInput[] {
  return weight === undefined ? working : working.filter(s => loadOf(s)?.weight === weight);
}

function dropOffOf(allWorking: SetInput[], weight?: number): number | null {
  const working = atLoad(allWorking, weight);
  const loads = working.map(loadOf);
  const top = Math.max(0, ...loads.map(l => l?.weight ?? 0));
  const sets = working.filter((s, i) => repsOf(s) !== null && (top === 0 || loads[i]?.weight === top));
  if (sets.length < HALF) {
    return null;
  }
  return (capacityOfSet(sets[0]) ?? 0) - (capacityOfSet(sets[sets.length - 1]) ?? 0);
}

function belowFloorSets(working: SetInput[], range: RepRange): SetInput[] {
  return working.filter(s => (capacityOfSet(s) ?? Infinity) < range.min);
}

/**
 * Effort of the newest performance (item 10; golden-table ruling G-06/07). Early stop: a set below the floor at RPE ≤ 7
 * while nothing is below the floor by capacity. Unclear: below-floor sets exist and NONE has an RPE — an early stop
 * cannot be told from a failure, so hold and ask the first time; when the previous performance at this load was also
 * below the floor without RPE (`repeated`), it is a real miss.
 */
function effortOf(working: SetInput[], range: RepRange | null, repeated: boolean): EffortFact {
  const none: EffortFact = { earlyStop: false, unclearBelowFloor: false, set: null };
  if (!range) {
    return none;
  }
  const below = belowFloorSets(working, range);
  const early = working.find(s => (repsOf(s) ?? Infinity) < range.min && s.rpe !== null && s.rpe <= EARLY_STOP_MAX_RPE);
  const earlyStop = below.length === 0 && early !== undefined;
  const unclearBelowFloor = below.length > 0 && below.every(s => s.rpe === null) && !repeated;
  const set = earlyStop ? early : below.find(() => unclearBelowFloor);
  return { earlyStop, unclearBelowFloor, set: set ? { reps: repsOf(set) ?? 0, rpe: set.rpe } : null };
}

/** The previous performance at this load was also below the floor, with no RPE on any below-floor set. */
function previousBelowWithoutRpe(
  earlier: PerformanceInput[],
  range: RepRange | null,
  workingWeight: number | undefined,
): boolean {
  if (!range) {
    return false;
  }
  const previous = [...earlier]
    .sort((a, b) => b.performedAt.getTime() - a.performedAt.getTime())
    .map(p => onlyAtLoad(classifySets(p.sets).working, workingWeight))
    .find(w => w.length > 0);
  const below = previous ? belowFloorSets(previous, range) : [];
  return below.length > 0 && below.every(s => s.rpe === null);
}

function repsVsRange(working: SetInput[], range: RepRange | null): Metric<RepsVsRange> {
  if (!range) {
    return absent(NO_RANGE);
  }
  const reps = working.map(capacityOfSet).filter((v): v is number => v !== null);
  if (reps.length === 0) {
    return absent('no reps recorded');
  }
  const weakest = Math.min(...reps);
  if (weakest < range.min) {
    return 'below floor';
  }
  return weakest >= range.max ? 'at or above top' : 'in range';
}

export function computeLastExposure(
  reference: PerformanceInput,
  earlier: PerformanceInput[],
  range: RepRange | null,
  exercise: ExerciseInput,
  workingWeight?: number,
): LastExposureFact {
  const { working: allWorking, estimated } = classifySets(reference.sets);
  // Each load is judged on its own sets: a probe at another load (a too-heavy opener) must not read as "below floor".
  const working = atLoad(allWorking, workingWeight);
  const rpe = working.map(s => s.rpe).filter((v): v is number => v !== null);
  const rpeFact = rpe.length > 0 ? { values: rpe } : absent('no RPE recorded');
  if (exercise.exerciseType !== 'strength' && exercise.exerciseType !== 'functional_reps') {
    return {
      effort: { earlyStop: false, unclearBelowFloor: false, set: null },
      repsVsRange: notApplicable(exercise),
      rpe: rpeFact,
      dropOff: notApplicable(exercise),
      warmupsEstimated: estimated,
    };
  }
  const value = dropOffOf(working);
  const atWeight = workingWeight !== undefined && working.some(s => loadOf(s)?.weight === workingWeight);
  return {
    effort: effortOf(
      onlyAtLoad(allWorking, workingWeight),
      range,
      previousBelowWithoutRpe(earlier, range, workingWeight),
    ),
    repsVsRange: repsVsRange(working, range),
    rpe: rpeFact,
    dropOff:
      value === null
        ? absent(`fewer than 2 sets at the ${atWeight ? 'working weight' : 'top load'}`)
        : { value, usual: usualDropOff(earlier, atWeight ? workingWeight : undefined) },
    warmupsEstimated: estimated,
  };
}

function usualDropOff(earlier: PerformanceInput[], weight?: number): number | null {
  const drops = [...earlier]
    .sort((a, b) => b.performedAt.getTime() - a.performedAt.getTime())
    .map(p => classifySets(p.sets).working)
    // At a given load only the performances that used it count towards the usual.
    .filter(w => weight === undefined || w.some(s => loadOf(s)?.weight === weight))
    .map(w => dropOffOf(w, weight))
    .filter((v): v is number => v !== null)
    .slice(0, NORM_WINDOW);
  return drops.length >= NORM_MIN ? median(drops) : null;
}

// --- Metric 7 ---

function gapDays(date: Date | undefined, now: Date, tz: string | null, missing: string): GapDays {
  return date ? { days: calendarDaysAgo(date, now, tz) } : absent(missing);
}

function newest(dates: Date[]): Date | undefined {
  return dates.reduce<Date | undefined>((best, d) => (!best || d.getTime() > best.getTime() ? d : best), undefined);
}

export function computeGap(
  exercise: ExerciseInput,
  perfs: PerformanceInput[],
  workouts: WorkoutSummaryInput[],
  todaySessionId: string,
  now: Date,
  tz: string | null,
): GapFact {
  const primary = new Set<MuscleGroup>(
    exercise.muscles.filter(m => m.involvement === 'primary').map(m => m.muscleGroup),
  );
  const past = workouts.filter(w => w.sessionId !== todaySessionId);
  const reals = realPerformances(perfs, todaySessionId, now, tz);
  const none = 'none in the last 60 workouts';
  return {
    exercise: gapDays(newest(reals.map(r => r.p.performedAt)), now, tz, NO_RECORD),
    primaryMuscles: gapDays(
      newest(past.filter(w => w.primaryMuscles.some(m => primary.has(m))).map(w => w.performedAt)),
      now,
      tz,
      none,
    ),
    anyWorkout: gapDays(newest(past.map(w => w.performedAt)), now, tz, none),
  };
}

// --- Metrics 8, 9 ---

export function computeConstraints(exercise: ExerciseInput, context: LoadFactsContext): ConstraintsFact {
  const muscles = new Set(exercise.muscles.map(m => m.muscleGroup));
  const primary = new Set(exercise.muscles.filter(m => m.involvement === 'primary').map(m => m.muscleGroup));
  return {
    constraints: context.constraints
      .filter(c => c.muscleGroup !== null && muscles.has(c.muscleGroup))
      .map(c => ({ ...c, onPrimary: c.muscleGroup !== null && primary.has(c.muscleGroup) })),
    equipment: [...context.equipmentFacts],
  };
}

const MIN_STEP_KG = 0.5;

/**
 * The step the recorded working loads actually use (orchestrator ruling 2026-10-01): when a load is not a multiple of
 * the default step, the step is the largest value that divides every recorded load — on a 0.25 kg grid, never above the
 * default, never below 0.5 kg. Evidence = the working loads of each performance of the last 8 weeks; an off-grid load
 * counts only when it occurs in at least two performances (a lone 22.7 / 20.4 kg set is an outlier, not a step).
 * Null = the default stands.
 */
const LOAD_TOLERANCE_KG = 0.1;
/** The step may be at most this multiple of the default (lb dumbbells logged in kg run ≈ 2.3 kg apart against 2). */
const STEP_MAX_FACTOR = 2;
const STEP_RESOLUTION = 100;

/** The load sits within the tolerance of a (positive) multiple of `step`. */
function onGrid(load: number, step: number): boolean {
  const k = Math.max(1, Math.round(load / step));
  return Math.abs(load - k * step) <= LOAD_TOLERANCE_KG + 1e-9;
}

type StepFromHistory = { kind: 'default' } | { kind: 'step'; step: number } | { kind: 'unknown' };

/**
 * The step the recorded working loads actually use (orchestrator ruling run 5 R3, W-37). Only CONFIRMED loads count —
 * a working load present in ≥ 2 performances of the last 8 weeks. Every recorded load on the default grid → the
 * default. Otherwise the step is the smallest positive difference between two adjacent distinct confirmed loads,
 * accepted in [0.5 kg, 2 × default] when at least two confirmed loads exist (17.5 / 20 / 22.5 → 2.5; lb dumbbells
 * 20.4 / 22.7 → 2.3). Anything else → unknown: the default would print loads that never existed (22.7 ± 2).
 */
function stepFromHistory(defaultStep: number, loadsByPerformance: number[][]): StepFromHistory {
  const presence = new Map<number, number>();
  for (const perfLoads of loadsByPerformance) {
    for (const l of new Set(perfLoads)) {
      presence.set(l, (presence.get(l) ?? 0) + 1);
    }
  }
  if ([...presence.keys()].every(l => onGrid(l, defaultStep))) {
    return { kind: 'default' };
  }
  const confirmed = [...presence.entries()]
    .filter(([, n]) => n >= RECURRING_PERFORMANCES)
    .map(([l]) => l)
    .sort((a, b) => a - b);
  if (confirmed.length >= 2) {
    const smallest = Math.min(...confirmed.slice(1).map((l, i) => l - confirmed[i]));
    const step = Math.round(smallest * STEP_RESOLUTION) / STEP_RESOLUTION;
    if (step >= MIN_STEP_KG && step <= defaultStep * STEP_MAX_FACTOR) {
      return { kind: 'step', step };
    }
  }
  return { kind: 'unknown' };
}

export function computeEquipmentStep(exercise: ExerciseInput, loadsByPerformance: number[][] = []): EquipmentStepFact {
  if (exercise.exerciseType !== 'strength') {
    return notApplicable(exercise);
  }
  if (exercise.equipment === 'bodyweight' || exercise.equipment === 'none') {
    return absent(`n/a for ${exercise.equipment}`);
  }
  const fallback = STEP_BY_EQUIPMENT[exercise.equipment];
  const history = stepFromHistory(fallback, loadsByPerformance);
  if (history.kind === 'unknown') {
    return absent('recorded loads do not fit one step');
  }
  return {
    step: history.kind === 'step' ? history.step : fallback,
    unit: 'kg',
    perHand: exercise.equipment === 'dumbbell',
    basis: history.kind === 'step' ? 'from history' : `default for ${exercise.equipment}`,
    // Owner ruling O-2, narrowed (W-32): only a machine's displayed load excludes its own (unknown) weight; a cable
    // stack shows the real load, so the cap stays.
    capApplies: exercise.equipment !== 'machine',
  };
}

/** Distinct working loads of the last 8 weeks, ascending. */
function recordedLoadsOf(perfs: PerformanceInput[], todaySessionId: string, now: Date, tz: string | null): number[] {
  const recent = realPerformances(perfs, todaySessionId, now, tz).filter(r => r.daysAgo <= WINDOW_DAYS);
  return [...new Set(recent.flatMap(r => loadedSets(r).map(l => l.weight)))].sort((a, b) => a - b);
}

/** The step of the exercise given its real performances of the last 8 weeks (the evidence of "from history"). */
function equipmentStepOf(
  exercise: ExerciseInput,
  perfs: PerformanceInput[],
  todaySessionId: string,
  now: Date,
  tz: string | null,
): EquipmentStepFact {
  const recent = realPerformances(perfs, todaySessionId, now, tz).filter(r => r.daysAgo <= WINDOW_DAYS);
  return computeEquipmentStep(
    exercise,
    recent.map(r => loadedSets(r).map(l => l.weight)),
  );
}

// --- Assembly ---

function resolveRepRange(today: TodayInput, reference: Metric<ReferenceFact>): Metric<RepRangeFact> {
  const mine = parseRepRange(today.targetReps);
  if (mine) {
    return { ...mine, source: 'today' };
  }
  const theirs = 'absent' in reference ? null : parseRepRange(reference.performance.targetReps);
  return theirs ? { ...theirs, source: 'reference' } : absent(NO_RANGE);
}

/**
 * The nine load metrics for one exercise (design §3.2, plan D6–D10). Pure: `now` and `timezone`
 * are arguments; performances may come in any order and may include today's session (ignored).
 */
export function computeLoadFacts(
  exercise: ExerciseInput,
  performances: PerformanceInput[],
  today: TodayInput,
  context: LoadFactsContext,
  now: Date,
  timezone: string | null,
): LoadFacts {
  const todayId = today.sessionId;
  const todayRange = parseRepRange(today.targetReps);
  const reference = computeReference(performances, today, todayRange, now, timezone);
  const repRange = resolveRepRange(today, reference);
  const range: RepRange | null = 'absent' in repRange ? null : { min: repRange.min, max: repRange.max };
  const fatigueToday = computeFatigue(exercise, today, now);
  // Pre-fatigue is measured against the NEWEST performance, like the safety rows (W-13) — not the like-for-like pick.
  const [newestReal] = realPerformances(performances, todayId, now, timezone);
  const fatigueReference = newestReal ? computeFatigue(exercise, newestReal.p, now) : absent(NO_RECORD);
  if (!('absent' in fatigueReference)) {
    fatigueToday.sameAsReference = sameFatigue(fatigueToday, fatigueReference);
  }
  const workingWeight = computeWorkingWeight(performances, todayId, range, exercise, now, timezone);
  return {
    exerciseId: exercise.id,
    exerciseName: exercise.name,
    dataSufficiency: computeDataSufficiency(performances, todayId, now, timezone, context.allTimePerformances),
    repRange,
    reference,
    fatigueReference,
    fatigueToday,
    workingWeight,
    indicativeLoad: computeIndicativeLoad(performances, todayId, range, exercise, now, timezone),
    e1rmTrend: computeE1rmTrend(performances, todayId, exercise, now, timezone),
    repHistory: computeRepHistory(performances, todayId, workingWeight, exercise, now, timezone),
    volume: computeVolume(performances, todayId, exercise, now, timezone),
    lastExposure: lastExposureOf(performances, todayId, now, timezone, range, exercise, workingWeight),
    gap: computeGap(exercise, performances, context.workouts, todayId, now, timezone),
    constraints: computeConstraints(exercise, context),
    equipmentStep: equipmentStepOf(exercise, performances, todayId, now, timezone),
    recordedLoads: recordedLoadsOf(performances, todayId, now, timezone),
  };
}

/**
 * Last-exposure quality of the NEWEST real performance — the one growth reads too (W-13). The reference (like-for-like
 * pick, D6) may be an older session; the safety rows must not judge a session the user has already moved past.
 */
function lastExposureOf(
  performances: PerformanceInput[],
  todaySessionId: string,
  now: Date,
  tz: string | null,
  range: RepRange | null,
  exercise: ExerciseInput,
  workingWeight: Metric<WorkingWeightFact>,
): Metric<LastExposureFact> {
  const [newest] = realPerformances(performances, todaySessionId, now, tz);
  if (!newest) {
    return absent(NO_RECORD);
  }
  const newestTime = newest.p.performedAt.getTime();
  const earlier = performances.filter(
    p => p.sessionId !== newest.p.sessionId && p.sessionId !== todaySessionId && p.performedAt.getTime() < newestTime,
  );
  return computeLastExposure(
    newest.p,
    earlier,
    range,
    exercise,
    isAbsent(workingWeight) ? undefined : workingWeight.weight,
  );
}
