import type { MuscleGroup, SetKind } from '../../types';
import type { ExerciseInput, LoadFactsContext, OtherSetInput, PerformanceInput, SetInput, TodayInput } from '../types';

/** Fixed clock: 2026-09-29 10:00 in Asia/Manila (UTC+8). */
export const NOW = new Date('2026-09-29T02:00:00Z');
export const TZ = 'Asia/Manila';

/** A Date `days` whole days before NOW at the same instant of day. */
export function daysBefore(days: number, hoursOffset = 0): Date {
  return new Date(NOW.getTime() - days * 86_400_000 + hoursOffset * 3_600_000);
}

export function strengthSet(
  weight: number,
  reps: number,
  extra: Partial<Omit<SetInput, 'setData'>> & { perHand?: boolean } = {},
): SetInput {
  const { perHand, ...rest } = extra;
  return {
    setData: { type: 'strength', reps, weight, ...(perHand === undefined ? {} : { perHand }) },
    setKind: undefined,
    rpe: null,
    userFeedback: null,
    createdAt: new Date('2026-09-01T10:00:00Z'),
    ...rest,
  };
}

export function withKind(s: SetInput, setKind: SetKind | null): SetInput {
  return { ...s, setKind };
}

export function perf(
  id: string,
  daysAgo: number,
  sets: SetInput[],
  extra: Partial<PerformanceInput> = {},
): PerformanceInput {
  const performedAt = daysBefore(daysAgo);
  return {
    id,
    sessionId: `s-${id}`,
    place: null,
    startedAt: new Date(performedAt.getTime() - 30 * 60_000),
    performedAt,
    targetReps: '8-12',
    equipmentBasis: undefined,
    sets: sets.map((s, i) => ({
      ...s,
      createdAt:
        s.createdAt.getTime() === new Date('2026-09-01T10:00:00Z').getTime()
          ? new Date(performedAt.getTime() + i * 120_000)
          : s.createdAt,
    })),
    otherSets: [],
    ...extra,
  } as PerformanceInput;
}

export function today(extra: Partial<TodayInput> = {}): TodayInput {
  return {
    sessionId: 'today',
    place: null,
    startedAt: new Date(NOW.getTime() - 40 * 60_000),
    targetReps: '8-12',
    sets: [],
    otherSets: [],
    ...extra,
  };
}

export function other(
  name: string,
  muscles: [MuscleGroup, 'primary' | 'secondary'][],
  createdAt: Date,
  setKind: SetKind | null = 'working',
  weight = 50,
): OtherSetInput {
  return {
    exerciseRowId: `row-${name}`,
    exerciseName: name,
    setData: { type: 'strength', reps: 10, weight },
    muscles: muscles.map(([muscleGroup, involvement]) => ({ muscleGroup, involvement })),
    setKind,
    createdAt,
  };
}

export const benchPress: ExerciseInput = {
  id: 'ex-bench',
  name: 'Machine Chest Press',
  exerciseType: 'strength',
  equipment: 'machine',
  muscles: [
    { muscleGroup: 'chest', involvement: 'primary' },
    { muscleGroup: 'triceps', involvement: 'secondary' },
  ],
};

export const barbellBench: ExerciseInput = { ...benchPress, id: 'ex-bb', name: 'Bench Press', equipment: 'barbell' };

export const emptyContext: LoadFactsContext = {
  constraints: [],
  equipmentFacts: [],
  workouts: [],
};
