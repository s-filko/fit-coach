/**
 * The weight oracle (coach-quality-proof T2 / AC-CQ-2) — the TEST-ONLY
 * yardstick that turns a seeded exercise history into the load a coach
 * following docs/domain/training.spec.md would name next. These tests pin the
 * six seeded patterns the n-load-* journeys run (up / miss / early stop /
 * break / uneven / no record); the oracle is measurement code, never product
 * code — the app itself computes no prediction since coach-simplification-i1
 * deleted the load engine (2026-10-04).
 */
import type { OracleInput, OraclePerformance, OracleSet } from '../weight-oracle';
import { predictNextLoad } from '../weight-oracle';

const RANGE_8_10 = { floor: 8, top: 10 };

const set = (reps: number, weight?: number, rpe?: number): OracleSet => ({ reps, weight, rpe });

/** One performance: its working sets in order. */
const perf = (...sets: OracleSet[]): OraclePerformance => ({ sets });

const perfs = (...performances: OraclePerformance[]): OraclePerformance[] => performances;

describe('predictNextLoad — the six seeded n-load patterns', () => {
  it('(1) all sets at the top of the range twice → one step up (BR-TRAINING-042 2-for-2 via capacity)', () => {
    const verdict = predictNextLoad({
      performances: perfs(
        perf(set(10, 80, 8), set(10, 80, 8), set(10, 80, 8)),
        perf(set(10, 80, 8), set(10, 80, 8), set(10, 80, 8)),
        perf(set(8, 77.5), set(8, 77.5), set(8, 77.5)),
      ),
      range: RANGE_8_10,
      equipment: 'barbell',
      gapDays: 2,
    });
    expect(verdict.direction).toBe('up');
    expect(verdict.expectedKg).toBe(82.5);
    expect(verdict.acceptableKg).toEqual([82.5]);
  });

  it('(2) a miss below the floor even by capacity → one step down (BR-TRAINING-043)', () => {
    const verdict = predictNextLoad({
      performances: perfs(
        perf(set(6, 100, 9), set(6, 100, 9), set(6, 100, 9)),
        perf(set(9, 100), set(9, 100), set(9, 100)),
        perf(set(8, 97.5), set(8, 97.5), set(8, 97.5)),
      ),
      range: RANGE_8_10,
      equipment: 'barbell',
      gapDays: 2,
    });
    expect(verdict.direction).toBe('down');
    expect(verdict.expectedKg).toBe(97.5);
    expect(verdict.acceptableKg).toEqual([97.5]);
  });

  it('(3) an early stop below the floor by reps but not by capacity (RPE ≤ 7) → hold (BR-TRAINING-043)', () => {
    const verdict = predictNextLoad({
      performances: perfs(
        perf(set(6, 80, 7), set(6, 80, 7), set(6, 80, 7)),
        perf(set(8, 80), set(8, 80), set(8, 80)),
        perf(set(8, 77.5), set(8, 77.5), set(8, 77.5)),
      ),
      range: RANGE_8_10,
      equipment: 'barbell',
      gapDays: 2,
    });
    expect(verdict.direction).toBe('hold');
    expect(verdict.expectedKg).toBe(80);
    expect(verdict.acceptableKg).toEqual([80]);
  });

  it('(4) a 3-week break → the return ladder: one step down, the ~10 % lighter alternative also acceptable (BR-TRAINING-038, owner-unconfirmed)', () => {
    const verdict = predictNextLoad({
      performances: perfs(
        perf(set(9, 100), set(9, 100), set(9, 100)),
        perf(set(8, 97.5), set(8, 97.5), set(8, 97.5)),
      ),
      range: RANGE_8_10,
      equipment: 'barbell',
      gapDays: 21,
    });
    expect(verdict.direction).toBe('down');
    expect(verdict.expectedKg).toBe(97.5);
    expect(verdict.acceptableKg).toEqual([90, 97.5]);
  });

  it('(5) an uneven drop-off counts neither for growth nor for a step down → hold (BR-TRAINING-043)', () => {
    const verdict = predictNextLoad({
      performances: perfs(
        perf(set(10, 80), set(10, 80), set(4, 80)),
        perf(set(10, 80), set(10, 80), set(10, 80)),
      ),
      range: RANGE_8_10,
      equipment: 'barbell',
      gapDays: 2,
    });
    expect(verdict.direction).toBe('hold');
    expect(verdict.expectedKg).toBe(80);
    expect(verdict.acceptableKg).toEqual([80]);
  });

  it('(6) no history → no number, ask (BR-TRAINING-036: the coach does not invent one)', () => {
    const verdict = predictNextLoad({ performances: [], range: RANGE_8_10, equipment: 'barbell', gapDays: 0 });
    expect(verdict.direction).toBe('ask');
    expect(verdict.expectedKg).toBeNull();
    expect(verdict.acceptableKg).toEqual([]);
  });
});

