import type { LoadFacts } from '../../load-facts';

/** Hand-built `LoadFacts` for the scheme suites — only the fields the schemes read matter. */
export function makeFacts(over: Partial<LoadFacts> = {}): LoadFacts {
  return {
    exerciseId: 'ex-bench',
    exerciseName: 'Machine Chest Press',
    dataSufficiency: { last56Days: 5, allTime: 8 },
    repRange: { min: 8, max: 12, source: 'today' },
    reference: { absent: 'not needed by schemes' },
    fatigueReference: { absent: 'not needed by schemes' },
    fatigueToday: { perMuscle: [], fresh: true, minutesIntoSession: { absent: 'n/a' } },
    workingWeight: { weight: 65, unit: 'kg', performances: 5, warmupsEstimated: false, mixedBasisExcluded: 0 },
    e1rmTrend: {
      newest: 86,
      oldest: 84,
      changePct: 2,
      trend: 'flat',
      flatRun: 2,
      currentLoad: 65,
      currentLoadUnit: 'kg',
      weeksAtWeight: 2,
      performances: 5,
      spanDays: 35,
      lowConfidence: null,
      warmupsEstimated: false,
      mixedBasisExcluded: 0,
    },
    lastExposure: {
      repsVsRange: 'at or above top',
      rpe: { absent: 'no RPE recorded' },
      dropOff: { absent: 'fewer than 2 sets at the top load' },
      warmupsEstimated: false,
    },
    gap: { exercise: { days: 3 }, primaryMuscles: { days: 3 }, anyWorkout: { days: 1 } },
    constraints: { constraints: [], equipment: [] },
    equipmentStep: { step: 5, unit: 'kg', perHand: false, basis: 'default for machine' },
    ...over,
  };
}

export const SHORT_CONSTRAINT = {
  muscleGroup: 'chest' as const,
  durability: 'short' as const,
  text: 'sore shoulder',
};
