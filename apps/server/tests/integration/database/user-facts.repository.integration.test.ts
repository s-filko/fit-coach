import { UserFactsRepository } from '../../../src/infra/db/repositories/user-facts.repository';
import { DrizzleUserRepository } from '../../../src/infra/db/repositories/user.repository';
import { db } from '../../../src/infra/db/drizzle';
import { conversationTurns, userFacts as userFactsTable } from '../../../src/infra/db/schema';
import { createTestUserData } from '../../shared/test-factories';

/**
 * UserFactsRepository Integration Tests (ADR-0009 table shape, D-B, D-C;
 * fact-lifecycle plan Task 1, AC-FL-1)
 * Runs under RUN_DB_TESTS=1 against the local compose DB (npm run test:integration).
 * Schema is managed by migrations (drizzle/); assumes the test database has been migrated.
 */

/** A `now` far in the future of every seeded row's dates — nothing is expired against it. */
const FAR_FUTURE = new Date('2030-01-01T00:00:00Z');

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

  /** Seeds one row with full lifecycle control — upsertMany has no lifecycle input yet (Task 2/3). */
  async function seedFact(
    userId: string,
    values: Partial<typeof userFactsTable.$inferInsert> & { fact: string; category: string },
  ): Promise<void> {
    await db.insert(userFactsTable).values({
      userId,
      factKey: values.fact.toLowerCase(),
      ...values,
    });
  }

  describe('upsertMany (D-C idempotent upsert)', () => {
    it('inserting the same normalised fact twice yields one row with confirmations = 2 and unchanged fact text', async () => {
      await repository.upsertMany(testUserId, [{ category: 'physical_constraint', fact: 'Bad lower back.' }]);
      await repository.upsertMany(testUserId, [{ category: 'physical_constraint', fact: 'bad lower back' }]);

      const facts = await repository.getForPrompt(testUserId, FAR_FUTURE);
      const matches = facts.filter(f => f.category === 'physical_constraint' && f.fact === 'Bad lower back.');

      expect(matches).toHaveLength(1);
      expect(matches[0]!.confirmations).toBe(2);
      expect(matches[0]!.fact).toBe('Bad lower back.');
    });

    it('a different category with the same text yields a second row', async () => {
      const fact = 'Loves squats';
      await repository.upsertMany(testUserId, [{ category: 'exercise_preference', fact }]);
      await repository.upsertMany(testUserId, [{ category: 'coaching_preference', fact }]);

      const facts = await repository.getForPrompt(testUserId, FAR_FUTURE);
      const matches = facts.filter(f => f.fact === fact);

      expect(matches).toHaveLength(2);
      expect(matches.map(m => m.category).sort()).toEqual(['coaching_preference', 'exercise_preference']);
    });

    it('stores an optional muscleGroup and sourceTurnId', async () => {
      // source_turn_id is a real FK — seed the turn row it cites.
      const [turn] = await db
        .insert(conversationTurns)
        .values({ userId: testUserId, phase: 'chat', role: 'user', content: 'колено болит' })
        .returning({ id: conversationTurns.id });
      await repository.upsertMany(
        testUserId,
        [{ category: 'physical_constraint', fact: 'Knee pain on lunges', muscleGroup: 'quads' }],
        turn!.id,
      );

      const facts = await repository.getForPrompt(testUserId, FAR_FUTURE);
      const match = facts.find(f => f.fact === 'Knee pain on lunges');

      expect(match).toBeTruthy();
      expect(match!.muscleGroup).toBe('quads');
      expect(match!.sourceTurnId).toBe(turn!.id);
    });

    it('defaults a new row to durability=permanent, status=active, no dates (AC-FL-1: nothing changes today)', async () => {
      await repository.upsertMany(testUserId, [{ category: 'equipment', fact: 'Has a barbell' }]);

      const facts = await repository.getForPrompt(testUserId, FAR_FUTURE);
      const match = facts.find(f => f.fact === 'Has a barbell');

      expect(match).toMatchObject({
        durability: 'permanent',
        expiresAt: null,
        reviewAfter: null,
        onExpiry: null,
        status: 'active',
        archivedAt: null,
        archivedReason: null,
        supersedesId: null,
        context: null,
      });
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

      const capped = await repository.getForPrompt(user.id, FAR_FUTURE, 2);
      expect(capped).toHaveLength(2);

      const all = await repository.getForPrompt(user.id, FAR_FUTURE, 50);
      expect(all).toHaveLength(3);
      // category then recency: 'equipment' sorts before 'nutrition_preference' asc
      expect(all[0]!.category).toBe('equipment');
      expect(all[1]!.category).toBe('equipment');
      expect(all[2]!.category).toBe('nutrition_preference');
    });

    it('AC-FL-1: an expired short fact is not returned; the same fact is before its expiry', async () => {
      const userData = createTestUserData({ username: 'user_facts_expiry_user' });
      const user = await userRepo.create(userData);
      const NOW = new Date('2026-09-20T12:00:00Z');

      await seedFact(user.id, {
        category: 'physiological_pattern',
        fact: 'Sore legs after squats',
        durability: 'short',
        expiresAt: new Date(NOW.getTime() - 86_400_000),
        onExpiry: 'forget',
      });

      await expect(repository.getForPrompt(user.id, NOW)).resolves.toHaveLength(0);
      await expect(repository.getForPrompt(user.id, new Date(NOW.getTime() - 2 * 86_400_000))).resolves.toHaveLength(
        1,
      );
    });

    it('AC-FL-1: an archived fact is never returned, whatever its dates', async () => {
      const userData = createTestUserData({ username: 'user_facts_archived_user' });
      const user = await userRepo.create(userData);

      await seedFact(user.id, {
        category: 'physical_constraint',
        fact: 'Old shoulder tweak',
        muscleGroup: 'shoulders_front',
        durability: 'short',
        expiresAt: new Date('2030-01-01T00:00:00Z'), // still "live" by date — archived anyway
        status: 'archived',
        archivedAt: new Date('2026-09-01T00:00:00Z'),
        archivedReason: 'user_closed',
        closedByUserAt: new Date('2026-09-01T00:00:00Z'),
      });

      await expect(repository.getForPrompt(user.id, new Date())).resolves.toHaveLength(0);
      await expect(repository.getConstraints(user.id, new Date())).resolves.toHaveLength(0);
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

      const constraints = await repository.getConstraints(user.id, FAR_FUTURE);

      expect(constraints).toHaveLength(1);
      expect(constraints[0]!.fact).toBe('Herniated disc');
      expect(constraints[0]!.muscleGroup).toBe('lower_back');
    });

    it('AC-FL-1: an expired short constraint no longer rejects anything', async () => {
      const userData = createTestUserData({ username: 'user_facts_expired_constraint_user' });
      const user = await userRepo.create(userData);
      const NOW = new Date('2026-09-20T12:00:00Z');

      await seedFact(user.id, {
        category: 'physical_constraint',
        fact: 'Tweaked lower back last week',
        muscleGroup: 'lower_back',
        durability: 'short',
        expiresAt: new Date(NOW.getTime() - 3_600_000),
        onExpiry: 'ask_once',
      });

      await expect(repository.getConstraints(user.id, NOW)).resolves.toHaveLength(0);
    });
  });

});
