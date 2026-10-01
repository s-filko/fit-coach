import type { E1rmTrendFact, FatigueFact, LoadFacts, PerformanceInput, SetInput } from '../../load-facts';
import { decide, type Decision } from '../decide';
import { getScheme } from '../schemes';
import { SHORT_CONSTRAINT, makeFacts, repHistoryOf } from './fixtures';

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
    expect(d.reason).toBe('no record, no reference load');
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
    expect(run(makeFacts({ workingWeight: { absent: 'x' } })).outcome).toBe('no number');
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

describe('AC-LPF-3 · insufficient data with a reference still names a number', () => {
  const PERFORMED = new Date('2026-09-25T10:00:00Z');
  const setOf = (weight: number, reps: number): SetInput => ({
    setData: { type: 'strength', reps, weight, weightUnit: 'kg' },
    setKind: 'working',
    rpe: null,
    userFeedback: null,
    createdAt: PERFORMED,
  });
  /** The `reference:` line's performance — e.g. Chest-Supported Row, 20 kg, replay U2/U6. */
  const reference = (sets: SetInput[], daysAgo = 4): LoadFacts['reference'] => ({
    performance: { id: 'p1', sessionId: 's1', performedAt: PERFORMED, sets } as unknown as PerformanceInput,
    daysAgo,
    sets,
    likeForLike: true,
    warmupsEstimated: false,
    rpe: [],
    feedback: [],
  });
  const few = { absent: 'insufficient: 1 performances / 8 wk' };
  const row = (sets: SetInput[], over: Partial<LoadFacts> = {}): LoadFacts =>
    makeFacts({ workingWeight: few, reference: reference(sets), ...over });

  it('prints the reference load as the candidate and one step down as the conservative, low confidence, with the reason', () => {
    const d = run(row([setOf(20, 10), setOf(20, 10), setOf(20, 9)]));
    expect(d).toMatchObject({ stage: 'A', row: 'insufficient_data' });
    expect([d.candidate.load, d.conservative.load]).toEqual([20, 15]);
    expect(d.candidate.unit).toBe('kg');
    expect(d.confidence).toBe('low');
    expect(d.reason).toContain('insufficient: 1 performances / 8 wk');
    expect(d.reason).toContain('last performance');
    expect(d.reason).toContain('4 d ago');
  });

  it('the reference load is the load used in most working sets (heavier on a tie)', () => {
    const d = run(row([setOf(50, 10), setOf(55, 8), setOf(55, 8)]));
    expect(d.candidate.load).toBe(55);
    const tie = run(row([setOf(50, 10), setOf(55, 8)]));
    expect(tie.candidate.load).toBe(55);
  });

  it('the conservative is floored — a step larger than the reference load leaves no lighter option, never 0', () => {
    const d = run(row([setOf(2.5, 12), setOf(2.5, 12)]));
    expect([d.candidate.load, d.conservative.load]).toEqual([2.5, 2.5]);
  });

  it('a break tier starts one step below the reference and says so', () => {
    const d = run(row([setOf(60, 8), setOf(60, 8)], { gap: gapOf(169) }));
    // O-3: a restart is never lighter than a rebuild — two steps below the reference, then the ladder.
    expect([d.candidate.load, d.conservative.load]).toEqual([50, 45]);
    expect(d.reason).toContain('restart tier');
    expect(d.reason).toContain('2 steps below it');
    expect(d.next).toEqual({ kind: 'ladder', remaining: 2, backTo: 60, cold: false });
  });

  it('with no reference at all there is no number and no conservative', () => {
    const d = run(makeFacts({ workingWeight: few, reference: { absent: 'no completed record' } }));
    expect(d.candidate.load).toBeNull();
    expect(d.conservative.load).toBeNull();
    expect(d.reason).toBe('no record, no reference load');
  });

  it('a reference with no loaded set (bodyweight) gives no number either', () => {
    const bodyweight: SetInput = { ...setOf(0, 8), setData: { type: 'strength', reps: 8, weight: 0 } };
    expect(run(row([bodyweight])).candidate.load).toBeNull();
  });
});

