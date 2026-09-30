import type { E1rmTrendFact, FatigueFact, LoadFacts } from '../../load-facts';
import { decide, type Decision } from '../decide';
import { getScheme } from '../schemes';
import { SHORT_CONSTRAINT, makeFacts } from './fixtures';

/**
 * AC-LP-2: the decision order of design §3.3 — Stage A safety rows (insufficient data, short
 * constraint, gap tier ≥ return, pre-fatigue, below floor) → Stage B (no tactic) → Stage C scheme.
 * The matching stage and row are part of the output.
 */
const double = { scheme: getScheme('double_progression'), goal: 'hypertrophy' as const };

function run(facts: LoadFacts, extra: Partial<Parameters<typeof decide>[1]> = {}): Decision {
  return decide(facts, { ...double, ...extra });
}

const gapOf = (days: number): LoadFacts['gap'] => ({
  exercise: { days },
  primaryMuscles: { days },
  anyWorkout: { days: 1 },
});

const fatigue = (sets: number, fresh = sets === 0): FatigueFact => ({
  perMuscle: sets === 0 ? [] : [{ muscleGroup: 'triceps', workingSets: sets, exerciseNames: ['Dips'] }],
  fresh,
  minutesIntoSession: { absent: 'n/a' },
});

function trend(over: Partial<E1rmTrendFact> = {}): LoadFacts['e1rmTrend'] {
  return { ...(makeFacts().e1rmTrend as E1rmTrendFact), ...over };
}

function exposure(repsVsRange: 'below floor' | 'in range' | 'at or above top'): LoadFacts['lastExposure'] {
  return { ...(makeFacts().lastExposure as object), repsVsRange } as LoadFacts['lastExposure'];
}

