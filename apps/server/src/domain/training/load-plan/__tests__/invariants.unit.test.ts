import { isAbsent, type LoadFacts, type PerformanceInput } from '../../load-facts';
import { decide, type DecideInput, preFatigueDelta, type Decision } from '../decide';
import { getScheme } from '../schemes';

import { factsOf, generateCase, type GeneratedCase } from './history-generator';

/**
 * AC-LPF-12 (c): invariants of the recommendation over thousands of seeded generated histories (deterministic seeds;
 * a failure names the seed, so `generateCase(seed)` reproduces it).
 */
const CASES = 2500;
const EPS = 1e-6;
const double: DecideInput = { scheme: getScheme('double_progression'), goal: 'hypertrophy' };
const linear: DecideInput = { scheme: getScheme('linear_progression'), goal: 'strength' };

interface Run {
  c: GeneratedCase;
  facts: LoadFacts;
  d: Decision;
}

const seeds = Array.from({ length: CASES }, (_v, i) => i + 1);
const cache = new Map<DecideInput, Run[]>();

function runAll(scheme: DecideInput): Run[] {
  const cached = cache.get(scheme);
  if (cached) {
    return cached;
  }
  const runs = seeds.map(seed => {
    const c = generateCase(seed);
    const facts = factsOf(c);
    return { c, facts, d: decide(facts, scheme) };
  });
  cache.set(scheme, runs);
  return runs;
}

const each = (check: (r: Run) => string | null, scheme = double): string[] =>
  runAll(scheme).flatMap(r => {
    const why = check(r);
    return why === null
      ? []
      : [`seed ${r.c.seed}: ${why} (${r.d.row}, ${r.d.candidate.load} / ${r.d.conservative.load})`];
  });

const base = (f: LoadFacts): number | null => (isAbsent(f.workingWeight) ? null : f.workingWeight.weight);
const stepOf = (f: LoadFacts): number | null => (isAbsent(f.equipmentStep) ? null : f.equipmentStep.step);
const grew = ({ facts, d }: Run): boolean => {
  const b = base(facts);
  return b !== null && d.candidate.load !== null && d.candidate.load > b + EPS;
};

const started = Date.now();

describe('AC-LPF-12 · invariants over generated histories', () => {
  it(`the generator is deterministic and produces ${CASES} varied cases`, () => {
    expect(JSON.stringify(generateCase(7))).toBe(JSON.stringify(generateCase(7)));
    const rows = new Set(runAll(double).map(r => r.d.row));
    expect(rows.size).toBeGreaterThanOrEqual(6);
  });

  it('every load is positive and finite — candidate and conservative, both schemes', () => {
    const bad = (r: Run): string | null => {
      const loads = [r.d.candidate.load, r.d.conservative.load].filter((l): l is number => l !== null);
      return loads.every(l => Number.isFinite(l) && l > 0) ? null : 'non-positive load';
    };
    expect(each(bad)).toEqual([]);
    expect(each(bad, linear)).toEqual([]);
  });

  it('never more than one step up from the working weight', () => {
    const tooFar = (r: Run): string | null => {
      const b = base(r.facts);
      const step = stepOf(r.facts);
      if (b === null || r.d.candidate.load === null) {
        return null;
      }
      return r.d.candidate.load <= b + (step ?? 0) + EPS ? null : 'more than one step above the working weight';
    };
    expect(each(tooFar)).toEqual([]);
    expect(each(tooFar, linear)).toEqual([]);
  });

  it('one-session growth never happens at RPE ≥ 9 on the last set', () => {
    const bad = (r: Run): string | null => {
      if (r.d.row !== 'early_growth' || isAbsent(r.facts.repHistory)) {
        return null;
      }
      const rpe = r.facts.repHistory.entries[0]?.lastSetRpe ?? null;
      return rpe !== null && rpe >= 9 ? `one-session growth at RPE ${rpe}` : null;
    };
    expect(each(bad)).toEqual([]);
  });

  it('no growth after a break (gap ≥ 14 d), with a short constraint, or with material pre-fatigue', () => {
    const bad = (r: Run): string | null => {
      if (!grew(r)) {
        return null;
      }
      const gap = r.d.gap.days ?? 0;
      if (gap >= 14) {
        return `growth after a ${gap} d gap`;
      }
      if (r.facts.constraints.constraints.some(x => x.durability === 'short')) {
        return 'growth with a short constraint';
      }
      const delta = preFatigueDelta(r.facts);
      return delta !== null && delta >= 3 ? `growth with pre-fatigue ${delta}` : null;
    };
    expect(each(bad)).toEqual([]);
  });

  it('more reps at the same load never lowers the recommendation (newest session, every set +2)', () => {
    // The working weight is NOT held constant any more (W-23 made it monotone). Held: the reference performance
    // (a like-for-like flip switches the pre-fatigue baseline — reported, W-24) and the decision PATH: a bump that
    // creates a working weight moves a case from the insufficient-data path to the ladder, and after a rebuild the
    // two start differently by the golden table itself (G-47: one step; G-43: two) — reported, W-24.
    let compared = 0;
    const lowers = ({ c, facts, d }: Run): string | null => {
      const [newest] = [...c.performances].sort((a, b) => b.performedAt.getTime() - a.performedAt.getTime());
      if (!newest) {
        return null;
      }
      const bump = (p: PerformanceInput): PerformanceInput =>
        p === newest
          ? {
              ...p,
              sets: p.sets.map(s =>
                s.setData.type === 'strength' && s.setKind !== 'warmup'
                  ? { ...s, setData: { ...s.setData, reps: s.setData.reps + 2 } }
                  : s,
              ),
            }
          : p;
      const bumpedFacts = factsOf(c, c.performances.map(bump));
      const refId = (f: LoadFacts): string | null => (isAbsent(f.reference) ? null : f.reference.performance.id);
      if (refId(bumpedFacts) !== refId(facts)) {
        return null;
      }
      const more = decide(bumpedFacts, double);
      if ((more.row === 'insufficient_data') !== (d.row === 'insufficient_data')) {
        return null;
      }
      compared++;
      const before = d.candidate.load ?? 0;
      return (more.candidate.load ?? 0) >= before - EPS ? null : `+2 reps lowered ${before} → ${more.candidate.load}`;
    };
    expect(each(lowers)).toEqual([]);
    expect(compared).toBeGreaterThan(800); // the held-constant filter must leave a real sample
  });

  it('every row carries a next step', () => {
    const missing = (r: Run): string | null => (r.d.next?.kind ? null : 'no next step');
    expect(each(missing)).toEqual([]);
    expect(each(missing, linear)).toEqual([]);
  });

  it('runs fast enough to stay in the unit suite (all invariants together under ~5 s)', () => {
    expect(Date.now() - started).toBeLessThan(5000);
  });
});
