/**
 * `training.load_plan` v1 (load-facts plan AC-LF-2, AC-LF-3, D2): the block renders one entry per
 * exercise with the fact lines; no line recommends a weight; the reference line omits the sets
 * when it is the EXERCISE HISTORY row.
 */
import { loadLoadPlanEntries, type LoadFactsLoaderDeps } from '@infra/ai/load-facts/load-facts.loader';
import { CHEST_PRESS, daysBefore, DIPS, NOW, sessionRow, sets, TZ } from '@infra/ai/load-facts/__tests__/rows';

import { renderLoadPlanEntry, TRAINING_LOAD_PLAN_V1 } from '../training-load-plan.v1';
import type { ExerciseHistoryEntry } from '../training-exercise-history.v1';

const ctx = { now: NOW, timezone: TZ, user: null };

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

const deps = (constraints: unknown[] = [], facts: unknown[] = []): LoadFactsLoaderDeps =>
  ({
    workoutSessionRepo: {
      findRecentByUserIdWithDetails: async () => [p1, p2, p3],
      findLastPerformancesByExercise: async () => [],
      countRealPerformancesByExercise: async () => new Map([[CHEST_PRESS.id, 12]]),
    },
    exerciseRepository: {
      findByIdsWithMuscles: async () => [p1.exercises[1].exercise, p1.exercises[0].exercise],
    },
    trainingService: { getSessionDetails: async () => null },
    userFacts: { getConstraints: async () => constraints, getForPrompt: async () => facts },
  }) as unknown as LoadFactsLoaderDeps;

async function entries(d = deps()) {
  return loadLoadPlanEntries(d, {
    userId: 'u1',
    session: today,
    exerciseIds: [CHEST_PRESS.id],
    planTargetReps: new Map(),
    now: NOW,
    timezone: TZ,
  });
}

