import {
  computeLoadFacts,
  isAbsent,
  computeDataSufficiency,
  computeFatigue,
  computeReference,
  computeWorkingWeight,
  computeE1rmTrend,
  computeLastExposure,
  computeGap,
  computeConstraints,
  computeEquipmentStep,
  computeVolume,
  classifySets,
} from '../index';
import {
  NOW,
  TZ,
  barbellBench,
  benchPress,
  daysBefore,
  emptyContext,
  LATERAL_RAISE_ROWS,
  lateralRaise,
  LEG_PRESS_ROWS,
  legPress,
  other,
  ownerNow,
  ownerPerfs,
  perf,
  strengthSet,
  today,
  withKind,
} from './fixtures';

const RANGE = { min: 8, max: 12 };

describe('AC-LF-1 · classifySets (D7)', () => {
  it('drops explicit warm-ups, keeps explicit working sets regardless of weight', () => {
    const sets = [
      withKind(strengthSet(20, 10), 'warmup'),
      withKind(strengthSet(30, 10), 'working'),
      strengthSet(100, 8, { setKind: 'working' }),
    ];
    const r = classifySets(sets);
    expect(r.working.map(s => (s.setData as { weight: number }).weight)).toEqual([30, 100]);
    expect(r.estimated).toBe(false);
  });

  it('legacy NULL set under 60 % of the top weight is an estimated warm-up', () => {
    const r = classifySets([strengthSet(40, 10), strengthSet(60, 10), strengthSet(100, 8)]);
    expect(r.working.map(s => (s.setData as { weight: number }).weight)).toEqual([60, 100]);
    expect(r.estimated).toBe(true);
  });

  it('exactly 60 % is kept; no estimate flag when nothing was dropped', () => {
    const r = classifySets([strengthSet(60, 10), strengthSet(100, 8)]);
    expect(r.working).toHaveLength(2);
    expect(r.estimated).toBe(false);
  });

  it('non-strength legacy sets are never dropped', () => {
    const r = classifySets([{ ...strengthSet(1, 1), setData: { type: 'isometric', duration: 30 } }]);
    expect(r.working).toHaveLength(1);
  });
});

describe('AC-LF-1 · metric 1 — data sufficiency', () => {
  it('counts performances in the last 56 days and all-time', () => {
    const perfs = [
      perf('a', 3, [strengthSet(60, 10)]),
      perf('b', 56, [strengthSet(60, 10)]),
      perf('c', 57, [strengthSet(60, 10)]),
      perf('warm', 2, [withKind(strengthSet(20, 10), 'warmup')]),
    ];
    expect(computeDataSufficiency(perfs, 'today', NOW, TZ, 3)).toEqual({ last56Days: 2, allTime: 3 });
  });

  it('all-time defaults to the loaded count when the loader gave none', () => {
    const perfs = [perf('a', 3, [strengthSet(60, 10)])];
    expect(computeDataSufficiency(perfs, 'today', NOW, TZ, undefined).allTime).toBe(1);
  });

  it("excludes today's session", () => {
    const perfs = [perf('a', 0, [strengthSet(60, 10)], { sessionId: 'today' })];
    expect(computeDataSufficiency(perfs, 'today', NOW, TZ, undefined)).toEqual({ last56Days: 0, allTime: 0 });
  });
});

describe('AC-LF-1 · metric 2 — reference (D6)', () => {
  it('no performances → absent "no completed record"', () => {
    expect(computeReference([], today(), RANGE, NOW, TZ)).toEqual({ absent: 'no completed record' });
  });

  it('picks the newest candidate; today is excluded; only performances with a working set count', () => {
    const perfs = [
      perf('warm-only', 1, [withKind(strengthSet(20, 10), 'warmup')]),
      perf('new', 3, [strengthSet(65, 10), strengthSet(65, 9)]),
      perf('old', 10, [strengthSet(60, 10)]),
      perf('same-session', 0, [strengthSet(1, 1)], { sessionId: 'today' }),
    ];
    const r = computeReference(perfs, today(), RANGE, NOW, TZ);
    if (isAbsent(r)) {
      throw new Error('expected a reference');
    }
    expect(r.performance.id).toBe('new');
    expect(r.daysAgo).toBe(3);
    expect(r.likeForLike).toBe(true);
    expect(r.sets).toHaveLength(2);
  });

  it('place is compared trimmed and case-insensitive ("дома" = " Дома ")', () => {
    const perfs = [
      perf('gym', 2, [strengthSet(60, 10)], { place: 'Зал' }),
      perf('home', 5, [strengthSet(40, 10)], { place: ' Дома ' }),
    ];
    const r = computeReference(perfs, today({ place: 'дома' }), RANGE, NOW, TZ);
    if (isAbsent(r)) {
      throw new Error('expected a reference');
    }
    expect(r.performance.id).toBe('home');
    expect(r.likeForLike).toBe(true);
  });

  it('unknown place on either side does not disqualify', () => {
    const perfs = [perf('a', 2, [strengthSet(60, 10)], { place: 'Зал' })];
    const r = computeReference(perfs, today({ place: null }), RANGE, NOW, TZ);
    if (isAbsent(r)) {
      throw new Error('expected a reference');
    }
    expect(r.likeForLike).toBe(true);
  });

  it('rep range ± 2 on the top working set: 6 reps passes 8–12, 5 does not', () => {
    const perfs = [perf('low', 2, [strengthSet(80, 5)]), perf('ok', 6, [strengthSet(70, 6)])];
    const r = computeReference(perfs, today(), RANGE, NOW, TZ);
    if (isAbsent(r)) {
      throw new Error('expected a reference');
    }
    expect(r.performance.id).toBe('ok');
  });

  it('nothing passes → newest, flagged with the failing reasons', () => {
    const perfs = [
      perf('a', 2, [strengthSet(60, 20)], { place: 'Зал' }),
      perf('b', 4, [strengthSet(60, 10)], { place: 'Зал' }),
    ];
    const r = computeReference(perfs, today({ place: 'Дома' }), RANGE, NOW, TZ);
    if (isAbsent(r)) {
      throw new Error('expected a reference');
    }
    expect(r.performance.id).toBe('a');
    expect(r.likeForLike).toEqual({ notLikeForLike: ['place', 'reps'] });
  });

  it('no range → the reps check is skipped', () => {
    const perfs = [perf('a', 2, [strengthSet(60, 30)])];
    const r = computeReference(perfs, today(), null, NOW, TZ);
    if (isAbsent(r)) {
      throw new Error('expected a reference');
    }
    expect(r.likeForLike).toBe(true);
  });

  it('exposes legacy warm-up estimation and verbatim feedback', () => {
    const perfs = [
      perf('a', 2, [strengthSet(30, 10), strengthSet(65, 10, { userFeedback: 'last set heavy', rpe: 8 })]),
    ];
    const r = computeReference(perfs, today(), RANGE, NOW, TZ);
    if (isAbsent(r)) {
      throw new Error('expected a reference');
    }
    expect(r.warmupsEstimated).toBe(true);
    expect(r.sets).toHaveLength(1);
    expect(r.feedback).toEqual(['last set heavy']);
  });
});

