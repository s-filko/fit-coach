/**
 * `training.exercise_history` / `training.recent_workouts` v1 (BUG-030, roadmap R1.3a,
 * training-exercise-history plan D4): replace `training.previous_session`, which picked one
 * "previous session" by exact `session_key` match — real keys are unique per session, so the
 * lookup missed recent history and reached arbitrarily far back to the one session that happened
 * to share the key (live evidence 2026-09-21, 2026-09-25).
 *
 * `training.exercise_history` anchors by exercise instead (D2): for each of today's exercises
 * (planned or started), the newest completed performance with >= 1 set, however old — its age is
 * always shown, so an old number is still useful. `training.recent_workouts` gives the last 7
 * real days of training (D3) so the model can see fatigue on overlapping muscles even when the
 * session used a different key.
 */
import type {
  Involvement,
  MuscleGroup,
  SessionExerciseWithDetails,
  WorkoutSessionWithDetails,
} from '@domain/training/types';

import { calendarDaysAgo, formatInUserTz, humanTimeAgo } from '@shared/date-utils';

import { formatExerciseSets, formatSetData } from './training-workout-overview.v1';
import type { ContextBlock, ContextBlockCtx } from './types';

const RECENT_WORKOUTS_WINDOW_DAYS = 7;

/** One of today's exercises (planned or started) and its last real performance, if any (D2). */
export interface ExerciseHistoryEntry {
  exerciseId: string;
  exerciseName: string;
  /** null = no completed record anywhere for this exercise. */
  performance: SessionExerciseWithDetails | null;
  completedAt: Date | null;
}

/**
 * `ctx.timezone`, falling back to the user's own, then to `'UTC'` explicitly (close-out review
 * advisory 8) — `formatInUserTz` already falls back to UTC internally when given `null`, but
 * `humanTimeAgo`'s no-tz path uses the *process's* local clock instead, not UTC. Resolving to a
 * concrete `'UTC'` string here, once, keeps the date and the age in `formatDateAge` and the
 * window cut in `TRAINING_RECENT_WORKOUTS_V1` reading the same calendar day.
 */
function resolveTz(ctx: ContextBlockCtx): string {
  return ctx.timezone ?? ctx.user?.timezone ?? 'UTC';
}

/** D5: "2026-09-16 · 5d ago (Wed)" — calendar date in the user's timezone, plus humanTimeAgo. */
function formatDateAge(date: Date, ctx: ContextBlockCtx): string {
  const tz = resolveTz(ctx);
  return `${formatInUserTz(date, tz).dateOnly} · ${humanTimeAgo(date, ctx.now, tz)}`;
}

/** Consecutive identical sets collapse to "3× 8 reps @ 80 kg" — a compact fatigue-context line. */
function compactSetSummary(sets: SessionExerciseWithDetails['sets']): string {
  if (sets.length === 0) {
    return 'no sets logged';
  }
  const groups: Array<{ text: string; count: number }> = [];
  for (const s of sets) {
    const text = formatSetData(s.setData);
    const last = groups[groups.length - 1];
    if (last?.text === text) {
      last.count += 1;
    } else {
      groups.push({ text, count: 1 });
    }
  }
  return groups.map(g => (g.count > 1 ? `${g.count}× ${g.text}` : g.text)).join(', ');
}

export interface TrainingExerciseHistoryData {
  exerciseHistory: ExerciseHistoryEntry[];
}

/**
 * `=== EXERCISE HISTORY ===` — one entry per today's exercise (plan order, then off-plan started),
 * its last real performance dated (D5), or an explicit "no completed record" line (AC-EH-3). Null
 * when today has no exercises at all.
 */
export const TRAINING_EXERCISE_HISTORY_V1: ContextBlock<TrainingExerciseHistoryData> = {
  id: 'training.exercise_history',
  version: 'v1',
  render(data, ctx: ContextBlockCtx) {
    if (data.exerciseHistory.length === 0) {
      return null;
    }

    const blocks = data.exerciseHistory.map(entry => {
      const header = `${entry.exerciseName} [ID:${entry.exerciseId}]`;
      if (!entry.performance || !entry.completedAt) {
        return `${header} — no completed record`;
      }

      const when = formatDateAge(entry.completedAt, ctx);
      return `${header} — last done ${when}\n${formatExerciseSets(entry.performance.sets, entry.performance.userFeedback)}`;
    });

    return `=== EXERCISE HISTORY (today's exercises — last completed performance) ===\n\n${blocks.join('\n\n')}`;
  },
};

export interface TrainingRecentWorkoutsData {
  recentWorkouts: WorkoutSessionWithDetails[];
  todayMuscles: MuscleGroup[];
}

/**
 * `=== RECENT WORKOUTS ===` — real workouts (completed, >= 1 set) within the last 7 calendar days
 * of `ctx.now` (D3; the loader hands over at most 7 candidates, the date cut happens here), newest
 * first, today's own session excluded by the loader. Each exercise that shares a muscle group
 * (primary or secondary, either side) with today's exercises is labelled `overlaps today: …`
 * (AC-EH-4). Outside the window: names the most recent real workout's date, or says there is none
 * on record (AC-EH-5).
 */
export const TRAINING_RECENT_WORKOUTS_V1: ContextBlock<TrainingRecentWorkoutsData> = {
  id: 'training.recent_workouts',
  version: 'v1',
  render(data, ctx: ContextBlockCtx) {
    const header = '=== RECENT WORKOUTS (last 7 days, fatigue context) ===';
    const tz = resolveTz(ctx);
    const inWindow = data.recentWorkouts.filter(
      s => calendarDaysAgo(s.completedAt ?? s.createdAt, ctx.now, tz) <= RECENT_WORKOUTS_WINDOW_DAYS,
    );

    if (inWindow.length === 0) {
      if (data.recentWorkouts.length === 0) {
        return `${header}\n\nNo completed workouts on record.`;
      }
      const [mostRecent] = data.recentWorkouts;
      const when = formatDateAge(mostRecent.completedAt ?? mostRecent.createdAt, ctx);
      return `${header}\n\nMost recent real workout: ${when} — outside the 7-day window, not detailed here.`;
    }

    const todaySet = new Set(data.todayMuscles);
    const blocks = inWindow.map(session => {
      const when = formatDateAge(session.completedAt ?? session.createdAt, ctx);
      const exerciseLines = session.exercises.map(ex => {
        const overlap: Array<{ muscleGroup: MuscleGroup; involvement: Involvement }> = (
          ex.exercise.muscleGroups ?? []
        ).filter(mg => todaySet.has(mg.muscleGroup));
        let line = `  ${ex.exercise.name} [ID:${ex.exerciseId}]: ${compactSetSummary(ex.sets)}`;
        if (overlap.length > 0) {
          const overlapText = overlap.map(mg => `${mg.muscleGroup} (${mg.involvement})`).join(', ');
          line += `\n    overlaps today: ${overlapText}`;
        }
        return line;
      });
      return `${when}\n${exerciseLines.join('\n')}`;
    });

    return `${header}\n\n${blocks.join('\n\n')}`;
  },
};
