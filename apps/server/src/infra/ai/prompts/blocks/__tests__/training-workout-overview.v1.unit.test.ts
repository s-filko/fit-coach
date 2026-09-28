/**
 * set-kind plan Task 1 (D4, D5, AC-SK-2, AC-SK-3, AC-SK-4): only working sets count against a
 * plan target (guide "(n/target sets)", ACTIVE STATUS "N remaining per plan"); warm-up sets are
 * still listed, marked `(w/u)`; a NULL/legacy `set_kind` counts as working (today's behaviour,
 * unchanged); a per-hand strength set renders "per hand". RED today: `buildWorkoutOverview`
 * counts every set regardless of kind, `workingSets` does not exist, and `formatSetData` never
 * renders "per hand".
 */
import type { SessionExerciseWithDetails, SessionSet, WorkoutSessionWithDetails } from '@domain/training/types';

import { buildWorkoutOverview, formatSetData, workingSets } from '../training-workout-overview.v1';

const NOW = new Date('2026-09-28T10:00:00.000Z');

function makeSet(overrides: Partial<SessionSet> = {}): SessionSet {
  return {
    id: `set-${Math.random()}`,
    sessionExerciseId: 'se-1',
    setNumber: 1,
    rpe: null,
    userFeedback: null,
    createdAt: NOW,
    completedAt: null,
    setData: { type: 'strength', reps: 10, weight: 40, weightUnit: 'kg' },
    setKind: null,
    ...overrides,
  };
}

function makeExercise(overrides: Partial<SessionExerciseWithDetails> = {}): SessionExerciseWithDetails {
  return {
    id: 'se-1',
    sessionId: 'session-1',
    exerciseId: 'ex-1',
    orderIndex: 0,
    status: 'in_progress',
    targetSets: 3,
    targetReps: '8-10',
    targetWeight: null,
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
    sets: [],
    ...overrides,
  };
}

function makeSession(exercise: SessionExerciseWithDetails): WorkoutSessionWithDetails {
  return {
    id: 'session-1',
    userId: 'user-1',
    planId: 'plan-1',
    sessionKey: 'upper_a',
    status: 'in_progress',
    startedAt: NOW,
    completedAt: null,
    durationMinutes: null,
    userContextJson: null,
    sessionPlanJson: {
      sessionKey: 'upper_a',
      sessionName: 'Upper A',
      reasoning: '',
      exercises: [
        {
          exerciseId: exercise.exerciseId,
          exerciseName: exercise.exercise.name,
          targetSets: exercise.targetSets ?? 3,
          targetReps: exercise.targetReps ?? '8-10',
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

describe('workingSets (set-kind plan D4)', () => {
  it('excludes warmup sets', () => {
    const sets = [makeSet({ setKind: 'warmup' }), makeSet({ setKind: 'working' })];
    expect(workingSets(sets)).toHaveLength(1);
  });

  it('treats a NULL set_kind (legacy row) as working — AC-SK-3', () => {
    const sets = [makeSet({ setKind: null })];
    expect(workingSets(sets)).toHaveLength(1);
  });
});

describe('buildWorkoutOverview — counting excludes warm-ups (AC-SK-2)', () => {
  const threeSets = [
    makeSet({ setNumber: 1, setKind: 'warmup' }),
    makeSet({ setNumber: 2, setKind: 'warmup' }),
    makeSet({
      setNumber: 3,
      setKind: 'working',
      setData: { type: 'strength', reps: 10, weight: 60, weightUnit: 'kg' },
    }),
  ];

  it('guide shows (1/3 sets) for 2 warmups + 1 working against a 3-set target', () => {
    const text = buildWorkoutOverview(makeSession(makeExercise({ sets: threeSets })), NOW);

    expect(text).toContain('(1/3 sets)');
  });

  it('ACTIVE STATUS reports 1 set done, 2 remaining per plan', () => {
    const text = buildWorkoutOverview(makeSession(makeExercise({ sets: threeSets })), NOW);

    expect(text).toContain('1 set(s) done, 2 remaining per plan.');
  });

  it('lists all three sets, warm-ups marked (w/u), the working set not', () => {
    const text = buildWorkoutOverview(makeSession(makeExercise({ sets: threeSets })), NOW);
    const lines = text.split('\n');
    const set1Line = lines.find(l => l.includes('Set 1 ('));
    const set2Line = lines.find(l => l.includes('Set 2 ('));
    const set3Line = lines.find(l => l.includes('Set 3 ('));

    expect(set1Line).toContain('(w/u)');
    expect(set2Line).toContain('(w/u)');
    expect(set3Line).not.toContain('(w/u)');
  });
});

describe('formatSetData — per-hand marker (set-kind plan D5, AC-SK-4)', () => {
  it('renders "per hand" when setData.perHand is true', () => {
    expect(formatSetData({ type: 'strength', reps: 10, weight: 12, weightUnit: 'kg', perHand: true })).toBe(
      '10 reps @ 12 kg per hand',
    );
  });

  it('does not render "per hand" when perHand is absent', () => {
    expect(formatSetData({ type: 'strength', reps: 10, weight: 80, weightUnit: 'kg' })).toBe('10 reps @ 80 kg');
  });

  it('does not render "per hand" when perHand is explicitly false', () => {
    expect(formatSetData({ type: 'strength', reps: 10, weight: 24, weightUnit: 'kg', perHand: false })).toBe(
      '10 reps @ 24 kg',
    );
  });
});
