import { computeE1rmTrend, computeWorkingWeight, isAbsent } from '../index';

import { benchPress, NOW, perf, strengthSet, TZ } from './fixtures';

/**
 * AC-LPF-12 (a): the Epley formula the code uses against the published %1RM↔reps table (NSCA, Baechle & Earle,
 * Essentials of Strength Training and Conditioning: 10 reps ≈ 75 %, 8 ≈ 80 %, 6 ≈ 85 % of 1RM), and the rule that no
 * formula is applied above 10 reps (Reynolds et al. 2006, JSCR — accuracy degrades above ~10 reps).
 *
 * Tolerance: 2 percentage points of 1RM. Epley gives 75.0 / 78.9 / 83.3 % — within 1.1 / 1.7 points of the table; a
 * looser tolerance would hide a wrong divisor, a tighter one would reject a published table rounded to 5 %.
 */
const TOLERANCE_PCT = 2;
const TABLE: [reps: number, pct1rm: number][] = [
  [10, 75],
  [8, 80],
  [6, 85],
];

describe('AC-LPF-12 · formula vs published table', () => {
  it.each(TABLE)('%i reps ≈ %i % of 1RM within 2 points (the e1RM the code computes)', (reps, pct) => {
    const weight = 100;
    const perfs = [
      perf('a', 3, [strengthSet(weight, reps)]),
      perf('b', 10, [strengthSet(weight, reps)]),
      perf('c', 17, [strengthSet(weight, reps)]),
    ];
    const trend = computeE1rmTrend(perfs, 'today', benchPress, NOW, TZ);
    if (isAbsent(trend)) {
      throw new Error('expected a value');
    }
    const impliedPct = (weight / trend.newest) * 100;
    expect(Math.abs(impliedPct - pct)).toBeLessThanOrEqual(TOLERANCE_PCT);
  });

  it('the indirect working-weight estimate inverts the same formula (60×6 for 8 reps lands near the table, rounded down)', () => {
    // 6 reps ≈ 85 % → e1RM ≈ 70.6; 8 reps ≈ 80 % → ≈ 56.5 kg; Epley 56.8 → machine step 5 → 55.
    const perfs = [perf('a', 3, [strengthSet(60, 6), strengthSet(60, 6)]), perf('b', 10, [strengthSet(50, 10)])];
    const ww = computeWorkingWeight(perfs, 'today', { min: 8, max: 10 }, benchPress, NOW, TZ);
    if (isAbsent(ww)) {
      throw new Error('expected a value');
    }
    expect(ww.weight).toBe(55);
    expect(ww.estimatedFrom).toEqual({ weight: 60, reps: 6 });
  });
});

describe('AC-LPF-12 · no formula above 10 reps', () => {
  it('e1RM trend: sets of 11+ reps are not scored (three 12-rep sessions give no trend)', () => {
    const perfs = [
      perf('a', 3, [strengthSet(100, 12)]),
      perf('b', 10, [strengthSet(100, 12)]),
      perf('c', 17, [strengthSet(100, 15)]),
    ];
    expect(computeE1rmTrend(perfs, 'today', benchPress, NOW, TZ)).toEqual({ absent: 'insufficient: 0 performances' });
  });

  it('e1RM trend: exactly 10 reps is still scored, 11 is not', () => {
    const at = (reps: number) => [
      perf('a', 3, [strengthSet(100, reps)]),
      perf('b', 10, [strengthSet(100, reps)]),
      perf('c', 17, [strengthSet(100, reps)]),
    ];
    expect(isAbsent(computeE1rmTrend(at(10), 'today', benchPress, NOW, TZ))).toBe(false);
    expect(isAbsent(computeE1rmTrend(at(11), 'today', benchPress, NOW, TZ))).toBe(true);
  });

  it('working weight: a set above 10 reps never produces an estimate, however far below the floor of a 15–20 range', () => {
    const perfs = [perf('a', 3, [strengthSet(40, 12), strengthSet(40, 12)]), perf('b', 10, [strengthSet(40, 12)])];
    const ww = computeWorkingWeight(perfs, 'today', { min: 15, max: 20 }, benchPress, NOW, TZ);
    expect(ww).toEqual({ absent: 'no load reached the rep floor' });
  });
});
