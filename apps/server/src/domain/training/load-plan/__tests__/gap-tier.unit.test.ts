import {
  GAP_TIER_PARAMS,
  gapTierFacts,
  gapTierOf,
  ladderStateOf,
  returnLadderStep,
  type GapTier,
  type LadderPerformance,
} from '../gap-tier';
import { performanceSuccess } from '../ladder-input';
import { makeFacts } from './fixtures';

/** D5 / R4.0: tier thresholds are named parameters; the ladder is a counter of real workouts. */
describe('gapTierOf (R4.0 thresholds)', () => {
  it.each<[number, GapTier]>([
    [0, 'rest'],
    [7, 'rest'],
    [8, 'rest_with_question'],
    [13, 'rest_with_question'],
    [14, 'return'],
    [27, 'return'],
    [28, 'rebuild'],
    [83, 'rebuild'],
    [84, 'restart'],
    [400, 'restart'],
  ])('%i days → %s', (days, tier) => {
    expect(gapTierOf(days)).toBe(tier);
  });

  it('exposes the thresholds as named, cited parameters', () => {
    expect(GAP_TIER_PARAMS.restWithQuestionAboveDays.value).toBe(7);
    expect(GAP_TIER_PARAMS.returnFromDays.value).toBe(14);
    expect(GAP_TIER_PARAMS.rebuildFromDays.value).toBe(28);
    expect(GAP_TIER_PARAMS.restartFromDays.value).toBe(84);
    for (const p of Object.values(GAP_TIER_PARAMS)) {
      expect(p.citation.length).toBeGreaterThan(10);
    }
  });
});

describe('gapTierFacts', () => {
  it('reads the exercise gap first', () => {
    const f = makeFacts({ gap: { exercise: { days: 30 }, primaryMuscles: { days: 3 }, anyWorkout: { days: 1 } } });
    expect(gapTierFacts(f)).toEqual({ tier: 'rebuild', days: 30, basis: 'exercise' });
  });

  it('falls back to primary muscles, then any workout', () => {
    const a = makeFacts({
      gap: { exercise: { absent: 'none' }, primaryMuscles: { days: 15 }, anyWorkout: { days: 1 } },
    });
    expect(gapTierFacts(a)).toEqual({ tier: 'return', days: 15, basis: 'primary muscles' });
    const b = makeFacts({
      gap: { exercise: { absent: 'none' }, primaryMuscles: { absent: 'none' }, anyWorkout: { days: 9 } },
    });
    expect(gapTierFacts(b)).toEqual({ tier: 'rest_with_question', days: 9, basis: 'any workout' });
  });

  it('is rest with no days when every gap is absent', () => {
    const f = makeFacts({
      gap: { exercise: { absent: 'x' }, primaryMuscles: { absent: 'x' }, anyWorkout: { absent: 'x' } },
    });
    expect(gapTierFacts(f)).toEqual({ tier: 'rest', days: null, basis: null });
  });
});

describe('returnLadderStep', () => {
  it('has no ladder below the return tier', () => {
    expect(returnLadderStep('rest', 0)).toBeNull();
    expect(returnLadderStep('rest_with_question', 0)).toBeNull();
  });

  it('return: 2 workouts, one step below then back to working weight', () => {
    expect(returnLadderStep('return', 0)).toEqual({
      tier: 'return',
      workout: 1,
      of: 2,
      stepsBelow: 1,
      coldStart: false,
    });
    expect(returnLadderStep('return', 1)).toEqual({
      tier: 'return',
      workout: 2,
      of: 2,
      stepsBelow: 0,
      coldStart: false,
    });
    expect(returnLadderStep('return', 2)).toBeNull();
  });

  it('rebuild: 3 workouts starting two steps below', () => {
    expect(returnLadderStep('rebuild', 0)?.stepsBelow).toBe(2);
    expect(returnLadderStep('rebuild', 1)?.stepsBelow).toBe(1);
    expect(returnLadderStep('rebuild', 2)).toMatchObject({ workout: 3, of: 3, stepsBelow: 0 });
  });

  it('restart is a cold start', () => {
    expect(returnLadderStep('restart', 0)).toMatchObject({ coldStart: true });
  });
});