describe('AC-LF-1 · metric 3 — fatigue context', () => {
  const t0 = new Date('2026-09-29T01:00:00Z');
  const dips = (min: number) =>
    other(
      'Dips',
      [
        ['chest', 'primary'],
        ['triceps', 'secondary'],
      ],
      new Date(t0.getTime() + min * 60_000),
    );
  const legPress = other('Leg Press', [['quads', 'primary']], new Date(t0.getTime() + 60_000));

  it('fresh (1st exercise) when nothing shares a muscle', () => {
    const f = computeFatigue(
      benchPress,
      {
        startedAt: t0,
        sets: [strengthSet(60, 10, { createdAt: new Date(t0.getTime() + 600_000) })],
        otherSets: [legPress],
      },
      NOW,
    );
    expect(f.perMuscle).toEqual([]);
    expect(f.fresh).toBe(true);
    expect(f.minutesIntoSession).toBe(10);
  });

  it('groups working sets per shared muscle, primary and secondary, with exercise names', () => {
    const others = [
      dips(1),
      dips(2),
      dips(3),
      other('Pushdown', [['triceps', 'primary']], new Date(t0.getTime() + 4 * 60_000)),
      legPress,
    ];
    const f = computeFatigue(
      benchPress,
      {
        startedAt: t0,
        sets: [strengthSet(60, 10, { createdAt: new Date(t0.getTime() + 20 * 60_000) })],
        otherSets: others,
      },
      NOW,
    );
    expect(f.fresh).toBe(false);
    expect(f.perMuscle).toEqual([
      { muscleGroup: 'triceps', workingSets: 4, exerciseNames: ['Dips', 'Pushdown'] },
      { muscleGroup: 'chest', workingSets: 3, exerciseNames: ['Dips'] },
    ]);
    expect(f.minutesIntoSession).toBe(20);
  });

  it("ignores warm-ups and sets after this exercise's first set; NULL kind counts as working", () => {
    const others = [
      other('Dips', [['triceps', 'secondary']], new Date(t0.getTime() + 60_000), 'warmup'),
      other('Dips', [['triceps', 'secondary']], new Date(t0.getTime() + 2 * 60_000), null),
      other('Dips', [['triceps', 'secondary']], new Date(t0.getTime() + 30 * 60_000)),
    ];
    const f = computeFatigue(
      benchPress,
      {
        startedAt: t0,
        sets: [strengthSet(60, 10, { createdAt: new Date(t0.getTime() + 10 * 60_000) })],
        otherSets: others,
      },
      NOW,
    );
    expect(f.perMuscle).toEqual([{ muscleGroup: 'triceps', workingSets: 1, exerciseNames: ['Dips'] }]);
  });

  it('today with no set yet: minutes and cutoff are measured to now', () => {
    const others = [dips(1)];
    const f = computeFatigue(
      benchPress,
      { startedAt: new Date(NOW.getTime() - 40 * 60_000), sets: [], otherSets: others },
      NOW,
    );
    expect(f.minutesIntoSession).toBe(40);
  });

  it('session start falls back to the first set when startedAt is null', () => {
    const f = computeFatigue(
      benchPress,
      {
        startedAt: null,
        sets: [strengthSet(60, 10, { createdAt: new Date(t0.getTime() + 15 * 60_000) })],
        otherSets: [dips(0)],
      },
      NOW,
    );
    expect(f.minutesIntoSession).toBe(15);
  });

  it('no timestamps at all → minutes absent', () => {
    const f = computeFatigue(benchPress, { startedAt: null, sets: [], otherSets: [] }, NOW);
    // today with no sets and no start: only `now` exists, so there is nothing to measure from
    expect(f.minutesIntoSession).toEqual({ absent: 'no session start' });
  });

  it('classifies legacy NULL-kind sets of other exercises with the D7 heuristic (< 60 % of that exercise top)', () => {
    const at = (m: number): Date => new Date(t0.getTime() + m * 60_000);
    const others = [
      other('Dips', [['triceps', 'secondary']], at(1), null, 20),
      other('Dips', [['triceps', 'secondary']], at(2), null, 100),
      other('Dips', [['triceps', 'secondary']], at(3), null, 100),
    ];
    const f = computeFatigue(
      benchPress,
      { startedAt: t0, sets: [strengthSet(60, 10, { createdAt: at(20) })], otherSets: others },
      NOW,
    );
    expect(f.perMuscle).toEqual([{ muscleGroup: 'triceps', workingSets: 2, exerciseNames: ['Dips'] }]);
  });

  it('computeLoadFacts marks today "same as reference" when the per-muscle counts are equal', () => {
    const refStart = daysBefore(3, -1);
    const refSets = [strengthSet(65, 10, { createdAt: new Date(refStart.getTime() + 20 * 60_000) })];
    const ref = perf('r', 3, refSets, {
      startedAt: refStart,
      otherSets: [other('Dips', [['triceps', 'secondary']], new Date(refStart.getTime() + 60_000))],
    });
    const td = today({
      startedAt: new Date(NOW.getTime() - 30 * 60_000),
      otherSets: [other('Dips', [['triceps', 'secondary']], new Date(NOW.getTime() - 25 * 60_000))],
    });
    const facts = computeLoadFacts(benchPress, [ref], td, emptyContext, NOW, TZ);
    expect(facts.fatigueToday.sameAsReference).toBe(true);
    const td2 = today({ otherSets: [] });
    expect(computeLoadFacts(benchPress, [ref], td2, emptyContext, NOW, TZ).fatigueToday.sameAsReference).toBe(false);
  });
});

