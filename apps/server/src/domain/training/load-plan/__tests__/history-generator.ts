import {
  computeLoadFacts,
  type ExerciseInput,
  type LoadFacts,
  type LoadFactsContext,
  type OtherSetInput,
  type PerformanceInput,
  type SetInput,
  type TodayInput,
} from '../../load-facts';
import { daysBefore, NOW, strengthSet } from '../../load-facts/__tests__/fixtures';

/**
 * AC-LPF-12 (c): a seeded generator of strength histories — no dependency, a tiny PRNG (mulberry32), so every run sees
 * the same cases. The histories are deliberately messy: odd gaps, openers at another load, warm-ups, RPE on some sets,
 * pre-fatigue today, short constraints, unknown equipment steps, per-hand loads.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface GeneratedCase {
  seed: number;
  exercise: ExerciseInput;
  performances: PerformanceInput[];
  today: TodayInput;
  context: LoadFactsContext;
  targetReps: string;
}

const RANGES = ['8-10', '8-12', '10-15', '5-8', '12', '6-10', '12-15'];
const EQUIPMENT = ['machine', 'barbell', 'dumbbell', 'cable', 'none'] as const;
const STEP: Record<(typeof EQUIPMENT)[number], number> = { machine: 5, barbell: 2.5, dumbbell: 2, cable: 5, none: 5 };

class Rng {
  constructor(private readonly next: () => number) {}
  float(): number {
    return this.next();
  }
  int(lo: number, hi: number): number {
    return lo + Math.floor(this.next() * (hi - lo + 1));
  }
  chance(p: number): boolean {
    return this.next() < p;
  }
  pick<T>(items: readonly T[]): T {
    return items[this.int(0, items.length - 1)];
  }
}

function otherSetsAt(rng: Rng, at: Date, count: number): OtherSetInput[] {
  return Array.from({ length: count }, (_v, i) => ({
    exerciseRowId: `row-other-${i % 3}`,
    exerciseName: `Other ${i % 3}`,
    setData: { type: 'strength' as const, reps: 10, weight: 40 },
    muscles: [{ muscleGroup: 'chest' as const, involvement: 'primary' as const }],
    setKind: 'working' as const,
    createdAt: new Date(at.getTime() - (count - i) * 120_000 - rng.int(1, 5) * 60_000),
  }));
}

function sessionSets(rng: Rng, at: Date, load: number, step: number, range: { min: number; max: number }): SetInput[] {
  const sets: SetInput[] = [];
  const stamp = (i: number): Date => new Date(at.getTime() + i * 120_000);
  if (rng.chance(0.2)) {
    sets.push({ ...strengthSet(Math.max(step, load / 2), 10, { createdAt: stamp(sets.length) }), setKind: 'warmup' });
  }
  if (rng.chance(0.15)) {
    // A probe at another load: too heavy, few reps.
    sets.push(
      strengthSet(load + step, rng.int(2, range.min), {
        createdAt: stamp(sets.length),
        rpe: rng.chance(0.4) ? 9 : null,
      }),
    );
  }
  const n = rng.int(1, 5);
  const start = rng.int(range.min - 3, range.max + 6);
  const fade = rng.int(0, 3);
  for (let i = 0; i < n; i++) {
    const reps = Math.max(1, start - i * (rng.chance(0.7) ? fade : rng.int(0, 5)));
    sets.push(
      strengthSet(load, reps, {
        createdAt: stamp(sets.length),
        rpe: rng.chance(0.35) ? rng.pick([6, 7, 8, 9, 10]) : null,
      }),
    );
  }
  return sets;
}

export function generateCase(seed: number): GeneratedCase {
  const rng = new Rng(mulberry32(seed));
  const targetReps = rng.pick(RANGES);
  const [lo, hi] = targetReps.includes('-')
    ? targetReps.split('-').map(Number)
    : [Number(targetReps), Number(targetReps)];
  const range = { min: lo, max: hi };
  const equipment = rng.pick(EQUIPMENT);
  const step = STEP[equipment];
  const exercise: ExerciseInput = {
    id: 'ex-gen',
    name: 'Generated Press',
    exerciseType: 'strength',
    equipment,
    muscles: [{ muscleGroup: 'chest', involvement: 'primary' }],
  };
  const sessions = rng.int(0, 6);
  let load = step * rng.int(2, 30);
  let days = rng.pick([1, 2, 3, 4, 5, 6, 7, 7, 9, 12, 15, 20, 31, 45, 90]);
  const performances: PerformanceInput[] = [];
  for (let i = 0; i < sessions; i++) {
    const performedAt = daysBefore(days);
    const sets = sessionSets(rng, performedAt, load, step, range);
    const refOthers = rng.chance(0.3) ? otherSetsAt(rng, performedAt, rng.int(1, 4)) : [];
    performances.push({
      id: `p${i}`,
      sessionId: `s${i}`,
      place: null,
      startedAt: new Date(performedAt.getTime() - 3_600_000),
      performedAt,
      targetReps,
      sets,
      otherSets: refOthers,
    });
    days += rng.int(2, 10);
    if (rng.chance(0.25)) {
      load = Math.max(step, load + (rng.chance(0.5) ? step : -step));
    }
  }
  const today: TodayInput = {
    sessionId: 'today',
    place: null,
    startedAt: new Date(NOW.getTime() - 40 * 60_000),
    targetReps,
    sets: [],
    otherSets: rng.chance(0.3) ? otherSetsAt(rng, NOW, rng.int(1, 9)) : [],
  };
  const context: LoadFactsContext = {
    constraints: rng.chance(0.15) ? [{ muscleGroup: 'chest', durability: 'short', text: 'sore shoulder' }] : [],
    equipmentFacts: [],
    workouts: [],
  };
  return { seed, exercise, performances, today, context, targetReps };
}

export function factsOf(c: GeneratedCase, performances = c.performances): LoadFacts {
  return computeLoadFacts(c.exercise, performances, c.today, c.context, NOW, null);
}
