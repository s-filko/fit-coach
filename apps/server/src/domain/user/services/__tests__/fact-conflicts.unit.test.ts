import type { ExerciseWithMuscles } from '@domain/training/types';

import type { UserFact } from '../../ports/user-facts.ports';

import { blockingConflicts, factConflictAdvisory, factConflictMessage, findFactConflicts } from '../fact-conflicts';

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

describe('findFactConflicts — pure domain function (D-G, AC-FL-6)', () => {
  it('returns [] when there are no facts', () => {
    expect(findFactConflicts({ facts: [], exercises: [makeExercise()] })).toEqual([]);
  });

  it('returns [] when there are no exercises', () => {
    expect(findFactConflicts({ facts: [makeFact()], exercises: [] })).toEqual([]);
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

    expect(findFactConflicts({ facts: [fact], exercises: [exercise] })).toEqual([
      { exerciseId: 'ex-squat', exerciseName: 'Squat', fact },
    ]);
  });

  it('does NOT conflict when the constrained muscle is a SECONDARY muscle only', () => {
    const exercise = makeExercise({
      muscleGroups: [
        { muscleGroup: 'quads', involvement: 'primary' },
        { muscleGroup: 'lower_back', involvement: 'secondary' },
      ],
    });

    expect(findFactConflicts({ facts: [makeFact()], exercises: [exercise] })).toEqual([]);
  });

  it('does NOT conflict for a non-physical_constraint fact with the same muscleGroup', () => {
    const fact = makeFact({ category: 'exercise_dislike', fact: 'User hates deadlifts.' });

    expect(findFactConflicts({ facts: [fact], exercises: [makeExercise()] })).toEqual([]);
  });

  it('ignores a physical_constraint fact whose muscleGroup is null', () => {
    expect(findFactConflicts({ facts: [makeFact({ muscleGroup: null })], exercises: [makeExercise()] })).toEqual([]);
  });

  it('returns EVERY conflict, in exercise order — not just the first', () => {
    const fact = makeFact();
    const clean = makeExercise({
      id: 'ex-bench',
      name: 'Bench Press',
      muscleGroups: [{ muscleGroup: 'chest', involvement: 'primary' }],
    });
    const a = makeExercise({ id: 'ex-dl', name: 'Deadlift' });
    const b = makeExercise({ id: 'ex-row', name: 'Barbell Row' });
    const c = makeExercise({ id: 'ex-hyper', name: 'Hyperextension' });

    const conflicts = findFactConflicts({ facts: [fact], exercises: [a, clean, b, c] });

    expect(conflicts.map(x => x.exerciseId)).toEqual(['ex-dl', 'ex-row', 'ex-hyper']);
    expect(conflicts.every(x => x.fact === fact)).toBe(true);
  });

  it('reports one conflict per (exercise, fact) pair when several constraints hit the same exercise', () => {
    const back = makeFact({ id: 'f-back' });
    const quad = makeFact({ id: 'f-quad', muscleGroup: 'quads', fact: 'Bad knee' });
    const squat = makeExercise({
      id: 'ex-squat',
      name: 'Squat',
      muscleGroups: [
        { muscleGroup: 'quads', involvement: 'primary' },
        { muscleGroup: 'lower_back', involvement: 'primary' },
      ],
    });

    const conflicts = findFactConflicts({ facts: [back, quad], exercises: [squat] });

    expect(conflicts.map(x => x.fact.id)).toEqual(['f-back', 'f-quad']);
  });
});

describe('blockingConflicts — only permanent blocks (AC-FL-6)', () => {
  const exercise = makeExercise();

  it('keeps a permanent fact’s conflicts', () => {
    const conflicts = findFactConflicts({ facts: [makeFact({ durability: 'permanent' })], exercises: [exercise] });

    expect(blockingConflicts(conflicts)).toHaveLength(1);
  });

  it.each(['long_term', 'short'] as const)('drops a %s fact’s conflicts', durability => {
    const conflicts = findFactConflicts({ facts: [makeFact({ durability })], exercises: [exercise] });

    expect(conflicts).toHaveLength(1);
    expect(blockingConflicts(conflicts)).toEqual([]);
  });

  it('with a mix, keeps only the permanent fact’s', () => {
    const perm = makeFact({ id: 'perm', durability: 'permanent' });
    const short = makeFact({ id: 'short', durability: 'short' });

    const blocking = blockingConflicts(findFactConflicts({ facts: [short, perm], exercises: [exercise] }));

    expect(blocking.map(c => c.fact.id)).toEqual(['perm']);
  });
});

describe('factConflictMessage / factConflictAdvisory', () => {
  const fact = makeFact();
  const dl = makeExercise({ id: 'ex-dl', name: 'Deadlift' });
  const row = makeExercise({ id: 'ex-row', name: 'Barbell Row' });

  it('a single conflict keeps the original rejection wording', () => {
    expect(factConflictMessage(findFactConflicts({ facts: [fact], exercises: [dl] }))).toBe(
      'Cannot proceed: "Deadlift" primarily trains the lower_back, ' +
        'but the user has a physical constraint: "User has a lower back injury — avoid direct lower back loading.". ' +
        'Remove or replace that exercise and explain the substitution to the user.',
    );
  });

  it('several conflicts are ALL listed in the rejection', () => {
    const message = factConflictMessage(findFactConflicts({ facts: [fact], exercises: [dl, row] }));

    expect(message).toContain('2 exercises');
    expect(message).toContain('"Deadlift"');
    expect(message).toContain('"Barbell Row"');
  });

  it('the advisory groups by fact, names durability, phase note and every exercise, and demands a reply', () => {
    const long = makeFact({ id: 'f-long', durability: 'long_term', phaseNote: 'in a cast three weeks ago' });
    const advisory = factConflictAdvisory(findFactConflicts({ facts: [long], exercises: [dl, row] }));

    expect(advisory).toContain('ADVISORY');
    expect(advisory).toContain('long_term');
    expect(advisory).toContain('in a cast three weeks ago');
    expect(advisory).toContain('"Deadlift", "Barbell Row"');
    expect(advisory).toMatch(/must address/i);
    // one line per fact, not per exercise
    expect(advisory.split('\n').filter(l => l.startsWith('- '))).toHaveLength(1);
  });
});
