/**
 * reopenLastSession over the real database (BUG-053, stale-session-autoclose plan T2 /
 * AC-SSA-2): the migration's `reopened_at` column round-trips, the service returns the most
 * recent completed session to training (completion fields cleared, `reopened_at` stamped,
 * `last_activity_at` untouched), the typed refusals fire, and the repo's timeout auto-close
 * measures idleness from `max(last_activity_at, reopened_at)` — a just-reopened workout is NOT
 * closed at the next sweep, the same session with an old reopening is.
 */
import { eq } from 'drizzle-orm';

import { ActiveSessionExistsError, NoCompletedSessionError } from '@domain/training/errors';

import { db } from '@infra/db/drizzle';
import { workoutSessions } from '@infra/db/schema';

import { buildRealTrainingService } from '../../helpers/training-service';
import { createTestUserData } from '../../shared/test-factories';

const HOUR = 60 * 60 * 1000;

describe('reopenLastSession (BUG-053 T2, AC-SSA-2) — integration', () => {
  const { service, userRepo } = buildRealTrainingService();

  /** A user with one completed workout whose last activity is `activityAgoMs` before now. */
  const userWithCompletedWorkout = async (activityAgoMs: number, label: string) => {
    const user = await userRepo.create(createTestUserData({ username: `reopen_${label}_${Date.now()}` }));
    const session = await service.startSession(user.id, {});
    const at = new Date(Date.now() - activityAgoMs);
    await db
      .update(workoutSessions)
      .set({ status: 'in_progress', startedAt: at, lastActivityAt: at, createdAt: at, updatedAt: at })
      .where(eq(workoutSessions.id, session.id));
    await service.completeSession(session.id);
    return { userId: user.id, sessionId: session.id };
  };

  it('reopens the most recent completed session: reopened_at round-trips, completion fields clear, last_activity_at stays', async () => {
    const { userId, sessionId } = await userWithCompletedWorkout(3 * HOUR, 'happy');
    const before = (await db.select().from(workoutSessions).where(eq(workoutSessions.id, sessionId)))[0]!;
    expect(before.status).toBe('completed');
    expect(before.reopenedAt).toBeNull();

    const reopened = await service.reopenLastSession(userId);

    expect(reopened.id).toBe(sessionId);
    expect(reopened.status).toBe('in_progress');
    expect(reopened.completedAt).toBeNull();
    expect(reopened.autoCloseReason).toBeNull();
    expect(reopened.reopenedAt).not.toBeNull();
    // The reopen is dated now; the last activity is still the pre-close moment (BR-TRAINING-030).
    expect(Date.now() - reopened.reopenedAt!.getTime()).toBeLessThan(HOUR);
    expect(reopened.lastActivityAt.getTime()).toBe(before.lastActivityAt.getTime());
  });

  it('refuses (typed) when another session is active', async () => {
    const { userId, sessionId } = await userWithCompletedWorkout(3 * HOUR, 'refuse_active');
    // A second, fresh in_progress session blocks the reopen.
    const second = await service.startSession(userId, {});
    await db
      .update(workoutSessions)
      .set({ status: 'in_progress', startedAt: new Date() })
      .where(eq(workoutSessions.id, second.id));

    await expect(service.reopenLastSession(userId)).rejects.toBeInstanceOf(ActiveSessionExistsError);

    await db.delete(workoutSessions).where(eq(workoutSessions.id, second.id));
    expect((await db.select().from(workoutSessions).where(eq(workoutSessions.id, sessionId)))[0]!.status).toBe(
      'completed',
    );
  });

  it('refuses (typed) when there is no completed session', async () => {
    const user = await userRepo.create(createTestUserData({ username: `reopen_none_${Date.now()}` }));

    await expect(service.reopenLastSession(user.id)).rejects.toBeInstanceOf(NoCompletedSessionError);
  });

  it('the timeout sweep keeps a just-reopened workout open (idle base = max(last_activity_at, reopened_at))', async () => {
    // Completed 3 h ago; a reopen NOW must make it fresh for the sweep.
    const { userId, sessionId } = await userWithCompletedWorkout(3 * HOUR, 'fresh_reopen');
    await service.reopenLastSession(userId);

    await service.autoCloseTimedOutSessions(userId);

    const afterSweep = (await db.select().from(workoutSessions).where(eq(workoutSessions.id, sessionId)))[0]!;
    expect(afterSweep.status).toBe('in_progress'); // NOT auto-closed: idle from the reopening

    // The same session with an OLD reopening (pre-T2 shape) is closed, dated to the last activity.
    await db
      .update(workoutSessions)
      .set({ reopenedAt: new Date(Date.now() - 3 * HOUR) })
      .where(eq(workoutSessions.id, sessionId));
    await service.autoCloseTimedOutSessions(userId);

    const closed = (await db.select().from(workoutSessions).where(eq(workoutSessions.id, sessionId)))[0]!;
    expect(closed.status).toBe('completed');
    expect(closed.autoCloseReason).toBe('timeout');
    expect(closed.completedAt!.getTime()).toBe(closed.lastActivityAt.getTime());
  });

  it('reopenLastSession reopens the NEWEST completed session when several exist', async () => {
    const user = await userRepo.create(createTestUserData({ username: `reopen_latest_${Date.now()}` }));
    const older = await service.startSession(user.id, {});
    const oldAt = new Date(Date.now() - 5 * HOUR);
    await db
      .update(workoutSessions)
      .set({ status: 'in_progress', startedAt: oldAt, lastActivityAt: oldAt, createdAt: oldAt, updatedAt: oldAt })
      .where(eq(workoutSessions.id, older.id));
    await service.completeSession(older.id);
    // Both completions stamp completed_at = now — backdate the older one so "newest" is unambiguous.
    await db
      .update(workoutSessions)
      .set({ completedAt: new Date(Date.now() - 4 * HOUR) })
      .where(eq(workoutSessions.id, older.id));

    await userWithCompletedWorkoutFor(user.id, 1 * HOUR);

    const reopened = await service.reopenLastSession(user.id);
    expect(reopened.id).not.toBe(older.id); // the newer completion wins
  });

  /** Same as userWithCompletedWorkout but for an existing user (the second session of the pair). */
  const userWithCompletedWorkoutFor = async (userId: string, activityAgoMs: number) => {
    const session = await service.startSession(userId, {});
    const at = new Date(Date.now() - activityAgoMs);
    await db
      .update(workoutSessions)
      .set({ status: 'in_progress', startedAt: at, lastActivityAt: at, createdAt: at, updatedAt: at })
      .where(eq(workoutSessions.id, session.id));
    await service.completeSession(session.id);
    return { sessionId: session.id };
  };
});
