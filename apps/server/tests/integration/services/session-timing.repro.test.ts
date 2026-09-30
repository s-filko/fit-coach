/**
 * retro-timestamps plan, T2 (BUG-043) — AC-RT-1a, AC-RT-2 over the real test DB and the real
 * TrainingService. Home test at promotion (T3): `training.service.integration.test.ts`.
 * Requires: RUN_DB_TESTS=1
 */
import { eq } from 'drizzle-orm';

import { db } from '@infra/db/drizzle';
import { workoutSessions } from '@infra/db/schema';

import { buildRealTrainingService } from '../../helpers/training-service';
import { createTestUserData } from '../../shared/test-factories';

const HOUR = 60 * 60 * 1000;

describe('session timing — integration (BUG-043)', () => {
  const { service, userRepo, exerciseRepo } = buildRealTrainingService();
  let benchPressId: string;

  beforeAll(async () => {
    const bench = (await exerciseRepo.findAll()).find(e => e.name === 'Barbell Bench Press');
    if (!bench) {
      throw new Error('Seed exercise "Barbell Bench Press" not found');
    }
    benchPressId = bench.id;
  });

  /** A started session whose row stamps are pinned by hand (the DB default clock cannot be steered). */
  async function startedSession(label: string, stamps: { startedAt: Date; lastActivityAt: Date }) {
    const user = await userRepo.create(createTestUserData({ username: `st_int_${label}_${Date.now()}` }));
    const session = await service.startSession(user.id, {});
    await db.update(workoutSessions).set(stamps).where(eq(workoutSessions.id, session.id));
    return { userId: user.id, sessionId: session.id };
  }

  async function rowOf(sessionId: string) {
    const [row] = await db.select().from(workoutSessions).where(eq(workoutSessions.id, sessionId));
    return row!;
  }

  it('AC-RT-2: completeSession with a completedAt before startedAt stores completed_at >= started_at', async () => {
    const startedAt = new Date(Date.now() - 3 * HOUR);
    const { sessionId } = await startedSession('complete', {
      startedAt,
      lastActivityAt: new Date(startedAt.getTime() - 77),
    });

    // What finish_training passes for a stale session: completedAt = lastActivityAt (77 ms before startedAt).
    await service.completeSession(sessionId, undefined, new Date(startedAt.getTime() - 77));

    const row = await rowOf(sessionId);
    expect(row.completedAt!.getTime()).toBeGreaterThanOrEqual(row.startedAt!.getTime());
  });

  it('AC-RT-2: auto-close of a timed-out session whose last_activity_at precedes started_at stores completed_at >= started_at', async () => {
    const startedAt = new Date(Date.now() - 3 * HOUR);
    const { userId, sessionId } = await startedSession('autoclose', {
      startedAt,
      lastActivityAt: new Date(startedAt.getTime() - 77),
    });

    // startSession(planning) runs autoCloseTimedOutSessions for this user.
    await service.startSession(userId, { status: 'planning' });

    const row = await rowOf(sessionId);
    expect(row.status).toBe('completed');
    expect(row.completedAt!.getTime()).toBeGreaterThanOrEqual(row.startedAt!.getTime());
  });

  it('AC-RT-2: completeSession with a completedAt before startedAt stores duration >= 0 (not -1)', async () => {
    const startedAt = new Date(Date.now() - 3 * HOUR);
    const { sessionId } = await startedSession('duration', {
      startedAt,
      lastActivityAt: new Date(startedAt.getTime() - 77),
    });

    await service.completeSession(sessionId, undefined, new Date(startedAt.getTime() - 77));

    expect((await rowOf(sessionId)).durationMinutes).toBeGreaterThanOrEqual(0);
  });

  it('AC-RT-2: auto-close of a timed-out session whose last_activity_at precedes started_at stores duration >= 0 (not -1)', async () => {
    const startedAt = new Date(Date.now() - 3 * HOUR);
    const { userId, sessionId } = await startedSession('autoclose_dur', {
      startedAt,
      lastActivityAt: new Date(startedAt.getTime() - 77),
    });

    await service.startSession(userId, { status: 'planning' });

    expect((await rowOf(sessionId)).durationMinutes).toBeGreaterThanOrEqual(0);
  });

  describe('AC-RT-1a: first set of a session with NO sets idle > 2 h is a live set', () => {
    it('re-anchors started_at to the first set (the workout began now, not at plan acceptance)', async () => {
      const stale = new Date(Date.now() - 3 * HOUR);
      const { sessionId } = await startedSession('anchor', { startedAt: stale, lastActivityAt: stale });
      const before = Date.now();

      await service.logSetWithContext(sessionId, {
        exerciseId: benchPressId,
        setData: { type: 'strength', reps: 10, weight: 80, weightUnit: 'kg' },
      });

      const row = await rowOf(sessionId);
      expect(row.startedAt!.getTime()).toBeGreaterThanOrEqual(before - 1000);
    });

    it('control (green on unchanged production): a live set advances last_activity_at', async () => {
      const stale = new Date(Date.now() - 3 * HOUR);
      const { sessionId } = await startedSession('activity', { startedAt: stale, lastActivityAt: stale });
      const before = Date.now();

      await service.logSetWithContext(sessionId, {
        exerciseId: benchPressId,
        setData: { type: 'strength', reps: 10, weight: 80, weightUnit: 'kg' },
      });

      expect((await rowOf(sessionId)).lastActivityAt.getTime()).toBeGreaterThanOrEqual(before - 1000);
    });
  });
});
