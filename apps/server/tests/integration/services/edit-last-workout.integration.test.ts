/**
 * `edit_last_workout` over the real database (BUG-053, stale-session-autoclose plan T5 /
 * AC-SSA-5): the most recent FINISHED workout is edited in place — added sets carry the retro
 * timestamp (last activity + RETRO_SET_OFFSET_MS, BR-TRAINING-049), and the session stays
 * `completed` with `completed_at`, `duration_minutes` and `last_activity_at` unchanged; an
 * exercise not in the workout is added to it; update and delete address a numbered set.
 */
import type { RunnableConfig } from '@langchain/core/runnables';
import { eq } from 'drizzle-orm';

import { isToolReturnWithUpdate, type ToolReturn } from '@domain/conversation/tool-outcome';
import { RETRO_SET_OFFSET_MS } from '@domain/training/session-timing';

import { buildEditLastWorkoutTool } from '@infra/ai/tools/edit-last-workout.tool';
import { toToolMessage } from '@infra/ai/tools/outcome';
import { db } from '@infra/db/drizzle';
import { sessionExercises, workoutSessions } from '@infra/db/schema';

import { buildRealTrainingService } from '../../helpers/training-service';
import { createTestUserData } from '../../shared/test-factories';

const HOUR = 60 * 60 * 1000;

