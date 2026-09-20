import type { ExerciseWithMuscles } from '@domain/training/types';

import type { UserFact } from '../../ports/user-facts.ports';

import { checkFactConflicts } from '../fact-conflicts';

const makeFact = (overrides: Partial<UserFact> = {}): UserFact => ({
  id: 'fact-1',
  userId: 'u1',
  category: 'physical_constraint',
  fact: 'User has a lower back injury — avoid direct lower back loading.',
  factKey: 'lower-back-injury',
  muscleGroup: 'lower_back',
  confirmations: 1,
  sourceTurnId: null,
  durability: 'permanent' as const,
  expiresAt: null,
  reviewAfter: null,
  phaseNote: null,
  phaseAt: null,
  onExpiry: null,
  status: 'active' as const,
  archivedAt: null,
  archivedReason: null,
  closedByUserAt: null,
  supersedesId: null,
  context: null,
  createdAt: new Date('2026-09-01T00:00:00Z'),
  updatedAt: new Date('2026-09-01T00:00:00Z'),
  ...overrides,
});

const makeExercise = (overrides: Partial<ExerciseWithMuscles> = {}): ExerciseWithMuscles => ({
  id: 'ex-deadlift',
  name: 'Deadlift',
  category: 'compound',
  equipment: 'barbell',
  exerciseType: 'strength',
  description: null,
  energyCost: 'very_high',
  complexity: 'intermediate',
  typicalDurationMinutes: 15,
  requiresSpotter: false,
  imageUrl: null,
  videoUrl: null,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  muscleGroups: [{ muscleGroup: 'lower_back', involvement: 'primary' }],
  ...overrides,
});

describe('checkFactConflicts — pure domain function (D-G)', () => {
  it('returns null when there are no facts', () => {
    const exercise = makeExercise();
    expect(checkFactConflicts({ facts: [], exercises: [exercise] })).toBeNull();
  });

  it('returns null when there are no exercises', () => {
    const fact = makeFact();
    expect(checkFactConflicts({ facts: [fact], exercises: [] })).toBeNull();
  });

  it('conflicts when a physical_constraint muscleGroup is among an exercise PRIMARY muscles', () => {
    const fact = makeFact();
    const exercise = makeExercise({
      id: 'ex-squat',
      name: 'Squat',
      muscleGroups: [
        { muscleGroup: 'quads', involvement: 'primary' },
        { muscleGroup: 'lower_back', involvement: 'primary' },
      ],
    });

    const conflict = checkFactConflicts({ facts: [fact], exercises: [exercise] });

    expect(conflict).toEqual({ exerciseId: 'ex-squat', exerciseName: 'Squat', fact });
  });

  it('does NOT conflict when the constrained muscle is a SECONDARY muscle only', () => {
    const fact = makeFact();
    const exercise = makeExercise({
      muscleGroups: [
        { muscleGroup: 'quads', involvement: 'primary' },
        { muscleGroup: 'lower_back', involvement: 'secondary' },
      ],
    });

    expect(checkFactConflicts({ facts: [fact], exercises: [exercise] })).toBeNull();
  });

  it('does NOT conflict for a non-physical_constraint fact with the same muscleGroup', () => {
    const fact = makeFact({ category: 'exercise_dislike', fact: 'User hates deadlifts.' });
    const exercise = makeExercise({ muscleGroups: [{ muscleGroup: 'lower_back', involvement: 'primary' }] });

    expect(checkFactConflicts({ facts: [fact], exercises: [exercise] })).toBeNull();
  });

  it('ignores a physical_constraint fact whose muscleGroup is null', () => {
    const fact = makeFact({ muscleGroup: null });
    const exercise = makeExercise();

    expect(checkFactConflicts({ facts: [fact], exercises: [exercise] })).toBeNull();
  });

  it('scans exercises in order and returns the FIRST conflict found', () => {
    const fact = makeFact();
    const clean = makeExercise({
      id: 'ex-bench',
      name: 'Bench Press',
      muscleGroups: [{ muscleGroup: 'chest', involvement: 'primary' }],
    });
    const conflicting = makeExercise({ id: 'ex-row', name: 'Barbell Row' });

    const conflict = checkFactConflicts({ facts: [fact], exercises: [clean, conflicting] });

    expect(conflict?.exerciseId).toBe('ex-row');
    expect(conflict?.fact).toBe(fact);
  });
});
