/**
 * `training.today` / `training.history` v1 (coach-simplification I1, AC-CS1-1): pure render tests over invented,
 * case-shaped fixtures — no DB, no loader. The facts blocks print dated facts only: no recommendation, verdict,
 * reason or target (P2/P3), and an effort that was not logged is absent, never guessed.
 */
import type { ExerciseLastPerformance } from '@domain/training/ports/workout-session.ports';
import type {
  ExerciseWithMuscles,
  SessionExerciseWithDetails,
  SessionExerciseStatus,
  SessionSet,
  SetData,
  SetKind,
  WorkoutSessionWithDetails,
} from '@domain/training/types';
import type { UserFact } from '@domain/user/ports';

import {
  collectLoadsUsed,
  computeWarmupHabit,
  formatSetShort,
  relativeDay,
  TRAINING_HISTORY_V1,
  TRAINING_TODAY_V1,
  trendLine,
  type ExerciseHistory,
  type TrainingFactsData,
} from '../training-facts';
import type { ContextBlockCtx } from '../types';

const TZ = 'Asia/Manila';
const NOW = new Date('2026-10-01T10:59:00.000Z'); // Thursday Oct 1, 18:59 local
const CTX: ContextBlockCtx = { now: NOW, timezone: TZ, user: null };

/** Local evening of the given date (Manila is UTC+8): 19:00 local = 11:00Z. */
const evening = (iso: string): Date => new Date(`${iso}T11:00:00.000Z`);

const ID = {
  press: '11111111-1111-4111-8111-111111111111',
  ext: '22222222-2222-4222-8222-222222222222',
  curl: '33333333-3333-4333-8333-333333333333',
  calf: '44444444-4444-4444-8444-444444444444',
  plank: '55555555-5555-4555-8555-555555555555',
  side: '66666666-6666-4666-8666-666666666666',
  bike: '77777777-7777-4777-8777-777777777777',
};

function exercise(id: string, name: string): ExerciseWithMuscles {
  return {
    id,
    name,
    category: 'compound',
    equipment: 'machine',
    exerciseType: 'strength',
    description: null,
    energyCost: 'medium',
    complexity: 'intermediate',
    typicalDurationMinutes: 10,
    requiresSpotter: false,
    imageUrl: null,
    videoUrl: null,
    createdAt: new Date('2020-01-01T00:00:00.000Z'),
    muscleGroups: [],
  };
}

let setSeq = 0;
function set(
  setData: SetData,
  extra: { rpe?: number | null; kind?: SetKind; note?: string; createdAt?: Date } = {},
): SessionSet {
  setSeq += 1;
  return {
    id: `set-${setSeq}`,
    sessionExerciseId: 'se',
    setNumber: setSeq,
    rpe: extra.rpe ?? null,
    userFeedback: extra.note ?? null,
    createdAt: extra.createdAt ?? NOW,
    completedAt: extra.createdAt ?? NOW,
    setData,
    setKind: extra.kind ?? 'working',
  };
}

/** `12×110` shorthand: kg strength sets from `[reps, weight, rpe?]` rows. */
function strength(rows: Array<[number, number, number?]>): SessionSet[] {
  return rows.map(([reps, weight, rpe]) => set({ type: 'strength', reps, weight, weightUnit: 'kg' }, { rpe }));
}

const hold = (seconds: number[]): SessionSet[] => seconds.map(s => set({ type: 'isometric', duration: s }));

function sessionExercise(
  id: string,
  name: string,
  sets: SessionSet[],
  status: SessionExerciseStatus = 'completed',
): SessionExerciseWithDetails {
  return {
    id: `se-${id}`,
    sessionId: 'sess',
    exerciseId: id,
    orderIndex: 0,
    status,
    targetSets: null,
    targetReps: null,
    targetWeight: null,
    actualRepsRange: null,
    userFeedback: null,
    createdAt: NOW,
    exercise: exercise(id, name),
    sets,
  };
}

function performance(id: string, name: string, date: string, sets: SessionSet[]): ExerciseLastPerformance {
  return { exerciseId: id, completedAt: evening(date), sessionExercise: sessionExercise(id, name, sets) };
}

function history(
  id: string,
  name: string,
  plannedText: string | null,
  performances: ExerciseLastPerformance[],
  lastSkippedAt: Date | null = null,
): ExerciseHistory {
  return {
    exerciseId: id,
    exerciseName: name,
    plannedText,
    performances,
    lastSkippedAt,
    loadsUsed: collectLoadsUsed(performances),
  };
}

