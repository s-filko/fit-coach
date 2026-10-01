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
  computeRepHistory,
  computeIndicativeLoad,
  capacityOf,
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
const R810 = { min: 8, max: 10 };

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

  it('no load reached the floor and no equipment step → absent', () => {
    const perfs = [perf('a', 3, [strengthSet(65, 5)]), perf('b', 6, [strengthSet(65, 6)])];
    const bodyweight = { ...benchPress, equipment: 'bodyweight' as const };
    expect(computeWorkingWeight(perfs, 'today', RANGE, bodyweight, NOW, TZ)).toEqual({
      absent: 'no load reached the rep floor',
    });
  });

  it('no load reached the floor, step known → the indirect estimate (65×5 for 8–12 → 55)', () => {
    const perfs = [perf('a', 3, [strengthSet(65, 5)]), perf('b', 6, [strengthSet(65, 6)])];
    const r = computeWorkingWeight(perfs, 'today', RANGE, benchPress, NOW, TZ);
    if (isAbsent(r)) {
      throw new Error('expected a value');
    }
    expect([r.weight, r.estimatedFrom]).toEqual([55, { weight: 65, reps: 5 }]);
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
    expect(c.constraints).toEqual([
      { muscleGroup: 'triceps', durability: 'short', text: 'elbow pain', onPrimary: false },
    ]);
    expect(c.equipment).toEqual(['home: 2 dumbbells']);
  });
});