describe('AC-LF-1 · metric 4 — working weight', () => {
  it('highest load at which every working set reached the range floor; warm-ups ignored', () => {
    const perfs = [
      perf('a', 3, [
        withKind(strengthSet(20, 12), 'warmup'),
        strengthSet(65, 10),
        strengthSet(65, 9),
        strengthSet(70, 6),
      ]),
      perf('b', 10, [strengthSet(60, 12), strengthSet(60, 10)]),
    ];
    const r = computeWorkingWeight(perfs, 'today', RANGE, benchPress, NOW, TZ);
    if (isAbsent(r)) {
      throw new Error('expected a value');
    }
    expect(r.weight).toBe(65);
    expect(r.performances).toBe(2);
    expect(r.warmupsEstimated).toBe(false);
  });

  it('a load with one set under the floor does not qualify', () => {
    const perfs = [perf('a', 3, [strengthSet(70, 10), strengthSet(70, 7)]), perf('b', 9, [strengthSet(65, 8)])];
    const r = computeWorkingWeight(perfs, 'today', RANGE, benchPress, NOW, TZ);
    if (isAbsent(r)) {
      throw new Error('expected a value');
    }
    expect(r.weight).toBe(65);
  });

  it('lateral-raise replay: one stray 5 kg set in an older session does not beat four sessions at 2.5 kg', () => {
    // Owner history (replay 2026-10-01, C1): 09-10 was 5×10 then 2.5×10 (legacy NULL kinds); later sessions all 2.5.
    const perfs = [
      perf('d', 4, [strengthSet(2.5, 10), strengthSet(2.5, 15), strengthSet(2.5, 12), strengthSet(2.5, 10)]),
      perf('c', 9, [strengthSet(2.5, 12), strengthSet(2.5, 11), strengthSet(2.5, 8)]),
      perf('b', 14, [strengthSet(2.5, 12), strengthSet(2.5, 12), strengthSet(2.5, 12)]),
      perf('a', 19, [strengthSet(5, 10), strengthSet(2.5, 10)]),
    ];
    const r = computeWorkingWeight(perfs, 'today', RANGE, benchPress, NOW, TZ);
    if (isAbsent(r)) {
      throw new Error('expected a value');
    }
    expect(r.weight).toBe(2.5);
  });

  it('a load that recurs in no other performance still counts when nothing recurs (pyramid)', () => {
    const perfs = [perf('a', 3, [strengthSet(70, 10)]), perf('b', 9, [strengthSet(65, 10)])];
    const r = computeWorkingWeight(perfs, 'today', RANGE, benchPress, NOW, TZ);
    if (isAbsent(r)) {
      throw new Error('expected a value');
    }
    expect(r.weight).toBe(70);
  });

  it('legacy NULL warm-up under 60 % is dropped and flagged estimated', () => {
    const perfs = [perf('a', 3, [strengthSet(30, 15), strengthSet(65, 10)]), perf('b', 9, [strengthSet(60, 10)])];
    const r = computeWorkingWeight(perfs, 'today', RANGE, benchPress, NOW, TZ);
    if (isAbsent(r)) {
      throw new Error('expected a value');
    }
    expect(r.weight).toBe(65);
    expect(r.warmupsEstimated).toBe(true);
  });

  it('only the last K = 5 performances within 56 days count', () => {
    const perfs = [
      ...[1, 2, 3, 4, 5].map(i => perf(`n${i}`, i * 3, [strengthSet(50, 10)])),
      perf('old-heavy', 20, [strengthSet(100, 10)]),
      perf('ancient', 90, [strengthSet(120, 10)]),
    ];
    const r = computeWorkingWeight(perfs, 'today', RANGE, benchPress, NOW, TZ);
    if (isAbsent(r)) {
      throw new Error('expected a value');
    }
    expect(r.weight).toBe(50);
    expect(r.performances).toBe(5);
  });

  it('< 2 performances in the window → absent with the count', () => {
    const perfs = [perf('a', 3, [strengthSet(65, 10)]), perf('old', 60, [strengthSet(65, 10)])];
    expect(computeWorkingWeight(perfs, 'today', RANGE, benchPress, NOW, TZ)).toEqual({
      absent: 'insufficient: 1 performances / 8 wk',
    });
  });

  it('no rep range → absent "no rep range"', () => {
    const perfs = [perf('a', 3, [strengthSet(65, 10)]), perf('b', 6, [strengthSet(65, 10)])];
    expect(computeWorkingWeight(perfs, 'today', null, benchPress, NOW, TZ)).toEqual({ absent: 'no rep range' });
  });

  it('no load reached the floor → absent', () => {
    const perfs = [perf('a', 3, [strengthSet(65, 5)]), perf('b', 6, [strengthSet(65, 6)])];
    expect(computeWorkingWeight(perfs, 'today', RANGE, benchPress, NOW, TZ)).toEqual({
      absent: 'no load reached the rep floor',
    });
  });

  it('a performance mixing per-hand and total loads is excluded and counted', () => {
    const perfs = [
      perf('mixed', 3, [strengthSet(35, 10, { perHand: true }), strengthSet(40, 10)]),
      perf('a', 6, [strengthSet(60, 10)]),
      perf('b', 9, [strengthSet(62, 10)]),
    ];
    const r = computeWorkingWeight(perfs, 'today', RANGE, benchPress, NOW, TZ);
    if (isAbsent(r)) {
      throw new Error('expected a value');
    }
    expect(r.performances).toBe(2);
    expect(r.mixedBasisExcluded).toBe(1);
    expect(r.weight).toBe(62);
  });

  it('non-strength exercise → n/a', () => {
    const iso = { ...benchPress, exerciseType: 'isometric' as const };
    expect(computeWorkingWeight([], 'today', RANGE, iso, NOW, TZ)).toEqual({ absent: 'n/a for isometric' });
  });
});

