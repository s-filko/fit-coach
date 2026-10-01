import type { LoadFacts } from '../../load-facts';
import { SCHEMES, UnknownSchemeError, getScheme, type ProgressionScheme, type SchemeGoal } from '../schemes';
import { SHORT_CONSTRAINT, makeFacts } from './fixtures';

/**
 * AC-LP-1 / D3: one fixture set, every registered scheme. A scheme that cannot pass a clause
 * fails here, so a new scheme cannot join the registry without meeting the safety contract.
 */

const GOALS: SchemeGoal[] = ['strength', 'hypertrophy', 'general'];
const STEP_CAP = 0.1;
const EPS = 1e-9;

const schemes = Object.values(SCHEMES) as ProgressionScheme[];

function fixtureSet(): { name: string; facts: LoadFacts }[] {
  const top = makeFacts();
  return [
    { name: 'at range top, 2 confirming sessions', facts: top },
    {
      name: 'at range top, first confirmation only',
      facts: makeFacts({ e1rmTrend: { ...(top.e1rmTrend as object), flatRun: 1 } as LoadFacts['e1rmTrend'] }),
    },
    {
      name: 'in range',
      facts: makeFacts({
        lastExposure: { ...(top.lastExposure as object), repsVsRange: 'in range' } as LoadFacts['lastExposure'],
      }),
    },
    {
      name: 'below floor',
      facts: makeFacts({
        lastExposure: { ...(top.lastExposure as object), repsVsRange: 'below floor' } as LoadFacts['lastExposure'],
      }),
    },
    {
      name: 'light load, step over the 10 % cap',
      facts: makeFacts({
        workingWeight: { weight: 20, unit: 'kg', performances: 4, warmupsEstimated: false, mixedBasisExcluded: 0 },
        equipmentStep: { step: 2.5, unit: 'kg', perHand: false, basis: 'default for cable', capApplies: true },
      }),
    },
    { name: 'no equipment step', facts: makeFacts({ equipmentStep: { absent: 'n/a for bodyweight' } }) },
    { name: 'no e1RM trend', facts: makeFacts({ e1rmTrend: { absent: 'insufficient' } }) },
    { name: 'last exposure absent', facts: makeFacts({ lastExposure: { absent: 'no reference' } }) },
    { name: 'no rep range', facts: makeFacts({ repRange: { absent: 'no rep range' } }) },
    {
      name: 'short constraint on the muscle',
      facts: makeFacts({ constraints: { constraints: [SHORT_CONSTRAINT], equipment: [] } }),
    },
    {
      name: 'insufficient data',
      facts: makeFacts({
        dataSufficiency: { last56Days: 0, allTime: 1 },
        workingWeight: { absent: 'insufficient: 1 performances / 8 wk' },
      }),
    },
  ];
}

describe('AC-LP-1 · scheme registry', () => {
  it('registers double_progression and linear_progression at version 1', () => {
    expect(Object.keys(SCHEMES).sort()).toEqual(['double_progression', 'linear_progression']);
    for (const s of schemes) {
      expect(s.version).toBe(1);
      expect(SCHEMES[s.id as keyof typeof SCHEMES]).toBe(s);
    }
  });

  it('rejects an unknown id', () => {
    expect(() => getScheme('rpe_autoregulation')).toThrow(UnknownSchemeError);
    expect(() => getScheme('')).toThrow(UnknownSchemeError);
    expect(() => getScheme('constructor')).toThrow(UnknownSchemeError);
  });

  it('returns the registered scheme for a known id', () => {
    expect(getScheme('double_progression').id).toBe('double_progression');
  });
});

