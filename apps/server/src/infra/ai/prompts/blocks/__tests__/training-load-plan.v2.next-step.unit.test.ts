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
  it('2.5 kg with a 5 kg machine step: no load step fits, progress by reps', async () => {
    const text = await entryText(
      LATERAL_RAISE,
      ownerSessions(LATERAL_RAISE, LATERAL_RAISE_ROWS, '2026-09-25'),
      ownerNow('2026-09-25', 4),
      '10-15',
    );
    expect(line(text, 'recommend')).toMatch(/^recommend: 2\.5 kg × 10–15 — /);
    expect(line(text, 'conservative')).toContain('2.5 kg × 10–15 — no lighter option');
    expect(line(text, 'next step')).toBe(
      'next step: no load step fits (5 kg is over 10 % of 2.5 kg) — progress by reps',
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