describe('AC-LP-2 · Stage A — safety rows', () => {
  it('insufficient data → no record, conservative start', () => {
    const d = run(makeFacts({ workingWeight: { absent: 'insufficient' } }));
    expect(d).toMatchObject({ stage: 'A', row: 'insufficient_data' });
    expect(d.candidate.load).toBeNull();
    expect(d.reason).toBe('no record — conservative start');
  });

  it('short constraint → hold at most the working weight, conservative one step lower', () => {
    const d = run(makeFacts({ constraints: { constraints: [SHORT_CONSTRAINT], equipment: [] } }));
    expect(d).toMatchObject({ stage: 'A', row: 'short_constraint' });
    expect(d.candidate.load).toBe(65);
    expect(d.conservative.load).toBe(60);
    expect(d.reason).toContain('sore shoulder');
  });

  it('gap tier return → one step below the working weight, conservative one lower, confidence one level down', () => {
    const d = run(makeFacts({ gap: gapOf(15) }));
    expect(d).toMatchObject({ stage: 'A', row: 'gap_return' });
    expect(d.candidate.load).toBe(60);
    expect(d.conservative.load).toBe(55);
    expect(d.gap).toEqual({ tier: 'return', days: 15, basis: 'exercise' });
    expect(d.ladder).toMatchObject({ workout: 1, of: 2 });
    expect(d.confidence).toBe('medium');
  });

  it('gap tier rebuild → two steps below, confidence low', () => {
    const d = run(makeFacts({ gap: gapOf(40) }));
    expect(d).toMatchObject({ stage: 'A', row: 'gap_rebuild' });
    expect(d.candidate.load).toBe(55);
    expect(d.conservative.load).toBe(50);
    expect(d.confidence).toBe('low');
  });

  it('gap tier restart → cold start, history is a dated reference only', () => {
    const d = run(makeFacts({ gap: gapOf(100) }));
    expect(d).toMatchObject({ stage: 'A', row: 'gap_restart' });
    expect(d.candidate.load).toBeNull();
    expect(d.conservative.load).toBeNull();
    expect(d.confidence).toBe('low');
    expect(d.reason).toContain('cold start');
  });

  it('the ladder counter advances the return rung (workout 2 of 2 → back to working weight, Stage C takes over)', () => {
    const d = run(makeFacts({ gap: gapOf(15) }), { ladderWorkoutsSince: 1 });
    expect(d.ladder).toMatchObject({ workout: 2, of: 2, stepsBelow: 0 });
    expect(d).toMatchObject({ stage: 'A', row: 'gap_return' });
    expect(d.candidate.load).toBe(65);
    expect(d.conservative.load).toBe(60);
  });

  it('a gap at rest_with_question does not reduce the load', () => {
    const d = run(makeFacts({ gap: gapOf(10) }));
    expect(d.stage).toBe('C');
    expect(d.gap.tier).toBe('rest_with_question');
  });

  it('pre-fatigue materially greater than the reference → hold, conservative one step lower', () => {
    const d = run(makeFacts({ fatigueToday: fatigue(4), fatigueReference: fatigue(0) }));
    expect(d).toMatchObject({ stage: 'A', row: 'pre_fatigue' });
    expect(d.candidate.load).toBe(65);
    expect(d.conservative.load).toBe(60);
  });

  it('very heavy pre-fatigue → the candidate drops one step as well', () => {
    const d = run(makeFacts({ fatigueToday: fatigue(9), fatigueReference: fatigue(0) }));
    expect(d).toMatchObject({ stage: 'A', row: 'pre_fatigue' });
    expect(d.candidate.load).toBe(60);
    expect(d.conservative.load).toBe(55);
  });

  it('fatigue equal to the reference adds nothing', () => {
    const d = run(makeFacts({ fatigueToday: { ...fatigue(6), sameAsReference: true }, fatigueReference: fatigue(6) }));
    expect(d.stage).toBe('C');
  });

  it('a small pre-fatigue difference is not material', () => {
    expect(run(makeFacts({ fatigueToday: fatigue(2), fatigueReference: fatigue(0) })).stage).toBe('C');
  });

  it('below the range floor → −1 step, conservative −2 steps', () => {
    const d = run(makeFacts({ lastExposure: exposure('below floor') }));
    expect(d).toMatchObject({ stage: 'A', row: 'below_floor' });
    expect(d.candidate.load).toBe(60);
    expect(d.conservative.load).toBe(55);
  });

  it('rows are evaluated in the fixed order: constraint and gap (more conservative) before fatigue before floor', () => {
    const all = makeFacts({
      constraints: { constraints: [SHORT_CONSTRAINT], equipment: [] },
      gap: gapOf(40),
      fatigueToday: fatigue(9),
      fatigueReference: fatigue(0),
      lastExposure: exposure('below floor'),
    });
    // Fix-S: the rebuild ladder (−2 steps) is more conservative than the constraint's hold.
    expect(run(all).row).toBe('gap_rebuild');
    expect(run({ ...all, gap: gapOf(3) }).row).toBe('short_constraint');
    expect(run({ ...all, constraints: { constraints: [], equipment: [] } }).row).toBe('gap_rebuild');
    expect(run({ ...all, constraints: { constraints: [], equipment: [] }, gap: gapOf(3) }).row).toBe('pre_fatigue');
    expect(
      run({ ...all, constraints: { constraints: [], equipment: [] }, gap: gapOf(3), fatigueToday: fatigue(0) }).row,
    ).toBe('below_floor');
  });

  it('Fix-S: a restart cold start (no load) beats a short constraint', () => {
    const d = run(makeFacts({ constraints: { constraints: [SHORT_CONSTRAINT], equipment: [] }, gap: gapOf(100) }));
    expect(d).toMatchObject({ row: 'gap_restart' });
    expect(d.candidate.load).toBeNull();
  });

  it('a missing equipment step is named in missing and stated in the reason', () => {
    const d = run(makeFacts({ gap: gapOf(15), equipmentStep: { absent: 'n/a for bodyweight' } }));
    expect(d.missing).toContain('equipmentStep');
    expect(d.reason).toContain('equipmentStep');
    expect(d.candidate.load).toBe(65);
  });
});

describe('AC-LP-2 · Stage B — no tactic until layer 2', () => {
  it('prints tactic none active on every decision', () => {
    expect(run(makeFacts()).tactic).toBe('none active');
    expect(run(makeFacts({ gap: gapOf(40) })).tactic).toBe('none active');
  });
});

