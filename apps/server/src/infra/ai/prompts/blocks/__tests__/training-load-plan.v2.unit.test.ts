/**
 * `training.load_plan` v2 (load-plan AC-LP-3, D4, D6, O1): the v1 fact lines plus scheme / tactic / decision /
 * recommend / conservative / confidence, framed as a suggestion; the equipment facts once per block; a
 * negative drop-off as "none (reps rose)"; the e1RM span printed.
 */
import { defaultProgression } from '@domain/training/load-plan';

import { decideLoadPlanEntry } from '@infra/ai/load-facts/load-decision';
import { loadLoadPlanEntries, type LoadFactsLoaderDeps } from '@infra/ai/load-facts/load-facts.loader';
import { CHEST_PRESS, daysBefore, DIPS, NOW, sessionRow, sets, TZ } from '@infra/ai/load-facts/__tests__/rows';

import { LOAD_PLAN_HEADER_V2, renderLoadPlanEntryV2, TRAINING_LOAD_PLAN_V2 } from '../training-load-plan.v2';

const ctx = { now: NOW, timezone: TZ, user: null };
const progression = defaultProgression(null);

const p1 = sessionRow('s1', daysBefore(3, -60), [
  { rowId: 'r1a', ...DIPS, sets: sets(0.001, [10, 10, 10], daysBefore(3, -55)) },
  {
    rowId: 'r1b',
    ...CHEST_PRESS,
    sets: sets(65, [10, 10, 9], daysBefore(3, -30), { rpe: 8, feedback: 'last set heavy' }),
  },
]);
const p2 = sessionRow('s2', daysBefore(10), [
  { rowId: 'r2', ...CHEST_PRESS, sets: sets(65, [10, 10, 10], daysBefore(10)) },
]);
const p3 = sessionRow('s3', daysBefore(17), [
  { rowId: 'r3', ...CHEST_PRESS, sets: sets(60, [10, 10, 10], daysBefore(17)) },
]);
const today = sessionRow(
  'today',
  daysBefore(0, -40),
  [{ rowId: 'rt', ...DIPS, sets: sets(0.001, [10, 10, 10, 10, 10, 10], daysBefore(0, -35)) }],
  { status: 'in_progress' },
);

const deps = (past = [p1, p2, p3], facts: unknown[] = []): LoadFactsLoaderDeps =>
  ({
    workoutSessionRepo: {
      findRecentByUserIdWithDetails: async () => past,
      findLastPerformancesByExercise: async () => [],
      countRealPerformancesByExercise: async () => new Map([[CHEST_PRESS.id, 12]]),
    },
    exerciseRepository: { findByIdsWithMuscles: async () => [p1.exercises[1].exercise, p1.exercises[0].exercise] },
    trainingService: { getSessionDetails: async () => null },
    userFacts: { getConstraints: async () => [], getForPrompt: async () => facts },
  }) as unknown as LoadFactsLoaderDeps;

async function entries(d = deps(), ids = [CHEST_PRESS.id]) {
  return loadLoadPlanEntries(d, {
    userId: 'u1',
    session: today,
    exerciseIds: ids,
    planTargetReps: new Map(),
    now: NOW,
    timezone: TZ,
  });
}