const PLAN = [
  { exerciseId: ID.press, exerciseName: '45° Leg Press', targetSets: 4, targetReps: '12', restSeconds: 90 },
  { exerciseId: ID.ext, exerciseName: 'Leg Extension', targetSets: 3, targetReps: '15', restSeconds: 60 },
  { exerciseId: ID.curl, exerciseName: 'Leg Curl', targetSets: 3, targetReps: '15', restSeconds: 60 },
  { exerciseId: ID.calf, exerciseName: 'Standing Calf Raise', targetSets: 3, targetReps: '25–30', restSeconds: 60 },
  { exerciseId: ID.plank, exerciseName: 'Plank', targetSets: 2, targetReps: '45 s', restSeconds: 60 },
  { exerciseId: ID.side, exerciseName: 'Side Plank', targetSets: 2, targetReps: '25–30 s per side', restSeconds: 60 },
];

function makeSession(over: Partial<WorkoutSessionWithDetails> = {}): WorkoutSessionWithDetails {
  const started = new Date('2026-10-01T10:38:00.000Z'); // 18:38 local
  return {
    id: 'sess',
    userId: 'u1',
    planId: null,
    sessionKey: null,
    status: 'in_progress',
    place: null,
    startedAt: started,
    completedAt: null,
    durationMinutes: null,
    userContextJson: null,
    sessionPlanJson: {
      sessionKey: 'k',
      sessionName: 'Lower',
      reasoning: '',
      exercises: PLAN,
      estimatedDuration: 45,
    },
    lastActivityAt: new Date('2026-10-01T10:55:00.000Z'),
    autoCloseReason: null,
    createdAt: started,
    updatedAt: started,
    exercises: [
      sessionExercise(
        ID.press,
        '45° Leg Press',
        strength([
          [12, 130, 8],
          [12, 135, 8],
          [12, 135, 9],
          [16, 135, 9.5],
        ]),
        'in_progress',
      ),
      sessionExercise(ID.ext, 'Leg Extension', [], 'pending'),
      sessionExercise(ID.plank, 'Plank', [], 'skipped'),
      sessionExercise(
        ID.bike,
        'Cycling',
        [set({ type: 'cardio_duration', duration: 540 }, { kind: 'warmup' })],
        'completed',
      ),
    ],
    ...over,
  };
}

const HISTORY: ExerciseHistory[] = [
  history(ID.press, '45° Leg Press', '4×12', [
    performance(
      ID.press,
      '45° Leg Press',
      '2026-09-27',
      strength([
        [12, 110],
        [12, 130, 8],
        [12, 130, 8],
        [12, 135, 9],
      ]),
    ),
    performance(
      ID.press,
      '45° Leg Press',
      '2026-09-21',
      strength([
        [12, 110],
        [12, 110],
        [12, 120],
        [12, 120, 9],
      ]),
    ),
    performance(ID.press, '45° Leg Press', '2026-09-16', [
      set({ type: 'strength', reps: 10, weight: 80, weightUnit: 'kg' }, { kind: 'warmup' }),
      ...strength([
        [12, 110, 9],
        [12, 110, 9],
        [12, 110, 9],
      ]),
    ]),
  ]),
  history(ID.plank, 'Plank', '2×45', [
    performance(ID.plank, 'Plank', '2026-09-29', hold([45, 45])),
    performance(ID.plank, 'Plank', '2026-09-27', hold([45, 45])),
    performance(ID.plank, 'Plank', '2026-09-21', hold([45, 45])),
  ]),
  history(ID.bike, 'Cycling', null, [
    {
      exerciseId: ID.bike,
      completedAt: evening('2026-09-10'),
      sessionExercise: sessionExercise(ID.bike, 'Cycling', [
        set({ type: 'cardio_duration', duration: 600 }, { note: 'timed by feel; 10 min is an estimate' }),
      ]),
    },
  ]),
];

const DATA: TrainingFactsData = {
  profileFacts: [],
  reportedToday: [],
  coachReplied: true,
  warmupHabit: null,
  session: makeSession(),
  history: HISTORY,
  lastWorkout: {
    completedAt: evening('2026-09-29'),
    exerciseNames: ['Treadmill', 'Chest-Supported Row', 'Plank'],
  },
};