describe('AC-LF-1 · metric 5 — e1RM trend', () => {
  // Epley: w * (1 + r/30). 60x10 = 80, 60x12 = 84, 66x10 = 88.
  const mk = (id: string, days: number, w: number, r: number) => perf(id, days, [strengthSet(w, r)]);

  it('rising: newest vs oldest above +2.5 %', () => {
    const r = computeE1rmTrend(
      [mk('c', 3, 66, 10), mk('b', 10, 63, 10), mk('a', 17, 60, 10)],
      'today',
      benchPress,
      NOW,
      TZ,
    );
    if (isAbsent(r)) {
      throw new Error('expected a value');
    }
    expect(r.trend).toBe('rising');
    expect(r.newest).toBeCloseTo(88, 5);
    expect(r.performances).toBe(3);
  });

  it('falling: below −2.5 %', () => {
    const r = computeE1rmTrend(
      [mk('c', 3, 57, 10), mk('b', 10, 60, 10), mk('a', 17, 66, 10)],
      'today',
      benchPress,
      NOW,
      TZ,
    );
    if (isAbsent(r)) {
      throw new Error('expected a value');
    }
    expect(r.trend).toBe('falling');
  });

  it('flat within the band; flat ×n counts consecutive newest within ±2.5 % of the newest', () => {
    // 80.0, 80.8 (+1 %), 80.0, then 60 (outlier) -> newest 3 within band
    const r = computeE1rmTrend(
      [mk('d', 3, 60, 10), mk('c', 10, 60.6, 10), mk('b', 17, 60, 10), mk('a', 24, 45, 10)],
      'today',
      benchPress,
      NOW,
      TZ,
    );
    if (isAbsent(r)) {
      throw new Error('expected a value');
    }
    expect(r.flatRun).toBe(3);
    expect(r.trend).toBe('rising'); // 4-performance window: newest vs oldest (45x10) is +33 %
  });

  it('exactly at the +2.5 % boundary is flat', () => {
    // 80 -> 82 is +2.5 %
    const r = computeE1rmTrend(
      [mk('c', 3, 61.5, 10), mk('b', 10, 60.5, 10), mk('a', 17, 60, 10)],
      'today',
      benchPress,
      NOW,
      TZ,
    );
    if (isAbsent(r)) {
      throw new Error('expected a value');
    }
    expect(r.trend).toBe('flat');
  });

  it('uses only the last 5 performances', () => {
    const perfs = [1, 2, 3, 4, 5].map(i => mk(`n${i}`, i * 3, 60, 10));
    perfs.push(mk('older', 30, 30, 10));
    const r = computeE1rmTrend(perfs, 'today', benchPress, NOW, TZ);
    if (isAbsent(r)) {
      throw new Error('expected a value');
    }
    expect(r.performances).toBe(5);
    expect(r.trend).toBe('flat');
  });

  it('sets over 10 reps are excluded; a performance with none is skipped; needs ≥ 3', () => {
    const perfs = [mk('c', 3, 60, 15), mk('b', 10, 60, 10), mk('a', 17, 60, 10)];
    expect(computeE1rmTrend(perfs, 'today', benchPress, NOW, TZ)).toEqual({ absent: 'insufficient: 2 performances' });
  });

  it('takes the best e1RM set per performance, not the heaviest', () => {
    const p = perf('a', 3, [strengthSet(70, 3), strengthSet(60, 10)]); // 77 vs 80
    const r = computeE1rmTrend([p, mk('b', 10, 60, 10), mk('c', 17, 60, 10)], 'today', benchPress, NOW, TZ);
    if (isAbsent(r)) {
      throw new Error('expected a value');
    }
    expect(r.newest).toBeCloseTo(80, 5);
  });

  it('weeks at current weight: whole weeks across the newest run at the same top load', () => {
    const perfs = [
      mk('e', 3, 60, 10),
      mk('d', 10, 60, 10),
      mk('c', 24, 60, 10),
      mk('b', 31, 55, 10),
      mk('a', 38, 55, 10),
    ];
    const r = computeE1rmTrend(perfs, 'today', benchPress, NOW, TZ);
    if (isAbsent(r)) {
      throw new Error('expected a value');
    }
    expect(r.weeksAtWeight).toBe(3); // day 24 -> day 3 = 21 days = 3 weeks
  });

  it('currentLoadUnit carries the stored weight unit (lbs stays lbs)', () => {
    const lbs = (id: string, d: number) => {
      const p = perf(id, d, [strengthSet(135, 10)]);
      p.sets = p.sets.map(x => ({ ...x, setData: { type: 'strength', reps: 10, weight: 135, weightUnit: 'lbs' } }));
      return p;
    };
    const r = computeE1rmTrend([lbs('c', 3), lbs('b', 10), lbs('a', 17)], 'today', benchPress, NOW, TZ);
    if (isAbsent(r)) {
      throw new Error('expected a value');
    }
    expect(r.currentLoadUnit).toBe('lbs');
  });

  it('low confidence for machine and cable, not barbell', () => {
    const perfs = [mk('c', 3, 60, 10), mk('b', 10, 60, 10), mk('a', 17, 60, 10)];
    const m = computeE1rmTrend(perfs, 'today', benchPress, NOW, TZ);
    const b = computeE1rmTrend(perfs, 'today', barbellBench, NOW, TZ);
    if (isAbsent(m) || isAbsent(b)) {
      throw new Error('expected values');
    }
    expect(m.lowConfidence).toBe('machine');
    expect(b.lowConfidence).toBeNull();
    const cable = computeE1rmTrend(perfs, 'today', { ...benchPress, equipment: 'cable' }, NOW, TZ);
    if (isAbsent(cable)) {
      throw new Error('expected a value');
    }
    expect(cable.lowConfidence).toBe('machine');
  });

  it('flags legacy warm-up estimation', () => {
    const legacy = (id: string, d: number) => perf(id, d, [strengthSet(20, 12), strengthSet(60, 10)]);
    const r = computeE1rmTrend([legacy('c', 3), legacy('b', 10), legacy('a', 17)], 'today', benchPress, NOW, TZ);
    if (isAbsent(r)) {
      throw new Error('expected a value');
    }
    expect(r.warmupsEstimated).toBe(true);
    expect(r.newest).toBeCloseTo(80, 5);
  });

  it('non-strength → n/a', () => {
    expect(computeE1rmTrend([], 'today', { ...benchPress, exerciseType: 'cardio_duration' }, NOW, TZ)).toEqual({
      absent: 'n/a for cardio_duration',
    });
  });
});

