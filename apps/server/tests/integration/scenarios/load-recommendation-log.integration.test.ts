/**
 * load-plan plan Task 3 (AC-LP-4, D7 as amended by O1, A3–A5): over the real test DB, the first
 * WORKING set of an exercise in a session writes one `load_recommendations` row carrying the
 * rendered v1 LOAD PLAN entry (taken before the set is counted); warm-ups and later sets write
 * nothing; completing the exercise fills `outcome` + `completed_at`; with the flag off (no log
 * wired into the service) there is no row at all. Decision columns stay NULL until Task 2 (A3).
 */
import { eq } from 'drizzle-orm';

import { db } from '@infra/db/drizzle';
import { UserFactsRepository } from '@infra/db/repositories/user-facts.repository';
import { loadRecommendations, workoutSessions } from '@infra/db/schema';
import { buildLoadRecommendationLog } from '@infra/ai/load-facts/load-recommendation-log';

import { buildRealTrainingService } from '../../helpers/training-service';
import { createTestUserData } from '../../shared/test-factories';

/** 17:30 in Manila on 2026-09-29. */
const NOW = new Date('2026-09-29T09:30:00.000Z');
const TIMEZONE = 'Asia/Manila';
const RUN_ID = '7a1f0f64-5b1e-4b53-9c0e-5d3f4a1b2c3d';