describe('LPF review · a floored step-down never claims a step was taken', () => {
  const lateral = (over: Partial<LoadFacts> = {}): LoadFacts =>
    makeFacts({
      workingWeight: { weight: 2.5, unit: 'kg', performances: 4, warmupsEstimated: false, mixedBasisExcluded: 0 },
      ...over,
    });
  const claimsStep = /one step (down|lower|below)/;

  it('pre-fatigue (heavy) floored: the reason says no lighter option, hold', () => {
    const d = run(lateral({ fatigueReference: fatigue(0, true), fatigueToday: fatigue(6, false) }));
    expect(d.row).toBe('pre_fatigue');
    expect(d.candidate.load).toBe(2.5);
    expect(d.reason).not.toMatch(claimsStep);
    expect(d.reason).toContain('no lighter option');
  });

  it('pre-fatigue (heavy) with room: still "one step down"', () => {
    const d = run(makeFacts({ fatigueReference: fatigue(0, true), fatigueToday: fatigue(6, false) }));
    expect(d.reason).toContain('one step down');
  });

  it('below floor floored: the reason says no lighter option, hold', () => {
    const d = run(lateral({ lastExposure: exposure('below floor') }));
    expect(d.row).toBe('below_floor');
    expect(d.reason).not.toMatch(claimsStep);
    expect(d.reason).toContain('no lighter option');
  });

  it('gap ladder with reason unknown, floored: no "one step lower" claim', () => {
    const d = run(lateral({ gap: gapOf(15) }), { breakReason: 'unknown' });
    expect(d.candidate.load).toBe(2.5);
    expect(d.reason).not.toMatch(claimsStep);
    expect(d.reason).toContain('no lighter option');
  });

  it('insufficient data after a break tier, floored: outcome and reason do not claim a step', () => {
    const set = (w: number): SetInput => ({
      setData: { type: 'strength', reps: 10, weight: w, weightUnit: 'kg' },
      setKind: 'working',
      rpe: null,
      userFeedback: null,
      createdAt: new Date('2026-09-25T10:00:00Z'),
    });
    const reference = {
      performance: { id: 'p', sessionId: 's', performedAt: new Date(), sets: [set(2.5)] },
      daysAgo: 60,
      sets: [set(2.5), set(2.5)],
      likeForLike: true,
      warmupsEstimated: false,
      rpe: [],
      feedback: [],
    } as unknown as LoadFacts['reference'];
    const d = run(makeFacts({ workingWeight: { absent: 'insufficient' }, reference, gap: gapOf(60) }));
    expect(d.candidate.load).toBe(2.5);
    expect(d.outcome).not.toMatch(claimsStep);
    expect(d.reason).not.toMatch(claimsStep);
    expect(d.reason).toContain('no lighter option');
  });

  it('insufficient data with an unknown step: the equipmentStep note, missing, and no lighter-option claim', () => {
    const set: SetInput = {
      setData: { type: 'strength', reps: 10, weight: 20, weightUnit: 'kg' },
      setKind: 'working',
      rpe: null,
      userFeedback: null,
      createdAt: new Date(),
    };
    const reference = {
      performance: { id: 'p', sessionId: 's', performedAt: new Date(), sets: [set] },
      daysAgo: 4,
      sets: [set],
      likeForLike: true,
      warmupsEstimated: false,
      rpe: [],
      feedback: [],
    } as unknown as LoadFacts['reference'];
    const d = run(
      makeFacts({ workingWeight: { absent: 'insufficient' }, reference, equipmentStep: { absent: 'unknown' } }),
    );
    expect(d.missing).toContain('equipmentStep');
    expect(d.reason).toContain('equipmentStep missing — steps cannot be computed');
    expect(d.reason).not.toContain('no lighter option');
  });

  it('no reference: the outcome says no number, never "conservative start"', () => {
    const d = run(makeFacts({ workingWeight: { absent: 'insufficient' }, reference: { absent: 'none' } }));
    expect(d.outcome).toBe('no number');
  });
});

