import type { ExerciseWithMuscles } from '@domain/training/types';
import type { IUserFactsService, UserFact } from '@domain/user/ports';

import { rejectOnFactConflict } from '../fact-constraint-guard';

const NOW = new Date('2026-09-20T12:00:00Z');

const makeFact = (overrides: Partial<UserFact> = {}): UserFact => ({
  id: 'fact-1',
  userId: 'u1',
  category: 'physical_constraint',
  fact: 'User has a quad injury — avoid quad-dominant exercises.',
  factKey: 'quad-injury',
  muscleGroup: 'quads',
  confirmations: 1,
  sourceTurnId: null,
  createdAt: new Date('2026-09-01T00:00:00Z'),
  updatedAt: new Date('2026-09-01T00:00:00Z'),
  durability: 'permanent',
  expiresAt: null,
  reviewAfter: null,
  phaseNote: null,
  phaseAt: null,
  onExpiry: null,
  status: 'active',
  archivedAt: null,
  archivedReason: null,
  closedByUserAt: null,
  supersedesId: null,
  context: null,
  ...overrides,
});

const makeExercise = (overrides: Partial<ExerciseWithMuscles> = {}): ExerciseWithMuscles => ({
  id: 'ex-squat',
  name: 'Squat',
  category: 'compound',
  equipment: 'barbell',
  exerciseType: 'strength',
  description: null,
  energyCost: 'high',
  complexity: 'intermediate',
  typicalDurationMinutes: 15,
  requiresSpotter: false,
  imageUrl: null,
  videoUrl: null,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  muscleGroups: [{ muscleGroup: 'quads', involvement: 'primary' }],
  ...overrides,
});

describe('rejectOnFactConflict — shared tool guard (D-G)', () => {
  it('fetches constraints via getConstraints for the given user', async () => {
    const getConstraints = jest.fn().mockResolvedValue([]);

    await rejectOnFactConflict({ getConstraints }, 'u1', [makeExercise()], NOW);

    expect(getConstraints).toHaveBeenCalledWith('u1', NOW); // AC-FL-1: the run clock, threaded by the caller
  });

  it('returns null when there is no conflict', async () => {
    const fact = makeFact({ muscleGroup: 'lower_back' });
    const exercise = makeExercise({ muscleGroups: [{ muscleGroup: 'chest', involvement: 'primary' }] });

    await expect(
      rejectOnFactConflict({ getConstraints: async () => [fact] }, 'u1', [exercise], NOW),
    ).resolves.toBeNull();
  });

  it('returns the userError outcome both tools return verbatim on a conflict', async () => {
    const fact = makeFact();
    const exercise = makeExercise();

    const rejection = await rejectOnFactConflict({ getConstraints: async () => [fact] }, 'u1', [exercise], NOW);

    expect(rejection).toEqual({
      ok: false,
      kind: 'user_error',
      message:
        'Cannot proceed: "Squat" primarily trains the quads, ' +
        'but the user has a physical constraint: "User has a quad injury — avoid quad-dominant exercises.". ' +
        'Remove or replace that exercise and explain the substitution to the user.',
    });
  });

  it('accepts a Pick<IUserFactsService, "getConstraints"> — the narrow contract the tools hold', async () => {
    // The tools' dependency is the full IUserFactsService; the guard must be
    // satisfied with a Pick — proves the narrow contract at compile time.
    const factsService: Pick<IUserFactsService, 'getConstraints'> = {
      getConstraints: async () => [],
    };

    await expect(rejectOnFactConflict(factsService, 'u1', [], NOW)).resolves.toBeNull();
  });
});
