/**
 * Regression tests for the 2026-09-21 review findings AC-RRP-1 and AC-RRP-3
 * (docs/superpowers/plans/review-regression-proof.md) — promoted from
 * review-training.repro.test.ts once the fixes landed.
 *
 * AC-RRP-1: logging by exerciseName resolves to the catalog id first and shares
 * the exerciseId path — one session_exercises row per exercise, set numbers
 * 1..n, previous exercise auto-completed on a switch.
 * AC-RRP-3 (INV-TRAINING-002): beginSession refuses a second in_progress session
 * for one user, and the partial unique index makes that hold under a race.
 *
 * Real fitcoach_test DB, real repositories, real TrainingService; nothing is mocked.
 */
import { inArray } from 'drizzle-orm';

import { ActiveSessionExistsError } from '@domain/training/errors';
import { TrainingService } from '@domain/training/services/training.service';

import { db } from '@infra/db/drizzle';
import { DrizzleUserRepository } from '@infra/db/repositories/user.repository';
import { WorkoutSessionRepository } from '@infra/db/repositories/workout-session.repository';
import { users } from '@infra/db/schema';

import { buildRealTrainingService } from '../../helpers/training-service';
import { createTestUserData } from '../../shared/test-factories';

const BENCH = 'Barbell Bench Press';
const SQUAT = 'Barbell Back Squat';

describe('training persistence — exerciseName logging and one active session (AC-RRP-1, AC-RRP-3)', () => {
  let service: TrainingService;
  let userRepo: DrizzleUserRepository;
  let sessionRepo: WorkoutSessionRepository;
  let benchId: string;
  const createdUserIds: string[] = [];

  beforeAll(async () => {
    const wiring = buildRealTrainingService();
    ({ service, userRepo, sessionRepo } = wiring);

    const all = await wiring.exerciseRepo.findAll();
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

    it('a name that matches no catalog exercise is rejected and creates no session exercise', async () => {
      const userId = await newUser('name_unknown');
      const session = await service.startSession(userId, {});

      await expect(
        service.logSetWithContext(session.id, { exerciseName: 'Zzzz Not A Real Exercise', setData: strength(10) }),
      ).rejects.toThrow(/not found in DB/);

      const details = await service.getSessionDetails(session.id);
      expect(details!.exercises).toHaveLength(0);
    });

    it('a name and its catalog id are the same exercise: mixing them adds sets to ONE row', async () => {
      const userId = await newUser('name_then_id');
      const session = await service.startSession(userId, {});

      await service.logSetWithContext(session.id, { exerciseName: BENCH, setData: strength(10) });
      await service.logSetWithContext(session.id, { exerciseId: benchId, setData: strength(8) });

      const details = await service.getSessionDetails(session.id);
      expect(details!.exercises).toHaveLength(1);
      expect(details!.exercises[0].sets.map(s => s.setNumber)).toEqual([1, 2]);
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
      let refusal: unknown;
      await service.beginSession(b.id).catch((err: unknown) => {
        secondBegin = 'refused';
        refusal = err;
      });

      const rows = await sessionRepo.findRecentByUserId(userId, 10);
      const inProgress = rows.filter(r => r.status === 'in_progress');
      expect({ secondBegin, inProgress: inProgress.length }).toEqual({ secondBegin: 'refused', inProgress: 1 });
      expect(refusal).toBeInstanceOf(ActiveSessionExistsError);
    });

    it('startSession and beginSession refuse with the very same domain error', async () => {
      const userId = await newUser('same_refusal');
      await service.startSession(userId, {}); // in_progress
      const planning = await service.startSession(userId, { status: 'planning' });

      const fromStart = await service.startSession(userId, {}).catch((err: unknown) => err);
      const fromBegin = await service.beginSession(planning.id).catch((err: unknown) => err);

      expect(fromStart).toBeInstanceOf(ActiveSessionExistsError);
      expect(fromBegin).toBeInstanceOf(ActiveSessionExistsError);
      expect((fromBegin as Error).message).toBe((fromStart as Error).message);
    });

    it('two beginSession calls racing for the same user: exactly one wins, one in_progress row remains', async () => {
      const userId = await newUser('race_begin');
      const a = await service.startSession(userId, { status: 'planning' });
      const b = await service.startSession(userId, { status: 'planning' });

      const outcomes = await Promise.allSettled([service.beginSession(a.id), service.beginSession(b.id)]);

      const rows = await sessionRepo.findRecentByUserId(userId, 10);
      expect(outcomes.filter(o => o.status === 'fulfilled')).toHaveLength(1);
      const rejected = outcomes.filter((o): o is PromiseRejectedResult => o.status === 'rejected');
      expect(rejected).toHaveLength(1);
      // Whichever way the loser lost (readable check or the index), it is the domain error — never a driver error.
      expect(rejected[0].reason).toBeInstanceOf(ActiveSessionExistsError);
      expect(rows.filter(r => r.status === 'in_progress')).toHaveLength(1);
      expect(rows.filter(r => r.status === 'planning')).toHaveLength(1);
    });

    it('the race loser — past the readable check, refused by the index — gets the same domain error, never a driver error', async () => {
      const userId = await newUser('loser_path');
      const a = await service.startSession(userId, { status: 'planning' });
      const b = await service.startSession(userId, { status: 'planning' });
      // Both callers read "no active session" before either wrote: the check is blind, only the index can refuse.
      const blindRepo = Object.assign(Object.create(sessionRepo) as WorkoutSessionRepository, {
        findActiveByUserId: async () => null,
      });
      const { service: blindService } = buildRealTrainingService({ sessionRepo: blindRepo });
      await blindService.beginSession(a.id);

      const loser = await blindService.beginSession(b.id).catch((err: unknown) => err);

      expect(loser).toBeInstanceOf(ActiveSessionExistsError);
      expect((loser as Error).name).not.toMatch(/Drizzle|Database/);
      const rows = await sessionRepo.findRecentByUserId(userId, 10);
      expect(rows.filter(r => r.status === 'in_progress')).toHaveLength(1);
    });

    it('the database itself refuses a second in_progress row, bypassing the service — as the domain error', async () => {
      const userId = await newUser('db_index');
      const a = await service.startSession(userId, { status: 'planning' });
      const b = await service.startSession(userId, { status: 'planning' });
      await sessionRepo.update(a.id, { status: 'in_progress', startedAt: new Date() });

      // The lifecycle handler writes through the repository, not the service — the index must still hold.
      await expect(sessionRepo.update(b.id, { status: 'in_progress', startedAt: new Date() })).rejects.toBeInstanceOf(
        ActiveSessionExistsError,
      );
    });
  });
});
