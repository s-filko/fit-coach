/**
 * `training.today` / `training.history` v1 (coach-simplification I1, AC-CS1-1): the two fact blocks the new
 * training turn carries in the `<context>` part of the client's message.
 *
 * Principle P2/P3: dated facts only — no recommendation, verdict, reason, target or next step. An effort value
 * that was not logged is rendered as absent, never guessed. Dates are natural relative days in the user's
 * calendar (no time of day for earlier workouts). Pure (BR-LLM-007): no I/O, no clock reads — `ctx.now` only.
 */
import type { ExerciseLastPerformance } from '@domain/training/ports';
import { isRetroLog, lastActivityOf } from '@domain/training/session-timing';
import { workingSets } from '@domain/training/sets';
import type {
  SessionExerciseWithDetails,
  SessionSet,
  SetData,
  WorkoutSessionWithDetails,
} from '@domain/training/types';
import type { UserFact } from '@domain/user/ports';

import { calendarDaysAgo, formatInUserTz } from '@shared/date-utils';

import type { ContextBlock, ContextBlockCtx } from './types';

export const TRAINING_TODAY_HEADER = '# Today (sets as reps×kg)';
export const TRAINING_HISTORY_HEADER = '# History (before today; sets as reps×kg)';

/** One of today's exercises with its last performances (newest first, today excluded) — the History block's unit. */
export interface ExerciseHistory {
  exerciseId: string;
  /** The catalog name (it wins over the plan's). */
  exerciseName: string;
  /** `4×12` — null = the exercise is not in today's plan (off plan). */
  plannedText: string | null;
  /** At most three, newest first. */
  performances: ExerciseLastPerformance[];
  /** The newest `skipped` row for this exercise, if any. */
  lastSkippedAt: Date | null;
}

export interface TrainingFactsData {
  session: WorkoutSessionWithDetails;
  history: ExerciseHistory[];
  lastWorkout: { completedAt: Date; exerciseNames: string[] } | null;
  /** The client's stored facts for the system message's `# Profile` (`renderTrainingProfile`); the blocks ignore it. */
  profileFacts: UserFact[];
}

const MONTH_WORDS = [
  'zero',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
] as const;

function tzOf(ctx: ContextBlockCtx): string {
  return ctx.timezone ?? ctx.user?.timezone ?? 'UTC';
}

/** `Sunday Sep 27` (with ` 2025` when `withYear`) — the calendar day in the user's timezone. */
function dayLabel(date: Date, tz: string, withYear = false): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).formatToParts(date);
  const get = (type: string): string => parts.find(p => p.type === type)?.value ?? '';
  return `${get('weekday')} ${get('month')} ${get('day')}${withYear ? ` ${get('year')}` : ''}`;
}

/** `Sep 27` (or `Sep 27 2025`) — the short date used in trend headers. */
function shortDate(date: Date, tz: string, withYear: boolean): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).formatToParts(date);
  const get = (type: string): string => parts.find(p => p.type === type)?.value ?? '';
  return `${get('month')} ${get('day')}${withYear ? ` ${get('year')}` : ''}`;
}

function yearOf(date: Date, tz: string): string {
  return formatInUserTz(date, tz).dateOnly.slice(0, 4);
}

/**
 * A natural relative day in the user's timezone (calendar days, not 24 h blocks): `today`;
 * `yesterday, Wednesday Sep 30`; `4 days ago, Sunday Sep 27`; from 60 days on
 * `Friday Apr 24, about five months ago` (the year is added when it differs from now's).
 * A date after `now` reads as `today` — an "ago" never goes negative.
 */
export function relativeDay(date: Date, now: Date, tz: string | null): string {
  const zone = tz ?? 'UTC';
  const days = Math.max(0, calendarDaysAgo(date, now, zone));
  if (days === 0) {
    return 'today';
  }
  if (days === 1) {
    return `yesterday, ${dayLabel(date, zone)}`;
  }
  if (days < 60) {
    return `${days} days ago, ${dayLabel(date, zone)}`;
  }
  const months = Math.round(days / 30);
  const monthsText = months <= 12 ? MONTH_WORDS[months] : String(months);
  const withYear = yearOf(date, zone) !== yearOf(now, zone);
  return `${dayLabel(date, zone, withYear)}, about ${monthsText} months ago`;
}

function minutesText(seconds: number): string {
  return seconds < 60 ? `${seconds} s` : `${Math.round(seconds / 60)} min`;
}