describe('load_recommendations log (AC-LP-4)', () => {
  const base = buildRealTrainingService();
  const { userRepo, exerciseRepo, sessionRepo, sessionExerciseRepo, sessionSetRepo } = base;
  const logged = buildRealTrainingService({
    loadRecommendationLog: buildLoadRecommendationLog(
      { workoutSessionRepo: sessionRepo, exerciseRepository: exerciseRepo, userFacts: new UserFactsRepository() },
      { LOAD_PLAN_SUGGESTION: true },
    ),
  });
  let userId: string;
  let benchId: string;

  const strength = (reps: number, weight: number) => ({ type: 'strength', reps, weight, weightUnit: 'kg' }) as const;
  const ctx = (advised?: { load?: number; reps?: number; reason?: string }) => ({
    runId: RUN_ID,
    now: NOW,
    timezone: TIMEZONE,
    advised,
  });

  async function newSession(): Promise<string> {
    // INV-TRAINING-002: one in_progress session per user — close the previous test's.
    await db.update(workoutSessions).set({ status: 'completed' }).where(eq(workoutSessions.userId, userId));
    const [row] = await db
      .insert(workoutSessions)
      .values({
        userId,
        sessionKey: `lrl_${Math.random()}`,
        status: 'in_progress',
        startedAt: new Date('2026-09-29T08:50:00Z'),
        lastActivityAt: new Date('2026-09-29T08:50:00Z'),
      })
      .returning();
    return row.id;
  }

  const rowsOf = (sessionId: string) =>
    db.select().from(loadRecommendations).where(eq(loadRecommendations.sessionId, sessionId));

  beforeAll(async () => {
    const bench = (await exerciseRepo.findAll()).find(e => e.name === 'Barbell Bench Press');
    if (!bench) {
      throw new Error('Seed exercise "Barbell Bench Press" not found — run with RUN_DB_TESTS=1');
    }
    benchId = bench.id;
    userId = (await userRepo.create(createTestUserData({ username: `lrl_${Date.now()}` }))).id;
    // One past workout so the rendered entry has a reference performance.
    const [past] = await db
      .insert(workoutSessions)
      .values({
        userId,
        sessionKey: 'lrl_past',
        status: 'completed',
        startedAt: new Date('2026-09-26T05:00:00Z'),
        completedAt: new Date('2026-09-26T06:00:00Z'),
        lastActivityAt: new Date('2026-09-26T05:00:00Z'),
      })
      .returning();
    const se = await sessionExerciseRepo.create(past.id, { exerciseId: benchId, orderIndex: 0 });
    for (const reps of [10, 10, 9]) {
      await sessionSetRepo.create(se.id, {
        setData: strength(reps, 82),
        createdAt: new Date('2026-09-26T05:10:00Z'),
        setKind: 'working',
      });
    }
  });

  it('first working set writes one row with the rendered entry and what the model advised; decision columns NULL', async () => {
    const sessionId = await newSession();
    await logged.service.logSetWithContext(sessionId, {
      exerciseId: benchId,
      setData: strength(10, 82),
      loadPlanLog: ctx({ load: 80, reps: 10, reason: 'fatigue after triceps' }),
    });
    const rows = await rowsOf(sessionId);
    expect(rows).toHaveLength(1);
    const [row] = rows;
    expect(row.userId).toBe(userId);
    expect(row.exerciseId).toBe(benchId);
    expect(row.runId).toBe(RUN_ID);
    expect(row.rendered).toMatch(/^Barbell Bench Press \[ID:[0-9a-f-]+\]\n {2}reference: 2026-09-26/);
    // The snapshot is taken BEFORE the set counts: today has no sets yet.
    expect(row.rendered).toContain('today: fresh (1st exercise)');
    expect(row.advised).toEqual({ load: 80, reps: 10, reason: 'fatigue after triceps' });
    expect(row.schemeId).toBeNull();
    expect(row.stage).toBeNull();
    expect(row.candidate).toBeNull();
    expect(row.conservative).toBeNull();
    expect(row.outcome).toBeNull();
    expect(row.completedAt).toBeNull();
  });

  it('a second working set writes nothing more; a warm-up first defers the row to the first working set', async () => {
    const sessionId = await newSession();
    const svc = logged.service;
    await svc.logSetWithContext(sessionId, {
      exerciseId: benchId,
      setData: strength(10, 40),
      setKind: 'warmup',
      loadPlanLog: ctx(),
    });
    expect(await rowsOf(sessionId)).toHaveLength(0);
    await svc.logSetWithContext(sessionId, { exerciseId: benchId, setData: strength(10, 80), loadPlanLog: ctx() });
    await svc.logSetWithContext(sessionId, { exerciseId: benchId, setData: strength(10, 80), loadPlanLog: ctx() });
    const rows = await rowsOf(sessionId);
    expect(rows).toHaveLength(1);
    expect(rows[0].advised).toBeNull();
    // The warm-up is a set of today, but not a working set: the entry still says "fresh".
    expect(rows[0].rendered).toContain('today: fresh (1st exercise)');
  });

  it('completing the exercise fills outcome (working sets done) and completed_at', async () => {
    const sessionId = await newSession();
    const svc = logged.service;
    await svc.logSetWithContext(sessionId, {
      exerciseId: benchId,
      setData: strength(10, 80),
      rpe: 7,
      loadPlanLog: ctx(),
    });
    await svc.logSetWithContext(sessionId, { exerciseId: benchId, setData: strength(9, 80), loadPlanLog: ctx() });
    await svc.completeCurrentExercise(sessionId);
    const [row] = await rowsOf(sessionId);
    expect(row.completedAt).toBeInstanceOf(Date);
    expect(row.outcome).toEqual({
      sets: [
        { setNumber: 1, reps: 10, weight: 80, weightUnit: 'kg', rpe: 7 },
        { setNumber: 2, reps: 9, weight: 80, weightUnit: 'kg', rpe: null },
      ],
    });
  });

  it('flag off (no log wired): same calls, no row, set still stored', async () => {
    const sessionId = await newSession();
    const { set } = await base.service.logSetWithContext(sessionId, {
      exerciseId: benchId,
      setData: strength(10, 80),
      loadPlanLog: ctx({ load: 80 }),
    });
    await base.service.completeCurrentExercise(sessionId);
    expect(set.setNumber).toBe(1);
    expect(await rowsOf(sessionId)).toHaveLength(0);
  });

  it('buildLoadRecommendationLog returns undefined when the flag is off', () => {
    expect(
      buildLoadRecommendationLog(
        { workoutSessionRepo: sessionRepo, exerciseRepository: exerciseRepo, userFacts: new UserFactsRepository() },
        { LOAD_PLAN_SUGGESTION: false },
      ),
    ).toBeUndefined();
  });
});