describe('AC-LPF-9 · volume is context, not a decision input', () => {
  const volume = (newest: number, previous: number): LoadFacts['volume'] => ({
    unit: 'kg',
    newest: { volume: newest, daysAgo: 4 },
    previous: { volume: previous, daysAgo: 9 },
    changePct: ((newest - previous) / previous) * 100,
  });

  it.each([
    ['absent', { absent: 'fewer than 2 performances with a load' }],
    ['up a lot', volume(9000, 1000)],
    ['down a lot', volume(100, 9000)],
  ] as [string, LoadFacts['volume']][])('volume %s changes no decision field', (_name, v) => {
    expect(run(makeFacts({ volume: v }))).toEqual(run(makeFacts()));
  });
});

describe('AC-LPF-6 · 2-for-2 on the sets at the working weight (NSCA)', () => {
  const noTrend = { e1rmTrend: { absent: 'insufficient: 2 performances' } } as Partial<LoadFacts>;
  const range = { repRange: { min: 10, max: 12, source: 'today' as const } };
  const facts = (perfs: Parameters<typeof repHistoryOf>[1], over: Partial<LoadFacts> = {}) =>
    makeFacts({ ...noTrend, ...range, repHistory: repHistoryOf(65, perfs), ...over });

  it('last set ≥ top + 2 in the two newest performances at the working weight → +1 step, conservative = the working weight', () => {
    const d = run(facts([{ reps: [12, 12, 14] }, { reps: [12, 13, 14] }]));
    expect(d).toMatchObject({ stage: 'C', row: 'scheme_growth', outcome: 'one step up' });
    expect(d.candidate).toMatchObject({ load: 70, reps: { min: 10, max: 12 } });
    expect(d.conservative.load).toBe(65);
    expect(d.missing).not.toContain('e1rmTrend');
    expect(d.reason).toContain('last set at the working weight');
  });

  it('one session only → hold, and the next step names the one session still missing', () => {
    const d = run(facts([{ reps: [12, 12, 14] }, { reps: [12, 12, 12] }]));
    expect(d).toMatchObject({ row: 'scheme_hold' });
    expect(d.candidate.load).toBe(65);
    expect(d.reason).toContain('confirmation 1 of 2');
    expect(d.reason).not.toContain('cannot count');
    expect(d.next).toEqual({ kind: 'growth', sessions: 1, reps: 14, load: 70 });
  });

  it('neither session → hold, two sessions are named', () => {
    const d = run(facts([{ reps: [12, 12, 12] }, { reps: [12, 12, 13] }]));
    expect(d.candidate.load).toBe(65);
    expect(d.next).toEqual({ kind: 'growth', sessions: 2, reps: 14, load: 70 });
  });

  it('a performance at another load between them breaks the run', () => {
    const d = run(facts([{ reps: [14] }, { reps: [] }, { reps: [14] }]));
    expect(d.candidate.load).toBe(65);
    expect(d.next).toMatchObject({ sessions: 1 });
  });

  it('the old e1RM-trend confirmation still serves facts without a rep history', () => {
    const d = run(makeFacts({ ...range }));
    expect(d.candidate.load).toBe(70);
  });

  it('never more than one step, whatever the surplus', () => {
    const d = run(facts([{ reps: [20] }, { reps: [20] }]));
    expect(d.candidate.load).toBe(70);
  });

  it('a load step above 10 % of the load progresses by reps, with that as the next step', () => {
    const d = run(
      makeFacts({
        ...noTrend,
        ...range,
        workingWeight: { weight: 2.5, unit: 'kg', performances: 5, warmupsEstimated: false, mixedBasisExcluded: 0 },
        repHistory: repHistoryOf(2.5, [{ reps: [15] }, { reps: [15] }]),
      }),
    );
    expect(d.candidate.load).toBe(2.5);
    expect(d.reason).toContain('progress by reps');
    expect(d.next).toEqual({ kind: 'reps_only', step: 5, load: 2.5 });
  });

  it('owner leg press after 09-21 (last set 12 vs top 12, range 10–12): hold, two sessions at ≥ 14', () => {
    const d = run(
      makeFacts({
        ...noTrend,
        ...range,
        workingWeight: { weight: 120, unit: 'kg', performances: 5, warmupsEstimated: false, mixedBasisExcluded: 0 },
        repHistory: repHistoryOf(120, [{ reps: [12, 12] }, { reps: [] }, { reps: [] }]),
      }),
    );
    expect(d.candidate.load).toBe(120);
    expect(d.next).toEqual({ kind: 'growth', sessions: 2, reps: 14, load: 125 });
  });
});