describe('AC-LP-2 · Stage C — scheme', () => {
  it('growth: top of the range confirmed twice → one step up', () => {
    const d = run(makeFacts());
    expect(d).toMatchObject({ stage: 'C', row: 'scheme_growth', scheme: { id: 'double_progression', version: 1 } });
    expect(d.candidate.load).toBe(70);
    expect(d.conservative.load).toBe(65);
  });

  it('hold: one confirmation only', () => {
    const d = run(makeFacts({ e1rmTrend: trend({ flatRun: 1 }) }));
    expect(d).toMatchObject({ stage: 'C', row: 'scheme_hold' });
    expect(d.candidate.load).toBe(65);
  });

  it('hold: in range', () => {
    expect(run(makeFacts({ lastExposure: exposure('in range') })).row).toBe('scheme_hold');
  });

  it('runs the scheme it is given (linear)', () => {
    const d = run(makeFacts(), { scheme: getScheme('linear_progression'), goal: 'strength' });
    expect(d.scheme.id).toBe('linear_progression');
    expect(d.candidate.reps).toEqual({ min: 5, max: 5 });
  });

  it('carries the printed outcome word', () => {
    expect(run(makeFacts()).outcome).toBe('one step up');
    expect(run(makeFacts({ lastExposure: exposure('in range') })).outcome).toBe('hold');
    expect(run(makeFacts({ lastExposure: exposure('below floor') })).outcome).toBe('one step down');
    expect(run(makeFacts({ workingWeight: { absent: 'x' } })).outcome).toBe('conservative start');
  });

  it('is pure', () => {
    const f = makeFacts({ gap: gapOf(15) });
    const snap = JSON.stringify(f);
    expect(run(f)).toEqual(run(f));
    expect(JSON.stringify(f)).toBe(snap);
  });
});

/**
 * Task 4 (AC-LP-6, D5, D9): the ladder counter from history, the break reason selects the branch.
 */
describe('AC-LP-6 · Task 4 — return ladder from history and the break reason', () => {
  const GAP_DAYS = { return: 20, rebuild: 30, restart: 100 } as const;
  const ladder = (workoutsSince: number, tier: 'return' | 'rebuild' | 'restart' = 'return') => ({
    tier,
    gapDays: GAP_DAYS[tier],
    gapStart: new Date('2026-08-01T10:00:00Z'),
    gapEnd: new Date('2026-08-25T10:00:00Z'),
    workoutsSince,
    performancesSince: workoutsSince,
  });

  it('after a gap, with the gap closed: workout 2 of 2 → back at the working weight, row stays gap_return', () => {
    const d = run(makeFacts({ gap: gapOf(3) }), { ladder: ladder(1) });
    expect(d).toMatchObject({ stage: 'A', row: 'gap_return' });
    expect(d.ladder).toMatchObject({ workout: 2, of: 2, stepsBelow: 0 });
    expect(d.candidate.load).toBe(65);
  });

  it('Fix-S: a short constraint ties with the last rung of a ladder (both hold) → the constraint row', () => {
    const d = run(makeFacts({ constraints: { constraints: [SHORT_CONSTRAINT], equipment: [] }, gap: gapOf(3) }), {
      ladder: ladder(1),
    });
    expect(d).toMatchObject({ stage: 'A', row: 'short_constraint' });
  });

  it('a finished ladder falls through to Stage C', () => {
    const d = run(makeFacts({ gap: gapOf(3) }), { ladder: ladder(2) });
    expect(d.stage).toBe('C');
    expect(d.ladder).toBeNull();
  });

  it('a miss repeats the rung: no successful workout yet → still workout 1', () => {
    const d = run(makeFacts({ gap: gapOf(3) }), { ladder: { ...ladder(0), performancesSince: 1 } });
    expect(d.ladder).toMatchObject({ workout: 1, stepsBelow: 1 });
    expect(d.candidate.load).toBe(60);
  });

  it('the current gap wins over an old ladder', () => {
    const d = run(makeFacts({ gap: gapOf(40) }), { ladder: ladder(1) });
    expect(d).toMatchObject({ row: 'gap_rebuild' });
    expect(d.ladder).toMatchObject({ workout: 1, of: 3 });
  });

  it('restart: first workout cold start, the next one follows the rebuild ladder', () => {
    const d = run(makeFacts({ gap: gapOf(3) }), { ladder: ladder(1, 'restart') });
    expect(d.candidate.load).toBe(55);
    // Post-restart rungs are labelled gap_rebuild, not gap_return.
    expect(d.row).toBe('gap_rebuild');
  });

  it('reason unknown → one step lower on the ladder', () => {
    const d = run(makeFacts({ gap: gapOf(15) }), { breakReason: 'unknown' });
    expect(d.candidate.load).toBe(55);
    expect(d.reason).toContain('reason unknown');
  });

  it('illness → one step lower as well, with a well-being check printed', () => {
    const d = run(makeFacts({ gap: gapOf(15) }), { breakReason: 'illness' });
    expect(d.candidate.load).toBe(55);
    expect(d.reason).toContain('illness');
    expect(d.reason).toContain('well-being');
  });

  it.each(['holiday_work_no_time', 'deliberate_deload', 'injury'] as const)('%s → the standard ladder', reason => {
    expect(run(makeFacts({ gap: gapOf(15) }), { breakReason: reason }).candidate.load).toBe(60);
  });

  it('stress / poor sleep → standard ladder plus a caution for the first week', () => {
    const d = run(makeFacts({ gap: gapOf(15) }), { breakReason: 'stress_poor_sleep' });
    expect(d.candidate.load).toBe(60);
    expect(d.reason).toContain('caution');
  });

  it('deliberate deload at rest_with_question: no reduction, Stage C', () => {
    const d = run(makeFacts({ gap: gapOf(10) }), { breakReason: 'deliberate_deload' });
    expect(d.stage).toBe('C');
  });

  it('the reason never reaches a tier below the ladder (rest stays rest)', () => {
    expect(run(makeFacts({ gap: gapOf(3) }), { breakReason: 'illness' }).stage).toBe('C');
  });
});