describe('AC-LF-1 · metric 9 — equipment step', () => {
  it.each([
    ['barbell', 2.5, false, true],
    ['dumbbell', 2, true, true],
    ['machine', 5, false, false],
    ['cable', 5, false, true],
  ] as const)('%s → %s kg (10 % cap applies: %s)', (equipment, step, perHand, capApplies) => {
    expect(computeEquipmentStep({ ...benchPress, equipment })).toEqual({
      step,
      unit: 'kg',
      perHand,
      basis: `default for ${equipment}`,
      capApplies, // O-2 narrowed (W-32): only machines are uncapped; cables keep the cap
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

describe('AC-LPF-6/7 · metric 4b — sets at the working weight', () => {
  const facts = (last: string, targetReps: string) =>
    computeLoadFacts(
      legPress,
      ownerPerfs(legPress.id, LEG_PRESS_ROWS, last),
      today({ targetReps }),
      emptyContext,
      ownerNow(last, 4),
      TZ,
    );

  it('leg press after 09-21: the working weight is 120, only the 09-21 performance has sets at it', () => {
    const f = facts('2026-09-21', '10-12');
    if (isAbsent(f.repHistory)) {
      throw new Error('expected a value');
    }
    expect(f.repHistory.weight).toBe(120);
    expect(f.repHistory.entries.map(e => e.repsAtWorkingWeight)).toEqual([[12, 12], [], [], [], []]);
    expect(f.repHistory.entries[0].daysAgo).toBe(4);
  });

  it('carries the RPE of the last set at the working weight', () => {
    const perfs = [
      perf('a', 3, [strengthSet(60, 10, { rpe: 6 }), strengthSet(60, 12, { rpe: 9 })]),
      perf('b', 9, [strengthSet(60, 10, { rpe: 7 }), strengthSet(60, 10)]),
    ];
    const f = computeLoadFacts(benchPress, perfs, today(), emptyContext, NOW, TZ);
    if (isAbsent(f.repHistory)) {
      throw new Error('expected a value');
    }
    expect(f.repHistory.entries.map(e => e.lastSetRpe)).toEqual([9, null]);
  });

  it('absent without a working weight; n/a for non-strength', () => {
    expect(computeRepHistory([], 'today', { absent: 'x' }, benchPress, NOW, TZ)).toEqual({
      absent: 'no working weight',
    });
    const plank = { ...benchPress, exerciseType: 'isometric' as const };
    expect(computeRepHistory([], 'today', { absent: 'x' }, plank, NOW, TZ)).toEqual({ absent: 'n/a for isometric' });
  });
});

describe('AC-LPF-7 · each load is judged on its own sets (a too-heavy opener is a probe)', () => {
  // 135 × 6 as the opener, then 130 × 12 ×3; the two older sessions are 130 × 12 ×3 too. Range 8–12.
  const withOpener = [
    perf('a', 3, [strengthSet(135, 6), strengthSet(130, 12), strengthSet(130, 12), strengthSet(130, 12)]),
    perf('b', 9, [strengthSet(130, 12), strengthSet(130, 12), strengthSet(130, 12)]),
    perf('c', 16, [strengthSet(130, 12), strengthSet(130, 12), strengthSet(130, 12)]),
  ];
  const f = () => computeLoadFacts(legPress, withOpener, today({ targetReps: '8-12' }), emptyContext, NOW, TZ);

  it('the working weight is 130 and the performance is not "below floor" because of the 135 × 6 probe', () => {
    const facts = f();
    if (isAbsent(facts.workingWeight) || isAbsent(facts.lastExposure) || isAbsent(facts.lastExposure.repsVsRange)) {
      throw new Error('expected values');
    }
    expect(facts.workingWeight.weight).toBe(130);
    expect(facts.lastExposure.repsVsRange).toBe('at or above top');
  });

  it('drop-off is measured at the working weight, the usual from earlier performances at that load', () => {
    const uneven = [
      perf('a', 3, [strengthSet(135, 6), strengthSet(130, 14), strengthSet(130, 12), strengthSet(130, 8)]),
      ...withOpener.slice(1),
      perf('d', 23, [strengthSet(130, 12), strengthSet(130, 11), strengthSet(130, 11)]),
    ];
    const facts = computeLoadFacts(legPress, uneven, today({ targetReps: '8-12' }), emptyContext, NOW, TZ);
    if (isAbsent(facts.lastExposure) || isAbsent(facts.lastExposure.dropOff)) {
      throw new Error('expected a value');
    }
    expect(facts.lastExposure.dropOff.value).toBe(6);
    expect(facts.lastExposure.dropOff.usual).toBe(0);
  });

  it('with no set at the working weight in the reference the old top-load reading stays', () => {
    const r = computeLastExposure(perf('x', 3, [strengthSet(70, 5), strengthSet(70, 5)]), [], RANGE, benchPress, 60);
    if (isAbsent(r.repsVsRange)) {
      throw new Error('expected a value');
    }
    expect(r.repsVsRange).toBe('below floor');
  });
});

describe('AC-LPF-5 · indirect working-weight estimate (Epley from sets ≤ 10 reps, rounded down to the step)', () => {
  const R810 = { min: 8, max: 10 };
  const older = perf('older', 9, [strengthSet(45, 12), strengthSet(45, 12)]);
  const ww = (sets: [number, number][], range = R810, ex = benchPress, extra = [older]) => {
    const perfs = [
      perf(
        'newest',
        3,
        sets.map(([w, r]) => strengthSet(w, r)),
      ),
      ...extra,
    ];
    return computeWorkingWeight(perfs, 'today', range, ex, NOW, TZ);
  };

  it('60×6, 55×8, 45×12 (range 8–10) → 55, from the reached load; the estimate does not lift it', () => {
    const r = ww([
      [60, 6],
      [55, 8],
      [45, 12],
    ]);
    if (isAbsent(r)) {
      throw new Error('expected a value');
    }
    expect(r.weight).toBe(55);
    expect(r.estimatedFrom).toBeUndefined();
  });

  it('60×6, 55×7, 45×12 (range 8–10) → 50, not 45, and says where it came from', () => {
    const r = ww([
      [60, 6],
      [55, 7],
      [45, 12],
    ]);
    if (isAbsent(r)) {
      throw new Error('expected a value');
    }
    expect(r.weight).toBe(50);
    expect(r.estimatedFrom).toEqual({ weight: 55, reps: 7 });
  });

  it('is rounded DOWN to the equipment step (barbell 2.5)', () => {
    // 100×7 → e1RM 123.3 → for 8 reps 97.4 → 95 (2.5 grid: 97.5 > 97.4 → 95).
    const r = ww([[100, 7]], R810, barbellBench, [perf('o', 9, [strengthSet(90, 10), strengthSet(90, 10)])]);
    if (isAbsent(r)) {
      throw new Error('expected a value');
    }
    expect(r.weight).toBe(95);
    expect(r.estimatedFrom).toEqual({ weight: 100, reps: 7 });
  });

  it('a set that reached the floor is never "estimated" upwards (80×10 for 8–12 stays 80)', () => {
    const r = ww(
      [
        [80, 10],
        [80, 10],
      ],
      { min: 8, max: 12 },
      benchPress,
      [perf('o', 9, [strengthSet(80, 10)])],
    );
    if (isAbsent(r)) {
      throw new Error('expected a value');
    }
    expect(r.weight).toBe(80);
    expect(r.estimatedFrom).toBeUndefined();
  });

  it('sets above 10 reps carry no estimate (E1RM_MAX_REPS stays 10)', () => {
    const r = ww([
      [45, 12],
      [45, 12],
    ]);
    if (isAbsent(r)) {
      throw new Error('expected a value');
    }
    expect(r.weight).toBe(45);
    expect(r.estimatedFrom).toBeUndefined();
  });

  it('no estimate when the equipment step is unknown (bodyweight / none)', () => {
    const bodyweight = { ...benchPress, equipment: 'bodyweight' as const };
    const r = ww(
      [
        [60, 6],
        [55, 7],
        [45, 12],
      ],
      R810,
      bodyweight,
    );
    if (isAbsent(r)) {
      throw new Error('expected a value');
    }
    expect(r.weight).toBe(45);
    expect(r.estimatedFrom).toBeUndefined();
  });

  it('only the newest performance is read', () => {
    const r = ww(
      [
        [45, 12],
        [45, 12],
      ],
      R810,
      benchPress,
      [perf('o', 9, [strengthSet(60, 6), strengthSet(55, 7)])],
    );
    if (isAbsent(r)) {
      throw new Error('expected a value');
    }
    expect(r.weight).toBe(45);
  });

  it('when no load reached the floor the estimate still gives a working weight', () => {
    const r = ww(
      [
        [60, 6],
        [55, 7],
      ],
      R810,
      benchPress,
      [perf('o', 9, [strengthSet(60, 6), strengthSet(55, 7)])],
    );
    if (isAbsent(r)) {
      throw new Error('expected a value');
    }
    expect(r.weight).toBe(50);
    expect(r.estimatedFrom).toEqual({ weight: 55, reps: 7 });
  });
});

describe('AC-LPF-10 · the safety rows judge the NEWEST performance (W-13)', () => {
  it('lateral raise 09-25 (15-rep top set → not like-for-like): last exposure is 09-25, not the 8-rep 09-20 reference', () => {
    const f = computeLoadFacts(
      lateralRaise,
      ownerPerfs(lateralRaise.id, LATERAL_RAISE_ROWS, '2026-09-25'),
      today({ targetReps: '10-12' }),
      emptyContext,
      ownerNow('2026-09-25', 4),
      TZ,
    );
    if (isAbsent(f.reference) || isAbsent(f.lastExposure) || isAbsent(f.lastExposure.repsVsRange)) {
      throw new Error('expected values');
    }
    expect(f.reference.daysAgo).toBe(9); // the reference stays the like-for-like pick
    expect(f.lastExposure.repsVsRange).toBe('in range'); // 10, 15, 12, 10 at 2.5 kg — newest, not 09-20's 8
  });

  it('with the newest performance as the reference nothing changes', () => {
    const perfs = [perf('a', 3, [strengthSet(65, 6)]), perf('b', 10, [strengthSet(65, 10)])];
    const f = computeLoadFacts(benchPress, perfs, today(), emptyContext, NOW, TZ);
    if (isAbsent(f.lastExposure) || isAbsent(f.lastExposure.repsVsRange)) {
      throw new Error('expected values');
    }
    expect(f.lastExposure.repsVsRange).toBe('below floor');
  });
});

describe('AC-LPF-11 · reps in reserve: capacity = reps + (10 − RPE) when RPE is recorded (Helms et al.)', () => {
  const R810 = { min: 8, max: 10 };
  const exposure = (sets: ReturnType<typeof strengthSet>[], range = R810) =>
    computeLastExposure(perf('x', 3, sets), [], range, benchPress, 60);

  it('capacityOf: no RPE → the reps; RPE 10 → the reps; RPE 8 → +2; RPE 7 → +3', () => {
    expect([capacityOf(8, null), capacityOf(8, 10), capacityOf(8, 8), capacityOf(6, 7), capacityOf(8, 11)]).toEqual([
      8, 8, 10, 9, 8,
    ]);
  });

  it('8 @ RPE 8 counts as 10: at the top of 8–10', () => {
    expect(exposure([strengthSet(60, 8, { rpe: 8 }), strengthSet(60, 8, { rpe: 8 })]).repsVsRange).toBe(
      'at or above top',
    );
  });

  it('6 @ RPE 7 is an early stop: capacity 9 is not below the floor, and the effort flags say so', () => {
    const e = exposure([strengthSet(60, 10), strengthSet(60, 9), strengthSet(60, 6, { rpe: 7 })]);
    expect(e.repsVsRange).toBe('in range');
    expect(e.effort).toEqual({ earlyStop: true, unclearBelowFloor: false, set: { reps: 6, rpe: 7 } });
  });

  it('6 @ RPE 9 is genuinely below the floor (capacity 7): no early stop, nothing unclear', () => {
    const e = exposure([strengthSet(60, 10), strengthSet(60, 6, { rpe: 9 })]);
    expect(e.repsVsRange).toBe('below floor');
    expect(e.effort).toMatchObject({ earlyStop: false, unclearBelowFloor: false });
  });

  it('a lone below-floor set without RPE is unclear — below floor, but not provable', () => {
    const e = exposure([strengthSet(60, 10), strengthSet(60, 10), strengthSet(60, 6)]);
    expect(e.repsVsRange).toBe('below floor');
    expect(e.effort).toEqual({ earlyStop: false, unclearBelowFloor: true, set: { reps: 6, rpe: null } });
  });

  it('G-06/07: any number of below-floor sets without RPE is unclear the FIRST time', () => {
    const e = exposure([strengthSet(60, 7), strengthSet(60, 7), strengthSet(60, 6)]);
    expect(e.repsVsRange).toBe('below floor');
    expect(e.effort).toMatchObject({ unclearBelowFloor: true });
  });

  it('G-06/07: the same again in the next performance (still no RPE) is a real miss', () => {
    const e = computeLastExposure(
      perf('x', 3, [strengthSet(60, 7), strengthSet(60, 6)]),
      [perf('prev', 7, [strengthSet(60, 7), strengthSet(60, 6)])],
      R810,
      benchPress,
      60,
    );
    expect(e.effort.unclearBelowFloor).toBe(false);
  });

  it('G-06/07: the previous performance being fine (or having an RPE) keeps it unclear', () => {
    const fine = computeLastExposure(
      perf('x', 3, [strengthSet(60, 6)]),
      [perf('prev', 7, [strengthSet(60, 9), strengthSet(60, 9)])],
      R810,
      benchPress,
      60,
    );
    expect(fine.effort.unclearBelowFloor).toBe(true);
    const withRpe = computeLastExposure(
      perf('x', 3, [strengthSet(60, 6)]),
      [perf('prev', 7, [strengthSet(60, 6, { rpe: 9 })])],
      R810,
      benchPress,
      60,
    );
    expect(withRpe.effort.unclearBelowFloor).toBe(true);
  });

  it('a lone below-floor set at RPE 10 is a real miss', () => {
    const e = exposure([strengthSet(60, 10), strengthSet(60, 6, { rpe: 10 })]);
    expect(e.effort).toMatchObject({ earlyStop: false, unclearBelowFloor: false });
  });

  it('drop-off is measured in capacity: 12 @ 8 (14) → 8 @ 10 (8) is 6, not 4', () => {
    const e = exposure(
      [strengthSet(60, 12, { rpe: 8 }), strengthSet(60, 10, { rpe: 9 }), strengthSet(60, 8, { rpe: 10 })],
      { min: 6, max: 10 },
    );
    if (isAbsent(e.dropOff)) {
      throw new Error('expected a value');
    }
    expect(e.dropOff.value).toBe(6);
  });

  it('without any RPE nothing changes (reps are the capacity)', () => {
    const e = exposure([strengthSet(60, 12), strengthSet(60, 10), strengthSet(60, 8)], { min: 6, max: 10 });
    if (isAbsent(e.dropOff)) {
      throw new Error('expected a value');
    }
    expect(e.dropOff.value).toBe(4);
  });
});

describe('AC-LPF-12 · working weight is monotone in reps (W-22 (1), W-23)', () => {
  it('the generated flip (seed 45): extra reps that make 65 recur no longer displace the older 70', () => {
    // Before W-23 nothing recurred → "highest overall" (70); with +2 reps 65 recurred → 65 won: reps up, weight down.
    const mk = (extra: number) => [
      perf('a', 3, [strengthSet(65, 7 + extra), strengthSet(60, 12), strengthSet(60, 6)]),
      perf('b', 10, [strengthSet(60, 10)]),
      perf('c', 12, [strengthSet(65, 14), strengthSet(65, 12), strengthSet(65, 10), strengthSet(65, 8)]),
      perf('d', 22, [strengthSet(70, 6), strengthSet(70, 4)]),
      perf('e', 30, [strengthSet(70, 16), strengthSet(70, 13)]),
    ];
    const ww = (extra: number): number => {
      const r = computeWorkingWeight(mk(extra), 'today', R810, benchPress, NOW, TZ);
      return isAbsent(r) ? 0 : r.weight;
    };
    expect(ww(2)).toBeGreaterThanOrEqual(ww(0));
    expect(ww(4)).toBeGreaterThanOrEqual(ww(2));
  });

  it('a load that recurs but was never reached, with nothing reached in the newest session → the estimate speaks', () => {
    const perfs = [perf('a', 3, [strengthSet(70, 5)]), perf('b', 9, [strengthSet(70, 6)])];
    const r = computeWorkingWeight(perfs, 'today', R810, benchPress, NOW, TZ);
    if (isAbsent(r)) {
      throw new Error('expected a value');
    }
    expect([r.weight, r.estimatedFrom]).toEqual([60, { weight: 70, reps: 5 }]);
  });

  it('nothing recurs at all (singles, a pyramid) → every reached load is eligible, the highest wins', () => {
    const perfs = [perf('a', 3, [strengthSet(65, 10)]), perf('b', 9, [strengthSet(70, 10)])];
    const r = computeWorkingWeight(perfs, 'today', R810, benchPress, NOW, TZ);
    if (isAbsent(r)) {
      throw new Error('expected a value');
    }
    expect(r.weight).toBe(70);
  });
});

describe('AC-LPF-12 · indicative load of the newest single performance (ruling G-11)', () => {
  const ind = (sets: [number, number][], ex = benchPress) =>
    computeIndicativeLoad(
      [
        perf(
          'a',
          3,
          sets.map(([w, r]) => strengthSet(w, r)),
        ),
      ],
      'today',
      R810,
      ex,
      NOW,
      TZ,
    );

  it('60×6, 55×7, 45×12 (8–10, step 5) → 50 estimated from 55×7, not the failed opener 60', () => {
    expect(
      ind([
        [60, 6],
        [55, 7],
        [45, 12],
      ]),
    ).toEqual({ weight: 50, unit: null, estimatedFrom: { weight: 55, reps: 7 } });
  });

  it('the highest load at which every set reached the floor; the tie on 40/45 goes to the heavier', () => {
    expect(
      ind([
        [40, 10],
        [40, 10],
        [45, 8],
        [45, 8],
      ]),
    ).toMatchObject({ weight: 45 });
    expect(
      ind([
        [40, 10],
        [40, 10],
        [40, 9],
      ]),
    ).toMatchObject({ weight: 40 });
  });

  it('absent without a performance or a range; n/a for non-strength', () => {
    expect(computeIndicativeLoad([], 'today', R810, benchPress, NOW, TZ)).toEqual({ absent: 'no completed record' });
    expect(computeIndicativeLoad([perf('a', 3, [strengthSet(60, 10)])], 'today', null, benchPress, NOW, TZ)).toEqual({
      absent: 'no rep range',
    });
    const plank = { ...benchPress, exerciseType: 'isometric' as const };
    expect(computeIndicativeLoad([], 'today', R810, plank, NOW, TZ)).toEqual({ absent: 'n/a for isometric' });
  });
});

describe('AC-LPF-12 · pre-fatigue is measured against the NEWEST performance (orchestrator ruling 2026-10-01, W-27)', () => {
  it('the fatigue baseline is the newest session even when the reference is an older like-for-like pick', () => {
    const newest = perf('new', 3, [strengthSet(60, 20)], {
      otherSets: [other('Fly', [['chest', 'primary']], daysBefore(3, -30))],
    });
    const old = perf('old', 10, [strengthSet(60, 10)]);
    const f = computeLoadFacts(benchPress, [newest, old], today({ targetReps: '8-10' }), emptyContext, NOW, TZ);
    if (isAbsent(f.reference) || isAbsent(f.fatigueReference)) {
      throw new Error('expected values');
    }
    expect(f.reference.performance.id).toBe('old'); // like-for-like: 20 reps is outside 8–10 ± 2
    expect(f.fatigueReference.perMuscle.map(m => m.workingSets)).toEqual([1]); // the newest's one earlier chest set
  });
});

describe('AC-LPF-11 · capacity in the working weight and the estimate (run 3, W-30)', () => {
  const R = { min: 8, max: 10 };

  it('an early stop at a NEW load is judged at that load: 60 ×3 sessions, then 65×9,8,6 @ RPE 7 → working weight 65, early stop', () => {
    const perfs = [
      perf('new', 3, [strengthSet(65, 9), strengthSet(65, 8), strengthSet(65, 6, { rpe: 7 })]),
      perf('a', 8, [strengthSet(60, 10), strengthSet(60, 10), strengthSet(60, 9)]),
      perf('b', 13, [strengthSet(60, 10), strengthSet(60, 10), strengthSet(60, 9)]),
    ];
    const f = computeLoadFacts(benchPress, perfs, today({ targetReps: '8-10' }), emptyContext, NOW, TZ);
    if (isAbsent(f.workingWeight) || isAbsent(f.lastExposure)) {
      throw new Error('expected values');
    }
    expect(f.workingWeight.weight).toBe(65);
    expect(f.workingWeight.estimatedFrom).toBeUndefined();
    expect(f.lastExposure.effort).toMatchObject({ earlyStop: true, set: { reps: 6, rpe: 7 } });
  });

  it('a single 60×9,8,6 @ RPE 7 is no Epley "failure": capacity 9 reached the floor, so no estimate', () => {
    const one = [perf('a', 3, [strengthSet(60, 9), strengthSet(60, 8), strengthSet(60, 6, { rpe: 7 })])];
    expect(computeIndicativeLoad(one, 'today', R, benchPress, NOW, TZ)).toEqual({ weight: 60, unit: null });
    const two = [...one, perf('b', 9, [strengthSet(60, 10), strengthSet(60, 9)])];
    const ww = computeWorkingWeight(two, 'today', R, benchPress, NOW, TZ);
    if (isAbsent(ww)) {
      throw new Error('expected a value');
    }
    expect([ww.weight, ww.estimatedFrom]).toEqual([60, undefined]);
  });

  it('the estimate reads capacity too: 60×6 @ RPE 9 (capacity 7) still falls short → estimated from its capacity', () => {
    const perfs = [perf('a', 3, [strengthSet(60, 6, { rpe: 9 })]), perf('b', 9, [strengthSet(60, 6, { rpe: 9 })])];
    const ww = computeWorkingWeight(perfs, 'today', R, benchPress, NOW, TZ);
    if (isAbsent(ww)) {
      throw new Error('expected a value');
    }
    expect(ww.estimatedFrom).toEqual({ weight: 60, reps: 6 });
  });

  it('the estimate targets min(range.min, 10) reps: range 12–15, 100×8 → 95 (a 10-rep target), not 90 (12)', () => {
    const perfs = [perf('a', 3, [strengthSet(100, 8)]), perf('b', 9, [strengthSet(100, 8)])];
    const ww = computeWorkingWeight(perfs, 'today', { min: 12, max: 15 }, benchPress, NOW, TZ);
    if (isAbsent(ww)) {
      throw new Error('expected a value');
    }
    expect(ww.weight).toBe(95);
  });
});

describe('AC-LPF-11 · effort rows judge sets at the working weight only (run 3, W-30)', () => {
  const R = { min: 8, max: 10 };

  it('a performance with no set at the working weight is not judged: 6, 6 at another load → no effort flags', () => {
    const e = computeLastExposure(perf('x', 3, [strengthSet(65, 6), strengthSet(65, 6)]), [], R, benchPress, 60);
    expect(e.effort).toEqual({ earlyStop: false, unclearBelowFloor: false, set: null });
  });

  it('"repeated" needs the same load: a previous below-floor session at ANOTHER load does not make it a real miss', () => {
    const e = computeLastExposure(
      perf('x', 3, [strengthSet(60, 6)]),
      [perf('prev', 7, [strengthSet(65, 6), strengthSet(65, 6)])],
      R,
      benchPress,
      60,
    );
    expect(e.effort.unclearBelowFloor).toBe(true);
  });
});

describe('AC-LPF-11 · reps in reserve count at most 3 toward capacity (run 4 R3, W-36)', () => {
  it('capacityOf caps the reserve: RPE 5 adds 3, not 5', () => {
    expect([capacityOf(3, 5), capacityOf(8, 8), capacityOf(6, 7), capacityOf(6, 4)]).toEqual([6, 10, 9, 9]);
  });

  it('the reviewer probe: 60×10 ×2 sessions then 60×10,10 + 100×3 @ RPE 5 (8–12) does not make 100 the working weight', () => {
    const perfs = [
      perf('new', 3, [strengthSet(60, 10), strengthSet(60, 10), strengthSet(100, 3, { rpe: 5 })]),
      perf('a', 8, [strengthSet(60, 10), strengthSet(60, 10), strengthSet(60, 10)]),
      perf('b', 13, [strengthSet(60, 10), strengthSet(60, 10), strengthSet(60, 10)]),
    ];
    const ww = computeWorkingWeight(perfs, 'today', { min: 8, max: 12 }, benchPress, NOW, TZ);
    if (isAbsent(ww)) {
      throw new Error('expected a value');
    }
    expect(ww.weight).toBe(60);
  });
});

describe('AC-LPF-12 · step from history — confirmed loads only (run 5 R3, W-37)', () => {
  const dumbbell = { ...benchPress, equipment: 'dumbbell' as const };
  const barbell = { ...benchPress, equipment: 'barbell' as const };
  const step = (loads: number[][], ex = benchPress) => computeEquipmentStep(ex, loads);
  const UNKNOWN = { absent: 'recorded loads do not fit one step' };

  it('every recorded load on the default grid → the default, whatever the confirmed differences are', () => {
    expect(step([[45, 55], [60]])).toMatchObject({ step: 5, basis: 'default for machine' });
    expect(
      step([
        [40, 50],
        [40, 50],
      ]),
    ).toMatchObject({ step: 5, basis: 'default for machine' });
    expect(step([])).toMatchObject({ step: 5, basis: 'default for machine' });
    expect(step([[]])).toMatchObject({ step: 5, basis: 'default for machine' });
  });

  it('17.5 / 20 / 22.5 kg dumbbells, each in two sessions → the smallest adjacent difference, 2.5', () => {
    expect(
      step(
        [
          [17.5, 20, 22.5],
          [17.5, 20, 22.5],
        ],
        dumbbell,
      ),
    ).toMatchObject({ step: 2.5, basis: 'from history' });
  });

  it('lb dumbbells logged in kg, 20.4 / 22.7 twice each → 2.3', () => {
    expect(
      step(
        [
          [20.4, 22.7],
          [20.4, 22.7],
        ],
        dumbbell,
      ),
    ).toMatchObject({ step: 2.3, basis: 'from history' });
  });

  it('a lone recurring off-grid load (22.7 lb dumbbell in two sessions) → unknown, never a made-up 3.8 / 26.5', () => {
    expect(step([[22.7], [22.7]], dumbbell)).toEqual(UNKNOWN);
  });

  it('22.5 once next to 20 ×2 on dumbbells (default 2): 22.5 is off the grid, one confirmed load → unknown', () => {
    expect(step([[22.5, 20], [20]], dumbbell)).toEqual(UNKNOWN);
  });

  it('barbell 61.25 ×2 alone → unknown; with 60 ×2 beside it → 1.25', () => {
    expect(step([[61.25], [61.25]], barbell)).toEqual(UNKNOWN);
    expect(
      step(
        [
          [61.25, 60],
          [61.25, 60],
        ],
        barbell,
      ),
    ).toMatchObject({ step: 1.25, basis: 'from history' });
  });

  it('the difference must lie in [0.5 kg, 2 × default]: 0.2 and 12 kg gaps are refused', () => {
    expect(
      step(
        [
          [20.2, 20],
          [20.2, 20],
        ],
        dumbbell,
      ),
    ).toEqual(UNKNOWN);
    expect(
      step(
        [
          [20, 32.2],
          [20, 32.2],
        ],
        dumbbell,
      ),
    ).toEqual(UNKNOWN);
  });

  it('one-off loads never count: 22.7 once and 20.4 once → unknown', () => {
    expect(step([[22.7], [20.4]], dumbbell)).toEqual(UNKNOWN);
  });

  it('non-strength and unknown equipment stay n/a', () => {
    expect(step([[2.5]], { ...benchPress, equipment: 'none' })).toEqual({ absent: 'n/a for none' });
  });

  it('only the last 8 weeks are read: a 2.5 / 5 kg history older than that does not set the step', () => {
    const f = computeLoadFacts(
      lateralRaise,
      ownerPerfs(lateralRaise.id, LATERAL_RAISE_ROWS, '2026-09-25'),
      today({ targetReps: '10-12' }),
      emptyContext,
      ownerNow('2026-09-25', 70),
      TZ,
    );
    expect(f.equipmentStep).toMatchObject({ step: 5, basis: 'default for machine' });
  });

  it('the owner lateral raise (5 kg once, 2.5 kg in every session): only 2.5 is confirmed → unknown step', () => {
    const f = computeLoadFacts(
      lateralRaise,
      ownerPerfs(lateralRaise.id, LATERAL_RAISE_ROWS, '2026-09-25'),
      today({ targetReps: '10-12' }),
      emptyContext,
      ownerNow('2026-09-25', 4),
      TZ,
    );
    expect(f.equipmentStep).toEqual(UNKNOWN);
  });

  it('the owner lateral raise with 5 kg confirmed too (two sessions, explicit working sets) → 2.5', () => {
    const w = (weight: number, reps: number) => strengthSet(weight, reps, { setKind: 'working' });
    const perfs = [
      perf('a', 4, [w(2.5, 12), w(2.5, 11)]),
      perf('b', 9, [w(5, 10), w(2.5, 10)]),
      perf('c', 14, [w(5, 10), w(2.5, 10)]),
    ];
    const f = computeLoadFacts(lateralRaise, perfs, today({ targetReps: '10-12' }), emptyContext, NOW, TZ);
    expect(f.equipmentStep).toMatchObject({ step: 2.5, basis: 'from history', capApplies: false });
  });
});
