/**
 * Review regression proof — Task 1 (docs/superpowers/plans/review-regression-proof.md).
 *
 * REPRODUCTIONS on UNCHANGED production code: AC-RRP-1 (exerciseName logging
 * fragments one exercise into many rows) and AC-RRP-3 (two planning sessions
 * can both be begun for one user). Real fitcoach_test DB, real repositories,
 * real TrainingService; nothing is mocked. The failing tests below are
 * intentionally RED until the remediation plan fixes the behavior — they are
 * not skipped, not test.failing and not inverted. Positive controls (by-ID
 * logging, a single begin) pass and prove the harness itself is sound.
 *
 * File name is *.repro.test.ts on purpose: outside every default suite, run
 * explicitly:
 *   RUN_DB_TESTS=1 NODE_ENV=test npx jest --runInBand --testMatch='**\/review-training.repro.test.ts'
 * When a fix lands the file is promoted to *.integration.test.ts.
 */
import { inArray } from 'drizzle-orm';

import { TrainingService } from '@domain/training/services/training.service';

import { db } from '@infra/db/drizzle';
import { ExerciseRepository } from '@infra/db/repositories/exercise.repository';
import { SessionExerciseRepository } from '@infra/db/repositories/session-exercise.repository';
import { SessionSetRepository } from '@infra/db/repositories/session-set.repository';
import { DrizzleUserRepository } from '@infra/db/repositories/user.repository';
import { WorkoutPlanRepository } from '@infra/db/repositories/workout-plan.repository';
import { WorkoutSessionRepository } from '@infra/db/repositories/workout-session.repository';
import { users } from '@infra/db/schema';

import { createTestUserData } from '../../shared/test-factories';

const BENCH = 'Barbell Bench Press';
const SQUAT = 'Barbell Back Squat';

describe('review repro — training persistence (AC-RRP-1, AC-RRP-3)', () => {
  let service: TrainingService;
  let userRepo: DrizzleUserRepository;
  let sessionRepo: WorkoutSessionRepository;
  let benchId: string;
  const createdUserIds: string[] = [];

  beforeAll(async () => {
    const exerciseRepo = new ExerciseRepository();
    userRepo = new DrizzleUserRepository();
    sessionRepo = new WorkoutSessionRepository();
    service = new TrainingService(
      new WorkoutPlanRepository(),
      sessionRepo,
      exerciseRepo,
      new SessionExerciseRepository(),
      new SessionSetRepository(),
      userRepo,
    );

    const all = await exerciseRepo.findAll();
    const bench = all.find(e => e.name === BENCH);
    if (!bench || !all.some(e => e.name === SQUAT)) {
      throw new Error('Seed exercises missing — fixture problem, not a reproduction');
    }
    benchId = bench.id;
  });

  // Users cascade to their sessions/exercises/sets; only rows this file created are removed.
  afterEach(async () => {
    if (createdUserIds.length > 0) {
      await db.delete(users).where(inArray(users.id, createdUserIds.splice(0)));
    }
  });

  const newUser = async (label: string) => {
    const user = await userRepo.create(createTestUserData({ username: `rrp_${label}_${Date.now()}` }));
    createdUserIds.push(user.id);
    return user.id;
  };

  const strength = (reps: number) => ({ type: 'strength' as const, reps, weight: 80, weightUnit: 'kg' as const });

  describe('AC-RRP-1 — logging by exerciseName', () => {
    it('control: two sets by exerciseId share ONE session exercise, set numbers [1,2]', async () => {
      const userId = await newUser('id_control');
      const session = await service.startSession(userId, {});

      await service.logSetWithContext(session.id, { exerciseId: benchId, setData: strength(10) });
      await service.logSetWithContext(session.id, { exerciseId: benchId, setData: strength(8) });

      const details = await service.getSessionDetails(session.id);
      expect(details!.exercises).toHaveLength(1);
      expect(details!.exercises[0].sets.map(s => s.setNumber)).toEqual([1, 2]);
    });

    it('two sets with the same exerciseName yield ONE session exercise, set numbers [1,2]', async () => {
      const userId = await newUser('name_twice');
      const session = await service.startSession(userId, {});

      await service.logSetWithContext(session.id, { exerciseName: BENCH, setData: strength(10) });
      await service.logSetWithContext(session.id, { exerciseName: BENCH, setData: strength(8) });

      const details = await service.getSessionDetails(session.id);
      expect(details!.exercises).toHaveLength(1);
      expect(details!.exercises[0].sets.map(s => s.setNumber)).toEqual([1, 2]);
      expect(details!.exercises.filter(e => e.status === 'in_progress')).toHaveLength(1);
    });

    it('switching to another exercise by name completes the previous one; exactly one stays in_progress', async () => {
      const userId = await newUser('name_switch');
      const session = await service.startSession(userId, {});

      await service.logSetWithContext(session.id, { exerciseName: BENCH, setData: strength(10) });
      await service.logSetWithContext(session.id, { exerciseName: SQUAT, setData: strength(5) });

      const details = await service.getSessionDetails(session.id);
      const bench = details!.exercises.find(e => e.exercise.name === BENCH);
      expect(details!.exercises).toHaveLength(2);
      expect(bench!.status).toBe('completed');
      expect(details!.exercises.filter(e => e.status === 'in_progress')).toHaveLength(1);
    });
  });

  describe('AC-RRP-3 — one active session per user (INV-TRAINING-002)', () => {
    it('control: beginning a single planning session works', async () => {
      const userId = await newUser('begin_control');
      const a = await service.startSession(userId, { status: 'planning' });

      const begun = await service.beginSession(a.id);

      expect(begun.status).toBe('in_progress');
    });

    it('the second begin of two planning sessions is refused and at most one in_progress row remains', async () => {
      const userId = await newUser('two_begin');
      const a = await service.startSession(userId, { status: 'planning' });
      const b = await service.startSession(userId, { status: 'planning' });
      await service.beginSession(a.id);

      let secondBegin: 'refused' | 'accepted' = 'accepted';
      await service.beginSession(b.id).catch(() => {
        secondBegin = 'refused';
      });

      const rows = await sessionRepo.findRecentByUserId(userId, 10);
      const inProgress = rows.filter(r => r.status === 'in_progress');
      expect({ secondBegin, inProgress: inProgress.length }).toEqual({ secondBegin: 'refused', inProgress: 1 });
    });
  });
});
