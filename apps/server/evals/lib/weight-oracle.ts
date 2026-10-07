/**
 * The weight oracle (coach-quality-proof T2 / AC-CQ-2) — a TEST-ONLY
 * yardstick that computes, from a seeded exercise history, the load a coach
 * following docs/domain/training.spec.md would name next.
 *
 * Why this exists: the app's own load-plan engine (domain `load-plan`,
 * BR-TRAINING-036…045) was deleted from dev by coach-simplification-i1 Task 3
 * (2026-10-04) — the training request carries dated facts only (`# History`:
 * performances, trend, loads used), no prediction. The n-load-* journeys and
 * the T3 live judge still need an EXPECTED load that is computed from the
 * seeded history, never hand-typed; this module is that computation, by the
 * rules the durable spec still states. It is measurement code: nothing in
 * `src/` imports it, and it must never be wired into a prompt or a tool.
 *
 * Rules implemented (docs/domain/training.spec.md):
 * - BR-TRAINING-041 — working weight: the highest load at which every set
 *   reached the rep floor (judged by capacity) among loads that recur in two
 *   recent performances or were reached in the newest one; when no load
 *   recurs, every reached load is eligible. A load whose every appearance
 *   missed the floor never qualifies ("never a failed opener", BR-036) — the
 *   highest cleanly reached load is the fallback.
 * - BR-TRAINING-043 — effort: capacity = reps + min(10 − RPE, 3) when RPE is
 *   recorded, else the reps. Below the floor by reps but not by capacity
 *   (RPE ≤ 7) is an early stop — hold; below the floor even by capacity is a
 *   miss — one step down; below the floor without RPE — hold the first time
 *   at that load, one step down when the previous performance already missed
 *   the floor at the same load without RPE; an uneven performance (drop-off
 *   above the user's usual + 3, or above 4 with no norm) counts neither for
 *   growth nor for a step down — hold.
 * - BR-TRAINING-042 — growth (2-for-2): the last set ≥ range top + 2 by
 *   capacity in two consecutive performances at the working weight → +1 step.
 * - BR-TRAINING-038 — break tiers: a gap ≥ 14 days is the `return` tier; the
 *   deleted engine's return ladder made the first workout back one step down
 *   (gap-tier.ts, "caution parameter" under Mujika & Padilla 2000). The
 *   ~10 %-lighter alternative is the coordinator's plain-rule wording,
 *   owner-unconfirmed — both are acceptable for that one pattern.
 * - BR-TRAINING-045 — equipment step: barbell 2.5, dumbbell 2 per hand,
 *   stack 5; a predicted load snaps to a recorded load within 0.3 kg.
 * - BR-TRAINING-036 — with no reference at all the coach names no number and
 *   does not invent one: the verdict is `ask`.
 */

/** One recorded set of the seeded history (the scenario schema's strength shape). */
export interface OracleSet {
  reps: number;
  weight?: number;
  rpe?: number;
}

/** One performance: the exercise's working sets in one workout, in order. */
export interface OraclePerformance {
  sets: OracleSet[];
}

export type OracleEquipment = 'barbell' | 'dumbbell' | 'stack' | 'bodyweight';

export interface OracleInput {
  /** Newest first — the order `findRecentPerformancesForExercise` returns. */
  performances: OraclePerformance[];
  /** The plan's rep range for the exercise. */
  range: { floor: number; top: number };
  equipment: OracleEquipment;
  /** Calendar days since the exercise's last performance; 0 when there is none. */
  gapDays: number;
}

export interface OracleVerdict {
  direction: 'up' | 'hold' | 'down' | 'ask';
  /** The load the rules name; null only for `ask`. */
  expectedKg: number | null;
  /** Loads a coach may legitimately propose for this history (expected first is NOT guaranteed — sorted ascending). */
  acceptableKg: number[];
  /** Which rule decided, for the report and the § 3 log. */
  reason: string;
}

/** BR-TRAINING-045 default steps per equipment kind. */
const STEP_BY_EQUIPMENT: Record<OracleEquipment, number> = {
  barbell: 2.5,
  dumbbell: 2,
  stack: 5,
  bodyweight: 2.5,
};

