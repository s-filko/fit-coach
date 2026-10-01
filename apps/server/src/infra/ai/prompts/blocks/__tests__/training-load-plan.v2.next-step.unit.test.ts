/**
 * load-plan-fixes items 5–7 end to end through the loader and the v2 block: the LOAD PLAN rows (recommend /
 * conservative / next step) for the owner's 45° Leg Press and Lateral Raise Machine histories (dev export 2026-10-01,
 * copied into the domain fixtures) and for the owner's example — 3 × 15 at 50 kg, range 8–10, four days of rest.
 */
import { LATERAL_RAISE_ROWS, LEG_PRESS_ROWS, ownerNow } from '@domain/training/load-facts/__tests__/fixtures';
import { defaultProgression } from '@domain/training/load-plan';

import { loadLoadPlanEntries, type LoadFactsLoaderDeps } from '@infra/ai/load-facts/load-facts.loader';
import { daysBefore, sessionRow, sets, TZ, type RowExercise } from '@infra/ai/load-facts/__tests__/rows';

import { renderLoadPlanEntryV2 } from '../training-load-plan.v2';

const progression = defaultProgression(null);

const LEG_PRESS = {
  id: '44444444-4444-4444-8444-444444444444',
  name: '45° Leg Press',
  muscles: [
    ['quads', 'primary'],
    ['glutes', 'primary'],
  ] as RowExercise['muscles'],
};
const LATERAL_RAISE = {
  id: '55555555-5555-4555-8555-555555555555',
  name: 'Lateral Raise Machine',
  muscles: [['shoulders_side', 'primary']] as RowExercise['muscles'],
};
type Ex = typeof LEG_PRESS;
type OwnerRows = { date: string; targetReps: string | null; sets: [number, number][] }[];

/** The LOAD PLAN entry text for `ex` with `past` sessions at `now`, today's plan range `targetReps`. */
async function entryText(
  ex: Ex,
  past: ReturnType<typeof sessionRow>[],
  now: Date,
  targetReps: string,
  constraints: unknown[] = [],
): Promise<string> {
  const today = sessionRow('today', now, [{ rowId: 'rt', ...ex, targetReps, sets: [] }], { status: 'in_progress' });
  const deps = {
    workoutSessionRepo: {
      findRecentByUserIdWithDetails: async () => past,
      findLastPerformancesByExercise: async () => [],
      countRealPerformancesByExercise: async () => new Map([[ex.id, past.length]]),
    },
    exerciseRepository: { findByIdsWithMuscles: async () => [past[0].exercises[0].exercise] },
    trainingService: { getSessionDetails: async () => null },
    userFacts: { getConstraints: async () => constraints, getForPrompt: async () => [] },
  } as unknown as LoadFactsLoaderDeps;
  const [entry] = await loadLoadPlanEntries(deps, {
    userId: 'u1',
    session: today,
    exerciseIds: [ex.id],
    planTargetReps: new Map(),
    now,
    timezone: TZ,
  });
  return renderLoadPlanEntryV2(entry, { now, timezone: TZ, user: null }, { progression });
}

function ownerSessions(ex: Ex, rows: OwnerRows, lastDate: string) {
  return rows
    .filter(r => r.date <= lastDate)
    .map(r => {
      const at = new Date(`${r.date}T04:00:00Z`);
      return sessionRow(`s-${r.date}`, new Date(at.getTime() - 3_600_000), [
        {
          rowId: `r-${r.date}`,
          ...ex,
          targetReps: r.targetReps,
          sets: r.sets.map(([weight, reps], i) => ({ weight, reps, at: new Date(at.getTime() + i * 120_000) })),
        },
      ]);
    });
}

const line = (text: string, key: string): string =>
  text
    .split('\n')
    .map(l => l.trim())
    .find(l => l.startsWith(`${key}:`)) ?? '';

describe('AC-LPF-8 · owner 45° Leg Press rows', () => {
  it('after 09-21 (120 ×2 last, last set 12 vs top 12): hold 120, growth needs two workouts at ≥ 14', async () => {
    const text = await entryText(
      LEG_PRESS,
      ownerSessions(LEG_PRESS, LEG_PRESS_ROWS, '2026-09-21'),
      ownerNow('2026-09-21', 4),
      '10-12',
    );
    expect(line(text, 'recommend')).toMatch(/^recommend: 120 kg × 10–12 — /);
    expect(line(text, 'conservative')).toBe('conservative: 115 kg × 10–12 — 5 kg lower');
    expect(line(text, 'next step')).toBe(
      'next step: last set at 120 kg ≥ 14 reps in 2 workouts in a row (or ≥ 15 reps once at RPE ≤ 8, recovered) → +1 step (125 kg)',
    );
  });

  it('after 09-27 (135 ×12 once): hold 135, same condition one step higher', async () => {
    const text = await entryText(
      LEG_PRESS,
      ownerSessions(LEG_PRESS, LEG_PRESS_ROWS, '2026-09-27'),
      ownerNow('2026-09-27', 4),
      '10-12',
    );
    expect(line(text, 'recommend')).toMatch(/^recommend: 135 kg × 10–12 — /);
    expect(line(text, 'conservative')).toBe('conservative: 130 kg × 10–12 — 5 kg lower');
    expect(line(text, 'next step')).toContain('last set at 135 kg ≥ 14 reps in 2 workouts in a row');
    expect(line(text, 'next step')).toContain('→ +1 step (140 kg)');
  });
});