describe('AC-LF-1 · metric 6 — last-exposure quality', () => {
  const ref = (sets: ReturnType<typeof strengthSet>[], id = 'ref', days = 3) => perf(id, days, sets);

  it('reps vs range: below floor / in range / at or above top (weakest working set decides)', () => {
    const q = (sets: ReturnType<typeof strengthSet>[]) =>
      computeLastExposure(ref(sets), [], RANGE, benchPress).repsVsRange;
    expect(q([strengthSet(60, 10), strengthSet(60, 7)])).toBe('below floor');
    expect(q([strengthSet(60, 12), strengthSet(60, 9)])).toBe('in range');
    expect(q([strengthSet(60, 12), strengthSet(60, 13)])).toBe('at or above top');
  });

  it('no range → repsVsRange absent, the rest still computed', () => {
    const q = computeLastExposure(
      ref([strengthSet(60, 10, { rpe: 8 }), strengthSet(60, 9, { rpe: 9 })]),
      [],
      null,
      benchPress,
    );
    expect(q.repsVsRange).toEqual({ absent: 'no rep range' });
    expect(q.rpe).toEqual({ values: [8, 9] });
  });

  it('RPE absent when none recorded', () => {
    const q = computeLastExposure(ref([strengthSet(60, 10)]), [], RANGE, benchPress);
    expect(q.rpe).toEqual({ absent: 'no RPE recorded' });
  });

  it('drop-off = first − last working set reps at the top load; number alone without a norm', () => {
    const q = computeLastExposure(
      ref([withKind(strengthSet(20, 15), 'warmup'), strengthSet(65, 12), strengthSet(65, 10), strengthSet(65, 9)]),
      [],
      RANGE,
      benchPress,
    );
    expect(q.dropOff).toEqual({ value: 3, usual: null });
  });

  it('single set at the top load → drop-off absent', () => {
    const q = computeLastExposure(ref([strengthSet(60, 10), strengthSet(65, 8)]), [], RANGE, benchPress);
    expect(q.dropOff).toEqual({ absent: 'fewer than 2 sets at the top load' });
  });

  it('usual = median drop-off of up to 5 earlier performances when ≥ 3 exist', () => {
    const p = (id: string, days: number, first: number, last: number) =>
      ref([strengthSet(60, first), strengthSet(60, last)], id, days);
    const earlier = [p('e1', 10, 10, 9), p('e2', 17, 10, 9), p('e3', 24, 10, 8), p('e4', 31, 12, 4)]; // drops 1,1,2,8 → median 1.5
    const q = computeLastExposure(ref([strengthSet(60, 12), strengthSet(60, 9)]), earlier, RANGE, benchPress);
    expect(q.dropOff).toEqual({ value: 3, usual: 1.5 });
  });

  it('two earlier performances are not enough for a norm', () => {
    const p = (id: string, days: number) => ref([strengthSet(60, 10), strengthSet(60, 9)], id, days);
    const q = computeLastExposure(
      ref([strengthSet(60, 12), strengthSet(60, 9)]),
      [p('e1', 10), p('e2', 17)],
      RANGE,
      benchPress,
    );
    expect(q.dropOff).toEqual({ value: 3, usual: null });
  });

  it('non-load exercises (isometric, cardio) → n/a', () => {
    const iso = { ...benchPress, exerciseType: 'isometric' as const };
    const q = computeLastExposure(
      ref([{ ...strengthSet(1, 1), setData: { type: 'isometric', duration: 30 } }]),
      [],
      RANGE,
      iso,
    );
    expect(q.repsVsRange).toEqual({ absent: 'n/a for isometric' });
    expect(q.dropOff).toEqual({ absent: 'n/a for isometric' });
  });
});

