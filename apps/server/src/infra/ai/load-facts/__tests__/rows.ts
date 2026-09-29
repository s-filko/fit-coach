import type { MuscleGroup, WorkoutSessionWithDetails } from '@domain/training/types';

/** Plain-row builders for the load-facts loader/block/tool unit tests. */
export const NOW = new Date('2026-09-29T02:00:00Z');
export const TZ = 'Asia/Manila';

export interface RowSet {
  weight: number;
  reps: number;
  at: Date;
  rpe?: number;
  feedback?: string;
  kind?: 'warmup' | 'working' | null;
  /** Overrides the default strength set data (non-strength exercises). */
  setData?: Record<string, unknown>;
}

export interface RowExercise {
  rowId: string;
  id: string;
  name: string;
  equipment?: 'machine' | 'barbell' | 'dumbbell' | 'bodyweight';
  exerciseType?: 'strength' | 'isometric' | 'functional_reps';
  muscles: [MuscleGroup, 'primary' | 'secondary'][];
  targetReps?: string | null;
  sets: RowSet[];
}

export const CHEST_PRESS = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Machine Chest Press',
  muscles: [
    ['chest', 'primary'],
    ['triceps', 'secondary'],
  ] as RowExercise['muscles'],
};
export const DIPS = {
  id: '22222222-2222-4222-8222-222222222222',
  name: 'Dips',
  muscles: [
    ['triceps', 'primary'],
    ['chest', 'secondary'],
  ] as RowExercise['muscles'],
};

export function daysBefore(days: number, minutes = 0): Date {
  return new Date(NOW.getTime() - days * 86_400_000 + minutes * 60_000);
}

export function sessionRow(
  id: string,
  startedAt: Date,
  exercises: RowExercise[],
  extra: Record<string, unknown> = {},
): WorkoutSessionWithDetails {
  const completed = extra['status'] !== 'in_progress';
  return {
    id,
    userId: 'u1',
    planId: null,
    sessionKey: null,
    status: completed ? 'completed' : 'in_progress',
    place: null,
    startedAt,
    completedAt: completed ? new Date(startedAt.getTime() + 3_600_000) : null,
    durationMinutes: null,
    userContextJson: null,
    sessionPlanJson: null,
    lastActivityAt: startedAt,
    autoCloseReason: null,
    createdAt: startedAt,
    updatedAt: startedAt,
    ...extra,
    exercises: exercises.map((e, i) => ({
      id: e.rowId,
      sessionId: id,
      exerciseId: e.id,
      orderIndex: i,
      status: 'completed',
      targetSets: null,
      targetReps: e.targetReps ?? '8-12',
      targetWeight: null,
      actualRepsRange: null,
      userFeedback: null,
      createdAt: startedAt,
      exercise: {
        id: e.id,
        name: e.name,
        equipment: e.equipment ?? 'machine',
        exerciseType: e.exerciseType ?? 'strength',
        muscleGroups: e.muscles.map(([muscleGroup, involvement]) => ({ muscleGroup, involvement })),
      },
      sets: e.sets.map((s, n) => ({
        id: `${e.rowId}-s${n}`,
        sessionExerciseId: e.rowId,
        setNumber: n + 1,
        rpe: s.rpe ?? null,
        userFeedback: s.feedback ?? null,
        createdAt: s.at,
        completedAt: s.at,
        setKind: s.kind,
        setData: s.setData ?? { type: 'strength', reps: s.reps, weight: s.weight, weightUnit: 'kg' },
      })),
    })),
  } as unknown as WorkoutSessionWithDetails;
}

export function sets(weight: number, reps: number[], start: Date, extra: Partial<RowSet> = {}): RowSet[] {
  return reps.map((r, i) => ({ weight, reps: r, at: new Date(start.getTime() + i * 120_000), ...extra }));
}
