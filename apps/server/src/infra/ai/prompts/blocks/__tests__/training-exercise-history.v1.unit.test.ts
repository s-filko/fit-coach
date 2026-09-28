/**
 * `training.exercise_history` / `training.recent_workouts` v1 (BUG-030 fix, close-out review R3):
 * pure block unit tests over hand-built `TrainingData` slices — no DB, no loader. The DB-backed
 * anchor/overlap behaviour itself is covered by the promoted scenario tests
 * (tests/integration/scenarios/previous-session.integration.test.ts,
 * overlapping-load.integration.test.ts); this file is about the render function's own contract:
 * the 7-day window boundary (AC-EH-5), the "no completed record" / "no workouts" fallbacks
 * (AC-EH-3), overlap labelling, and the date+age format (D5) including the null-timezone fallback.
 */
import type {
  ExerciseWithMuscles,
  Involvement,
  MuscleGroup,
  SessionExerciseWithDetails,
  SessionSet,
  WorkoutSessionWithDetails,
} from '@domain/training/types';

import {
  TRAINING_EXERCISE_HISTORY_V1,
  TRAINING_RECENT_WORKOUTS_V1,
  type ExerciseHistoryEntry,
} from '../training-exercise-history.v1';
import type { ContextBlockCtx } from '../types';

const NOW = new Date('2026-09-24T09:30:00.000Z');
const CTX: ContextBlockCtx = { now: NOW, timezone: 'Asia/Manila', user: null };

function makeExercise(
  id: string,
  name: string,
  muscleGroups: Array<{ muscleGroup: MuscleGroup; involvement: Involvement }> = [],
): ExerciseWithMuscles {
  return {
    id,
    name,
    category: 'compound',
    equipment: 'barbell',
    exerciseType: 'strength',
    description: null,
    energyCost: 'medium',
    complexity: 'intermediate',
    typicalDurationMinutes: 10,
    requiresSpotter: false,
    imageUrl: null,
    videoUrl: null,
    createdAt: new Date('2020-01-01T00:00:00.000Z'),
    muscleGroups,
  };
}

function makeSet(setNumber: number, weight: number, reps: number): SessionSet {
  return {
    id: `set-${setNumber}`,
    sessionExerciseId: 'se-1',
    setNumber,
    rpe: null,
    userFeedback: null,
    createdAt: NOW,
    completedAt: NOW,
    setData: { type: 'strength', reps, weight, weightUnit: 'kg' },
  };
}

function makeSessionExercise(
  exercise: ExerciseWithMuscles,
  sets: SessionSet[],
  overrides: Partial<SessionExerciseWithDetails> = {},
): SessionExerciseWithDetails {
  return {
    id: `se-${exercise.id}`,
    sessionId: 'sess-x',
    exerciseId: exercise.id,
    orderIndex: 0,
    status: 'completed',
    targetSets: null,
    targetReps: null,
    targetWeight: null,
    actualRepsRange: null,
    userFeedback: null,
    createdAt: NOW,
    exercise,
    sets,
    ...overrides,
  };
}

function makeWorkout(
  daysAgo: number,
  exercises: SessionExerciseWithDetails[],
  overrides: Partial<WorkoutSessionWithDetails> = {},
): WorkoutSessionWithDetails {
  const completedAt = new Date(NOW.getTime() - daysAgo * 24 * 60 * 60 * 1000);
  return {
    id: `sess-${daysAgo}d`,
    userId: 'user-1',
    planId: null,
    sessionKey: 'key',
    status: 'completed',
    startedAt: completedAt,
    completedAt,
    durationMinutes: 30,
    userContextJson: null,
    sessionPlanJson: null,
    lastActivityAt: completedAt,
    autoCloseReason: null,
    createdAt: completedAt,
    updatedAt: completedAt,
    exercises,
    ...overrides,
  };
}

