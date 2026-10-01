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

// --- Owner history (copied from the dev export of 2026-10-01; tests never read the replay folder) ---

export const legPress: ExerciseInput = {
  id: 'ex-leg-press',
  name: '45° Leg Press',
  exerciseType: 'strength',
  equipment: 'machine',
  muscles: [
    { muscleGroup: 'quads', involvement: 'primary' },
    { muscleGroup: 'glutes', involvement: 'primary' },
  ],
};

export const lateralRaise: ExerciseInput = {
  id: 'ex-lat-raise',
  name: 'Lateral Raise Machine',
  exerciseType: 'strength',
  equipment: 'machine',
  muscles: [{ muscleGroup: 'shoulders_side', involvement: 'primary' }],
};

type OwnerRow = { date: string; targetReps: string | null; sets: [number, number][] };

/** 45° Leg Press, legacy NULL set kinds (owner dev export). */
export const LEG_PRESS_ROWS: OwnerRow[] = [
  {
    date: '2026-09-07',
    targetReps: null,
    sets: [
      [100, 10],
      [100, 12],
    ],
  },
  {
    date: '2026-09-09',
    targetReps: null,
    sets: [
      [100, 12],
      [100, 12],
      [100, 12],
    ],
  },
  {
    date: '2026-09-12',
    targetReps: null,
    sets: [
      [100, 12],
      [100, 12],
      [100, 12],
    ],
  },
  {
    date: '2026-09-16',
    targetReps: null,
    sets: [
      [80, 10],
      [110, 12],
      [110, 12],
      [110, 12],
    ],
  },
  {
    date: '2026-09-21',
    targetReps: '10-12',
    sets: [
      [110, 12],
      [110, 12],
      [120, 12],
      [120, 12],
    ],
  },
  {
    date: '2026-09-27',
    targetReps: '12',
    sets: [
      [110, 12],
      [130, 12],
      [130, 12],
      [135, 12],
    ],
  },
];

/** Lateral Raise Machine: an old 5 kg × 10 set, recent sessions 2.5 kg. */
export const LATERAL_RAISE_ROWS: OwnerRow[] = [
  {
    date: '2026-09-10',
    targetReps: null,
    sets: [
      [5, 10],
      [2.5, 10],
    ],
  },
  {
    date: '2026-09-15',
    targetReps: null,
    sets: [
      [2.5, 12],
      [2.5, 12],
      [2.5, 12],
    ],
  },
  {
    date: '2026-09-20',
    targetReps: '12',
    sets: [
      [2.5, 12],
      [2.5, 11],
      [2.5, 8],
    ],
  },
  {
    date: '2026-09-25',
    targetReps: '15',
    sets: [
      [2.5, 10],
      [2.5, 15],
      [2.5, 12],
      [2.5, 10],
    ],
  },
];

/** Performances for the owner rows up to and including `lastDate` (Manila noon of each date). */
export function ownerPerfs(exerciseKey: string, rows: OwnerRow[], lastDate: string): PerformanceInput[] {
  return rows
    .filter(r => r.date <= lastDate)
    .map(r => {
      const performedAt = new Date(`${r.date}T04:00:00Z`);
      return perf(
        `${exerciseKey}-${r.date}`,
        0,
        r.sets.map(([w, reps], i) =>
          strengthSet(w, reps, { createdAt: new Date(performedAt.getTime() + i * 120_000) }),
        ),
        { performedAt, targetReps: r.targetReps, startedAt: new Date(performedAt.getTime() - 3_600_000) },
      );
    });
}

/** A clock `days` after an owner performance date (Manila 10:00). */
export function ownerNow(date: string, days: number): Date {
  return new Date(new Date(`${date}T02:00:00Z`).getTime() + days * 86_400_000);
}