describe('AC-LPF-7 · one-session growth (APRE-style surplus on the last set)', () => {
  // 3 × 15 at 50 kg four days ago, range 8–10, machine step 5 kg (owner example).
  const base = (over: Partial<LoadFacts> = {}): LoadFacts =>
    makeFacts({
      workingWeight: { weight: 50, unit: 'kg', performances: 5, warmupsEstimated: false, mixedBasisExcluded: 0 },
      repRange: { min: 8, max: 10, source: 'today' },
      e1rmTrend: { absent: 'insufficient: 2 performances' },
      repHistory: repHistoryOf(50, [{ reps: [15, 15, 15], daysAgo: 4 }]),
      lastExposure: exposure('at or above top'),
      gap: gapOf(4),
      ...over,
    });

  it('last set ≥ top + 3, RPE absent, recovered → 55 × 8–10, conservative 50, medium at most, evidence named', () => {
    const d = run(base());
    expect(d).toMatchObject({ stage: 'C', row: 'early_growth', outcome: 'one step up' });
    expect(d.candidate).toEqual({ load: 55, unit: 'kg', reps: { min: 8, max: 10 } });
    expect(d.conservative).toEqual({ load: 50, unit: 'kg', reps: { min: 8, max: 10 } });
    expect(d.confidence).toBe('medium');
    expect(d.reason).toContain('3×15 at 50 kg 4 d ago');
    expect(d.reason).toContain('recovered');
    expect(d.next).toEqual({ kind: 'after_growth', load: 55, reps: 10 });
  });

  it('RPE 8 on the last set still qualifies; RPE 9 does not', () => {
    expect(run(base({ repHistory: repHistoryOf(50, [{ reps: [15, 15, 15], rpe: 8 }]) })).row).toBe('early_growth');
    const d = run(base({ repHistory: repHistoryOf(50, [{ reps: [15, 15, 15], rpe: 9 }]) }));
    expect(d.row).toBe('scheme_hold');
    expect(d.candidate.load).toBe(50);
  });

  it('a surplus of 2 (not 3) on one session is not enough alone', () => {
    const d = run(base({ repHistory: repHistoryOf(50, [{ reps: [12, 12, 12] }]) }));
    expect(d.row).toBe('scheme_hold');
  });

  it('only the LAST set counts: a strong opener with a weak last set does not jump', () => {
    const d = run(base({ repHistory: repHistoryOf(50, [{ reps: [15, 12, 9] }]) }));
    expect(d.row).toBe('scheme_hold');
  });

  it.each([
    ['a short constraint', { constraints: { constraints: [SHORT_CONSTRAINT], equipment: [] } }, 'short_constraint'],
    ['a return-tier gap', { gap: gapOf(15) }, 'gap_return'],
    ['material pre-fatigue today', { fatigueToday: fatigue(3), fatigueReference: fatigue(0) }, 'pre_fatigue'],
  ] as [string, Partial<LoadFacts>, string][])('no jump with %s', (_name, over, row) => {
    const d = run(base(over));
    expect(d.row).toBe(row);
    expect(d.candidate.load).toBeLessThanOrEqual(50);
  });

  it('no jump when the step exceeds the 10 % cap (lateral raise)', () => {
    const d = run(
      base({
        workingWeight: { weight: 2.5, unit: 'kg', performances: 5, warmupsEstimated: false, mixedBasisExcluded: 0 },
        repHistory: repHistoryOf(2.5, [{ reps: [15, 15, 15] }]),
      }),
    );
    expect(d.row).toBe('scheme_hold');
    expect(d.candidate.load).toBe(2.5);
  });

  it('a fixed-rep scheme never takes the one-session jump', () => {
    const d = decide(base({ repRange: { min: 5, max: 5, source: 'today' } }), {
      scheme: getScheme('linear_progression'),
      goal: 'strength',
    });
    expect(d.row).not.toBe('early_growth');
  });
});