/** One set as the facts blocks print it (`reps×kg`, see the block headers). */
export function formatSetShort(setData: SetData): string {
  switch (setData.type) {
    case 'strength': {
      if (setData.weight == null) {
        return `${setData.reps} reps`;
      }
      const unit = setData.weightUnit === 'lbs' ? ' lb' : '';
      return `${setData.reps}×${setData.weight}${unit}${setData.perHand ? ' per hand' : ''}`;
    }
    case 'functional_reps':
      return `${setData.reps} reps`;
    case 'isometric':
      return `${setData.duration} s`;
    case 'cardio_duration':
      return `${minutesText(setData.duration)}${setData.intensity ? `, ${setData.intensity} intensity` : ''}`;
    case 'cardio_distance': {
      const unit = setData.distanceUnit === 'meters' ? 'm' : setData.distanceUnit;
      const base =
        setData.duration > 0
          ? `${setData.distance} ${unit} in ${minutesText(setData.duration)}`
          : `${setData.distance} ${unit}, time not recorded`;
      return setData.inclinePct != null ? `${base}, ${setData.inclinePct}% incline` : base;
    }
    case 'interval': {
      const rounds = setData.rounds ?? 1;
      return `${rounds} ${rounds === 1 ? 'round' : 'rounds'} ${setData.workDuration} s on / ${setData.restDuration} s off`;
    }
    default:
      return JSON.stringify(setData);
  }
}

/** Effort is asked for (and so its absence is stated) only on rep-based sets; holds and cardio never get a note. */
function isEffortRated(setData: SetData): boolean {
  return setData.type === 'strength' || setData.type === 'functional_reps';
}

/**
 * The sets of one exercise on one line: `12×110 (no RPE), 12×130 (RPE 8), …`.
 * RPE rules: when the working sets share one RPE, `— all RPE 9` once; when none is rated, `— no RPE recorded`;
 * when some are rated, an unrated working set says `(no RPE)`. Warm-up sets say `(warm-up)` and are never
 * rated-or-unrated. A set note follows as ` — note: "<text>"`.
 */
export function formatSetsLine(sets: readonly SessionSet[]): string {
  const ordered = [...sets].sort((a, b) => a.setNumber - b.setNumber);
  const working = workingSets(ordered);
  const rpes = working.map(s => s.rpe);
  const rated = rpes.filter((r): r is number => r != null);
  const allSame = working.length >= 2 && rated.length === working.length && new Set(rated).size === 1;
  const effortApplies = working.some(s => isEffortRated(s.setData));

  const items = ordered.map(s => {
    const text = formatSetShort(s.setData);
    if (s.setKind === 'warmup') {
      return `${text} (warm-up)`;
    }
    if (s.rpe != null) {
      return allSame ? text : `${text} (RPE ${s.rpe})`;
    }
    return rated.length > 0 && isEffortRated(s.setData) ? `${text} (no RPE)` : text;
  });

  let line = items.join(', ');
  if (allSame) {
    line += ` — all RPE ${rated[0]}`;
  } else if (rated.length === 0 && effortApplies) {
    line += ' — no RPE recorded';
  }
  for (const s of ordered) {
    if (s.userFeedback) {
      line += ` — note: "${s.userFeedback}"`;
    }
  }
  return line;
}

// --- trend -----------------------------------------------------------------------------------

const nf = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 });

function arrow(values: number[]): string {
  return values.map(v => nf.format(v)).join(' → ');
}

function rangeOf(values: number[]): string {
  const min = Math.min(...values);
  const max = Math.max(...values);
  return min === max ? nf.format(min) : `${nf.format(min)}–${nf.format(max)}`;
}

type TrendKind = 'weighted' | 'reps' | 'hold' | 'duration' | 'distance';

function trendKindOf(sets: readonly SessionSet[]): { kind: TrendKind; unit: string } | null {
  const kinds = new Set<string>();
  let unit = 'kg';
  let perHand = false;
  for (const s of sets) {
    const d = s.setData;
    switch (d.type) {
      case 'strength':
        if (d.weight == null) {
          kinds.add('reps');
        } else {
          kinds.add('weighted');
          unit = d.weightUnit === 'lbs' ? 'lb' : 'kg';
          perHand = perHand || d.perHand === true;
        }
        break;
      case 'functional_reps':
        kinds.add('reps');
        break;
      case 'isometric':
        kinds.add('hold');
        break;
      case 'cardio_duration':
        kinds.add('duration');
        break;
      case 'cardio_distance':
        kinds.add('distance');
        unit = d.distanceUnit === 'meters' ? 'm' : d.distanceUnit;
        break;
      default:
        kinds.add('other');
    }
  }
  if (kinds.size !== 1) {
    return null;
  }
  const kind = [...kinds][0] as TrendKind | 'other';
  if (kind === 'other') {
    return null;
  }
  return { kind, unit: kind === 'weighted' && perHand ? `${unit} per hand` : unit };
}