describe('AC-LPF-1 · the step-down floor — no candidate or conservative is ever ≤ 0', () => {
  // Lateral Raise Machine shape (replay C1): working weight 2.5 kg, machine step 5 kg.
  const lateral = (over: Partial<LoadFacts> = {}): LoadFacts =>
    makeFacts({
      workingWeight: { weight: 2.5, unit: 'kg', performances: 4, warmupsEstimated: false, mixedBasisExcluded: 0 },
      ...over,
    });

  it('gap rebuild ladder with a step larger than the load keeps a positive candidate and conservative', () => {
    // 207 d gap before the last workout: the restart ladder's first rung after the cold start is a rebuild rung.
    const d = run(lateral(), {
      ladder: {
        tier: 'restart',
        gapDays: 207,
        gapStart: new Date('2026-02-20T00:00:00Z'),
        gapEnd: new Date('2026-09-10T00:00:00Z'),
        workoutsSince: 1,
        performancesSince: 1,
      },
    });
    expect(d.row).toBe('gap_rebuild');
    expect(d.candidate.load).toBeGreaterThan(0);
    expect(d.conservative.load).toBeGreaterThan(0);
  });

  it.each([
    ['return tier', gapOf(15)],
    ['rebuild tier', gapOf(60)],
  ])('%s with reason unknown (one extra step) stays positive', (_n, gap) => {
    const d = run(lateral({ gap }), { breakReason: 'unknown' });
    expect(d.candidate.load).toBeGreaterThan(0);
    expect(d.conservative.load).toBeGreaterThan(0);
  });

  it('short constraint, below floor and pre-fatigue rows stay positive', () => {
    const constrained = run(lateral({ constraints: { constraints: [SHORT_CONSTRAINT], equipment: [] } }));
    expect(constrained.conservative.load).toBeGreaterThan(0);
    const below = run(lateral({ lastExposure: exposure('below floor') }));
    expect(below.candidate.load).toBeGreaterThan(0);
    expect(below.conservative.load).toBeGreaterThan(0);
    const heavy = run(lateral({ fatigueReference: fatigue(0, true), fatigueToday: fatigue(6, false) }));
    expect(heavy.candidate.load).toBeGreaterThan(0);
    expect(heavy.conservative.load).toBeGreaterThan(0);
  });

  it('scheme hold (no growth) conservative stays positive', () => {
    const d = run(lateral({ lastExposure: exposure('in range') }));
    expect(d.conservative.load).toBeGreaterThan(0);
  });

  it('a step that still leaves a positive load is taken as before', () => {
    const d = run(makeFacts({ gap: gapOf(15) }));
    expect([d.candidate.load, d.conservative.load]).toEqual([60, 55]);
  });
});