const TZ_UTC = 'UTC';
const day = (iso: string): Date => new Date(`${iso}T10:00:00Z`);
const lp = (iso: string, success = true): LadderPerformance => ({ performedAt: day(iso), success });

describe('ladderStateOf (workouts since the gap)', () => {
  it('no gap in the history → null', () => {
    expect(ladderStateOf([lp('2026-09-25'), lp('2026-09-18'), lp('2026-09-11')], TZ_UTC)).toBeNull();
    expect(ladderStateOf([], TZ_UTC)).toBeNull();
  });

  it('a 30-day gap before the newest performance: tier rebuild, one workout since', () => {
    const s = ladderStateOf([lp('2026-09-27'), lp('2026-08-28'), lp('2026-08-21')], TZ_UTC);
    expect(s).toMatchObject({ tier: 'rebuild', gapDays: 30, workoutsSince: 1, performancesSince: 1 });
    expect(s?.gapStart).toEqual(day('2026-08-28'));
    expect(s?.gapEnd).toEqual(day('2026-09-27'));
  });

  it('counts only the successful workouts as rungs; a miss repeats the rung', () => {
    const s = ladderStateOf([lp('2026-09-27', false), lp('2026-08-28'), lp('2026-08-21')], TZ_UTC);
    expect(s).toMatchObject({ workoutsSince: 0, performancesSince: 1 });
    const two = ladderStateOf([lp('2026-09-27'), lp('2026-09-24', false), lp('2026-09-20'), lp('2026-08-20')], TZ_UTC);
    expect(two).toMatchObject({ tier: 'rebuild', workoutsSince: 2, performancesSince: 3 });
  });

  it('uses the NEWEST gap only', () => {
    const s = ladderStateOf([lp('2026-09-27'), lp('2026-09-10'), lp('2026-06-01'), lp('2026-05-01')], TZ_UTC);
    expect(s).toMatchObject({ tier: 'return', gapDays: 17, workoutsSince: 1 });
    const restart = ladderStateOf([lp('2026-09-27'), lp('2026-09-20'), lp('2026-06-01')], TZ_UTC);
    expect(restart).toMatchObject({ tier: 'restart', gapDays: 111, workoutsSince: 2 });
  });
});

describe('returnLadderStep after a restart', () => {
  it('the first workout is a cold start, the ones after follow the rebuild ladder', () => {
    expect(returnLadderStep('restart', 0)).toMatchObject({ coldStart: true });
    expect(returnLadderStep('restart', 1)).toMatchObject({ coldStart: false, workout: 1, of: 3, stepsBelow: 2 });
    expect(returnLadderStep('restart', 3)).toMatchObject({ workout: 3, stepsBelow: 0 });
    expect(returnLadderStep('restart', 4)).toBeNull();
  });
});

describe('performanceSuccess (a workout in range with reserve)', () => {
  const set = (reps: number, rpe: number | null): Parameters<typeof performanceSuccess>[0]['sets'][number] =>
    ({
      setData: { type: 'strength', reps, weight: 60 },
      setKind: 'working',
      rpe,
      userFeedback: null,
      createdAt: day('2026-09-27'),
    }) as never;
  const perf = (sets: ReturnType<typeof set>[], targetReps: string | null = '8-12') =>
    ({ sets, targetReps }) as Parameters<typeof performanceSuccess>[0];

  it('in range with RPE ≤ 8 → success', () => {
    expect(performanceSuccess(perf([set(10, 7), set(9, 8)]))).toBe(true);
  });
  it('below the rep floor → miss', () => {
    expect(performanceSuccess(perf([set(10, 7), set(6, 7)]))).toBe(false);
  });
  it('RPE above 8 (no reserve) → miss', () => {
    expect(performanceSuccess(perf([set(10, 9)]))).toBe(false);
  });
  it('no RPE recorded and in range → success; no range known → success', () => {
    expect(performanceSuccess(perf([set(10, null)]))).toBe(true);
    expect(performanceSuccess(perf([set(3, null)], null))).toBe(true);
  });
});