describe('predictNextLoad — rule details', () => {
  it('2-for-2 needs the last set ≥ top + 2 in TWO consecutive performances — one is not growth', () => {
    const input: OracleInput = {
      performances: perfs(
        perf(set(12, 80, 8), set(12, 80, 8), set(12, 80, 8)),
        perf(set(8, 80), set(8, 80), set(8, 80)),
      ),
      range: RANGE_8_10,
      equipment: 'barbell',
      gapDays: 2,
    };
    expect(predictNextLoad(input).direction).toBe('hold');
  });

  it('below the floor without RPE → hold and ask, never a step down on the first occurrence (BR-TRAINING-043)', () => {
    const verdict = predictNextLoad({
      performances: perfs(
        perf(set(6, 80), set(6, 80), set(6, 80)),
        perf(set(8, 80), set(8, 80), set(8, 80)),
      ),
      range: RANGE_8_10,
      equipment: 'barbell',
      gapDays: 2,
    });
    expect(verdict.direction).toBe('hold');
    expect(verdict.expectedKg).toBe(80);
  });

  it('the same below-floor-without-RPE at the same load in the NEXT performance → one step down (BR-TRAINING-043)', () => {
    const verdict = predictNextLoad({
      performances: perfs(
        perf(set(6, 80), set(6, 80), set(6, 80)),
        perf(set(6, 80), set(6, 80), set(6, 80)),
      ),
      range: RANGE_8_10,
      equipment: 'barbell',
      gapDays: 2,
    });
    expect(verdict.direction).toBe('down');
    expect(verdict.expectedKg).toBe(77.5);
  });

  it('a predicted load snaps to a recorded load within 0.3 kg (BR-TRAINING-045)', () => {
    const verdict = predictNextLoad({
      performances: perfs(
        perf(set(10, 100, 8), set(10, 100, 8), set(10, 100, 8)),
        perf(set(10, 100, 8), set(10, 100, 8), set(10, 100, 8)),
        // 105.2 is within 0.3 of the stack step prediction 105.
        perf(set(8, 105.2), set(8, 105.2), set(8, 105.2)),
      ),
      range: RANGE_8_10,
      equipment: 'stack',
      gapDays: 2,
    });
    expect(verdict.direction).toBe('up');
    expect(verdict.expectedKg).toBe(105.2);
  });

  it('the working weight never comes from a load whose every appearance missed the floor (BR-TRAINING-041)', () => {
    // 102.5 recurs but every set at it missed the floor; 100 was reached cleanly.
    const verdict = predictNextLoad({
      performances: perfs(
        perf(set(6, 102.5), set(6, 102.5), set(6, 102.5)),
        perf(set(6, 102.5), set(6, 102.5), set(6, 102.5)),
        perf(set(9, 100), set(9, 100), set(9, 100)),
      ),
      range: RANGE_8_10,
      equipment: 'barbell',
      gapDays: 2,
    });
    // Judged at the working weight 100: in range, no growth signal → hold.
    expect(verdict.direction).toBe('hold');
    expect(verdict.expectedKg).toBe(100);
  });
});

// --- the Gravitron (owner 2026-10-08): a counterweight — less weight = harder = progress ---

describe('predictNextLoad — the assisted counterweight exercise', () => {
  const gravitron = (over: Partial<Parameters<typeof predictNextLoad>[0]> = {}) =>
    ({
      performances: perfs(
        perf(set(10, 25, 8), set(10, 25, 8), set(10, 25, 8)),
        perf(set(10, 25, 8), set(10, 25, 8), set(10, 25, 8)),
        perf(set(8, 30), set(8, 30), set(8, 30)),
      ),
      range: RANGE_8_10,
      equipment: 'stack',
      gapDays: 2,
      exerciseName: 'Assisted Pull-ups (Gravitron)',
      ...over,
    }) as Parameters<typeof predictNextLoad>[0];

  it('2-for-2 at the top of the range → difficulty UP = counterweight DOWN one stack step: 25 → 20', () => {
    const verdict = predictNextLoad(gravitron());
    expect(verdict.direction).toBe('up');
    expect(verdict.expectedKg).toBe(20);
    expect(verdict.acceptableKg).toEqual([20]);
  });

  it('a miss mirrors: difficulty DOWN = counterweight UP one step', () => {
    const verdict = predictNextLoad(
      gravitron({
        performances: perfs(
          perf(set(6, 25, 9), set(6, 25, 9), set(6, 25, 9)),
          perf(set(9, 25), set(9, 25), set(9, 25)),
          perf(set(8, 30), set(8, 30), set(8, 30)),
        ),
      }),
    );
    expect(verdict.direction).toBe('down');
    expect(verdict.expectedKg).toBe(30); // harder failed → more assistance: 25 + the 5 kg stack step
    expect(verdict.acceptableKg).toEqual([30]);
  });

  it('the flag comes from the NAME ("Assisted") — the product has no such flag (owner decision)', () => {
    const unassisted = predictNextLoad(gravitron({ exerciseName: 'Leg Press' }));
    expect(unassisted.expectedKg).toBe(30); // a normal stack exercise grows UP: 25 + 5
  });
});