describe('AC-LP-3 · renderLoadPlanEntryV2', () => {
  it('keeps the v1 fact lines and adds scheme / tactic / decision / recommend / conservative / confidence', async () => {
    const [entry] = await entries();
    const text = renderLoadPlanEntryV2(entry, ctx, { progression });
    expect(text).toContain(`Machine Chest Press [ID:${CHEST_PRESS.id}]`);
    expect(text).toMatch(/\n {2}reference: /);
    expect(text).toMatch(/\n {2}metrics: working weight 65 kg/);
    expect(text).toMatch(/\n {2}scheme: double progression 8–12, confirm ×2 \(default, unconfirmed\)/);
    expect(text).toMatch(/\n {2}tactic: none active/);
    expect(text).toMatch(/\n {2}decision: Stage [ABC], .+ → .+/);
    expect(text).toMatch(/\n {2}recommend: \d+ kg × \d+–\d+ — .+/);
    expect(text).toMatch(/\n {2}conservative: \d+ kg × \d+–\d+/);
    expect(text).toMatch(/\n {2}confidence: (low|medium|high)/);
  });

  it('orders the decision lines after the facts', async () => {
    const [entry] = await entries();
    const lines = renderLoadPlanEntryV2(entry, ctx, { progression })
      .split('\n')
      .map(l => l.trim().split(':')[0]);
    const at = (k: string): number => lines.indexOf(k);
    expect(at('data')).toBeGreaterThan(-1);
    for (const k of ['scheme', 'tactic', 'decision', 'recommend', 'conservative', 'confidence']) {
      expect(at(k)).toBeGreaterThan(at('data'));
    }
    expect(at('scheme')).toBeLessThan(at('tactic'));
    expect(at('tactic')).toBeLessThan(at('decision'));
    expect(at('decision')).toBeLessThan(at('recommend'));
    expect(at('recommend')).toBeLessThan(at('conservative'));
    expect(at('conservative')).toBeLessThan(at('confidence'));
  });

  it('prints the pre-fatigue row as in the design example (triceps pre-loaded today)', async () => {
    const [entry] = await entries();
    const text = renderLoadPlanEntryV2(entry, ctx, { progression });
    expect(text).toContain('decision: Stage A, pre-fatigue delta → hold');
    expect(text).toContain('recommend: 65 kg');
    expect(text).toContain('conservative: 60 kg');
  });

  it('AC-LPF-1: a floored step-down prints "no lighter option", never a 0 kg line or a fake lower conservative', async () => {
    const [entry] = await entries();
    const d = decideLoadPlanEntry(entry, { progression });
    if (d === null) {
      throw new Error('expected a decision');
    }
    const floored = { ...d, candidate: { ...d.candidate, load: 2.5 }, conservative: { ...d.conservative, load: 2.5 } };
    const text = renderLoadPlanEntryV2(entry, ctx, { progression, decision: floored });
    expect(text).toContain('conservative: 2.5 kg × 8–12 — no lighter option');
    expect(text).not.toMatch(/\b0 kg/);
  });

  it('an unknown equipment step never prints "no lighter option" (the missing-step note stands instead)', async () => {
    const [entry] = await entries();
    const d = decideLoadPlanEntry(entry, { progression });
    if (d === null) {
      throw new Error('expected a decision');
    }
    const same = {
      ...d,
      candidate: { ...d.candidate, load: 65 },
      conservative: { ...d.conservative, load: 65 },
      missing: ['equipmentStep'],
    };
    const text = renderLoadPlanEntryV2(entry, ctx, { progression, decision: same });
    expect(text).not.toContain('no lighter option');
  });

  it('AC-LPF-3: no record and no reference — the block says there is no number and no conservative option', async () => {
    const [entry] = await entries(deps([]));
    const text = renderLoadPlanEntryV2(entry, ctx, { progression });
    expect(text).toContain('decision: Stage A, insufficient data → no number');
    expect(text).not.toContain('conservative start');
    expect(text).toContain('recommend: no number — no record, no reference load');
    expect(text).toContain('conservative: no conservative option — no record, no reference load');
    expect(text).toContain('confidence: low');
  });

  it('AC-LPF-3: one performance (Stage A insufficient data) with a reference still prints a number and a lower conservative', async () => {
    const [entry] = await entries(deps([p2]));
    const text = renderLoadPlanEntryV2(entry, ctx, { progression });
    expect(text).toMatch(/\n {2}reference: /);
    expect(text).toContain('decision: Stage A, insufficient data');
    expect(text).toMatch(
      /\n {2}recommend: 65 kg × 8–12 — insufficient: 1 performances \/ 8 wk; last performance 65 kg 10 d ago/,
    );
    expect(text).toMatch(/\n {2}conservative: 60 kg × 8–12 — 5 kg lower/);
    expect(text).toContain('confidence: low');
    expect(text).not.toContain('no record');
  });

  it('prints the e1RM span and a plain negative drop-off (D6)', async () => {
    const rising = sessionRow('s1', daysBefore(3, -60), [
      { rowId: 'r1b', ...CHEST_PRESS, sets: sets(65, [8, 10], daysBefore(3, -30)) },
    ]);
    const [entry] = await entries(deps([rising, p2, p3]));
    const text = renderLoadPlanEntryV2(entry, ctx, { progression });
    expect(text).toContain('drop-off none (reps rose)');
    expect(text).not.toMatch(/drop-off -\d/);
    expect(text).toMatch(/e1RM over 3 performances \/ 14 d/);
  });

  it('includes the equipment facts in the entry unless the block prints them once', async () => {
    const d = deps([p1, p2, p3], [{ category: 'equipment', fact: 'home: 2 dumbbells' }]);
    const [entry] = await entries(d);
    expect(renderLoadPlanEntryV2(entry, ctx, { progression })).toContain('equipment facts: home: 2 dumbbells');
    expect(renderLoadPlanEntryV2(entry, ctx, { progression, equipment: 'omit' })).not.toContain('equipment facts');
  });

  it('a non-strength exercise prints n/a for the scheme lines', async () => {
    const plank = {
      ...sessionRow('sp', daysBefore(4), [
        {
          rowId: 'rp',
          id: '33333333-3333-4333-8333-333333333333',
          name: 'Plank',
          muscles: [['core', 'primary']] as never,
          equipment: 'bodyweight',
          exerciseType: 'isometric',
          targetReps: null,
          sets: [{ weight: 0, reps: 1, at: daysBefore(4), setData: { type: 'isometric', duration: 45 } }],
        },
      ]),
    };
    const d = {
      ...deps([plank]),
      exerciseRepository: { findByIdsWithMuscles: async () => [plank.exercises[0].exercise] },
    } as LoadFactsLoaderDeps;
    const [entry] = await entries(d, ['33333333-3333-4333-8333-333333333333']);
    const text = renderLoadPlanEntryV2(entry, ctx, { progression });
    expect(text).toContain('recommend: n/a for isometric');
    expect(text).not.toContain('decision:');
  });
});