describe('AC-LPF-8 · owner Lateral Raise Machine row', () => {
  it('2.5 kg on a machine with a 5 kg step (O-2: the cap is waived — the machine adds its own weight): growth is named', async () => {
    const text = await entryText(
      LATERAL_RAISE,
      ownerSessions(LATERAL_RAISE, LATERAL_RAISE_ROWS, '2026-09-25'),
      ownerNow('2026-09-25', 4),
      '10-15',
    );
    expect(line(text, 'recommend')).toMatch(/^recommend: 2\.5 kg × 10–15 — /);
    expect(line(text, 'conservative')).toContain('2.5 kg × 10–15 — no lighter option');
    expect(line(text, 'next step')).toBe(
      'next step: last set at 2.5 kg ≥ 17 reps in 2 workouts in a row (or ≥ 18 reps once at RPE ≤ 8, recovered) → +1 step (7.5 kg)',
    );
  });
});

describe('AC-LPF-7 · the owner example: 3 × 15 at 50 kg, range 8–10, four days of rest', () => {
  const PRESS = { ...LEG_PRESS, id: '66666666-6666-4666-8666-666666666666', name: 'Chest Press Machine' };
  const now = daysBefore(0);
  const past = [
    sessionRow('s1', daysBefore(4, -60), [{ rowId: 'r1', ...PRESS, sets: sets(50, [15, 15, 15], daysBefore(4)) }]),
    sessionRow('s2', daysBefore(9, -60), [{ rowId: 'r2', ...PRESS, sets: sets(50, [10, 10, 10], daysBefore(9)) }]),
  ];

  it('recommends 55 × 8–10, conservative 50, medium at most, and says what comes after the step', async () => {
    const text = await entryText(PRESS, past, now, '8-10');
    expect(line(text, 'decision')).toBe('decision: Stage C, one-session growth → one step up');
    expect(line(text, 'recommend')).toMatch(/^recommend: 55 kg × 8–10 — last set at the working weight 15 reps/);
    expect(line(text, 'conservative')).toBe('conservative: 50 kg × 8–10 — 5 kg lower');
    expect(line(text, 'confidence')).toMatch(/^confidence: (low|medium)/);
    expect(line(text, 'next step')).toBe(
      'next step: after the step up, hold 55 kg until the last set reaches 12 reps in 2 workouts in a row (or 13 reps once at RPE ≤ 8, recovered)',
    );
  });

  it('a short constraint on the muscle: no jump, the next step says the constraint holds growth', async () => {
    const text = await entryText(PRESS, past, now, '8-10', [
      { fact: 'sore shoulder', category: 'physical_constraint', durability: 'short', muscleGroup: 'quads' },
    ]);
    expect(line(text, 'decision')).toContain('short constraint');
    expect(line(text, 'recommend')).toMatch(/^recommend: 50 kg/);
    expect(line(text, 'next step')).toMatch(/^next step: no growth while the short constraint is active/);
  });
});

describe('AC-LPF-8 · the other rows each carry a next step', () => {
  it('no record at all → "log this exercise once"', async () => {
    const lonely = sessionRow('s0', daysBefore(3), [{ rowId: 'r0', ...LEG_PRESS, sets: [] }]);
    const text = await entryText(LEG_PRESS, [lonely], daysBefore(0), '10-12');
    expect(line(text, 'next step')).toBe('next step: log this exercise once — that performance becomes the reference');
  });
});