/** BR-TRAINING-043: capacity = reps + min(10 − RPE, 3) with RPE, else the reps. */
function capacityOf(set: OracleSet): number {
  return set.rpe == null ? set.reps : set.reps + Math.min(10 - set.rpe, 3);
}

/** Every set of the performance is at this load. */
function loadOf(performance: OraclePerformance): number | null {
  const weights = new Set(performance.sets.map(s => s.weight).filter((w): w is number => w != null));
  return weights.size === 1 ? [...weights][0]! : null;
}

/** True when every set reached the rep floor by capacity (BR-TRAINING-041). */
function cleanAtFloor(performance: OraclePerformance, floor: number): boolean {
  return performance.sets.every(s => capacityOf(s) >= floor);
}

/** First-set reps minus last-set reps, clamped at 0 — the within-performance drop-off. */
function dropOff(performance: OraclePerformance): number {
  const { sets } = performance;
  return sets.length < 2 ? 0 : Math.max(0, sets[0]!.reps - sets[sets.length - 1]!.reps);
}

/**
 * BR-TRAINING-041 working weight over the whole history (newest first):
 * candidates are loads that recur in ≥ 2 performances or were reached in the
 * newest one; the winner is the highest candidate with at least one
 * floor-clean appearance. When no candidate qualifies (every recurring load
 * only ever missed), the highest cleanly reached load of ANY performance is
 * the fallback; when nothing was ever cleanly reached, the newest
 * performance's own load (the current attempt) is.
 */
function workingWeight(input: OracleInput): number | null {
  const { performances, range } = input;
  const byLoad = new Map<number, OraclePerformance[]>();
  for (const p of performances) {
    const load = loadOf(p);
    if (load == null) {
      continue;
    }
    byLoad.set(load, [...(byLoad.get(load) ?? []), p]);
  }
  if (byLoad.size === 0) {
    return null;
  }
  const loads = [...byLoad.keys()].sort((a, b) => b - a); // descending
  const recurringOrNewest = new Set<number>();
  for (const [load, appearances] of byLoad) {
    if (appearances.length >= 2 || (performances[0] && loadOf(performances[0]) === load)) {
      recurringOrNewest.add(load);
    }
  }
  // "When no load recurs, every reached load is eligible."
  if ([...byLoad.values()].every(appearances => appearances.length < 2)) {
    for (const load of loads) {
      recurringOrNewest.add(load);
    }
  }
  const candidates = loads.filter(load => recurringOrNewest.has(load));
  for (const load of candidates) {
    if ((byLoad.get(load) ?? []).some(p => cleanAtFloor(p, range.floor))) {
      return load;
    }
  }
  for (const load of loads) {
    if ((byLoad.get(load) ?? []).some(p => cleanAtFloor(p, range.floor))) {
      return load;
    }
  }
  // Nothing was ever floor-clean: the newest performance's own load is the
  // user's current attempt — the base a repeated miss steps down from.
  return performances[0] ? loadOf(performances[0]) : null;
}

/** Round to the equipment's step grid (BR-TRAINING-045). */
function roundToStep(load: number, step: number): number {
  return Math.round(load / step) * step;
}

/** BR-TRAINING-045: a predicted load snaps to a recorded load within 0.3 kg. */
function snapToRecorded(load: number, recorded: number[]): number {
  const near = recorded.find(r => Math.abs(r - load) <= 0.3 + 1e-9);
  return near ?? load;
}