const sum = (values: number[]): number => values.reduce((a, b) => a + b, 0);

/**
 * `Trend Sep 16 → Sep 21 → Sep 27: …` over the working sets of ≥ 2 performances, oldest → newest; null when there
 * are fewer than two, when a performance has no working set, or when the set types differ between performances.
 * Numbers only — no verdict.
 */
export function trendLine(
  performances: readonly ExerciseLastPerformance[],
  now: Date,
  tz: string | null,
): string | null {
  if (performances.length < 2) {
    return null;
  }
  const zone = tz ?? 'UTC';
  const oldestFirst = [...performances].reverse();
  const perfSets = oldestFirst.map(p => workingSets(p.sessionExercise.sets));
  if (perfSets.some(sets => sets.length === 0)) {
    return null;
  }
  const kinds = perfSets.map(trendKindOf);
  const [first] = kinds;
  if (!first || kinds.some(k => k === null || k.kind !== first.kind || k.unit !== first.unit)) {
    return null;
  }

  const years = new Set([yearOf(now, zone), ...oldestFirst.map(p => yearOf(p.completedAt, zone))]);
  const withYear = years.size > 1;
  const header = `Trend ${oldestFirst.map(p => shortDate(p.completedAt, zone, withYear)).join(' → ')}`;

  const nums = (pick: (d: SetData) => number): number[][] => perfSets.map(sets => sets.map(s => pick(s.setData)));
  const repsOf = (d: SetData): number => ('reps' in d ? d.reps : 0);
  const weightOf = (d: SetData): number => (d.type === 'strength' ? (d.weight ?? 0) : 0);
  const durationOf = (d: SetData): number => ('duration' in d ? d.duration : 0);

  let body: string;
  switch (first.kind) {
    case 'weighted': {
      const weights = nums(weightOf);
      const reps = nums(repsOf);
      const volume = perfSets.map((sets, i) => sum(sets.map((s, j) => (weights[i]?.[j] ?? 0) * (reps[i]?.[j] ?? 0))));
      body =
        `top weight ${arrow(weights.map(w => Math.max(...w)))} ${first.unit}; ` +
        `working sets ${arrow(perfSets.map(s => s.length))}; ` +
        `reps per working set ${reps.map(r => rangeOf(r)).join(' → ')}; ` +
        `weight × reps ${arrow(volume)}`;
      break;
    }
    case 'reps': {
      const reps = nums(repsOf);
      body =
        `working sets ${arrow(perfSets.map(s => s.length))}; ` +
        `reps per set ${reps.map(r => rangeOf(r)).join(' → ')}; ` +
        `total reps ${arrow(reps.map(sum))}`;
      break;
    }
    case 'hold': {
      const holds = nums(durationOf);
      body = `hold per set ${holds.map(h => rangeOf(h)).join(' → ')} s; sets ${arrow(perfSets.map(s => s.length))}`;
      break;
    }
    case 'duration': {
      body = `minutes ${arrow(nums(durationOf).map(d => sum(d) / 60))}`;
      break;
    }
    case 'distance': {
      const distances = perfSets.map(sets =>
        sum(sets.map(s => (s.setData.type === 'cardio_distance' ? s.setData.distance : 0))),
      );
      const durations = nums(durationOf).map(sum);
      body = `distance ${arrow(distances)} ${first.unit}`;
      if (durations.every(d => d > 0)) {
        body += `; time ${arrow(durations.map(d => d / 60))} min`;
      }
      break;
    }
  }
  return `${header}: ${body}.`;
}

// --- Today -----------------------------------------------------------------------------------

function exerciseLine(
  name: string,
  exerciseId: string,
  planText: string | null,
  ex: SessionExerciseWithDetails | undefined,
): string {
  let state: string;
  if (ex?.status === 'skipped') {
    state = 'skipped';
  } else if (!ex || ex.sets.length === 0) {
    state = ex?.status === 'completed' ? 'done' : 'nothing yet';
  } else {
    const label = ex.status === 'completed' ? 'done' : 'in progress';
    state = `${label}: ${formatSetsLine(ex.sets)}`;
  }
  const plan = planText ? ` — plan ${planText}` : '';
  return `- ${name} [id ${exerciseId}]${plan} — ${state}`;
}

