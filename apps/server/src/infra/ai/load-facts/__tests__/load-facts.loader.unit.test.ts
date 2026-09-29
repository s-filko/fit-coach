/**
 * load-facts loader (D11): an exercise whose last performance is older than the loaded 60 workouts
 * still gets a real day count through the `findLastPerformancesByExercise` fallback (AC-LF-2).
 */
import { CHEST_PRESS, daysBefore, NOW, sessionRow, sets, TZ } from './rows';
import { loadLoadPlanEntries, type LoadFactsLoaderDeps } from '../load-facts.loader';

describe('AC-LF-2 · loadLoadPlanEntries fallback beyond the loaded workouts', () => {
  it('gives the exercise gap a real day count when its last performance is outside the recent workouts', async () => {
    const old = sessionRow('old', daysBefore(90), [
      { rowId: 'ro', ...CHEST_PRESS, sets: sets(60, [10, 10], daysBefore(90)) },
    ]);
    const getSessionDetails = jest.fn().mockResolvedValue(old);
    const deps = {
      workoutSessionRepo: {
        findRecentByUserIdWithDetails: async () => [],
        findLastPerformancesByExercise: async () => [
          { exerciseId: CHEST_PRESS.id, completedAt: old.completedAt, sessionExercise: old.exercises[0] },
        ],
        countRealPerformancesByExercise: async () => new Map([[CHEST_PRESS.id, 1]]),
      },
      exerciseRepository: { findByIdsWithMuscles: async () => [old.exercises[0].exercise] },
      trainingService: { getSessionDetails },
      userFacts: { getConstraints: async () => [], getForPrompt: async () => [] },
    } as unknown as LoadFactsLoaderDeps;

    const [entry] = await loadLoadPlanEntries(deps, {
      userId: 'u1',
      session: null,
      exerciseIds: [CHEST_PRESS.id],
      planTargetReps: new Map(),
      now: NOW,
      timezone: TZ,
    });

    expect(getSessionDetails).toHaveBeenCalledWith('old');
    expect(entry.facts.gap.exercise).toEqual({ days: 90 });
  });
});
