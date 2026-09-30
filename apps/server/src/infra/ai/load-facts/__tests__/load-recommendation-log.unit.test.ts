/**
 * load-plan A3: the snapshot port stores the decision behind the rendered v2 entry; a non-strength exercise
 * has no scheme decision (NULL columns, `recommend: n/a`), and the profile drives the D8 default scheme.
 */
import { LoadPlanSnapshotPort } from '../load-recommendation-log';
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

describe('LoadPlanSnapshotPort (A3)', () => {
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