describe('AC-LPF-7 · uneven performance and the opener', () => {
  const dropOff = (value: number, usual: number | null): LoadFacts['lastExposure'] =>
    ({
      ...(makeFacts().lastExposure as object),
      dropOff: { value, usual },
    }) as LoadFacts['lastExposure'];

  it('drop-off far above the usual (> usual + 3) → hold, neither growth nor step down, the reason names the opener', () => {
    const d = run(
      makeFacts({
        lastExposure: { ...(dropOff(6, 1) as object), repsVsRange: 'below floor' } as LoadFacts['lastExposure'],
      }),
    );
    expect(d).toMatchObject({ stage: 'A', row: 'uneven_performance', outcome: 'hold' });
    expect(d.candidate.load).toBe(65);
    expect(d.conservative.load).toBe(60);
    expect(d.reason).toContain('reps fell by 6');
    expect(d.reason).toContain('opening set');
    expect(d.reason).toContain('neither for growth nor for a step down');
    expect(d.next).toEqual({ kind: 'uneven', load: 65, maxDrop: 4 });
  });

  it('with no norm the threshold is a drop above 4', () => {
    expect(run(makeFacts({ lastExposure: dropOff(5, null) })).row).toBe('uneven_performance');
    expect(run(makeFacts({ lastExposure: dropOff(4, null) })).row).not.toBe('uneven_performance');
  });

  it('exactly usual + 3 is still even', () => {
    expect(run(makeFacts({ lastExposure: dropOff(4, 1) })).row).not.toBe('uneven_performance');
  });

  it('an even performance that is below the floor still steps down', () => {
    const d = run(
      makeFacts({
        lastExposure: { ...(dropOff(0, 0) as object), repsVsRange: 'below floor' } as LoadFacts['lastExposure'],
      }),
    );
    expect(d.row).toBe('below_floor');
    expect(d.next).toMatchObject({ kind: 'step_down', backTo: 65 });
  });
});

describe('AC-LPF-8 · every decision carries the next step', () => {
  it('short constraint, ladder, pre-fatigue, insufficient data, no number, hold, growth', () => {
    expect(run(makeFacts({ constraints: { constraints: [SHORT_CONSTRAINT], equipment: [] } })).next).toEqual({
      kind: 'constraint',
    });
    expect(run(makeFacts({ gap: gapOf(15) })).next).toEqual({ kind: 'ladder', remaining: 1, backTo: 65, cold: false });
    expect(run(makeFacts({ gap: gapOf(30) })).next).toEqual({ kind: 'ladder', remaining: 2, backTo: 65, cold: false });
    expect(run(makeFacts({ gap: gapOf(90) })).next).toEqual({ kind: 'ladder', remaining: 3, backTo: 65, cold: true });
    expect(run(makeFacts({ fatigueToday: fatigue(3), fatigueReference: fatigue(0) })).next).toEqual({
      kind: 'pre_fatigue',
      load: 65,
    });
    expect(run(makeFacts({ workingWeight: { absent: 'insufficient: 1 performances / 8 wk' } })).next).toEqual({
      kind: 'no_number',
    });
    expect(run(makeFacts()).next).toMatchObject({ kind: 'after_growth' });
  });

  it('the last rung of a ladder says growth rules apply again after it', () => {
    const d = run(makeFacts({ gap: gapOf(15) }), { ladderWorkoutsSince: 1 });
    expect(d.next).toEqual({ kind: 'ladder', remaining: 0, backTo: 65, cold: false });
  });
});

