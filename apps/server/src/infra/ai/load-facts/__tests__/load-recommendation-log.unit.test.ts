/**
 * load-plan A3: the snapshot port stores the decision behind the rendered v2 entry; a non-strength exercise
 * has no scheme decision (NULL columns, `recommend: n/a`), and the profile drives the D8 default scheme.
 */
import { LoadPlanSnapshotPort, LoadRecommendationLog } from '../load-recommendation-log';
import { CHEST_PRESS, daysBefore, NOW, sessionRow, sets, TZ } from './rows';

const PLANK_ID = '33333333-3333-4333-8333-333333333333';
const p1 = sessionRow('s1', daysBefore(3), [
  { rowId: 'r1', ...CHEST_PRESS, sets: sets(65, [10, 10, 9], daysBefore(3)) },
]);
const p2 = sessionRow('s2', daysBefore(10), [
  { rowId: 'r2', ...CHEST_PRESS, sets: sets(65, [10, 10, 10], daysBefore(10)) },
]);
const today = sessionRow('today', daysBefore(0, -30), [], { status: 'in_progress' });
const plank = sessionRow('sp', daysBefore(4), [
  {
    rowId: 'rp',
    id: PLANK_ID,
    name: 'Plank',
    muscles: [['core', 'primary']] as never,
    equipment: 'bodyweight',
    exerciseType: 'isometric',
    targetReps: null,
    sets: [{ weight: 0, reps: 1, at: daysBefore(4), setData: { type: 'isometric', duration: 45 } }],
  },
]);

function port(past: unknown[], exercise: unknown, profile: unknown = null): LoadPlanSnapshotPort {
  return new LoadPlanSnapshotPort({
    workoutSessionRepo: {
      findRecentByUserIdWithDetails: async () => past,
      findLastPerformancesByExercise: async () => [],
      countRealPerformancesByExercise: async () => new Map(),
      findByIdWithDetails: async () => today,
    },
    exerciseRepository: { findByIdsWithMuscles: async () => [exercise] },
    userFacts: { getConstraints: async () => [], getForPrompt: async () => [] },
    userRepository: { getById: async () => profile },
  } as never);
}

const input = (exerciseId: string) => ({ userId: 'u1', session: today as never, exerciseId, now: NOW, timezone: TZ });

describe('AC-LP-4 LoadPlanSnapshotPort (A3)', () => {
  it('strength: decision columns come from decide(); rendered is the v2 entry', async () => {
    const snap = await port([p1, p2], p1.exercises[0].exercise).snapshot(input(CHEST_PRESS.id));
    expect(snap).toMatchObject({ schemeId: 'double_progression', schemeVersion: '1', gapTier: 'rest' });
    expect(snap?.stage).toMatch(/^[ABC]$/);
    expect(snap?.row).toEqual(expect.any(String));
    expect(snap?.candidate).toMatchObject({ reps: expect.anything() });
    expect(snap?.rendered).toMatch(/\n {2}decision: Stage [ABC], /);
    expect(snap?.rendered).toMatch(/\n {2}recommend: /);
  });

  it('the profile picks the default scheme: beginner + strength goal → linear', async () => {
    const snap = await port([p1, p2], p1.exercises[0].exercise, {
      fitnessLevel: 'beginner',
      fitnessGoal: 'get stronger',
    }).snapshot(input(CHEST_PRESS.id));
    expect(snap?.schemeId).toBe('linear_progression');
    expect(snap?.rendered).toContain('scheme: linear progression');
  });

  it('non-strength: no decision, NULL columns, recommend n/a', async () => {
    const snap = await port([plank], plank.exercises[0].exercise).snapshot(input(PLANK_ID));
    expect(snap).toMatchObject({
      schemeId: null,
      schemeVersion: null,
      stage: null,
      row: null,
      candidate: null,
      conservative: null,
      confidence: null,
      gapTier: null,
    });
    expect(snap?.rendered).toContain('recommend: n/a for isometric');
  });
});

describe('AC-LP-5 LoadPlanSnapshotPort and the progression_scheme fact (Task 5a)', () => {
  it('scheme_id follows the user’s choice (the default would be double)', async () => {
    const p = new LoadPlanSnapshotPort({
      workoutSessionRepo: {
        findRecentByUserIdWithDetails: async () => [p1, p2],
        findLastPerformancesByExercise: async () => [],
        countRealPerformancesByExercise: async () => new Map(),
        findByIdWithDetails: async () => today,
      },
      exerciseRepository: { findByIdsWithMuscles: async () => [p1.exercises[0].exercise] },
      userFacts: {
        getConstraints: async () => [],
        getForPrompt: async () => [
          {
            category: 'progression_scheme',
            fact: 'progression_scheme id=linear_progression — add weight each time',
            createdAt: new Date('2026-09-20T03:00:00Z'),
          },
        ],
      },
      userRepository: { getById: async () => null },
    } as never);
    const snap = await p.snapshot(input(CHEST_PRESS.id));
    expect(snap?.schemeId).toBe('linear_progression');
    expect(snap?.rendered).toContain('scheme: linear progression');
    expect(snap?.rendered).toContain('chosen by user 2026-09-20');
  });
});

describe('AC-LP-4 LoadRecommendationLog.prepare — the D7 trigger runs inside the never-throw guard', () => {
  const snap = { rendered: 'entry' } as never;
  const session = (sets: { setKind: string | null }[]) =>
    ({ id: 'sess', userId: 'u1', exercises: [{ id: 'row-1', sets }] }) as never;
  const input = {
    sessionId: 'sess',
    sessionExerciseId: 'row-1',
    exerciseId: CHEST_PRESS.id,
    ctx: { runId: 'run', now: NOW, timezone: TZ },
  };
  const build = (findByIdWithDetails: () => Promise<unknown>) => {
    const snapshot = jest.fn().mockResolvedValue(snap);
    const log = new LoadRecommendationLog({ snapshot }, {} as never, { findByIdWithDetails } as never);
    return { log, snapshot };
  };

  it('no earlier working set → snapshot taken (warm-ups and only warm-ups do not count)', async () => {
    const { log, snapshot } = build(async () => session([{ setKind: 'warmup' }]));
    expect(await log.prepare(input)).toMatchObject({ rendered: 'entry', userId: 'u1', sessionId: 'sess' });
    expect(snapshot).toHaveBeenCalledTimes(1);
  });

  it.each([['working'], [null]])('an earlier working set (%s) → no row', async kind => {
    const { log, snapshot } = build(async () => session([{ setKind: kind }]));
    expect(await log.prepare(input)).toBeNull();
    expect(snapshot).not.toHaveBeenCalled();
  });

  it('a failed session read returns null instead of failing the set', async () => {
    const { log } = build(() => Promise.reject(new Error('db down')));
    await expect(log.prepare(input)).resolves.toBeNull();
  });
});