const BENCH = makeExercise('bench-1', 'Barbell Bench Press', [
  { muscleGroup: 'chest', involvement: 'primary' },
  { muscleGroup: 'triceps', involvement: 'secondary' },
]);
const OVERHEAD_PRESS = makeExercise('ohp-1', 'Overhead Press', [
  { muscleGroup: 'shoulders_front', involvement: 'primary' },
  { muscleGroup: 'triceps', involvement: 'secondary' },
]);
const SQUAT = makeExercise('squat-1', 'Barbell Back Squat', [
  { muscleGroup: 'quads', involvement: 'primary' },
  { muscleGroup: 'glutes', involvement: 'primary' },
]);

describe('TRAINING_EXERCISE_HISTORY_V1', () => {
  it('is absent (null) when today has no exercises at all', () => {
    expect(TRAINING_EXERCISE_HISTORY_V1.render({ exerciseHistory: [] }, CTX, 0)).toBeNull();
  });

  it('AC-EH-3: renders an explicit "no completed record" line for an exercise with no performance', () => {
    const entry: ExerciseHistoryEntry = {
      exerciseId: 'bench-1',
      exerciseName: 'Barbell Bench Press',
      performance: null,
      completedAt: null,
    };

    const text = TRAINING_EXERCISE_HISTORY_V1.render({ exerciseHistory: [entry] }, CTX, 0);

    expect(text).toContain('Barbell Bench Press [ID:bench-1] — no completed record');
  });

  it('D5: dates the anchor as "YYYY-MM-DD · <age>" and renders its sets', () => {
    const performance = makeSessionExercise(BENCH, [makeSet(1, 80, 8), makeSet(2, 80, 8)]);
    const entry: ExerciseHistoryEntry = {
      exerciseId: 'bench-1',
      exerciseName: 'Barbell Bench Press',
      performance,
      completedAt: new Date('2026-09-16T12:00:00.000Z'),
    };

    const text = TRAINING_EXERCISE_HISTORY_V1.render({ exerciseHistory: [entry] }, CTX, 0);

    expect(text).toContain('Barbell Bench Press [ID:bench-1] — last done 2026-09-16 · 8d ago');
    expect(text).toContain('Set 1: 8 reps @ 80 kg');
    expect(text).toContain('Set 2: 8 reps @ 80 kg');
  });

  it('null timezone (no ctx.timezone, no ctx.user) falls back to UTC for both the date and the age', () => {
    const performance = makeSessionExercise(BENCH, [makeSet(1, 80, 8)]);
    const entry: ExerciseHistoryEntry = {
      exerciseId: 'bench-1',
      exerciseName: 'Barbell Bench Press',
      performance,
      // 2026-09-16T20:00Z is 2026-09-17T04:00 in a UTC+8 zone (e.g. Asia/Manila, this machine's
      // own local zone) — a non-UTC fallback (the *process's* local clock, close-out review
      // advisory 8) would read this as "today", not "yesterday".
      completedAt: new Date('2026-09-16T20:00:00.000Z'),
    };
    // now = 2026-09-17T02:00Z is 2026-09-17T10:00 in UTC+8 — same local calendar day as
    // completedAt under a UTC+8 fallback, but the NEXT UTC calendar day.
    const nullTzCtx: ContextBlockCtx = { now: new Date('2026-09-17T02:00:00.000Z'), timezone: null, user: null };

    const text = TRAINING_EXERCISE_HISTORY_V1.render({ exerciseHistory: [entry] }, nullTzCtx, 0);

    // UTC dateOnly for completedAt, and UTC-consistent age ("yesterday", 1 whole UTC day) — not
    // "today", which is what a process-local (non-UTC) fallback for the age would have said while
    // the date line still (correctly) said 2026-09-16.
    expect(text).toContain('last done 2026-09-16 · yesterday');
    expect(text).not.toContain('· today');
  });
});