describe('AC-LF-1 · metric 7 — gap (calendar days in the user timezone)', () => {
  const workouts = [
    { sessionId: 'w1', performedAt: daysBefore(2), primaryMuscles: ['quads' as const] },
    { sessionId: 'w2', performedAt: daysBefore(5), primaryMuscles: ['chest' as const, 'triceps' as const] },
  ];

  it('days since the exercise, its primary muscles, any workout', () => {
    const perfs = [perf('a', 9, [strengthSet(60, 10)])];
    const g = computeGap(benchPress, perfs, workouts, 'today', NOW, TZ);
    expect(g).toEqual({ exercise: { days: 9 }, primaryMuscles: { days: 5 }, anyWorkout: { days: 2 } });
  });

  it('uses the user timezone: 17:00Z the previous UTC day is already "today" in Manila', () => {
    const late = new Date('2026-09-28T17:00:00Z'); // 2026-09-29 01:00 Manila
    const g = computeGap(
      benchPress,
      [perf('a', 1, [strengthSet(60, 10)], { performedAt: late })],
      [],
      'today',
      NOW,
      TZ,
    );
    expect(g.exercise).toEqual({ days: 0 });
    const utc = computeGap(
      benchPress,
      [perf('a', 1, [strengthSet(60, 10)], { performedAt: late })],
      [],
      'today',
      NOW,
      'UTC',
    );
    expect(utc.exercise).toEqual({ days: 1 });
  });

  it('nothing loaded → truthful absent reasons; the exercise with no record says so', () => {
    const g = computeGap(benchPress, [], [], 'today', NOW, TZ);
    expect(g.exercise).toEqual({ absent: 'no completed record' });
    expect(g.primaryMuscles).toEqual({ absent: 'none in the last 60 workouts' });
    expect(g.anyWorkout).toEqual({ absent: 'none in the last 60 workouts' });
  });

  it("today's own session is not a workout for the gap", () => {
    const g = computeGap(
      benchPress,
      [],
      [{ sessionId: 'today', performedAt: daysBefore(0), primaryMuscles: ['chest'] }],
      'today',
      NOW,
      TZ,
    );
    expect(g.anyWorkout).toEqual({ absent: 'none in the last 60 workouts' });
  });

  it('a secondary-only muscle does not count as primary involvement', () => {
    const g = computeGap(
      benchPress,
      [],
      [{ sessionId: 'x', performedAt: daysBefore(1), primaryMuscles: ['back_lats'] }],
      'today',
      NOW,
      TZ,
    );
    expect(g.primaryMuscles).toEqual({ absent: 'none in the last 60 workouts' });
    expect(g.anyWorkout).toEqual({ days: 1 });
  });
});

describe('AC-LF-1 · metric 8 — constraints', () => {
  it('active constraints on the exercise muscles with durability; equipment facts as text', () => {
    const c = computeConstraints(benchPress, {
      constraints: [
        { muscleGroup: 'triceps', durability: 'short', text: 'elbow pain' },
        { muscleGroup: 'quads', durability: 'long_term', text: 'knee' },
        { muscleGroup: null, durability: 'permanent', text: 'general' },
      ],
      equipmentFacts: ['home: 2 dumbbells'],
      workouts: [],
    });
    expect(c.constraints).toEqual([{ muscleGroup: 'triceps', durability: 'short', text: 'elbow pain' }]);
    expect(c.equipment).toEqual(['home: 2 dumbbells']);
  });
});

