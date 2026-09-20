import { PermanentFactRefusal } from '../../../src/domain/user/services/fact-lifecycle';
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

  describe('rememberFact (fact-lifecycle Task 2, AC-FL-2/AC-FL-3) — tool writes', () => {
    it('creates a fact with the class bounds clamped end to end (short 90d TTL -> 14d)', async () => {
      const userData = createTestUserData({ username: 'user_facts_remember_user' });
      const user = await userRepo.create(userData);
      const NOW = new Date('2026-09-21T12:00:00Z');

      const result = await repository.rememberFact(
        user.id,
        { category: 'physiological_pattern', fact: 'Sore legs after squats', durability: 'short', ttlDays: 90 },
        NOW,
      );

      expect(result.outcome).toBe('created');
      if (result.outcome !== 'created') return;
      expect(result.fact.expiresAt).toEqual(new Date(NOW.getTime() + 14 * 86_400_000));
      expect(result.fact.confirmations).toBe(1);
      expect(result.fact.status).toBe('active');
    });

    it('clamps a long-term review below the 2-week floor up to 14 days', async () => {
      const userData = createTestUserData({ username: 'user_facts_remember_lt_user' });
      const user = await userRepo.create(userData);
      const NOW = new Date('2026-09-21T12:00:00Z');

      const result = await repository.rememberFact(
        user.id,
        { category: 'physical_constraint', fact: 'Broken wrist', durability: 'long_term', reviewInDays: 3, phaseNote: 'in a cast' },
        NOW,
      );

      if (result.outcome !== 'created') throw new Error('expected created');
      expect(result.fact.reviewAfter).toEqual(new Date(NOW.getTime() + 14 * 86_400_000));
      expect(result.fact.phaseNote).toBe('in a cast');
      expect(result.fact.phaseAt).toEqual(NOW);
    });

    it('refuses permanent without the gate (PermanentFactRefusal), allows it with explicitPermanent', async () => {
      const userData = createTestUserData({ username: 'user_facts_perm_user' });
      const user = await userRepo.create(userData);
      const NOW = new Date('2026-09-21T12:00:00Z');

      await expect(
        repository.rememberFact(user.id, { category: 'equipment', fact: 'Has a prosthesis', durability: 'permanent' }, NOW),
      ).rejects.toThrow(PermanentFactRefusal);

      const allowed = await repository.rememberFact(
        user.id,
        { category: 'equipment', fact: 'Has a prosthesis', durability: 'permanent', explicitPermanent: true },
        NOW,
      );
      expect(allowed.outcome).toBe('created');
      if (allowed.outcome !== 'created') return;
      expect(allowed.fact.expiresAt).toBeNull();
      expect(allowed.fact.reviewAfter).toBeNull();
    });

    it('an existing ACTIVE fact with the same key is UPDATED in place: text rewritten, confirmations bumped', async () => {
      const userData = createTestUserData({ username: 'user_facts_update_user' });
      const user = await userRepo.create(userData);
      const NOW = new Date('2026-09-21T12:00:00Z');

      const first = await repository.rememberFact(user.id, { category: 'equipment', fact: 'Has dumbbells up to 12kg', durability: 'short', ttlDays: 7 }, NOW);
      if (first.outcome !== 'created') throw new Error('expected created');

      // A correction: DIFFERENT text (a new factKey), referenced by id.
      const updated = await repository.rememberFact(
        user.id,
        { category: 'equipment', fact: 'Has dumbbells up to 20kg', durability: 'short', ttlDays: 7, factId: first.fact.id },
        new Date(NOW.getTime() + 86_400_000),
      );

      expect(updated.outcome).toBe('updated');
      if (updated.outcome !== 'updated') return;
      expect(updated.fact.fact).toBe('Has dumbbells up to 20kg'); // a correction REWRITES the text (unlike compaction)
      expect(updated.fact.confirmations).toBe(2);
      expect(updated.fact.status).toBe('active');

      const rows = await repository.getForPrompt(user.id, NOW);
      expect(rows.filter(r => r.factKey === 'has dumbbells up to 20kg')).toHaveLength(1); // one row, not two

      // A repeat with NO id and the same wording dedupes on the unique key — an update, not a duplicate.
      const repeat = await repository.rememberFact(user.id, { category: 'equipment', fact: 'Has dumbbells up to 20kg', durability: 'short', ttlDays: 7 }, NOW);
      expect(repeat.outcome).toBe('updated');
      if (repeat.outcome !== 'updated') return;
      expect(repeat.fact.confirmations).toBe(3);
      expect((await repository.listFacts(user.id, false, NOW)).active).toHaveLength(1);
    });

    it('AC-FL-3: a user-closed key is NOT re-created from older evidence; newer evidence creates a NEW linked row and the closure stays intact', async () => {
      const userData = createTestUserData({ username: 'user_facts_closed_key_user' });
      const user = await userRepo.create(userData);
      const T0 = new Date('2026-09-21T09:00:00Z'); // the statement was made
      const T1 = new Date('2026-09-21T18:00:00Z'); // the user closed the fact
      const T2 = new Date('2026-09-21T20:00:00Z'); // this run's clock (always > T1)
      const T3 = new Date('2026-09-21T19:00:00Z'); // a genuinely newer statement

      await repository.rememberFact(user.id, { category: 'physical_constraint', fact: 'Shoulder hurts', durability: 'short', ttlDays: 7 }, T0);
      const closedId = (await repository.getForPrompt(user.id, T0))[0]!.id;
      const closed = await repository.retractFact(user.id, { factId: closedId }, T1);
      expect(closed).toMatchObject({ status: 'archived', archivedReason: 'user_closed', closedByUserAt: T1 });

      // FINDING 2 pin — cannot pass by accident: the RUN clock is well past the
      // closure, but the EVIDENCE predates it (a summariser replaying an old
      // turn). The comparison must use evidenceAt, not now.
      const stale = await repository.rememberFact(
        user.id,
        { category: 'physical_constraint', fact: 'Shoulder hurts', durability: 'short', ttlDays: 7, evidenceAt: T0 },
        T2,
      );
      expect(stale.outcome).toBe('skipped_stale_evidence');
      // Nothing was written: the closed row is untouched.
      const afterStale = await repository.listFacts(user.id, true, T2);
      expect(afterStale.active).toEqual([]);
      expect(afterStale.archived.map(f => f.id)).toEqual([closedId]);

      // FINDING 1 pin: evidence NEWER than the closure creates a NEW active row
      // linked via supersedes_id — the closed row is never un-archived.
      const fresh = await repository.rememberFact(
        user.id,
        { category: 'physical_constraint', fact: 'Shoulder hurts', durability: 'short', ttlDays: 7, evidenceAt: T3 },
        T2,
      );
      expect(fresh.outcome).toBe('created');
      if (fresh.outcome !== 'created') return;
      expect(fresh.fact.id).not.toBe(closedId); // a NEW row
      expect(fresh.fact.supersedesId).toBe(closedId); // linked to the closed one
      expect(fresh.fact.status).toBe('active');
      expect(fresh.fact.createdAt).toEqual(T2); // date arithmetic keeps the RUN clock
      expect(fresh.fact.expiresAt).toEqual(new Date(T2.getTime() + 7 * 86_400_000));

      // The closure evidence survives for wave B's recurrence promotion.
      const afterFresh = await repository.listFacts(user.id, true, T2);
      expect(afterFresh.active.map(f => f.id)).toEqual([fresh.fact.id]);
      const stillClosed = afterFresh.archived.find(f => f.id === closedId);
      expect(stillClosed).toMatchObject({ status: 'archived', archivedReason: 'user_closed', closedByUserAt: T1 });
    });

    it('AC-FL-3: without evidenceAt, the evidence defaults to the run clock — a live conversation is always newer than the closure', async () => {
      const userData = createTestUserData({ username: 'user_facts_default_evidence_user' });
      const user = await userRepo.create(userData);
      const T0 = new Date('2026-09-21T12:00:00Z');
      const T1 = new Date('2026-09-21T18:00:00Z');
      const T2 = new Date('2026-09-21T20:00:00Z');

      await repository.rememberFact(user.id, { category: 'equipment', fact: 'Borrowed a barbell', durability: 'short', ttlDays: 5 }, T0);
      const closedId = (await repository.getForPrompt(user.id, T0))[0]!.id;
      await repository.retractFact(user.id, { factId: closedId }, T1);

      const again = await repository.rememberFact(user.id, { category: 'equipment', fact: 'Borrowed a barbell', durability: 'short', ttlDays: 5 }, T2);
      expect(again.outcome).toBe('created');
      if (again.outcome !== 'created') return;
      expect(again.fact.supersedesId).toBe(closedId);
    });

    it('the summariser upsert still dedupes against ACTIVE rows (partial unique index)', async () => {
      const userData = createTestUserData({ username: 'user_facts_partial_idx_user' });
      const user = await userRepo.create(userData);
      const NOW = new Date('2026-09-21T12:00:00Z');

      await repository.upsertMany(user.id, [{ category: 'equipment', fact: 'Has a barbell.' }]);
      await repository.upsertMany(user.id, [{ category: 'equipment', fact: 'has a barbell' }]);

      const rows = await repository.getForPrompt(user.id, NOW);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.confirmations).toBe(2);
    });

    it('links a genuinely new statement to the closed fact via supersedesFactId', async () => {
      const userData = createTestUserData({ username: 'user_facts_supersede_user' });
      const user = await userRepo.create(userData);
      const T0 = new Date('2026-09-21T12:00:00Z');

      await repository.rememberFact(user.id, { category: 'physical_constraint', fact: 'Right shoulder injured', durability: 'short', ttlDays: 7 }, T0);
      const closedId = (await repository.getForPrompt(user.id, T0))[0]!.id;
      await repository.retractFact(user.id, { factId: closedId }, new Date(T0.getTime() + 3_600_000));

      const replaced = await repository.rememberFact(
        user.id,
        { category: 'physical_constraint', fact: 'Left shoulder injured after the fall', durability: 'long_term', reviewInDays: 30, supersedesFactId: closedId },
        new Date(T0.getTime() + 7_200_000),
      );

      expect(replaced.outcome).toBe('created');
      if (replaced.outcome !== 'created') return;
      expect(replaced.fact.supersedesId).toBe(closedId);
      expect(replaced.fact.id).not.toBe(closedId); // a NEW row — the closed one keeps its history
    });
  });

  describe('retractFact / deleteFact (AC-FL-2: two distinct operations, never swapped)', () => {
    it('retract archives and KEEPS the row, the history and the counter; never deletes', async () => {
      const userData = createTestUserData({ username: 'user_facts_retract_user' });
      const user = await userRepo.create(userData);
      const NOW = new Date('2026-09-21T12:00:00Z');

      const created = await repository.rememberFact(user.id, { category: 'exercise_dislike', fact: 'Hates burpees', durability: 'short', ttlDays: 5 }, NOW);
      if (created.outcome !== 'created') throw new Error('expected created');

      const retracted = await repository.retractFact(user.id, { factId: created.fact.id }, NOW);

      expect(retracted).toMatchObject({ status: 'archived', archivedReason: 'user_closed', closedByUserAt: NOW, confirmations: 1 });
      // The row is still there — invisible to the prompt, visible to a listing with archived.
      await expect(repository.getForPrompt(user.id, NOW)).resolves.toHaveLength(0);
      const listed = await repository.listFacts(user.id, true, NOW);
      expect(listed.archived.map(f => f.id)).toContain(created.fact.id);
    });

    it('retract is idempotent: an already-archived fact comes back unchanged', async () => {
      const userData = createTestUserData({ username: 'user_facts_retract_idem_user' });
      const user = await userRepo.create(userData);
      const NOW = new Date('2026-09-21T12:00:00Z');

      const created = await repository.rememberFact(user.id, { category: 'equipment', fact: 'Borrowed a barbell', durability: 'short', ttlDays: 5 }, NOW);
      if (created.outcome !== 'created') throw new Error('expected created');
      await repository.retractFact(user.id, { factId: created.fact.id }, NOW);
      const again = await repository.retractFact(user.id, { factId: created.fact.id }, new Date(NOW.getTime() + 3_600_000));

      expect(again).toMatchObject({ status: 'archived' });
      expect(again?.archivedAt).toEqual(NOW); // the first closure is kept, not re-stamped
    });

    it('retract of an unknown id returns null; delete of an unknown id returns false', async () => {
      const userData = createTestUserData({ username: 'user_facts_missing_user' });
      const user = await userRepo.create(userData);

      await expect(repository.retractFact(user.id, { factId: '00000000-0000-0000-0000-0000000000aa' }, new Date())).resolves.toBeNull();
      await expect(repository.deleteFact(user.id, '00000000-0000-0000-0000-0000000000ab')).resolves.toBe(false);
    });

    it('delete removes the row ENTIRELY — no trace, not even in the archived listing', async () => {
      const userData = createTestUserData({ username: 'user_facts_delete_user' });
      const user = await userRepo.create(userData);
      const NOW = new Date('2026-09-21T12:00:00Z');

      const created = await repository.rememberFact(user.id, { category: 'nutrition_preference', fact: 'Allergic to shrimp', durability: 'permanent', explicitPermanent: true }, NOW);
      if (created.outcome !== 'created') throw new Error('expected created');

      await expect(repository.deleteFact(user.id, created.fact.id)).resolves.toBe(true);
      await expect(repository.getForPrompt(user.id, NOW)).resolves.toHaveLength(0);
      const listed = await repository.listFacts(user.id, true, NOW);
      expect(listed.active).toHaveLength(0);
      expect(listed.archived).toHaveLength(0); // gone, not archived
      await expect(repository.deleteFact(user.id, created.fact.id)).resolves.toBe(false);
    });
  });

  describe('listFacts (AC-FL-8: the review listing)', () => {
    it('returns active facts (expired excluded) and archived only when asked, with the closure reason', async () => {
      const userData = createTestUserData({ username: 'user_facts_list_user' });
      const user = await userRepo.create(userData);
      const NOW = new Date('2026-09-21T12:00:00Z');

      const live = await repository.rememberFact(user.id, { category: 'equipment', fact: 'Has a barbell', durability: 'permanent', explicitPermanent: true }, NOW);
      await repository.rememberFact(user.id, { category: 'physiological_pattern', fact: 'Sore legs', durability: 'short', ttlDays: 1 }, new Date(NOW.getTime() - 3 * 86_400_000)); // expired by NOW
      const closed = live.outcome === 'created' ? live.fact : null;
      if (!closed) throw new Error('expected created');
      await repository.retractFact(user.id, { factId: closed.id }, NOW);

      const activeOnly = await repository.listFacts(user.id, false, NOW);
      expect(activeOnly.active.map(f => f.id)).toEqual([]); // the expired short fact is out, the closed one is out
      expect(activeOnly.archived).toEqual([]);

      const withArchived = await repository.listFacts(user.id, true, NOW);
      expect(withArchived.active).toEqual([]);
      expect(withArchived.archived.map(f => f.id)).toEqual([closed.id]);
      expect(withArchived.archived[0]).toMatchObject({ archivedReason: 'user_closed' });
    });
  });
});
