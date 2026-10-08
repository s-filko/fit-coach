import { db } from '../../../src/infra/db/drizzle';
import { workoutPlans } from '../../../src/infra/db/schema';
import { WorkoutPlanRepository } from '../../../src/infra/db/repositories/workout-plan.repository';
import { DrizzleUserRepository } from '../../../src/infra/db/repositories/user.repository';
import { createTestUserData } from '../../shared/test-factories';

/**
 * WorkoutPlanRepository integration tests — one active plan per user
 * (AC-PTF-1, plan plan-and-tool-fixes T1, BR-TRAINING-046).
 */
describe('WorkoutPlanRepository – one active plan per user (AC-PTF-1)', () => {
  let repo: WorkoutPlanRepository;
  let userRepo: DrizzleUserRepository;

  const planJson = (label: string) => ({
    goal: `Goal ${label}`,
    trainingStyle: 'Upper-Lower',
    targetMuscleGroups: ['chest' as const, 'quads' as const],
    recoveryGuidelines: {
      majorMuscleGroups: { minRestDays: 2, maxRestDays: 4 },
      smallMuscleGroups: { minRestDays: 1, maxRestDays: 3 },
      highIntensity: { minRestDays: 3 },
      customRules: [],
    },
    sessionTemplates: [],
    progressionRules: ['Increase weight by 2.5kg when all sets completed'],
  });

  const makePlan = (label: string) => ({ name: `Plan ${label}`, planJson: planJson(label) });

  beforeAll(async () => {
    repo = new WorkoutPlanRepository();
    userRepo = new DrizzleUserRepository();
  });

  it('createActiveReplacingOthers archives the previous active plan and returns the new one', async () => {
    const user = await userRepo.create(createTestUserData());

    const first = await repo.createActiveReplacingOthers(user.id, makePlan('A'));
    const second = await repo.createActiveReplacingOthers(user.id, makePlan('B'));

    expect(second.name).toBe('Plan B');
    expect(second.status).toBe('active');
    expect(second.id).not.toBe(first.id);

    const active = await repo.findByUserId(user.id, 'active');
    expect(active).toHaveLength(1);
    expect(active[0].id).toBe(second.id);

    const archived = await repo.findByUserId(user.id, 'archived');
    expect(archived).toHaveLength(1);
    expect(archived[0].id).toBe(first.id);
  });

  it('createActiveReplacingOthers leaves another user’s active plan untouched', async () => {
    const userA = await userRepo.create(createTestUserData());
    const userB = await userRepo.create(createTestUserData());

    const planB = await repo.createActiveReplacingOthers(userB.id, makePlan('B'));
    await repo.createActiveReplacingOthers(userA.id, makePlan('A1'));
    await repo.createActiveReplacingOthers(userA.id, makePlan('A2'));

    const activeB = await repo.findActiveByUserId(userB.id);
    expect(activeB?.id).toBe(planB.id);
    expect(activeB?.status).toBe('active');

    const archivedB = await repo.findByUserId(userB.id, 'archived');
    expect(archivedB).toHaveLength(0);
  });

  it('findActiveByUserId returns the newest active row when several exist', async () => {
    const user = await userRepo.create(createTestUserData());

    // Inserted directly: rows predating BR-TRAINING-046 can hold several active plans.
    // Explicit createdAt values — Postgres now() is transaction-start time, so two
    // inserts in one statement would otherwise share a timestamp.
    await db.insert(workoutPlans).values([
      {
        userId: user.id,
        name: 'Older active',
        planJson: planJson('older'),
        status: 'active',
        createdAt: new Date('2026-10-01T10:00:00Z'),
        updatedAt: new Date('2026-10-01T10:00:00Z'),
      },
      {
        userId: user.id,
        name: 'Newer active',
        planJson: planJson('newer'),
        status: 'active',
        createdAt: new Date('2026-10-03T10:00:00Z'),
        updatedAt: new Date('2026-10-03T10:00:00Z'),
      },
    ]);

    const active = await repo.findActiveByUserId(user.id);
    expect(active?.name).toBe('Newer active');
  });
});