describe('AC-LPF-5 · an estimated working weight', () => {
  const estimated = (over: Partial<LoadFacts> = {}): LoadFacts =>
    makeFacts({
      workingWeight: {
        weight: 50,
        unit: 'kg',
        performances: 2,
        warmupsEstimated: false,
        mixedBasisExcluded: 0,
        estimatedFrom: { weight: 55, reps: 7 },
      },
      repRange: { min: 8, max: 10, source: 'today' },
      repHistory: repHistoryOf(50, [{ reps: [] }, { reps: [] }]),
      lastExposure: exposure('below floor'),
      ...over,
    });

  it('is not stepped down again for the same below-floor performance; the reason says where it came from', () => {
    const d = run(estimated());
    expect(d).toMatchObject({ stage: 'C', row: 'scheme_hold' });
    expect(d.candidate.load).toBe(50);
    expect(d.reason).toBe('working weight estimated from 55×7 (short of the rep floor at the heavier load) — hold');
    expect(d.next).toEqual({ kind: 'estimated', load: 50, reps: 8 });
    expect(d.confidence).not.toBe('high');
  });

  it('Stage A safety rows still apply on top (short constraint, gap)', () => {
    expect(run(estimated({ constraints: { constraints: [SHORT_CONSTRAINT], equipment: [] } })).row).toBe(
      'short_constraint',
    );
    expect(run(estimated({ gap: gapOf(15) })).row).toBe('gap_return');
  });
});

describe('AC-LPF-11 · reps in reserve in the decision rows', () => {
  const withEffort = (
    effort: Partial<NonNullable<Extract<LoadFacts['lastExposure'], { effort: unknown }>['effort']>>,
    vs: 'below floor' | 'in range' | 'at or above top' = 'in range',
  ): LoadFacts['lastExposure'] =>
    ({
      ...(makeFacts().lastExposure as object),
      repsVsRange: vs,
      effort: { earlyStop: false, unclearBelowFloor: false, set: null, ...effort },
    }) as LoadFacts['lastExposure'];

  it('early stop (6 @ RPE 7): hold, NO step down, the next step says the load is within reach', () => {
    const d = run(makeFacts({ lastExposure: withEffort({ earlyStop: true, set: { reps: 6, rpe: 7 } }) }));
    expect(d).toMatchObject({ stage: 'A', row: 'early_stop', outcome: 'hold' });
    expect(d.candidate.load).toBe(65);
    expect(d.reason).toContain('6 reps at RPE 7');
    expect(d.reason).toContain('early stop');
    expect(d.next).toEqual({ kind: 'early_stop', load: 65, reps: 8 });
  });

  it('an early stop beats growth evidence in the same performance', () => {
    const d = run(
      makeFacts({
        lastExposure: withEffort({ earlyStop: true, set: { reps: 6, rpe: 7 } }),
        repHistory: repHistoryOf(65, [{ reps: [14] }, { reps: [14] }]),
      }),
    );
    expect(d.row).toBe('early_stop');
  });

  it('a lone below-floor set without RPE never steps down on its own: hold and ask', () => {
    const d = run(
      makeFacts({ lastExposure: withEffort({ unclearBelowFloor: true, set: { reps: 6, rpe: null } }, 'below floor') }),
    );
    expect(d).toMatchObject({ stage: 'A', row: 'unclear_effort', outcome: 'hold' });
    expect(d.candidate.load).toBe(65);
    expect(d.reason).toContain('6 reps');
    expect(d.reason).toContain('without RPE');
    expect(d.next).toEqual({ kind: 'ask_effort', load: 65, stepDownTo: 60 });
  });

  it('a below-floor performance that is a real miss (RPE given, or several sets) still steps down', () => {
    const d = run(makeFacts({ lastExposure: withEffort({}, 'below floor') }));
    expect(d.row).toBe('below_floor');
    expect(d.candidate.load).toBe(60);
  });

  it('growth reads capacity: 12 reps @ RPE 8 (14) twice in a row is 2-for-2 at top 12', () => {
    const d = run(
      makeFacts({
        e1rmTrend: { absent: 'x' },
        repRange: { min: 10, max: 12, source: 'today' },
        repHistory: repHistoryOf(65, [
          { reps: [12, 12], rpe: 8 },
          { reps: [12, 12], rpe: 8 },
        ]),
      }),
    );
    expect(d).toMatchObject({ row: 'scheme_growth', outcome: 'one step up' });
  });

  it('one-session growth reads capacity too: 13 @ RPE 8 (15) vs top 12; RPE 9 still blocks it', () => {
    const base = (rpe: number) =>
      makeFacts({
        e1rmTrend: { absent: 'x' },
        repRange: { min: 10, max: 12, source: 'today' },
        gap: gapOf(4),
        repHistory: repHistoryOf(65, [{ reps: [12, 13], rpe }]),
      });
    expect(run(base(8)).row).toBe('early_growth');
    expect(run(base(9)).row).toBe('scheme_hold');
  });

  it('without RPE the reps are the capacity: 13 vs top 12 → one-session growth, 12 → hold', () => {
    const f = (last: number) =>
      makeFacts({
        e1rmTrend: { absent: 'x' },
        repRange: { min: 10, max: 12, source: 'today' },
        gap: gapOf(4),
        repHistory: repHistoryOf(65, [{ reps: [12, last] }]),
      });
    expect(run(f(15)).row).toBe('early_growth');
    expect(run(f(13)).row).toBe('scheme_hold');
  });
});