describe('edit_last_workout (BUG-053 T5, AC-SSA-5) — integration', () => {
  const { service, userRepo, exerciseRepo } = buildRealTrainingService();

  const exerciseId = async (name: string): Promise<string> => {
    const found = (await exerciseRepo.findAll()).find(e => e.name === name);
    if (!found) {
      throw new Error(`Seed exercise "${name}" not found — run with RUN_DB_TESTS=1`);
    }
    return found.id;
  };

  /** A user whose one workout ran 4 h ago (2 bench sets logged live), then finished. */
  const userWithFinishedWorkout = async (label: string) => {
    const user = await userRepo.create(createTestUserData({ username: `edit_last_${label}_${Date.now()}` }));
    const bench = await exerciseId('Barbell Bench Press');
    const session = await service.startSession(user.id, {});
    const start = new Date(Date.now() - 4 * HOUR);
    await db
      .update(workoutSessions)
      .set({ startedAt: start, lastActivityAt: start, createdAt: start, updatedAt: start })
      .where(eq(workoutSessions.id, session.id));
    for (const reps of [8, 8]) {
      await service.logSetWithContext(session.id, {
        exerciseId: bench,
        setData: { type: 'strength', reps, weight: 55, weightUnit: 'kg' },
      });
    }
    await service.completeSession(session.id);
    const row = async () => (await db.select().from(workoutSessions).where(eq(workoutSessions.id, session.id)))[0]!;
    return { userId: user.id, sessionId: session.id, bench, row, before: await row() };
  };

  const callTool = async (userId: string, input: Record<string, unknown>): Promise<string> => {
    const tool = buildEditLastWorkoutTool({ trainingService: service });
    const config: RunnableConfig = { configurable: { userId, thread_id: userId } };
    const result = (await tool.invoke(input, config)) as ToolReturn;
    return String(toToolMessage(isToolReturnWithUpdate(result) ? result.outcome : result, 'tc').content);
  };

  it('add: a retro-dated set lands in the finished workout; status, completed_at, duration and last_activity stay', async () => {
    const { userId, sessionId, bench, row, before } = await userWithFinishedWorkout('add');

    const text = await callTool(userId, { action: 'add', exerciseId: bench, reps: 6, weight: 55 });

    const after = await row();
    expect(after.status).toBe('completed');
    expect(after.completedAt!.getTime()).toBe(before.completedAt!.getTime());
    expect(after.durationMinutes).toBe(before.durationMinutes);
    expect(after.lastActivityAt.getTime()).toBe(before.lastActivityAt.getTime());
    const details = await service.getSessionDetails(sessionId);
    const sets = details!.exercises.find(e => e.exerciseId === bench)!.sets;
    expect(sets.map(s => s.setNumber)).toEqual([1, 2, 3]);
    expect(sets[2]!.createdAt.getTime()).toBe(before.lastActivityAt.getTime() + RETRO_SET_OFFSET_MS);
    expect(text).toContain('Set 3: 6 reps @ 55 kg');
  });

  it('add: an exercise not in the workout is added to it as a completed row', async () => {
    const { userId, sessionId, row, before } = await userWithFinishedWorkout('new_ex');
    const pullUps = await exerciseId('Pull-ups');

    await callTool(userId, { action: 'add', exerciseId: pullUps, reps: 8 });

    const details = await service.getSessionDetails(sessionId);
    const added = details!.exercises.find(e => e.exerciseId === pullUps)!;
    expect(added.status).toBe('completed');
    expect(added.sets).toHaveLength(1);
    // the pre-existing exercise's status is untouched
    expect(details!.exercises.find(e => e.exerciseId !== pullUps)!.status).not.toBe('in_progress');
    const after = await row();
    expect(after.status).toBe('completed');
    expect(after.lastActivityAt.getTime()).toBe(before.lastActivityAt.getTime());
  });

  it('update (default = last set) and update with a setNumber; delete a numbered set', async () => {
    const { userId, sessionId, bench } = await userWithFinishedWorkout('upd_del');

    await callTool(userId, { action: 'update', exerciseId: bench, reps: 10 });
    await callTool(userId, { action: 'update', exerciseId: bench, setNumber: 1, weight: 50 });
    const afterUpdates = (await service.getSessionDetails(sessionId))!.exercises.find(
      e => e.exerciseId === bench,
    )!.sets;
    expect(afterUpdates.map(s => s.setData)).toEqual([
      { type: 'strength', reps: 8, weight: 50, weightUnit: 'kg' },
      { type: 'strength', reps: 10, weight: 55, weightUnit: 'kg' },
    ]);

    await callTool(userId, { action: 'delete', exerciseId: bench, setNumber: 1 });
    const afterDelete = (await service.getSessionDetails(sessionId))!.exercises.find(e => e.exerciseId === bench)!.sets;
    expect(afterDelete.map(s => s.setNumber)).toEqual([2]);
  });

  it('with no finished workout the call is refused and nothing is written', async () => {
    const user = await userRepo.create(createTestUserData({ username: `edit_last_none_${Date.now()}` }));

    const text = await callTool(user.id, { action: 'add', exerciseId: await exerciseId('Pull-ups'), reps: 8 });

    expect(text).toContain('No finished workout');
  });

  it('targets the most recent finished workout only, even while a new one is in progress', async () => {
    const { userId, sessionId, bench } = await userWithFinishedWorkout('with_active');
    await service.startSession(userId, {});

    await callTool(userId, { action: 'add', exerciseId: bench, reps: 5, weight: 55 });

    const sets = (await service.getSessionDetails(sessionId))!.exercises.find(e => e.exerciseId === bench)!.sets;
    expect(sets).toHaveLength(3);
  });

  const statusOf = async (sessionId: string, exId: string) =>
    (await service.getSessionDetails(sessionId))!.exercises.find(e => e.exerciseId === exId)!.status;

  it('review R3: adding a set to a skipped row (finish reconciliation) makes it completed', async () => {
    const { userId, sessionId } = await userWithFinishedWorkout('skipped_row');
    const pullUps = await exerciseId('Pull-ups');
    const [row] = await db
      .insert(sessionExercises)
      .values({ sessionId, exerciseId: pullUps, orderIndex: 1, status: 'skipped' })
      .returning();
    expect(row!.status).toBe('skipped');

    await callTool(userId, { action: 'add', exerciseId: pullUps, reps: 8 });

    expect(await statusOf(sessionId, pullUps)).toBe('completed');
  });

  it('review R3: deleting the last set of an exercise in a finished workout makes its row skipped; other rows keep their status', async () => {
    const { userId, sessionId, bench } = await userWithFinishedWorkout('delete_last');
    const pullUps = await exerciseId('Pull-ups');
    await callTool(userId, { action: 'add', exerciseId: pullUps, reps: 8 });
    expect(await statusOf(sessionId, pullUps)).toBe('completed');

    await callTool(userId, { action: 'delete', exerciseId: pullUps, setNumber: 1 });

    expect(await statusOf(sessionId, pullUps)).toBe('skipped');
    expect(await statusOf(sessionId, bench)).toBe('completed');
    // a set still left on the row: the status stays
    await callTool(userId, { action: 'delete', exerciseId: bench, setNumber: 2 });
    expect(await statusOf(sessionId, bench)).toBe('completed');
  });

  it('review R3: findLastCompletedByUserId ignores a completed session without completed_at (NULLs sort first on DESC)', async () => {
    const { userId, sessionId } = await userWithFinishedWorkout('null_completed');
    const broken = await service.startSession(userId, {});
    await db
      .update(workoutSessions)
      .set({ status: 'completed', completedAt: null })
      .where(eq(workoutSessions.id, broken.id));

    const last = await service.getLastFinishedSession(userId);

    expect(last?.id).toBe(sessionId);
  });
});
