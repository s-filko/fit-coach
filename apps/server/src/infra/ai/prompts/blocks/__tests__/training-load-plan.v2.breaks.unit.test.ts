/**
 * load-plan Task 4 (AC-LP-6, D5, D9): with LOAD_PLAN_BREAKS on the loader attaches the return ladder and the break
 * reason, `decide()` reads them, and the v2 entry prints the tier and the ladder step. Off = no ladder, no line.
 */
import { defaultProgression } from '@domain/training/load-plan';

import { loadLoadPlanEntries, type LoadFactsLoaderDeps } from '@infra/ai/load-facts/load-facts.loader';
import { CHEST_PRESS, daysBefore, NOW, sessionRow, sets, TZ } from '@infra/ai/load-facts/__tests__/rows';

import { decideLoadPlanEntry, renderLoadPlanEntryV2 } from '../training-load-plan.v2';

const ctx = { now: NOW, timezone: TZ, user: null };
const progression = defaultProgression(null);

const perf = (id: string, daysAgo: number, reps = [10, 10, 10], extra: Record<string, unknown> = {}) =>
  sessionRow(id, daysBefore(daysAgo), [
    { rowId: `r-${id}`, ...CHEST_PRESS, sets: sets(65, reps, daysBefore(daysAgo), extra) },
  ]);
const today = sessionRow('today', daysBefore(0, -30), [], { status: 'in_progress' });

const deps = (past: unknown[], promptFacts: unknown[] = []): LoadFactsLoaderDeps =>
  ({
    workoutSessionRepo: {
      findRecentByUserIdWithDetails: async () => past,
      findLastPerformancesByExercise: async () => [],
      countRealPerformancesByExercise: async () => new Map([[CHEST_PRESS.id, past.length]]),
    },
    exerciseRepository: {
      findByIdsWithMuscles: async () => [(past[0] as ReturnType<typeof perf>).exercises[0].exercise],
    },
    trainingService: { getSessionDetails: async () => null },
    userFacts: { getConstraints: async () => [], getForPrompt: async () => promptFacts },
  }) as unknown as LoadFactsLoaderDeps;

async function entry(past: unknown[], breaks: boolean, promptFacts: unknown[] = []) {
  const [e] = await loadLoadPlanEntries(deps(past, promptFacts), {
    userId: 'u1',
    session: today,
    exerciseIds: [CHEST_PRESS.id],
    planTargetReps: new Map(),
    now: NOW,
    timezone: TZ,
    breaks,
  });
  return e;
}

const render = (e: Awaited<ReturnType<typeof entry>>): string => renderLoadPlanEntryV2(e, ctx, { progression });

describe('LOAD PLAN v2 with LOAD_PLAN_BREAKS', () => {
  it('open 31-day gap: tier rebuild and ladder step 1 of 3 are printed, the reason is unknown', async () => {
    const e = await entry([perf('a', 31), perf('b', 40)], true);
    expect(e.returnBranch).toMatchObject({ breakReason: 'unknown' });
    const text = render(e);
    expect(text).toContain('break: tier rebuild (general norm) · return workout 1 of 3 · reason unknown');
    expect(text).toContain('decision: Stage A, gap tier rebuild →');
    // rebuild starts two steps below 65 (step 5) and unknown costs one more.
    expect(text).toContain('recommend: 50 kg');
  });

  it('the break fact the user answered with sets the reason — illness reads one step lower, well-being check', async () => {
    const facts = [
      {
        category: 'break',
        fact: 'break reason=holiday_work_no_time from=2026-08-29 to=2026-09-29 — travel',
        createdAt: NOW,
      },
    ];
    const text = render(await entry([perf('a', 31), perf('b', 40)], true, facts));
    expect(text).toContain('reason holiday_work_no_time');
    expect(text).toContain('recommend: 55 kg');
    const ill = [
      { category: 'break', fact: 'break reason=illness from=2026-08-29 to=2026-09-29 — flu', createdAt: NOW },
    ];
    expect(render(await entry([perf('a', 31), perf('b', 40)], true, ill))).toContain('well-being check');
  });

  it('the ladder advances after a workout in range with reserve: workout 2 of 3 with the gap closed', async () => {
    const e = await entry([perf('a', 2), perf('b', 35), perf('c', 40)], true);
    expect(e.returnBranch?.ladder).toMatchObject({ tier: 'rebuild', workoutsSince: 1 });
    const d = decideLoadPlanEntry(e, { progression });
    expect(d?.ladder).toMatchObject({ workout: 2, of: 3, stepsBelow: 1 });
    expect(render(e)).toContain('break: tier rebuild (general norm) · return workout 2 of 3 · reason unknown');
  });

  it('a workout without reserve (RPE 9) repeats the rung', async () => {
    const e = await entry([perf('a', 2, [10, 10, 10], { rpe: 9 }), perf('b', 35), perf('c', 40)], true);
    expect(decideLoadPlanEntry(e, { progression })?.ladder).toMatchObject({ workout: 1, of: 3 });
  });

  it('after the ladder is done there is no break line and Stage C decides', async () => {
    const past = [perf('a', 2), perf('b', 6), perf('c', 10), perf('d', 50), perf('e', 55)];
    const e = await entry(past, true);
    expect(e.returnBranch?.ladder).toMatchObject({ workoutsSince: 3 });
    const text = render(e);
    expect(text).not.toContain('break:');
    expect(text).toMatch(/decision: Stage C/);
  });

  it('a gap at rest_with_question prints the tier and the reason, no ladder', async () => {
    const text = render(await entry([perf('a', 10), perf('b', 14), perf('c', 18)], true));
    expect(text).toMatch(/break: tier rest_with_question \(10 d since exercise, general norm\) · reason unknown/);
  });

  it('flag off: no returnBranch, no break line, decisions exactly as before the ladder existed', async () => {
    const e = await entry([perf('a', 31), perf('b', 40)], false);
    expect(e.returnBranch).toBeUndefined();
    const text = render(e);
    expect(text).not.toContain('break:');
    // Task 2 behaviour: tier from the current gap, first rung, no reason adjustment (one step cheaper).
    expect(text).toContain('recommend: 55 kg');
  });
});