/** The verdict for one seeded history. */
export function predictNextLoad(input: OracleInput): OracleVerdict {
  const { performances, range, gapDays } = input;
  const step = STEP_BY_EQUIPMENT[input.equipment];
  const recordedLoads = [
    ...new Set(
      performances.flatMap(p => p.sets.map(s => s.weight).filter((w): w is number => w != null && w > 0)),
    ),
  ].sort((a, b) => a - b);

  // BR-TRAINING-036: no reference at all → no number, the coach asks.
  const weight = workingWeight(input);
  if (performances.length === 0 || weight == null) {
    return { direction: 'ask', expectedKg: null, acceptableKg: [], reason: 'no reference load (BR-TRAINING-036)' };
  }
  const predict = (load: number): number => snapToRecorded(load, recordedLoads);

  // BR-TRAINING-038: a gap ≥ 14 d is the `return` tier — the first workout back
  // is one step down (the deleted engine's return ladder); the ~10 % lighter
  // alternative is the coordinator's plain rule, owner-unconfirmed.
  if (gapDays >= 14) {
    const expected = predict(roundToStep(weight - step, step));
    const lighter = predict(roundToStep(weight * 0.9, step));
    return {
      direction: 'down',
      expectedKg: expected,
      acceptableKg: [...new Set([expected, lighter])].sort((a, b) => a - b),
      reason: `break ${gapDays} d — return tier, first workout one step down (BR-TRAINING-038; ~10 % lighter owner-unconfirmed)`,
    };
  }

  const [newest, previous] = performances;
  const atWorkingWeight = newest && loadOf(newest) === weight;

  // BR-TRAINING-043, uneven: drop-off above the usual + 3 (usual = the mean of
  // the earlier performances' drop-offs, a norm from ≥ 3 of them) or above 4
  // with no norm — counts neither for growth nor for a step down.
  const priors = performances.slice(1);
  const norm = priors.length >= 3 ? priors.reduce((a, p) => a + dropOff(p), 0) / priors.length : null;
  if (atWorkingWeight && dropOff(newest) > (norm == null ? 4 : norm + 3)) {
    return {
      direction: 'hold',
      expectedKg: weight,
      acceptableKg: [weight],
      reason: 'uneven drop-off — neither growth nor a step down (BR-TRAINING-043)',
    };
  }

  // BR-TRAINING-042, 2-for-2: the last set ≥ range top + 2 by capacity in two
  // consecutive performances at the working weight.
  const twoMostRecent = performances.slice(0, 2);
  if (
    twoMostRecent.length === 2 &&
    twoMostRecent.every(p => loadOf(p) === weight) &&
    twoMostRecent.every(p => capacityOf(p.sets[p.sets.length - 1]!) >= range.top + 2)
  ) {
    const expected = predict(roundToStep(weight + step, step));
    return {
      direction: 'up',
      expectedKg: expected,
      acceptableKg: [expected],
      reason: '2-for-2 — the last set at top + 2 by capacity twice (BR-TRAINING-042)',
    };
  }

  if (atWorkingWeight) {
    const last = newest.sets[newest.sets.length - 1]!;
    const belowByReps = last.reps < range.floor;
    const belowByCapacity = capacityOf(last) < range.floor;
    if (belowByReps && belowByCapacity && last.rpe != null) {
      // BR-TRAINING-043: a miss — one step down.
      const expected = predict(roundToStep(weight - step, step));
      return {
        direction: 'down',
        expectedKg: expected,
        acceptableKg: [expected],
        reason: 'miss below the floor even by capacity (BR-TRAINING-043)',
      };
    }
    if (belowByReps && last.rpe != null) {
      // RPE ≤ 7 by construction: capacity reached the floor while reps did not.
      return {
        direction: 'hold',
        expectedKg: weight,
        acceptableKg: [weight],
        reason: 'early stop — below the floor by reps, not by capacity (BR-TRAINING-043)',
      };
    }
    if (belowByReps && last.rpe == null) {
      // BR-TRAINING-043: hold and ask the first time; the same at the same load
      // in the previous performance — one step down.
      const repeated =
        previous != null &&
        loadOf(previous) === weight &&
        (previous.sets[previous.sets.length - 1]!.reps ?? 0) < range.floor &&
        previous.sets[previous.sets.length - 1]!.rpe == null;
      if (repeated) {
        const expected = predict(roundToStep(weight - step, step));
        return {
          direction: 'down',
          expectedKg: expected,
          acceptableKg: [expected],
          reason: 'below the floor without RPE at the same load twice (BR-TRAINING-043)',
        };
      }
      return {
        direction: 'hold',
        expectedKg: weight,
        acceptableKg: [weight],
        reason: 'below the floor without RPE — hold and ask the first time (BR-TRAINING-043)',
      };
    }
  }

  return {
    direction: 'hold',
    expectedKg: weight,
    acceptableKg: [weight],
    reason: 'in range with no growth signal — hold (BR-TRAINING-043)',
  };
}