describe('AC-LPF-5 · the metrics line says when the working weight is an estimate', () => {
  const PRESS = { ...LEG_PRESS, id: '77777777-7777-4777-8777-777777777777', name: 'Incline Press Machine' };
  const sessionOf = (id: string, days: number, rows: [number, number][]) =>
    sessionRow(id, daysBefore(days, -60), [
      {
        rowId: `r-${id}`,
        ...PRESS,
        sets: rows.flatMap(([w, r], i) => sets(w, [r], new Date(daysBefore(days).getTime() + i * 120_000))),
      },
    ]);
  const older = sessionOf('o', 9, [
    [45, 12],
    [45, 12],
  ]);

  it('60×6, 55×7, 45×12 (range 8–10) → working weight 50 kg, estimated from 55×7', async () => {
    const past = [
      sessionOf('n', 3, [
        [60, 6],
        [55, 7],
        [45, 12],
      ]),
      older,
    ];
    const text = await entryText(PRESS, past, daysBefore(0), '8-10');
    expect(text).toMatch(/metrics: working weight 50 kg \(2 performances \/ 8 wk, estimated from 55×7\)/);
    expect(line(text, 'recommend')).toMatch(/^recommend: 50 kg × 8–10 — /);
  });

  it('60×6, 55×8, 45×12 → 55 kg from a reached load, no "estimated"', async () => {
    const past = [
      sessionOf('n', 3, [
        [60, 6],
        [55, 8],
        [45, 12],
      ]),
      older,
    ];
    const text = await entryText(PRESS, past, daysBefore(0), '8-10');
    expect(text).toMatch(/metrics: working weight 55 kg \(2 performances \/ 8 wk\)/);
    expect(text).not.toContain('estimated from');
  });
});

describe('AC-LPF-11 · the owner early-stop cases at 60 kg, range 8–10', () => {
  const PRESS = { ...LEG_PRESS, id: '88888888-8888-4888-8888-888888888888', name: 'Shoulder Press Machine' };
  const sessionWith = (id: string, days: number, rows: [number, number, number?][]) =>
    sessionRow(id, daysBefore(days, -60), [
      {
        rowId: `r-${id}`,
        ...PRESS,
        sets: rows.map(([w, r, rpe], i) => ({
          weight: w,
          reps: r,
          at: new Date(daysBefore(days).getTime() + i * 120_000),
          ...(rpe === undefined ? {} : { rpe }),
        })),
      },
    ]);
  const older = sessionWith('o', 9, [
    [60, 9],
    [60, 9],
    [60, 9],
  ]);

  it('6 @ RPE 7 (stopped early): hold 60, no step down, "take it to the floor next time"', async () => {
    const past = [
      sessionWith('n', 3, [
        [60, 10],
        [60, 9],
        [60, 6, 7],
      ]),
      older,
    ];
    const text = await entryText(PRESS, past, daysBefore(0), '8-10');
    expect(line(text, 'decision')).toBe('decision: Stage A, early stop → hold');
    expect(line(text, 'recommend')).toMatch(
      /^recommend: 60 kg × 8–10 — a set stopped below the floor \(6 reps at RPE 7\)/,
    );
    expect(line(text, 'conservative')).toBe('conservative: 55 kg × 8–10 — 5 kg lower');
    expect(line(text, 'next step')).toBe(
      'next step: take it to the floor next time (8+ reps at 60 kg) — the load is within reach',
    );
  });

  it('6 with no RPE (a lone weak set): hold and ask, never a step down by itself', async () => {
    const past = [
      sessionWith('n', 3, [
        [60, 10],
        [60, 9],
        [60, 6],
      ]),
      older,
    ];
    const text = await entryText(PRESS, past, daysBefore(0), '8-10');
    expect(line(text, 'decision')).toBe('decision: Stage A, unclear effort → hold');
    expect(line(text, 'recommend')).toMatch(/^recommend: 60 kg/);
    expect(line(text, 'next step')).toContain('ask how many more reps that set had in it (0, 1–2 or 3+)');
  });

  it('6 @ RPE 9 is a real miss: one step down', async () => {
    const past = [
      sessionWith('n', 3, [
        [60, 10],
        [60, 9],
        [60, 6, 9],
      ]),
      older,
    ];
    const text = await entryText(PRESS, past, daysBefore(0), '8-10');
    expect(line(text, 'decision')).toBe('decision: Stage A, last below range floor → one step down');
    expect(line(text, 'recommend')).toMatch(/^recommend: 55 kg/);
  });

  it('8 @ RPE 8 counts as 10: not a failure, not growth either — hold at 60', async () => {
    const past = [
      sessionWith('n', 3, [
        [60, 10],
        [60, 9],
        [60, 8, 8],
      ]),
      older,
    ];
    const text = await entryText(PRESS, past, daysBefore(0), '8-10');
    expect(line(text, 'decision')).toBe('decision: Stage C, scheme hold → hold');
    expect(line(text, 'recommend')).toMatch(/^recommend: 60 kg × 8–10 — /);
    expect(line(text, 'next step')).toContain('+1 step (65 kg)');
  });
});
