import type { ExerciseWithMuscles } from '@domain/training/types';
import type { IUserFactsService, UserFact } from '@domain/user/ports';

import { guardFactConstraints } from '../fact-constraint-guard';

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

describe('guardFactConstraints — shared tool guard (D-G, AC-FL-6)', () => {
  it('fetches constraints via getConstraints for the given user', async () => {
    const getConstraints = jest.fn().mockResolvedValue([]);

    await guardFactConstraints({ getConstraints }, 'u1', [makeExercise()], NOW);

    expect(getConstraints).toHaveBeenCalledWith('u1', NOW); // AC-FL-1: the run clock, threaded by the caller
  });

  it('no conflict → neither rejection nor advisory', async () => {
    const fact = makeFact({ muscleGroup: 'lower_back' });
    const exercise = makeExercise({ muscleGroups: [{ muscleGroup: 'chest', involvement: 'primary' }] });

    await expect(guardFactConstraints({ getConstraints: async () => [fact] }, 'u1', [exercise], NOW)).resolves.toEqual({
      rejection: null,
      advisory: null,
    });
  });

  it('a permanent conflict → the userError outcome both tools return verbatim, no advisory', async () => {
    const verdict = await guardFactConstraints(
      { getConstraints: async () => [makeFact()] },
      'u1',
      [makeExercise()],
      NOW,
    );

    expect(verdict).toEqual({
      rejection: {
        ok: false,
        kind: 'user_error',
        message:
          'Cannot proceed: "Squat" primarily trains the quads, ' +
          'but the user has a physical constraint: "User has a quad injury — avoid quad-dominant exercises.". ' +
          'Remove or replace that exercise and explain the substitution to the user.',
      },
      advisory: null,
    });
  });

  it.each(['long_term', 'short'] as const)(
    'a %s conflict → no rejection, an advisory naming the fact and every conflicting exercise',
    async durability => {
      const fact = makeFact({ durability });
      const exercises = [
        makeExercise({ id: 'ex-1', name: 'Squat' }),
        makeExercise({ id: 'ex-2', name: 'Leg Press' }),
        makeExercise({ id: 'ex-3', name: 'Lunge' }),
      ];

      const verdict = await guardFactConstraints({ getConstraints: async () => [fact] }, 'u1', exercises, NOW);

      expect(verdict.rejection).toBeNull();
      expect(verdict.advisory).toContain(fact.fact);
      for (const name of ['Squat', 'Leg Press', 'Lunge']) {
        expect(verdict.advisory).toContain(name);
      }
    },
  );

  it('a permanent fact alongside a short one → rejection (the advisory is not produced)', async () => {
    const facts = [makeFact({ id: 'a', durability: 'short' }), makeFact({ id: 'b', durability: 'permanent' })];

    const verdict = await guardFactConstraints({ getConstraints: async () => facts }, 'u1', [makeExercise()], NOW);

    expect(verdict.rejection).not.toBeNull();
    expect(verdict.advisory).toBeNull();
  });

  it('accepts a Pick<IUserFactsService, "getConstraints"> — the narrow contract the tools hold', async () => {
    const factsService: Pick<IUserFactsService, 'getConstraints'> = {
      getConstraints: async () => [],
    };

    await expect(guardFactConstraints(factsService, 'u1', [], NOW)).resolves.toEqual({
      rejection: null,
      advisory: null,
    });
  });
});
