import { makeFacts } from './fixtures';
import { GAP_TIER_PARAMS, gapTierFacts, gapTierOf, returnLadderStep, type GapTier } from '../gap-tier';

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