describe('AC-LPF-12 · golden-table rulings in the domain', () => {
  const grown = (over: Partial<LoadFacts> = {}): LoadFacts =>
    makeFacts({
      workingWeight: { weight: 50, unit: 'kg', performances: 5, warmupsEstimated: false, mixedBasisExcluded: 0 },
      repRange: { min: 8, max: 10, source: 'today' },
      e1rmTrend: { absent: 'x' },
      repHistory: repHistoryOf(50, [{ reps: [15, 15, 15] }]),
      gap: gapOf(4),
      ...over,
    });

  it('G-15: recovered = gap tier rest OR rest_with_question — 9 d off the exercise still allows one-session growth', () => {
    expect(run(grown({ gap: gapOf(9) }))).toMatchObject({ row: 'early_growth' });
    expect(run(grown({ gap: gapOf(15) })).row).toBe('gap_return');
  });

  it('G-16: a short constraint on a primary muscle keeps one step down and adds "or skip / substitute"', () => {
    const d = run(grown({ constraints: { constraints: [{ ...SHORT_CONSTRAINT, onPrimary: true }], equipment: [] } }));
    expect(d.row).toBe('short_constraint');
    expect(d.conservative.load).toBe(45);
    expect(d.reason).toContain('or skip / substitute');
  });

  it('G-17: a short constraint on a secondary muscle only does not block growth', () => {
    const d = run(grown({ constraints: { constraints: [{ ...SHORT_CONSTRAINT, onPrimary: false }], equipment: [] } }));
    expect(d.row).toBe('early_growth');
    expect(d.candidate.load).toBe(55);
  });

  it('O-2: where the machine adds its own weight the 10 % cap is waived — 2.5 kg + 5 kg, with the small-step note', () => {
    const d = run(
      grown({
        workingWeight: { weight: 2.5, unit: 'kg', performances: 5, warmupsEstimated: false, mixedBasisExcluded: 0 },
        equipmentStep: { step: 5, unit: 'kg', perHand: false, basis: 'default for machine', capApplies: false },
        repHistory: repHistoryOf(2.5, [{ reps: [15, 15, 15] }, { reps: [15, 15, 15] }]),
        repRange: { min: 10, max: 12, source: 'today' },
      }),
    );
    expect(d).toMatchObject({ row: 'scheme_growth', outcome: 'one step up' });
    expect(d.candidate.load).toBe(7.5);
    expect(d.reason).toContain('relatively small step');
  });

  it('O-2: free weights keep the cap — 20 kg + 2.5 kg barbell step holds, progress by reps', () => {
    const d = run(
      grown({
        workingWeight: { weight: 20, unit: 'kg', performances: 5, warmupsEstimated: false, mixedBasisExcluded: 0 },
        equipmentStep: { step: 2.5, unit: 'kg', perHand: false, basis: 'default for barbell', capApplies: true },
        repHistory: repHistoryOf(20, [{ reps: [12, 12, 12] }, { reps: [12, 12, 12] }]),
      }),
    );
    expect(d.row).toBe('scheme_hold');
    expect(d.next).toEqual({ kind: 'reps_only', step: 2.5, load: 20 });
  });

  it('G-11: with one performance the insufficient-data load is the working-weight value, not the failed opener', () => {
    const d = run(
      makeFacts({
        workingWeight: { absent: 'insufficient: 1 performances / 8 wk' },
        indicativeLoad: { weight: 50, unit: 'kg', estimatedFrom: { weight: 55, reps: 7 } },
        reference: { absent: 'x' } as never,
      }),
    );
    expect(d.row).toBe('insufficient_data');
  });

  it('G-51: a record without a load (bodyweight) is the reps-only path — no load number, and not "no record"', () => {
    const reference = {
      performance: {} as never,
      daysAgo: 4,
      sets: [{ setData: { type: 'strength', reps: 8 }, rpe: null, userFeedback: null, createdAt: new Date() }],
      likeForLike: true,
      warmupsEstimated: false,
      rpe: [],
      feedback: [],
    } as unknown as LoadFacts['reference'];
    const d = run(
      makeFacts({
        workingWeight: { absent: 'insufficient: 1 performances / 8 wk' },
        indicativeLoad: { absent: 'no load reached the rep floor' },
        reference,
      }),
    );
    expect(d.candidate.load).toBeNull();
    expect(d.reason).toContain('progress by reps');
    expect(d.reason).not.toContain('no record');
    expect(d.next).toMatchObject({ kind: 'hold' });
  });

  it('O-3: after a restart the start is never lighter than after a rebuild — two steps below, then the ladder', () => {
    const reference = {
      performance: {} as never,
      daysAgo: 100,
      sets: [
        { setData: { type: 'strength', reps: 10, weight: 60 }, rpe: null, userFeedback: null, createdAt: new Date() },
      ],
      likeForLike: true,
      warmupsEstimated: false,
      rpe: [],
      feedback: [],
    } as unknown as LoadFacts['reference'];
    const d = run(
      makeFacts({
        workingWeight: { absent: 'insufficient: 0 performances / 8 wk' },
        indicativeLoad: { weight: 60, unit: 'kg' },
        reference,
        gap: gapOf(100),
      }),
    );
    expect([d.candidate.load, d.conservative.load]).toEqual([50, 45]);
    expect(d.outcome).toBe('2 steps below the reference');
    expect(d.next).toEqual({ kind: 'ladder', remaining: 2, backTo: 60, cold: false });
  });

  it('G-26: 2-for-2 has no RPE condition — 12 @ RPE 9 twice grows (the RPE ≥ 9 guard is one-session growth only)', () => {
    const d = run(
      grown({
        repHistory: repHistoryOf(50, [
          { reps: [12, 12, 12], rpe: 9 },
          { reps: [12, 12, 12], rpe: 9 },
        ]),
      }),
    );
    expect(d).toMatchObject({ row: 'scheme_growth', outcome: 'one step up' });
  });
});