describe('AC-LP-3 · TRAINING_LOAD_PLAN_V2 block', () => {
  it('is the training.load_plan block at v2, framed as a suggestion (O1)', async () => {
    expect(TRAINING_LOAD_PLAN_V2.id).toBe('training.load_plan');
    expect(TRAINING_LOAD_PLAN_V2.version).toBe('v2');
    expect(LOAD_PLAN_HEADER_V2).toMatch(/suggestion/);
    expect(LOAD_PLAN_HEADER_V2).toMatch(/you decide/);
    expect(LOAD_PLAN_HEADER_V2).toMatch(/reason/);
  });

  it('prints the equipment facts once per block, however many entries', async () => {
    const d = deps([p1, p2, p3], [{ category: 'equipment', fact: 'home: 2 dumbbells' }]);
    const loadPlan = await entries(d, [CHEST_PRESS.id, DIPS.id]);
    expect(loadPlan).toHaveLength(2);
    const out = TRAINING_LOAD_PLAN_V2.render({ loadPlan, exerciseHistory: [], progression }, ctx, 0) as string;
    expect(out.startsWith(LOAD_PLAN_HEADER_V2)).toBe(true);
    expect(out.split('home: 2 dumbbells')).toHaveLength(2);
    expect(out).toContain('equipment facts (all exercises): home: 2 dumbbells');
  });

  it('matches the history row by exercise id and is null when there is nothing to show', async () => {
    const loadPlan = await entries();
    const history = [
      { exerciseId: CHEST_PRESS.id, exerciseName: 'x', performance: p1.exercises[1], completedAt: p1.completedAt },
    ] as never;
    const out = TRAINING_LOAD_PLAN_V2.render({ loadPlan, exerciseHistory: history, progression }, ctx, 0);
    expect(out).toContain('sets as in EXERCISE HISTORY');
    expect(TRAINING_LOAD_PLAN_V2.render({ loadPlan: [], exerciseHistory: [], progression }, ctx, 0)).toBeNull();
  });
});