describe.each(schemes.map(s => [s.id, s] as const))('AC-LP-1 · scheme contract: %s', (_id, scheme) => {
  it('carries its definition: description, coach rule, citation, applicable classes', () => {
    expect(scheme.description.length).toBeGreaterThan(20);
    expect(scheme.coachRule.length).toBeGreaterThan(10);
    expect(scheme.citation.length).toBeGreaterThan(10);
    expect(scheme.applicableTo).toContain('strength');
  });

  describe.each(GOALS)('goal %s', goal => {
    const params = () => scheme.defaultParams(goal);

    it('uses the 2-for-2 confirmation and the 10 % cap as sourced defaults', () => {
      expect(params().confirmSessions).toBe(2);
      expect(params().stepCapPct).toBe(STEP_CAP);
    });

    it.each(fixtureSet())('$name: candidate ≤ working weight + 1 step, conservative ≤ candidate', ({ facts }) => {
      const out = scheme.decide(facts, goal, params());
      if (out.candidate.load === null) {
        expect(out.conservative.load).toBeNull();
        return;
      }
      expect(out.conservative.load).not.toBeNull();
      expect(out.conservative.load as number).toBeLessThanOrEqual(out.candidate.load + EPS);
      expect(out.conservative.load as number).toBeGreaterThanOrEqual(0);
      const base = 'absent' in facts.workingWeight ? null : facts.workingWeight.weight;
      const step = 'absent' in facts.equipmentStep ? 0 : facts.equipmentStep.step;
      expect(base).not.toBeNull();
      expect(out.candidate.load).toBeLessThanOrEqual((base as number) + step + EPS);
    });

    it.each(fixtureSet())('$name: candidate is a whole number of steps from the last load', ({ facts }) => {
      const out = scheme.decide(facts, goal, params());
      if (out.candidate.load === null || 'absent' in facts.workingWeight) {
        return;
      }
      const step = 'absent' in facts.equipmentStep ? null : facts.equipmentStep.step;
      const delta = out.candidate.load - facts.workingWeight.weight;
      if (step === null) {
        expect(delta).toBe(0);
        return;
      }
      const steps = delta / step;
      expect(Math.abs(steps - Math.round(steps))).toBeLessThan(1e-6);
    });

    it.each(fixtureSet())(
      '$name: no step above the 10 % cap — except the equipment smallest step, reps reset',
      ({ facts }) => {
        const out = scheme.decide(facts, goal, params());
        if (out.candidate.load === null || 'absent' in facts.workingWeight) {
          return;
        }
        const base = facts.workingWeight.weight;
        const over = out.candidate.load - base > base * STEP_CAP + EPS;
        if (over) {
          // Run 3: a met growth condition under a blocking cap offers the SMALLEST step (one equipment step) with reps
          // reset to the floor; never more than one step.
          const step = 'absent' in facts.equipmentStep ? 0 : facts.equipmentStep.step;
          expect(out.candidate.load - base).toBeLessThanOrEqual(step + EPS);
          expect(out.candidate.reps.min).toBe(out.candidate.reps.max);
          expect(out.reason).toContain('smallest step');
        }
      },
    );

    it.each(fixtureSet())('$name: every output carries a reason, a confidence and a missing list', ({ facts }) => {
      const out = scheme.decide(facts, goal, params());
      expect(out.reason.length).toBeGreaterThan(0);
      expect(['low', 'medium', 'high']).toContain(out.confidence);
      expect(Array.isArray(out.missing)).toBe(true);
    });

    it('a short constraint forbids growth', () => {
      const free = scheme.decide(makeFacts(), goal, params());
      const constrained = scheme.decide(
        makeFacts({ constraints: { constraints: [SHORT_CONSTRAINT], equipment: [] } }),
        goal,
        params(),
      );
      const base = 65;
      expect(constrained.candidate.load as number).toBeLessThanOrEqual(base);
      expect(constrained.conservative.load as number).toBeLessThanOrEqual(constrained.candidate.load as number);
      // The fixture is one where the scheme would otherwise grow (or at least never do less).
      expect(free.candidate.load as number).toBeGreaterThanOrEqual(constrained.candidate.load as number);
      expect(constrained.reason.toLowerCase()).toContain('constraint');
    });

    it('a long_term constraint does not forbid growth', () => {
      const longTerm = scheme.decide(
        makeFacts({ constraints: { constraints: [{ ...SHORT_CONSTRAINT, durability: 'long_term' }], equipment: [] } }),
        goal,
        params(),
      );
      const free = scheme.decide(makeFacts(), goal, params());
      expect(longTerm.candidate.load).toBe(free.candidate.load);
    });

    it('insufficient data yields the Stage A answer: no load, conservative start, missing named', () => {
      const out = scheme.decide(
        makeFacts({ dataSufficiency: { last56Days: 0, allTime: 1 }, workingWeight: { absent: 'insufficient' } }),
        goal,
        params(),
      );
      expect(out.candidate.load).toBeNull();
      expect(out.conservative.load).toBeNull();
      expect(out.reason).toBe('no record, no reference load');
      expect(out.confidence).toBe('low');
      expect(out.missing).toContain('workingWeight');
    });

    it('unmet requirements are named in missing and stated in the reason, never a silent branch', () => {
      const out = scheme.decide(makeFacts({ equipmentStep: { absent: 'n/a for bodyweight' } }), goal, params());
      expect(out.missing).toContain('equipmentStep');
      expect(out.reason).toContain('equipmentStep');
      expect(out.candidate.load).toBe(65);
    });

    it('is pure: the same input gives the same output and the facts are not mutated', () => {
      const facts = makeFacts();
      const snapshot = JSON.stringify(facts);
      expect(scheme.decide(facts, goal, params())).toEqual(scheme.decide(facts, goal, params()));
      expect(JSON.stringify(facts)).toBe(snapshot);
    });
  });
});