describe('AC-LF-1 · metric 9 — equipment step', () => {
  it.each([
    ['barbell', 2.5, false],
    ['dumbbell', 2, true],
    ['machine', 5, false],
    ['cable', 5, false],
  ] as const)('%s → %s kg', (equipment, step, perHand) => {
    expect(computeEquipmentStep({ ...benchPress, equipment })).toEqual({
      step,
      unit: 'kg',
      perHand,
      basis: `default for ${equipment}`,
    });
  });

  it('bodyweight / none → n/a', () => {
    expect(computeEquipmentStep({ ...benchPress, equipment: 'bodyweight' })).toEqual({ absent: 'n/a for bodyweight' });
    expect(computeEquipmentStep({ ...benchPress, equipment: 'none' })).toEqual({ absent: 'n/a for none' });
  });

  it('non-strength → n/a for the type', () => {
    expect(computeEquipmentStep({ ...benchPress, exerciseType: 'cardio_distance' })).toEqual({
      absent: 'n/a for cardio_distance',
    });
  });
});

describe('AC-LF-1 · computeLoadFacts (D8 range source, D10 applicability)', () => {
  it("falls back to the reference performance's target reps when today has none", () => {
    const perfs = [perf('a', 3, [strengthSet(65, 10)], { targetReps: '6-8' })];
    const f = computeLoadFacts(benchPress, perfs, today({ targetReps: null }), emptyContext, NOW, TZ);
    expect(f.repRange).toEqual({ min: 6, max: 8, source: 'reference' });
  });

  it("today's target reps win", () => {
    const perfs = [perf('a', 3, [strengthSet(65, 10)], { targetReps: '6-8' })];
    const f = computeLoadFacts(benchPress, perfs, today({ targetReps: '10' }), emptyContext, NOW, TZ);
    expect(f.repRange).toEqual({ min: 10, max: 10, source: 'today' });
  });

  it('no range anywhere → repRange absent, metrics 4 and 6-range absent with the reason', () => {
    const perfs = [
      perf('a', 3, [strengthSet(65, 10)], { targetReps: null }),
      perf('b', 8, [strengthSet(65, 10)], { targetReps: 'AMRAP' }),
    ];
    const f = computeLoadFacts(benchPress, perfs, today({ targetReps: null }), emptyContext, NOW, TZ);
    expect(f.repRange).toEqual({ absent: 'no rep range' });
    expect(f.workingWeight).toEqual({ absent: 'no rep range' });
    if (isAbsent(f.lastExposure)) {
      throw new Error('expected last exposure');
    }
    expect(f.lastExposure.repsVsRange).toEqual({ absent: 'no rep range' });
  });

  it('no history → every history metric absent with a reason, fatigue today and gap/constraints still present', () => {
    const f = computeLoadFacts(benchPress, [], today(), emptyContext, NOW, TZ);
    expect(f.reference).toEqual({ absent: 'no completed record' });
    expect(f.lastExposure).toEqual({ absent: 'no completed record' });
    expect(f.workingWeight).toEqual({ absent: 'insufficient: 0 performances / 8 wk' });
    expect(f.e1rmTrend).toEqual({ absent: 'insufficient: 0 performances' });
    expect(f.dataSufficiency).toEqual({ last56Days: 0, allTime: 0 });
    expect(f.fatigueReference).toEqual({ absent: 'no completed record' });
    expect(f.fatigueToday.fresh).toBe(true);
  });

  it('functional_reps: reference/fatigue/gap present, 4/5/9 n/a', () => {
    const ex = { ...benchPress, exerciseType: 'functional_reps' as const, equipment: 'bodyweight' as const };
    const p = perf('a', 3, [{ ...strengthSet(1, 1), setData: { type: 'functional_reps', reps: 15 } }], {
      targetReps: '10-15',
    });
    const f = computeLoadFacts(ex, [p], today(), emptyContext, NOW, TZ);
    expect(isAbsent(f.reference)).toBe(false);
    expect(f.workingWeight).toEqual({ absent: 'n/a for functional_reps' });
    expect(f.e1rmTrend).toEqual({ absent: 'n/a for functional_reps' });
    expect(f.equipmentStep).toEqual({ absent: 'n/a for functional_reps' });
    if (isAbsent(f.lastExposure)) {
      throw new Error('expected last exposure');
    }
    expect(f.lastExposure.repsVsRange).toBe('at or above top');
    expect(f.gap.exercise).toEqual({ days: 3 });
  });

  it('is pure: identical inputs give identical output, and inputs are not mutated', () => {
    const perfs = [perf('a', 3, [strengthSet(30, 10), strengthSet(65, 10)]), perf('b', 9, [strengthSet(60, 10)])];
    const snapshot = JSON.stringify(perfs);
    const a = computeLoadFacts(benchPress, perfs, today(), emptyContext, NOW, TZ);
    const b = computeLoadFacts(benchPress, perfs, today(), emptyContext, NOW, TZ);
    expect(a).toEqual(b);
    expect(JSON.stringify(perfs)).toBe(snapshot);
  });

  it('accepts performances in any order (newest-first is not required)', () => {
    const perfs = [perf('old', 20, [strengthSet(50, 10)]), perf('new', 3, [strengthSet(65, 10)])];
    const f = computeLoadFacts(benchPress, perfs, today(), emptyContext, NOW, TZ);
    if (isAbsent(f.reference)) {
      throw new Error('expected a reference');
    }
    expect(f.reference.performance.id).toBe('new');
  });
});