describe('TRAINING_TODAY_V1 (# Today)', () => {
  const text = TRAINING_TODAY_V1.render(DATA, CTX, 0) ?? '';

  it('has id training.today and renders the exact header, previous workout, plan and sets', () => {
    expect(TRAINING_TODAY_V1.id).toBe('training.today');
    expect(text.split('\n')).toEqual([
      '# Today (sets as reps×kg)',
      'Previous workout: 2 days ago, Tuesday Sep 29 — Treadmill, Chest-Supported Row, Plank.',
      'Plan and sets so far:',
      `- 45° Leg Press [id ${ID.press}] — plan 4×12 — in progress: 12×130 (RPE 8), 12×135 (RPE 8), 12×135 (RPE 9), 16×135 (RPE 9.5)`,
      `- Leg Extension [id ${ID.ext}] — plan 3×15 — nothing yet`,
      `- Leg Curl [id ${ID.curl}] — plan 3×15 — nothing yet`,
      `- Standing Calf Raise [id ${ID.calf}] — plan 3×25–30 — nothing yet`,
      `- Plank [id ${ID.plank}] — plan 2×45 s — skipped`,
      `- Side Plank [id ${ID.side}] — plan 2×25–30 s per side — nothing yet`,
      'Off plan:',
      `- Cycling [id ${ID.bike}] — done: 9 min (warm-up)`,
    ]);
  });

  it('names a plan exercise not yet started from the history (catalog name), then the plan', () => {
    const named = TRAINING_TODAY_V1.render(
      { ...DATA, history: [history(ID.curl, 'Seated Leg Curl', '3×15', [])] },
      CTX,
      0,
    );
    expect(named).toContain(`- Seated Leg Curl [id ${ID.curl}] — plan 3×15 — nothing yet`);
  });

  it('states the place only when stated', () => {
    expect(text).not.toContain('Place');
    const placed = TRAINING_TODAY_V1.render({ ...DATA, session: makeSession({ place: 'Hotel gym' }) }, CTX, 0);
    expect(placed?.split('\n')[1]).toBe('Place: Hotel gym.');
  });

  it('says "No plan for this session." and lists ad-hoc exercises when there is no plan', () => {
    const adhoc = makeSession({ sessionPlanJson: null });
    const out = TRAINING_TODAY_V1.render({ ...DATA, session: adhoc, lastWorkout: null }, CTX, 0) ?? '';
    expect(out).toContain('No plan for this session.');
    expect(out).toContain('Sets so far:');
    expect(out).not.toContain('Previous workout');
    expect(out).toContain(`- Cycling [id ${ID.bike}] — done: 9 min (warm-up)`);
  });

  it('adds one fact line for a stale session (retro-logging), nothing otherwise', () => {
    expect(text).not.toContain('No activity');
    const stale = makeSession({ lastActivityAt: new Date('2026-10-01T07:55:00.000Z') }); // 3 h before NOW
    const out = TRAINING_TODAY_V1.render({ ...DATA, session: stale }, CTX, 0) ?? '';
    expect(out).toContain("No activity for 3 h; a set logged now is dated to the session's last activity.");
  });

  it('never prints an age: no session length or elapsed minutes, whatever the clock says', () => {
    const future = new Date(NOW.getTime() + 5 * 60000);
    const session = makeSession({ startedAt: future, createdAt: future });
    session.exercises[0]?.sets.push(
      set({ type: 'strength', reps: 10, weight: 100, weightUnit: 'kg' }, { createdAt: future }),
    );
    const out = TRAINING_TODAY_V1.render({ ...DATA, session }, CTX, 0) ?? '';
    expect(out).not.toMatch(/-\d+\s*min|\(-\d|min ago|Session started/);
  });

  it('carries no recommendation, verdict, reason or target wording (status word "in progress" aside)', () => {
    const scrubbed = text.replace(/in progress/g, 'ongoing');
    expect(scrubbed).not.toMatch(/recommend|conservative|next step|stage|tier|LOAD PLAN|should|progress|regress/i);
  });
});

describe('TRAINING_HISTORY_V1 (# History)', () => {
  const text = TRAINING_HISTORY_V1.render(DATA, CTX, 0) ?? '';

  it('has id training.history; absent (null) with no exercises', () => {
    expect(TRAINING_HISTORY_V1.id).toBe('training.history');
    expect(TRAINING_HISTORY_V1.render({ ...DATA, history: [] }, CTX, 0)).toBeNull();
  });

  it('renders the leg press entry: dated lines, RPE rules, trend', () => {
    expect(text).toContain(
      [
        '45° Leg Press (today 4×12)',
        '- 4 days ago, Sunday Sep 27: 12×110, 12×130 (RPE 8), 12×130 (RPE 8), 12×135 (RPE 9)',
        '- 10 days ago, Monday Sep 21: 12×110, 12×110, 12×120, 12×120 (RPE 9)',
        '- 15 days ago, Wednesday Sep 16: 10×80 (warm-up), 12×110, 12×110, 12×110 (all RPE 9)',
        '- Trend Sep 16 → Sep 21 → Sep 27: top weight 110 → 120 → 135 kg; working sets 3 → 4 → 4; reps per working set 12 → 12 → 12; weight × reps 3,960 → 5,520 → 6,060.',
        '- Loads used: 80, 110, 120, 130, 135 kg.',
      ].join('\n'),
    );
  });

  it('renders the plank entry: holds without an RPE note, hold trend', () => {
    expect(text).toContain(
      [
        'Plank (today 2×45)',
        '- 2 days ago, Tuesday Sep 29: 45 s, 45 s',
        '- 4 days ago, Sunday Sep 27: 45 s, 45 s',
        '- 10 days ago, Monday Sep 21: 45 s, 45 s',
        '- Trend Sep 21 → Sep 27 → Sep 29: hold per set 45 → 45 → 45 s; sets 2 → 2 → 2.',
      ].join('\n'),
    );
  });

  it('renders the off-plan cycling entry with the set note and no trend (one performance)', () => {
    expect(text).toContain(
      [
        'Cycling (today off plan)',
        '- 21 days ago, Thursday Sep 10: 10 min — his note: "timed by feel; 10 min is an estimate"',
      ].join('\n'),
    );
    expect(text).not.toMatch(/Cycling[\s\S]*Trend[\s\S]*$/);
  });

  it('says "no earlier record" when there is no performance', () => {
    const out = TRAINING_HISTORY_V1.render({ ...DATA, history: [history(ID.curl, 'Leg Curl', '3×15', [])] }, CTX, 0);
    expect(out).toContain('Leg Curl (today 3×15)\n- no earlier record');
  });

  it('prints a skip newer than the newest performance, and ignores an older one', () => {
    const skipped = history(
      ID.plank,
      'Plank',
      '2×45',
      [performance(ID.plank, 'Plank', '2026-09-21', hold([45]))],
      evening('2026-09-29'),
    );
    expect(TRAINING_HISTORY_V1.render({ ...DATA, history: [skipped] }, CTX, 0)).toContain(
      'Plank (today 2×45)\n- skipped Tuesday Sep 29 (planned, not done)\n- 10 days ago, Monday Sep 21: 45 s',
    );
    const older = history(
      ID.plank,
      'Plank',
      '2×45',
      [performance(ID.plank, 'Plank', '2026-09-29', hold([45]))],
      evening('2026-09-21'),
    );
    expect(TRAINING_HISTORY_V1.render({ ...DATA, history: [older] }, CTX, 0)).not.toContain('skipped');
  });

  it('carries no recommendation, verdict, reason or target wording', () => {
    expect(text).not.toMatch(/recommend|conservative|next step|stage|tier|LOAD PLAN|should|progress|regress/i);
  });
});

describe('RPE rules', () => {
  const line = (sets: SessionSet[]): string => {
    const h = history(ID.press, 'X', null, [
      {
        exerciseId: ID.press,
        completedAt: evening('2026-09-27'),
        sessionExercise: sessionExercise(ID.press, 'X', sets),
      },
    ]);
    const lines = (TRAINING_HISTORY_V1.render({ ...DATA, history: [h] }, CTX, 0) ?? '').split('\n');
    return lines.find(l => l.startsWith('- 4 days ago')) ?? '';
  };

  it('mixed: a rated set prints its RPE, an unrated working set is printed bare', () => {
    expect(
      line(
        strength([
          [10, 50, 7],
          [10, 50],
          [10, 50, 8],
        ]),
      ),
    ).toBe('- 4 days ago, Sunday Sep 27: 10×50 (RPE 7), 10×50, 10×50 (RPE 8)');
  });

  it('none rated: a strength line ends "(no RPE recorded)"', () => {
    expect(
      line(
        strength([
          [10, 50],
          [10, 50],
        ]),
      ),
    ).toBe('- 4 days ago, Sunday Sep 27: 10×50, 10×50 (no RPE recorded)');
  });

  it('all equal: "all RPE n" once', () => {
    expect(
      line(
        strength([
          [10, 50, 8],
          [10, 50, 8],
        ]),
      ),
    ).toBe('- 4 days ago, Sunday Sep 27: 10×50, 10×50 (all RPE 8)');
  });

  it('a single rated working set keeps its own (RPE n)', () => {
    expect(line(strength([[10, 50, 8]]))).toBe('- 4 days ago, Sunday Sep 27: 10×50 (RPE 8)');
  });

  it('a legacy set with no stored kind is never labelled warm-up, even when it looks light', () => {
    const legacy = [
      { ...set({ type: 'strength', reps: 10, weight: 20, weightUnit: 'kg' }), setKind: null },
      ...strength([[10, 50, 9]]),
    ];
    expect(line(legacy)).toBe('- 4 days ago, Sunday Sep 27: 10×20, 10×50 (RPE 9)');
  });

  it('warm-up sets are marked and never counted as unrated', () => {
    const sets = [
      set({ type: 'strength', reps: 10, weight: 20, weightUnit: 'kg' }, { kind: 'warmup' }),
      ...strength([[10, 50, 9]]),
    ];
    expect(line(sets)).toBe('- 4 days ago, Sunday Sep 27: 10×20 (warm-up), 10×50 (RPE 9)');
  });
});

describe('relativeDay', () => {
  const at = (iso: string): string => relativeDay(new Date(`${iso}T11:00:00.000Z`), NOW, TZ);

  it('0 days → today', () => expect(at('2026-10-01')).toBe('today'));
  it('1 day → yesterday with the date', () => expect(at('2026-09-30')).toBe('yesterday, Wednesday Sep 30'));
  it('4 days', () => expect(at('2026-09-27')).toBe('4 days ago, Sunday Sep 27'));
  it('15 days', () => expect(at('2026-09-16')).toBe('15 days ago, Wednesday Sep 16'));
  it('59 days still counts days', () => expect(at('2026-08-03')).toBe('59 days ago, Monday Aug 3'));
  it('159 days → date plus months in words', () =>
    expect(at('2026-04-24')).toBe('Friday Apr 24, about five months ago'));
  it('adds the year when it differs', () =>
    expect(relativeDay(new Date('2025-12-05T11:00:00.000Z'), NOW, TZ)).toBe('Friday Dec 5 2025, about ten months ago'));
  it('across a year boundary under 60 days keeps days', () =>
    expect(relativeDay(new Date('2026-12-28T11:00:00.000Z'), new Date('2027-01-05T03:00:00.000Z'), TZ)).toBe(
      '8 days ago, Monday Dec 28',
    ));
  it('counts calendar days in the user timezone, not 24 h blocks', () => {
    // 23:50 local on Sep 30 vs 00:10 local on Oct 1 → yesterday
    expect(relativeDay(new Date('2026-09-30T15:50:00.000Z'), new Date('2026-09-30T16:10:00.000Z'), TZ)).toBe(
      'yesterday, Wednesday Sep 30',
    );
  });
  it('a date after now clamps to today', () => expect(at('2026-10-03')).toBe('today'));
});

describe('formatSetShort', () => {
  it.each<[string, SetData, string]>([
    ['strength', { type: 'strength', reps: 12, weight: 130, weightUnit: 'kg' }, '12×130'],
    ['per hand', { type: 'strength', reps: 10, weight: 12, weightUnit: 'kg', perHand: true }, '10×12 per hand'],
    ['no weight', { type: 'strength', reps: 12 }, '12 reps'],
    ['functional', { type: 'functional_reps', reps: 20 }, '20 reps'],
    ['isometric', { type: 'isometric', duration: 45 }, '45 s'],
    ['cardio minutes', { type: 'cardio_duration', duration: 540 }, '9 min'],
    ['cardio short', { type: 'cardio_duration', duration: 40 }, '40 s'],
    ['cardio intensity', { type: 'cardio_duration', duration: 600, intensity: 'high' }, '10 min, high intensity'],
    ['distance', { type: 'cardio_distance', distance: 2.26, distanceUnit: 'km', duration: 1020 }, '2.26 km in 17 min'],
    [
      'distance no time',
      { type: 'cardio_distance', distance: 2.26, distanceUnit: 'km', duration: 0 },
      '2.26 km, time not recorded',
    ],
    [
      'incline',
      { type: 'cardio_distance', distance: 3, distanceUnit: 'km', duration: 1800, inclinePct: 5 },
      '3 km in 30 min, 5% incline',
    ],
    ['interval', { type: 'interval', workDuration: 30, restDuration: 30, rounds: 6 }, '6 rounds 30 s on / 30 s off'],
  ])('%s', (_name, data, expected) => {
    expect(formatSetShort(data)).toBe(expected);
  });
});

describe('trendLine', () => {
  const perf = (date: string, sets: SessionSet[]): ExerciseLastPerformance => performance(ID.press, 'X', date, sets);
  const trend = (...p: ExerciseLastPerformance[]): string | null => trendLine(p, NOW, TZ);

  it('weighted strength', () => {
    expect(
      trend(
        perf(
          '2026-09-27',
          strength([
            [12, 135],
            [12, 135],
          ]),
        ),
        perf(
          '2026-09-21',
          strength([
            [10, 120],
            [12, 120],
            [12, 120],
          ]),
        ),
      ),
    ).toBe(
      'Trend Sep 21 → Sep 27: top weight 120 → 135 kg; working sets 3 → 2; reps per working set 10–12 → 12; weight × reps 4,080 → 3,240.',
    );
  });

  it('per hand weights are noted', () => {
    const hands = (reps: number, weight: number): SessionSet =>
      set({ type: 'strength', reps, weight, weightUnit: 'kg', perHand: true });
    expect(trend(perf('2026-09-27', [hands(10, 14)]), perf('2026-09-21', [hands(10, 12)]))).toContain(
      'top weight 12 → 14 kg per hand',
    );
  });

  it('reps only', () => {
    const reps = (n: number): SessionSet => set({ type: 'functional_reps', reps: n });
    expect(trend(perf('2026-09-27', [reps(15), reps(15)]), perf('2026-09-21', [reps(12), reps(12), reps(12)]))).toBe(
      'Trend Sep 21 → Sep 27: working sets 3 → 2; reps per set 12 → 15; total reps 36 → 30.',
    );
  });

  it('isometric', () => {
    expect(trend(perf('2026-09-27', hold([40, 45])), perf('2026-09-21', hold([30, 30])))).toBe(
      'Trend Sep 21 → Sep 27: hold per set 30 → 40–45 s; sets 2 → 2.',
    );
  });

  it('cardio duration', () => {
    const run = (s: number): SessionSet => set({ type: 'cardio_duration', duration: s });
    expect(trend(perf('2026-09-27', [run(720)]), perf('2026-09-21', [run(600)]))).toBe(
      'Trend Sep 21 → Sep 27: minutes 10 → 12.',
    );
  });

  it('cardio distance', () => {
    const run = (km: number, s: number): SessionSet =>
      set({ type: 'cardio_distance', distance: km, distanceUnit: 'km', duration: s });
    expect(trend(perf('2026-09-27', [run(2.5, 960)]), perf('2026-09-21', [run(2.2, 1020)]))).toBe(
      'Trend Sep 21 → Sep 27: distance 2.2 → 2.5 km; time 17 → 16 min.',
    );
  });

  it('mixed set types → no trend', () => {
    expect(trend(perf('2026-09-27', hold([45])), perf('2026-09-21', strength([[10, 50]])))).toBeNull();
    expect(
      trend(
        perf('2026-09-27', strength([[10]].map(([r]) => [r ?? 10, 50]))),
        perf('2026-09-21', [set({ type: 'strength', reps: 10 })]),
      ),
    ).toBeNull();
  });

  it('fewer than two performances → no trend', () => {
    expect(trend(perf('2026-09-27', strength([[10, 50]])))).toBeNull();
  });

  it('adds the year to the dates when they span years', () => {
    const line = trendLine(
      [performance(ID.press, 'X', '2026-09-27', hold([45])), performance(ID.press, 'X', '2025-12-05', hold([40]))],
      NOW,
      TZ,
    );
    expect(line).toContain('Trend Dec 5 2025 → Sep 27 2026');
  });
});

describe('Habit and loads used', () => {
  const workout = (id: string, exercises: SessionExerciseWithDetails[]): WorkoutSessionWithDetails =>
    makeSession({ id, status: 'completed', exercises });
  const cardio = (name: string, minutes: number, order = 0): SessionExerciseWithDetails => ({
    ...sessionExercise(ID.bike, name, [set({ type: 'cardio_duration', duration: minutes * 60 })]),
    orderIndex: order,
    exercise: { ...exercise(ID.bike, name), category: 'cardio' },
  });
  const lift = (order = 1): SessionExerciseWithDetails => ({
    ...sessionExercise(ID.press, 'Leg Press', strength([[10, 100]])),
    orderIndex: order,
  });

  it('computeWarmupHabit: kinds with minute ranges, from the last workouts that opened with cardio', () => {
    const ws = [
      workout('a', [cardio('Treadmill', 10), lift()]),
      workout('b', [cardio('Treadmill', 15), lift()]),
      workout('c', [cardio('Cycling', 8), lift()]),
      workout('d', [lift(0), lift(1)]),
      workout('e', [lift(0)]), // one exercise only: not counted
    ];
    expect(computeWarmupHabit(ws)).toEqual({
      workouts: 4,
      withCardio: 3,
      kinds: [
        { label: 'treadmill', minMinutes: 10, maxMinutes: 15 },
        { label: 'bike', minMinutes: 8, maxMinutes: 8 },
      ],
    });
  });

  it('computeWarmupHabit: null below half, and with no workouts', () => {
    expect(
      computeWarmupHabit([
        workout('a', [cardio('Treadmill', 10), lift()]),
        workout('b', [lift(0), lift(1)]),
        workout('c', [lift(0), lift(1)]),
      ]),
    ).toBeNull();
    expect(computeWarmupHabit([])).toBeNull();
  });

  it('renders the habit line first under the History header', () => {
    const habit = {
      workouts: 10,
      withCardio: 9,
      kinds: [
        { label: 'treadmill', minMinutes: 10, maxMinutes: 15 },
        { label: 'bike', minMinutes: 8, maxMinutes: 8 },
      ],
    };
    const out = TRAINING_HISTORY_V1.render({ ...DATA, warmupHabit: habit }, CTX, 0) ?? '';
    expect(out.split('\n\n').slice(0, 2)).toEqual([
      '# History (before today)',
      'Habit: a cardio warm-up (treadmill 10–15 min, bike 8 min) before 9 of the last 10 workouts.',
    ]);
    expect(TRAINING_HISTORY_V1.render({ ...DATA, history: [], warmupHabit: habit }, CTX, 0)).toContain('Habit:');
  });

  it('collectLoadsUsed: distinct kg loads ascending with the last day each was used', () => {
    const loads = collectLoadsUsed([
      performance(
        ID.press,
        'X',
        '2026-09-27',
        strength([
          [10, 80],
          [10, 90],
        ]),
      ),
      performance(
        ID.press,
        'X',
        '2026-09-20',
        strength([
          [10, 80],
          [10, 70],
        ]),
      ),
    ]);
    expect(loads.map(l => [l.weight, l.lastUsedAt.toISOString().slice(0, 10)])).toEqual([
      [70, '2026-09-20'],
      [80, '2026-09-27'],
      [90, '2026-09-27'],
    ]);
  });

  it('Loads used line: recent loads ascending, older ones grouped by their last date', () => {
    const h = history(ID.press, 'X', '3×10', [
      performance(
        ID.press,
        'X',
        '2026-09-27',
        strength([
          [10, 80],
          [10, 90],
        ]),
      ),
      performance(ID.press, 'X', '2026-01-12', strength([[10, 100]])),
      performance(ID.press, 'X', '2025-11-18', strength([[10, 60]])),
    ]);
    const out = TRAINING_HISTORY_V1.render({ ...DATA, history: [h] }, CTX, 0) ?? '';
    expect(out).toContain('- Loads used: 80, 90 kg; 100 kg last on Jan 12 2026; 60 kg last on Nov 18 2025.');
  });

  it('no Loads used line for holds', () => {
    expect(TRAINING_HISTORY_V1.render({ ...DATA, history: [HISTORY[1] as ExerciseHistory] }, CTX, 0)).not.toContain(
      'Loads used',
    );
  });
});

describe('Today: planning warnings and notes', () => {
  it('renders the planner warnings and per-exercise notes verbatim when persisted', () => {
    const base = makeSession();
    const plan = base.sessionPlanJson!;
    const session = makeSession({
      sessionPlanJson: {
        ...plan,
        warnings: ['slept badly', 'lower back is sore'],
        exercises: plan.exercises.map(e => (e.exerciseId === ID.ext ? { ...e, notes: 'keep it light' } : e)),
      },
    });
    const out = TRAINING_TODAY_V1.render({ ...DATA, session }, CTX, 0) ?? '';
    expect(out).toContain('Planning warnings: slept badly; lower back is sore.');
    expect(out).toContain(`- Leg Extension [id ${ID.ext}] — plan 3×15 — planning note: keep it light — nothing yet`);
  });

  it('prints nothing extra when the plan has none', () => {
    const out = TRAINING_TODAY_V1.render(DATA, CTX, 0) ?? '';
    expect(out).not.toMatch(/Planning (warnings|note)/);
  });
});

describe('Today: check-in (D12) and reported today (D13)', () => {
  const fact = (over: Partial<UserFact>): UserFact =>
    ({
      id: 'f',
      category: 'physical_constraint',
      fact: 'Lower back: no heavy axial loading',
      muscleGroup: 'lower_back',
      createdAt: new Date('2026-08-01T00:00:00.000Z'),
      ...over,
    }) as UserFact;
  const render = (over: Partial<TrainingFactsData>): string =>
    TRAINING_TODAY_V1.render({ ...DATA, ...over }, CTX, 0) ?? '';
  const CHECK = 'Check-in: ask how the lower back is today — not asked yet today.';

  it('first turn with a constraint: one line per constrained muscle group, in plain words', () => {
    const out = render({
      coachReplied: false,
      profileFacts: [
        fact({}),
        fact({ id: 'g', muscleGroup: 'right_knee', fact: 'Right knee: pinches' }),
        fact({ id: 'h', muscleGroup: 'lower_back' }),
      ],
    });
    expect(out).toContain(CHECK);
    expect(out).toContain('Check-in: ask how the right knee is today — not asked yet today.');
    expect(out.match(/Check-in:/g)).toHaveLength(2);
  });

  it('absent once the coach has replied', () => {
    expect(render({ coachReplied: true, profileFacts: [fact({})] })).not.toContain('Check-in');
  });

  it('absent without a physical constraint (or one with no muscle group)', () => {
    expect(render({ coachReplied: false, profileFacts: [] })).not.toContain('Check-in');
    expect(
      render({ coachReplied: false, profileFacts: [fact({ category: 'equipment' }), fact({ muscleGroup: null })] }),
    ).not.toContain('Check-in');
  });

  it('absent when the planner left warnings or an exercise note', () => {
    const base = makeSession();
    const plan = base.sessionPlanJson!;
    const withWarning = makeSession({ sessionPlanJson: { ...plan, warnings: ['slept badly'] } });
    const withNote = makeSession({
      sessionPlanJson: { ...plan, exercises: plan.exercises.map((e, i) => (i === 0 ? { ...e, notes: 'light' } : e)) },
    });
    for (const session of [withWarning, withNote]) {
      expect(render({ session, coachReplied: false, profileFacts: [fact({})] })).not.toContain('Check-in');
    }
    // blank warnings do not count as a covered state
    const blank = makeSession({ sessionPlanJson: { ...plan, warnings: ['  '] } });
    expect(render({ session: blank, coachReplied: false, profileFacts: [fact({})] })).toContain(CHECK);
  });

  it('renders facts created this workout as "Reported today" with the local time', () => {
    const out = render({
      reportedToday: [
        fact({ fact: 'Right knee pinched on the squat', createdAt: new Date('2026-10-01T11:33:00.000Z') }),
      ],
    });
    expect(out).toContain('Reported today: Right knee pinched on the squat (19:33)');
    expect(render({})).not.toContain('Reported today');
  });
});

describe('History: the habit line replaces the cardio warm-up block', () => {
  const habit = {
    workouts: 10,
    withCardio: 9,
    kinds: [{ label: 'bike', minMinutes: 8, maxMinutes: 8 }],
  };
  const bikeFirst = [HISTORY[2]!, HISTORY[0]!];

  it('drops the first exercise history when its kind is in the habit', () => {
    const out = TRAINING_HISTORY_V1.render({ ...DATA, history: bikeFirst, warmupHabit: habit }, CTX, 0) ?? '';
    expect(out).toContain('Habit:');
    expect(out).not.toContain('Cycling');
    expect(out).toContain('45° Leg Press');
  });

  it('keeps it without a habit, or when the cardio is not first', () => {
    expect(TRAINING_HISTORY_V1.render({ ...DATA, history: bikeFirst, warmupHabit: null }, CTX, 0)).toContain('Cycling');
    expect(
      TRAINING_HISTORY_V1.render({ ...DATA, history: [HISTORY[0]!, HISTORY[2]!], warmupHabit: habit }, CTX, 0),
    ).toContain('Cycling');
  });

  it('with only the warm-up exercise today, the block is just the habit line', () => {
    const out = TRAINING_HISTORY_V1.render({ ...DATA, history: [HISTORY[2]!], warmupHabit: habit }, CTX, 0);
    expect(out).toBe(
      '# History (before today)\n\nHabit: a cardio warm-up (bike 8 min) before 9 of the last 10 workouts.',
    );
  });
});