describe('TRAINING_LOAD_PLAN_V1 / renderLoadPlanEntry', () => {
  it('renders the fact lines of one exercise (AC-LF-2)', async () => {
    const [entry] = await entries();
    const text = renderLoadPlanEntry(entry, ctx);
    expect(text).toContain(`Machine Chest Press [ID:${CHEST_PRESS.id}]`);
    expect(text).toMatch(/\n {2}reference: 2026-09-26 · 3d ago \(Sat\) morning/);
    expect(text).toContain('10 reps @ 65 kg; 10 reps @ 65 kg; 9 reps @ 65 kg');
    expect(text).toContain('RPE 8');
    expect(text).toContain('RPE 8 · "last set heavy" · after 3 working sets on chest');
    expect(text).toContain(
      'today: after 6 working sets on chest (Dips), 6 working sets on triceps (Dips) · 40 min into the session',
    );
    expect(text).toMatch(/\n {2}metrics: working weight 65 kg \(3 performances \/ 8 wk\)/);
    expect(text).toContain('e1RM ');
    expect(text).toContain('low confidence: machine');
    expect(text).toMatch(/\n {2}quality: last 10, 10, 9 vs range 8–12 \(reference performance's plan\) — in range/);
    expect(text).toMatch(/\n {2}gap: exercise 3 d · primary muscles \(chest\) 3 d · any workout 3 d/);
    expect(text).toContain('constraints: none · equipment facts: none');
    expect(text).toContain('step: 5 kg (default for machine)');
    expect(text).toContain('data: 3 performances in 8 wk, 12 all-time');
  });

  it('recommends nothing: no recommend/target/next-weight wording', async () => {
    const [entry] = await entries();
    expect(renderLoadPlanEntry(entry, ctx)).not.toMatch(/recommend|should|try |next time|increase/i);
  });

  it('prints constraints with durability and equipment facts as text', async () => {
    const [entry] = await entries(
      deps(
        [{ muscleGroup: 'triceps', durability: 'short', fact: 'elbow pain' }],
        [
          { category: 'equipment', fact: 'home: 2 dumbbells' },
          { category: 'nutrition_preference', fact: 'x' },
        ],
      ),
    );
    const text = renderLoadPlanEntry(entry, ctx);
    expect(text).toContain('constraints: elbow pain (triceps, short) · equipment facts: home: 2 dumbbells');
  });

  it('D2: sets are replaced by "sets as in EXERCISE HISTORY" when the reference is that row', async () => {
    const [entry] = await entries();
    const text = renderLoadPlanEntry(entry, ctx, { historyRowId: 'r1b' });
    expect(text).toContain('sets as in EXERCISE HISTORY');
    expect(text).not.toContain('10 reps @ 65 kg; 10 reps');
    const other = renderLoadPlanEntry(entry, ctx, { historyRowId: 'r2' });
    expect(other).not.toContain('sets as in EXERCISE HISTORY');
  });

  it('prints the reason of an absent metric instead of guessing', async () => {
    const [entry] = await entries({
      ...deps(),
      workoutSessionRepo: {
        ...deps().workoutSessionRepo,
        findRecentByUserIdWithDetails: async () => [p1],
      },
    } as LoadFactsLoaderDeps);
    const text = renderLoadPlanEntry(entry, ctx);
    expect(text).toContain('working weight: insufficient: 1 performances / 8 wk');
    expect(text).toContain('e1RM: insufficient: 1 performances');
  });

  it('no record: reference line says so, and the quality line is left out', async () => {
    const [entry] = await entries({
      ...deps(),
      workoutSessionRepo: { ...deps().workoutSessionRepo, findRecentByUserIdWithDetails: async () => [] },
    } as LoadFactsLoaderDeps);
    const text = renderLoadPlanEntry(entry, ctx);
    expect(text).toContain('reference: no completed record');
    expect(text).not.toContain('quality:');
    expect(text).toContain('gap: exercise');
  });

  it('block: header, one entry, history row matched by exercise id; null when empty', async () => {
    const loadPlan = await entries();
    const history = [
      {
        exerciseId: CHEST_PRESS.id,
        exerciseName: 'Machine Chest Press',
        performance: p1.exercises[1],
        completedAt: p1.completedAt,
      } as ExerciseHistoryEntry,
    ];
    const out = TRAINING_LOAD_PLAN_V1.render({ loadPlan, exerciseHistory: history }, ctx, 0);
    expect(out).toContain('=== LOAD PLAN (computed facts — no recommendation) ===');
    expect(out).toContain('sets as in EXERCISE HISTORY');
    expect(TRAINING_LOAD_PLAN_V1.render({ loadPlan: [], exerciseHistory: [] }, ctx, 0)).toBeNull();
  });

  it('AC-LF-3: an isometric exercise prints n/a for metrics 4, 5, 9 and the hold via formatSetData', async () => {
    const PLANK = {
      id: '33333333-3333-4333-8333-333333333333',
      name: 'Plank',
      muscles: [['core', 'primary']] as never,
    };
    const plankSession = sessionRow('sp', daysBefore(4), [
      {
        rowId: 'rp',
        ...PLANK,
        equipment: 'bodyweight',
        exerciseType: 'isometric',
        targetReps: null,
        sets: [{ weight: 0, reps: 1, at: daysBefore(4), setData: { type: 'isometric', duration: 45 } }],
      },
    ]);
    const d = {
      ...deps(),
      workoutSessionRepo: { ...deps().workoutSessionRepo, findRecentByUserIdWithDetails: async () => [plankSession] },
      exerciseRepository: { findByIdsWithMuscles: async () => [plankSession.exercises[0].exercise] },
    } as LoadFactsLoaderDeps;
    const [entry] = await loadLoadPlanEntries(d, {
      userId: 'u1',
      session: today,
      exerciseIds: [PLANK.id],
      planTargetReps: new Map(),
      now: NOW,
      timezone: TZ,
    });
    const text = renderLoadPlanEntry(entry, ctx);
    expect(text).toContain('45s hold');
    expect(text).toContain('working weight: n/a for isometric');
    expect(text).toContain('e1RM: n/a for isometric');
    expect(text).toContain('step: n/a for isometric');
    expect(text).toContain('gap: exercise 4 d');
  });
});