describe('AC-LPF-5 · working weight follows the newest session (owner history)', () => {
  const ww = (
    rows: Parameters<typeof ownerPerfs>[1],
    last: string,
    ex: typeof legPress,
    range = { min: 10, max: 12 },
  ) => {
    const r = computeWorkingWeight(ownerPerfs(ex.id, rows, last), 'today', range, ex, ownerNow(last, 4), TZ);
    if (isAbsent(r)) {
      throw new Error(`expected a value, got ${r.absent}`);
    }
    return r;
  };

  it('leg press after 09-21 (110 ×3 → 110,110,120,120) is 120, not the recurring 110', () => {
    expect(ww(LEG_PRESS_ROWS, '2026-09-21', legPress).weight).toBe(120);
  });

  it('leg press after 09-27 (110,130,130,135) is at least 130', () => {
    expect(ww(LEG_PRESS_ROWS, '2026-09-27', legPress).weight).toBeGreaterThanOrEqual(130);
  });

  it('lateral raise stays 2.5 kg — its 5 kg set is in the oldest session, not the newest', () => {
    expect(ww(LATERAL_RAISE_ROWS, '2026-09-25', lateralRaise, RANGE).weight).toBe(2.5);
  });

  it('the newest performance counts only at a load where EVERY set at that load reached the floor', () => {
    const perfs = [
      perf('a', 3, [strengthSet(65, 10), strengthSet(70, 12), strengthSet(70, 4)]),
      perf('b', 9, [strengthSet(65, 10)]),
      perf('c', 16, [strengthSet(65, 10)]),
    ];
    const r = computeWorkingWeight(perfs, 'today', RANGE, benchPress, NOW, TZ);
    if (isAbsent(r)) {
      throw new Error('expected a value');
    }
    expect(r.weight).toBe(65);
  });

  it('a heavier load that only an OLDER performance reached still does not win unless it recurs', () => {
    const perfs = [
      perf('a', 3, [strengthSet(60, 10), strengthSet(60, 10)]),
      perf('b', 9, [strengthSet(60, 10)]),
      perf('c', 16, [strengthSet(80, 10)]),
    ];
    const r = computeWorkingWeight(perfs, 'today', RANGE, benchPress, NOW, TZ);
    if (isAbsent(r)) {
      throw new Error('expected a value');
    }
    expect(r.weight).toBe(60);
  });
});

describe('AC-LPF-9 · metric 10 — volume load of the newest vs the previous performance', () => {
  const volume = (last: string) =>
    computeVolume(ownerPerfs(legPress.id, LEG_PRESS_ROWS, last), 'today', legPress, ownerNow(last, 4), TZ);

  it('sums reps × load of the working sets; leg press 09-21 vs 09-16', () => {
    const v = volume('2026-09-21');
    if (isAbsent(v)) {
      throw new Error('expected a value');
    }
    expect(v.newest).toEqual({ volume: 110 * 12 * 2 + 120 * 12 * 2, daysAgo: 4 });
    expect(v.previous).toEqual({ volume: 80 * 10 + 110 * 12 * 3, daysAgo: 9 });
    expect(v.changePct).toBeCloseTo(((5520 - 4760) / 4760) * 100, 5);
    expect(v.unit).toBeNull(); // the fixtures store no weight unit; the block prints kg by default
  });

  it('leg press 09-27 vs 09-21', () => {
    const v = volume('2026-09-27');
    if (isAbsent(v)) {
      throw new Error('expected a value');
    }
    expect(v.newest.volume).toBe(110 * 12 + 130 * 12 * 2 + 135 * 12);
    expect(v.previous.volume).toBe(5520);
  });

  it('warm-ups never count', () => {
    const perfs = [
      perf('a', 3, [withKind(strengthSet(20, 15), 'warmup'), strengthSet(60, 10)]),
      perf('b', 9, [strengthSet(60, 10), withKind(strengthSet(20, 15), 'warmup')]),
    ];
    const v = computeVolume(perfs, 'today', benchPress, NOW, TZ);
    if (isAbsent(v)) {
      throw new Error('expected a value');
    }
    expect([v.newest.volume, v.previous.volume, v.changePct]).toEqual([600, 600, 0]);
  });

  it('absent with the reason when fewer than two performances carry a load', () => {
    const one = [perf('a', 3, [strengthSet(60, 10)])];
    expect(computeVolume(one, 'today', benchPress, NOW, TZ)).toEqual({
      absent: 'fewer than 2 performances with a load',
    });
  });

  it('today is not a performance; non-strength is n/a', () => {
    const perfs = [perf('today', 0, [strengthSet(60, 10)]), perf('a', 3, [strengthSet(60, 10)])];
    expect(isAbsent(computeVolume(perfs, 's-today', benchPress, NOW, TZ))).toBe(true);
    const plank = { ...benchPress, exerciseType: 'isometric' as const };
    expect(computeVolume(perfs, 'today', plank, NOW, TZ)).toEqual({ absent: 'n/a for isometric' });
  });

  it('is part of computeLoadFacts', () => {
    const f = computeLoadFacts(
      legPress,
      ownerPerfs(legPress.id, LEG_PRESS_ROWS, '2026-09-21'),
      today({ targetReps: '10-12' }),
      emptyContext,
      ownerNow('2026-09-21', 4),
      TZ,
    );
    expect(isAbsent(f.volume)).toBe(false);
  });
});