function idleText(ms: number): string {
  const hours = Math.max(0, Math.floor(ms / 3_600_000));
  return hours >= 48 ? `${Math.floor(hours / 24)} days` : `${hours} h`;
}

/** `# Today` — the session so far: start, place, previous workout, plan and every logged set. */
export const TRAINING_TODAY_V1: ContextBlock<TrainingFactsData> = {
  id: 'training.today',
  version: 'v1',
  render({ session, history, lastWorkout }, ctx: ContextBlockCtx) {
    const tz = tzOf(ctx);
    const lines: string[] = [TRAINING_TODAY_HEADER];
    // The i0 replay rendering shows no session length / elapsed minutes (they made the coach cut sets for time):
    // the time now rides in the NOW line, the place only when it was stated.
    if (session.place) {
      lines.push(`Place: ${session.place}.`);
    }
    if (lastWorkout) {
      const names = lastWorkout.exerciseNames.length > 0 ? ` — ${lastWorkout.exerciseNames.join(', ')}` : '';
      lines.push(`Previous workout: ${relativeDay(lastWorkout.completedAt, ctx.now, tz)}${names}.`);
    }
    if (isRetroLog(session, ctx.now)) {
      const idle = ctx.now.getTime() - lastActivityOf(session).getTime();
      lines.push(`No activity for ${idleText(idle)}; a set logged now is dated to the session's last activity.`);
    }

    const nameOf = new Map(history.map(h => [h.exerciseId, h.exerciseName]));
    const startedById = new Map(session.exercises.map(ex => [ex.exerciseId, ex]));
    const plan = session.sessionPlanJson;
    const planIds = new Set(plan?.exercises.map(p => p.exerciseId) ?? []);
    const offPlan = session.exercises.filter(ex => !planIds.has(ex.exerciseId));

    if (plan && plan.exercises.length > 0) {
      lines.push('Plan and sets so far:');
      for (const p of plan.exercises) {
        const ex = startedById.get(p.exerciseId);
        const name = ex?.exercise.name ?? nameOf.get(p.exerciseId) ?? p.exerciseName ?? 'Exercise';
        lines.push(exerciseLine(name, p.exerciseId, `${p.targetSets}×${p.targetReps}`, ex));
      }
    } else {
      lines.push('No plan for this session.');
    }
    if (offPlan.length > 0) {
      lines.push(plan && plan.exercises.length > 0 ? 'Off plan:' : 'Sets so far:');
      for (const ex of offPlan) {
        lines.push(exerciseLine(ex.exercise.name, ex.exerciseId, null, ex));
      }
    }
    return lines.join('\n');
  },
};

// --- History ---------------------------------------------------------------------------------

function historyEntry(entry: ExerciseHistory, ctx: ContextBlockCtx): string {
  const tz = tzOf(ctx);
  const lines = [`${entry.exerciseName} (today ${entry.plannedText ?? 'off plan'})`];
  const [newest] = entry.performances;
  if (entry.lastSkippedAt && (!newest || entry.lastSkippedAt > newest.completedAt)) {
    lines.push(`- skipped ${dayLabel(entry.lastSkippedAt, tz)} (planned, not done)`);
  }
  if (!newest) {
    lines.push('- no earlier record');
    return lines.join('\n');
  }
  for (const p of entry.performances) {
    lines.push(`- ${relativeDay(p.completedAt, ctx.now, tz)}: ${formatSetsLine(p.sessionExercise.sets)}`);
  }
  const trend = trendLine(entry.performances, ctx.now, tz);
  if (trend) {
    lines.push(`- ${trend}`);
  }
  return lines.join('\n');
}

/** `# History` — per today's exercise, its last performances with dates and a numeric trend. Absent when empty. */
export const TRAINING_HISTORY_V1: ContextBlock<TrainingFactsData> = {
  id: 'training.history',
  version: 'v1',
  render({ history }, ctx: ContextBlockCtx) {
    if (history.length === 0) {
      return null;
    }
    return [TRAINING_HISTORY_HEADER, ...history.map(entry => historyEntry(entry, ctx))].join('\n\n');
  },
};