describe('AC-LP-1 · double_progression specifics', () => {
  const s = getScheme('double_progression');
  const p = () => s.defaultParams('hypertrophy');

  it('grows one step at the range top after the confirming sessions, resetting to the range floor', () => {
    const out = s.decide(makeFacts(), 'hypertrophy', p());
    expect(out.candidate).toMatchObject({ load: 70, reps: { min: 8, max: 12 } });
    expect(out.conservative.load).toBe(65);
  });

  it('holds at the top with one confirmation only, and says so', () => {
    const top = makeFacts();
    const facts = makeFacts({ e1rmTrend: { ...(top.e1rmTrend as object), flatRun: 1 } as LoadFacts['e1rmTrend'] });
    const out = s.decide(facts, 'hypertrophy', p());
    expect(out.candidate.load).toBe(65);
    expect(out.reason).toContain('1 of 2');
  });

  it('a step over the 10 % cap with the growth condition met → the smallest step, reps reset to the floor (run 3)', () => {
    const out = s.decide(
      makeFacts({
        workingWeight: { weight: 20, unit: 'kg', performances: 4, warmupsEstimated: false, mixedBasisExcluded: 0 },
        equipmentStep: { step: 2.5, unit: 'kg', perHand: false, basis: 'x', capApplies: true },
      }),
      'hypertrophy',
      p(),
    );
    expect(out.candidate.load).toBe(22.5);
    expect(out.reason).toContain('10 %');
    expect(out.reason).toContain('smallest step');
  });

  it('steps down one step below the range floor', () => {
    const top = makeFacts();
    const out = s.decide(
      makeFacts({
        lastExposure: { ...(top.lastExposure as object), repsVsRange: 'below floor' } as LoadFacts['lastExposure'],
      }),
      'hypertrophy',
      p(),
    );
    expect(out.candidate.load).toBe(65);
    expect(out.conservative.load).toBe(60);
  });
});

describe('AC-LP-1 · linear_progression specifics', () => {
  const s = getScheme('linear_progression');

  it('uses fixed reps that override the goal range', () => {
    const p = s.defaultParams('strength');
    expect(p.fixedReps).toBeGreaterThan(0);
    const out = s.decide(makeFacts(), 'strength', p);
    expect(out.candidate.reps.min).toBe(p.fixedReps);
    expect(out.candidate.reps.max).toBe(p.fixedReps);
  });

  it('adds one step when the fixed reps were made', () => {
    const p = s.defaultParams('strength');
    const top = makeFacts();
    const out = s.decide(
      makeFacts({
        lastExposure: { ...(top.lastExposure as object), repsVsRange: 'in range' } as LoadFacts['lastExposure'],
      }),
      'strength',
      p,
    );
    expect(out.candidate.load).toBe(70);
  });
});
