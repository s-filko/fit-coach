/**
 * plan Task 5b (D10, AC-LP-7): with the retired planner flag on, WORKOUT OVERVIEW is
 * the v2 block — sets × reps only, no target weight, even for legacy rows that still carry one
 * (the DB column stays; it is simply not written and not printed). The v1 block is untouched.
 */
import type { SessionExerciseWithDetails, SessionSet, WorkoutSessionWithDetails } from '@domain/training/types';

import { TRAINING_WORKOUT_OVERVIEW_V1 } from '../training-workout-overview.v1';
import { TRAINING_WORKOUT_OVERVIEW_V2 } from '../training-workout-overview.v2';

const NOW = new Date('2026-10-01T10:00:00.000Z');

function makeSession(): WorkoutSessionWithDetails {
  const set: SessionSet = {
    id: 'set-1',
    sessionExerciseId: 'se-1',
    setNumber: 1,
    rpe: null,
    userFeedback: null,
    createdAt: NOW,
    completedAt: null,
    setData: { type: 'strength', reps: 10, weight: 60, weightUnit: 'kg' },
    setKind: 'working',
  };
  const exercise: SessionExerciseWithDetails = {
    id: 'se-1',
    sessionId: 'session-1',
    exerciseId: 'ex-1',
    orderIndex: 0,
    status: 'in_progress',
    targetSets: 3,
    targetReps: '8-10',
    targetWeight: '60', // DECIMAL arrives as a string
    actualRepsRange: null,
    userFeedback: null,
    createdAt: NOW,
    exercise: {
      id: 'ex-1',
      name: 'Bench Press',
      category: 'compound',
      equipment: 'barbell',
      exerciseType: 'strength',
      description: null,
      energyCost: 'high',
      complexity: 'intermediate',
      typicalDurationMinutes: 12,
      requiresSpotter: true,
      imageUrl: null,
      videoUrl: null,
      createdAt: NOW,
      muscleGroups: [],
    },
    sets: [set],
  };
  return {
    id: 'session-1',
    userId: 'user-1',
    planId: 'plan-1',
    sessionKey: 'upper_a',
    status: 'in_progress',
    place: null,
    startedAt: NOW,
    completedAt: null,
    durationMinutes: null,
    userContextJson: null,
    // A legacy plan row: the exercise still carries a targetWeight.
    sessionPlanJson: {
      sessionKey: 'upper_a',
      sessionName: 'Upper A',
      reasoning: '',
      exercises: [
        {
          exerciseId: 'ex-1',
          exerciseName: 'Bench Press',
          targetSets: 3,
          targetReps: '8-10',
          targetWeight: 60,
          restSeconds: 90,
        },
      ],
      estimatedDuration: 45,
    },
    lastActivityAt: NOW,
    autoCloseReason: null,
    createdAt: NOW,
    updatedAt: NOW,
    exercises: [exercise],
  };
}

const CTX = { now: NOW, timezone: 'UTC', user: null };

describe('training.workout_overview v2 — sets × reps only (plan Task 5b, AC-LP-7)', () => {
  it('v2 keeps the block id, bumps the version', () => {
    expect(TRAINING_WORKOUT_OVERVIEW_V2.id).toBe(TRAINING_WORKOUT_OVERVIEW_V1.id);
    expect(TRAINING_WORKOUT_OVERVIEW_V2.version).toBe('v2');
  });

  it('v1 still prints the plan and exercise target weights (legacy behaviour, flag off)', () => {
    const text = TRAINING_WORKOUT_OVERVIEW_V1.render({ session: makeSession() } as never, CTX as never, 0)!;
    expect(text).toContain('Bench Press: 3×8-10 @ 60 kg');
    expect(text).toContain('Target: 3×8-10 @ 60 kg');
  });

  it('v2 prints sets × reps and no target weight anywhere', () => {
    const text = TRAINING_WORKOUT_OVERVIEW_V2.render({ session: makeSession() } as never, CTX as never, 0)!;
    expect(text).toContain('Bench Press: 3×8-10');
    expect(text).toContain('Target: 3×8-10');
    // The only remaining kilogram is the LOGGED set, which stays — the record of what
    // happened is not a plan target.
    expect(text).not.toContain('3×8-10 @ 60 kg');
    expect(text.match(/@ 60 kg/g)).toEqual(['@ 60 kg']); // the logged Set 1 line only
  });
});