describe('TRAINING_RECENT_WORKOUTS_V1', () => {
  it('empty recentWorkouts: "No completed workouts on record."', () => {
    const text = TRAINING_RECENT_WORKOUTS_V1.render({ recentWorkouts: [], todayMuscles: [] }, CTX, 0);

    expect(text).toBe('=== RECENT WORKOUTS (last 7 days, fatigue context) ===\n\nNo completed workouts on record.');
  });

  it('AC-EH-5: only-old sessions (all beyond the 7-day window) fall back to naming the most recent one', () => {
    const workouts = [makeWorkout(9, [makeSessionExercise(SQUAT, [makeSet(1, 100, 5)])])];

    const text = TRAINING_RECENT_WORKOUTS_V1.render({ recentWorkouts: workouts, todayMuscles: [] }, CTX, 0);

    expect(text).toContain('Most recent real workout:');
    expect(text).toContain('outside the 7-day window');
    // Not detailed — the exercise itself is not rendered.
    expect(text).not.toContain('Barbell Back Squat');
  });

  it('AC-EH-5: a workout at exactly 7 days is IN the window, one at 8 days is OUT', () => {
    const sevenDays = makeWorkout(7, [makeSessionExercise(SQUAT, [makeSet(1, 100, 5)])]);
    const eightDays = makeWorkout(8, [makeSessionExercise(BENCH, [makeSet(1, 80, 8)])]);
    const threeDays = makeWorkout(3, [makeSessionExercise(OVERHEAD_PRESS, [makeSet(1, 55, 6)])]);

    const text = TRAINING_RECENT_WORKOUTS_V1.render(
      { recentWorkouts: [threeDays, sevenDays, eightDays], todayMuscles: [] },
      CTX,
      0,
    );

    expect(text).toContain('Barbell Back Squat');
    expect(text).toContain('Overhead Press');
    expect(text).not.toContain('Barbell Bench Press');
  });

  it("a workout completed \"today\" (0 days ago) is within the window — the block does not know or care which session is today's own; that exclusion is the loader's job (findRecentByUserIdWithDetails filters by status=completed, and training.spec.ts additionally drops today's own session id before the block ever sees it)", () => {
    const todayWorkout = makeWorkout(0, [makeSessionExercise(SQUAT, [makeSet(1, 100, 5)])]);

    const text = TRAINING_RECENT_WORKOUTS_V1.render({ recentWorkouts: [todayWorkout], todayMuscles: [] }, CTX, 0);

    expect(text).toContain('Barbell Back Squat');
    expect(text).not.toContain('outside the 7-day window');
  });

  it("AC-EH-4: labels an exercise that overlaps today's muscles, leaves a non-overlapping one unlabelled", () => {
    const overlapping = makeWorkout(1, [makeSessionExercise(OVERHEAD_PRESS, [makeSet(1, 55, 6)])]);
    const nonOverlapping = makeWorkout(2, [makeSessionExercise(SQUAT, [makeSet(1, 100, 5)])]);
    // Today's muscles match Overhead Press (shoulders_front, triceps) but not Squat (quads, glutes).
    const todayMuscles: MuscleGroup[] = ['shoulders_front', 'triceps'];

    const text = TRAINING_RECENT_WORKOUTS_V1.render(
      { recentWorkouts: [overlapping, nonOverlapping], todayMuscles },
      CTX,
      0,
    );

    expect(text).toMatch(/overlaps today:.*shoulders_front \(primary\)/);
    expect(text).toMatch(/overlaps today:.*triceps \(secondary\)/);
    // Squat's own workout block (one per \n\n-separated section) carries no overlap label.
    const squatBlock = text!.split('\n\n').find(block => block.includes('Barbell Back Squat'));
    expect(squatBlock).toBeDefined();
    expect(squatBlock).not.toContain('overlaps today');
  });

  it('D5: dates each workout as "YYYY-MM-DD · <age>"', () => {
    // 5 days ago lands in humanTimeAgo's "Nd ago (weekday)" bucket (4-7d) — a stable, unambiguous
    // string to assert on (the <=3d bucket adds a time-of-day word that would make this brittle).
    const workout = makeWorkout(5, [makeSessionExercise(SQUAT, [makeSet(1, 100, 5)])]);

    const text = TRAINING_RECENT_WORKOUTS_V1.render({ recentWorkouts: [workout], todayMuscles: [] }, CTX, 0);

    expect(text).toContain('2026-09-19 · 5d ago');
  });
});
