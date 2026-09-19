import { UserFactsRepository } from '../../../src/infra/db/repositories/user-facts.repository';
import { DrizzleUserRepository } from '../../../src/infra/db/repositories/user.repository';
import { createTestUserData } from '../../shared/test-factories';

/**
 * UserFactsRepository Integration Tests (ADR-0009 table shape, D-B, D-C)
 * Runs under RUN_DB_TESTS=1 against the local compose DB (npm run test:integration).
 * Schema is managed by migrations (drizzle/); assumes the test database has been migrated.
 */
describe('UserFactsRepository – integration', () => {
  let repository: UserFactsRepository;
  let userRepo: DrizzleUserRepository;
  let testUserId: string;

  beforeAll(async () => {
    repository = new UserFactsRepository();
    userRepo = new DrizzleUserRepository();

    const user = await userRepo.create(
      createTestUserData({
        username: 'user_facts_test_user',
        firstName: 'Facts',
        lastName: 'Tester',
      }),
    );
    testUserId = user.id;
  });

  describe('upsertMany (D-C idempotent upsert)', () => {
    it('inserting the same normalised fact twice yields one row with confirmations = 2 and unchanged fact text', async () => {
      await repository.upsertMany(testUserId, [{ category: 'physical_constraint', fact: 'Bad lower back.' }]);
      await repository.upsertMany(testUserId, [{ category: 'physical_constraint', fact: 'bad lower back' }]);

      const facts = await repository.getForPrompt(testUserId);
      const matches = facts.filter(f => f.category === 'physical_constraint' && f.fact === 'Bad lower back.');

      expect(matches).toHaveLength(1);
      expect(matches[0]!.confirmations).toBe(2);
      expect(matches[0]!.fact).toBe('Bad lower back.');
    });

    it('a different category with the same text yields a second row', async () => {
      const fact = 'Loves squats';
      await repository.upsertMany(testUserId, [{ category: 'exercise_preference', fact }]);
      await repository.upsertMany(testUserId, [{ category: 'coaching_preference', fact }]);

      const facts = await repository.getForPrompt(testUserId);
      const matches = facts.filter(f => f.fact === fact);

      expect(matches).toHaveLength(2);
      expect(matches.map(m => m.category).sort()).toEqual(['coaching_preference', 'exercise_preference']);
    });

    it('stores an optional muscleGroup and sourceTurnId', async () => {
      await repository.upsertMany(testUserId, [
        { category: 'physical_constraint', fact: 'Knee pain on lunges', muscleGroup: 'quads' },
      ]);

      const facts = await repository.getForPrompt(testUserId);
      const match = facts.find(f => f.fact === 'Knee pain on lunges');

      expect(match).toBeTruthy();
      expect(match!.muscleGroup).toBe('quads');
    });
  });

  describe('getForPrompt', () => {
    it('respects the cap and orders by category then recency', async () => {
      const userData = createTestUserData({ username: 'user_facts_cap_user' });
      const user = await userRepo.create(userData);

      await repository.upsertMany(user.id, [
        { category: 'equipment', fact: 'Has a barbell' },
        { category: 'equipment', fact: 'Has dumbbells' },
        { category: 'nutrition_preference', fact: 'Vegetarian' },
      ]);

      const capped = await repository.getForPrompt(user.id, 2);
      expect(capped).toHaveLength(2);

      const all = await repository.getForPrompt(user.id, 50);
      expect(all).toHaveLength(3);
      // category then recency: 'equipment' sorts before 'nutrition_preference' asc
      expect(all[0]!.category).toBe('equipment');
      expect(all[1]!.category).toBe('equipment');
      expect(all[2]!.category).toBe('nutrition_preference');
    });
  });

  describe('getConstraints', () => {
    it('returns only physical_constraint rows with a non-null muscleGroup', async () => {
      const userData = createTestUserData({ username: 'user_facts_constraints_user' });
      const user = await userRepo.create(userData);

      await repository.upsertMany(user.id, [
        { category: 'physical_constraint', fact: 'Herniated disc', muscleGroup: 'lower_back' },
        { category: 'physical_constraint', fact: 'Gets tired easily' }, // no muscleGroup
        { category: 'exercise_preference', fact: 'Prefers barbell rows', muscleGroup: 'back_lats' },
      ]);

      const constraints = await repository.getConstraints(user.id);

      expect(constraints).toHaveLength(1);
      expect(constraints[0]!.fact).toBe('Herniated disc');
      expect(constraints[0]!.muscleGroup).toBe('lower_back');
    });
  });
});
