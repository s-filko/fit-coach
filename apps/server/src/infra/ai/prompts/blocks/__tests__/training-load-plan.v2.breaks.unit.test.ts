/**
 * load-plan Task 4 (AC-LP-6, D5, D9): with LOAD_PLAN_BREAKS on the loader attaches the return ladder and the break
 * reason, `decide()` reads them, and the v2 entry prints the tier and the ladder step. Off = no ladder, no line.
 */
import { defaultProgression } from '@domain/training/load-plan';

import { loadLoadPlanEntries, type LoadFactsLoaderDeps } from '@infra/ai/load-facts/load-facts.loader';
import { CHEST_PRESS, daysBefore, NOW, sessionRow, sets, TZ } from '@infra/ai/load-facts/__tests__/rows';
import { decideLoadPlanEntry } from '@infra/ai/load-facts/load-decision';

import { renderLoadPlanEntryV2 } from '../training-load-plan.v2';

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

describe('AC-LP-6 · LOAD PLAN v2 with LOAD_PLAN_BREAKS', () => {
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

  it('Fix-9: break facts that only touch the ladder gap at a workout day do not colour it', async () => {
    // Ladder gap: performance b (35 d ago) → performance a (2 d ago). Dates in the user's timezone.
    const day = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString().slice(0, 10);
    const facts = [
      // the previous break ended on the day of b — it belongs to the gap BEFORE b
      { category: 'break', fact: `break reason=holiday_work_no_time from=${day(60)} to=${day(35)}`, createdAt: NOW },
      // a marker for the gap that opens at a — it belongs to the gap AFTER a
      { category: 'break', fact: `break reason=illness from=${day(2)} to=${day(0)}`, createdAt: NOW },
    ];
    const e = await entry([perf('a', 2), perf('b', 35), perf('c', 40)], true, facts);
    expect(e.returnBranch).toMatchObject({ breakReason: 'unknown' });
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

/**
 * load-plan Task 5a (AC-LP-5, D8): the user's `progression_scheme` fact replaces the default scheme; the block prints
 * one Progression line and the scheme line says who chose it; without the fact it is "default, unconfirmed".
 */
describe('AC-LP-5 · LOAD PLAN v2 with a progression_scheme fact', () => {
  const schemeFact = (text: string, iso = '2026-09-20T03:00:00Z') => ({
    category: 'progression_scheme',
    fact: text,
    createdAt: new Date(iso),
  });
  const past = () => [perf('a', 3), perf('b', 10), perf('c', 17)];

  it('the block prints the Progression line with the choice and its date, and the scheme line agrees', async () => {
    const e = await entry(past(), false, [schemeFact('progression_scheme id=double_progression — by reps')]);
    expect(e.chosenScheme).toEqual({ schemeId: 'double_progression', chosenAt: new Date('2026-09-20T03:00:00Z') });
    const { TRAINING_LOAD_PLAN_V2 } = await import('../training-load-plan.v2');
    const block = TRAINING_LOAD_PLAN_V2.render({ loadPlan: [e], exerciseHistory: [], progression }, ctx, 0) as string;
    expect(block).toContain('Progression: double progression, confirm ×2 — chosen by user 2026-09-20');
    expect(block).toContain('scheme: double progression 8–12, confirm ×2 (chosen by user 2026-09-20)');
    expect(block).not.toContain('default, unconfirmed');
  });

  it('without the fact: default, unconfirmed — in the line and in the entry', async () => {
    const e = await entry(past(), false);
    expect(e.chosenScheme).toBeNull();
    const { TRAINING_LOAD_PLAN_V2 } = await import('../training-load-plan.v2');
    const block = TRAINING_LOAD_PLAN_V2.render({ loadPlan: [e], exerciseHistory: [], progression }, ctx, 0) as string;
    expect(block).toContain('Progression: double progression, confirm ×2 — default, unconfirmed');
    expect(block).toContain('(default, unconfirmed)');
  });

  it('the choice decides: a linear choice runs linear_progression (decide, and so the log’s scheme_id)', async () => {
    const e = await entry(past(), false, [
      schemeFact('progression_scheme id=linear_progression — add weight each time'),
    ]);
    const d = decideLoadPlanEntry(e, { progression });
    expect(d?.scheme).toEqual({ id: 'linear_progression', version: 1 });
    expect(render(e)).toContain(
      'scheme: linear progression 8 (scheme default), confirm ×2 (chosen by user 2026-09-20)',
    );
  });

  it('the newest active fact wins; a malformed or unknown-id fact is ignored', async () => {
    const e = await entry(past(), false, [
      schemeFact('progression_scheme id=double_progression — old', '2026-09-01T00:00:00Z'),
      schemeFact('progression_scheme id=linear_progression — new', '2026-09-22T00:00:00Z'),
      schemeFact('progression_scheme id=nonsense', '2026-09-25T00:00:00Z'),
    ]);
    expect(e.chosenScheme?.schemeId).toBe('linear_progression');
  });
});

/**
 * load-plan Task 5a fix: the block-level Progression line carries no rep range (each entry works on its own: today's
 * range, else the scheme default — labelled), so one block never shows two contradicting ranges.
 */
describe('AC-LP-5 · LOAD PLAN v2: one rep range per entry, none on the Progression line', () => {
  const noRangePerf = (id: string, daysAgo: number) =>
    sessionRow(id, daysBefore(daysAgo), [
      { rowId: `r-${id}`, ...CHEST_PRESS, targetReps: '', sets: sets(65, [10, 10, 10], daysBefore(daysAgo)) },
    ]);

  it('the Progression line has no range, even for a strength goal whose scheme default is 4–6', async () => {
    const strength = defaultProgression({ fitnessLevel: 'intermediate', fitnessGoal: 'get stronger' });
    const { TRAINING_LOAD_PLAN_V2 } = await import('../training-load-plan.v2');
    const e = await entry([perf('a', 3), perf('b', 10), perf('c', 17)], false);
    const block = TRAINING_LOAD_PLAN_V2.render(
      { loadPlan: [e], exerciseHistory: [], progression: strength },
      ctx,
      0,
    ) as string;
    const line = block.split('\n').find(l => l.startsWith('Progression:'));
    expect(line).toBe('Progression: double progression, confirm ×2 — default, unconfirmed');
    expect(line).not.toMatch(/\d+–\d+/);
    // The entry keeps the range it works on (the reference performance's plan), not the scheme default.
    expect(block).toContain('scheme: double progression 8–12, confirm ×2');
    expect(block).not.toContain('4–6');
  });

  it('with no range from today or the reference, the entry prints the scheme default and says so', async () => {
    const e = await entry([noRangePerf('a', 3), noRangePerf('b', 10), noRangePerf('c', 17)], false);
    expect(render(e)).toContain('scheme: double progression 8–12 (scheme default), confirm ×2 (default, unconfirmed)');
  });

  it('a range from the plan is printed without the label', async () => {
    const e = await entry([perf('a', 3), perf('b', 10), perf('c', 17)], false);
    expect(render(e)).toContain('scheme: double progression 8–12, confirm ×2 (default, unconfirmed)');
    expect(render(e)).not.toContain('(scheme default)');
  });
});
