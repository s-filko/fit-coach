/**
 * load-plan-fixes (AC-LPF-1, AC-LPF-3), dated clock, real test DB, the real loader + v2 block, shapes from the
 * 2026-10-01 replay: the Lateral Raise Machine ladder (recent 2.5 kg sessions, a stray 5 kg set older, 5 kg machine
 * step) prints 2.5 kg and never 0 kg; an exercise with ONE performance (Stage A insufficient data) still prints the
 * reference load with a lower conservative; an exercise with no history prints no number and no conservative option.
 */
import { defaultProgression } from '@domain/training/load-plan';

import { loadLoadPlanEntries } from '@infra/ai/load-facts/load-facts.loader';
import { renderLoadPlanEntryV2 } from '@infra/ai/prompts/blocks/training-load-plan.v2';
import { db } from '@infra/db/drizzle';
import { UserFactsRepository } from '@infra/db/repositories/user-facts.repository';
import { exerciseMuscleGroups, exercises, workoutSessions } from '@infra/db/schema';

import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';

import { buildRealTrainingService } from '../../helpers/training-service';
import { createTestUserData } from '../../shared/test-factories';

const TIMEZONE = 'Asia/Manila';
const NOW = new Date('2026-09-29T09:30:00.000Z');
const DAY = 86_400_000;
const daysAgo = (days: number): Date => new Date(NOW.getTime() - days * DAY);

describe('load plan fixes — replay shapes through the real loader and block', () => {
  const { userRepo, exerciseRepo, sessionRepo, sessionExerciseRepo, sessionSetRepo, service } =
    buildRealTrainingService();
  const userFacts = new UserFactsRepository();
  const ids = new Map<string, string>();
  let userId: string;

  async function seedWorkout(at: Date, exercise: string, sets: [weight: number, reps: number][]): Promise<void> {
    const [row] = await db
      .insert(workoutSessions)
      .values({
        userId,
        sessionKey: `lpf_${exercise}_${at.toISOString()}`,
        status: 'completed',
        startedAt: at,
        completedAt: new Date(at.getTime() + 3_600_000),
        lastActivityAt: at,
        createdAt: at,
        updatedAt: at,
      })
      .returning();
    const se = await sessionExerciseRepo.create(row.id, {
      exerciseId: ids.get(exercise)!,
      orderIndex: 0,
      targetReps: '8-12',
    });
    for (const [i, [weight, reps]] of sets.entries()) {
      await sessionSetRepo.create(se.id, {
        setData: { type: 'strength', reps, weight, weightUnit: 'kg' },
        createdAt: new Date(at.getTime() + 600_000 + i * 120_000),
        setKind: 'working',
      });
    }
  }

  /** The LOAD PLAN v2 entry of one exercise for "today" (an in_progress helper session, closed again). */
  async function loadPlanOf(exercise: string): Promise<string> {
    const [today] = await db
      .insert(workoutSessions)
      .values({
        userId,
        sessionKey: `lpf_today_${exercise}`,
        status: 'in_progress',
        startedAt: NOW,
        lastActivityAt: NOW,
        createdAt: NOW,
        updatedAt: NOW,
      })
      .returning();
    const session = await service.getSessionDetails(today.id);
    const [entry] = await loadLoadPlanEntries(
      {
        workoutSessionRepo: sessionRepo,
        exerciseRepository: exerciseRepo,
        trainingService: { getSessionDetails: id => sessionRepo.findByIdWithDetails(id) },
        userFacts,
      },
      {
        userId,
        session,
        exerciseIds: [ids.get(exercise)!],
        planTargetReps: new Map([[ids.get(exercise)!, '8-12']]),
        now: NOW,
        timezone: TIMEZONE,
      },
    );
    await db
      .update(workoutSessions)
      .set({ status: 'completed', completedAt: null })
      .where(eq(workoutSessions.id, today.id));
    return renderLoadPlanEntryV2(
      entry,
      { now: NOW, timezone: TIMEZONE, user: null },
      { progression: defaultProgression(null) },
    );
  }

  beforeAll(async () => {
    const machine = [
      { name: 'Lateral Raise Machine', muscle: 'shoulders_side' as const },
      { name: 'Seated Calf Raise Machine', muscle: 'calves' as const },
    ];
    for (const { name, muscle } of machine) {
      const id = randomUUID();
      await db
        .insert(exercises)
        .values({
          id,
          name,
          category: 'isolation',
          equipment: 'machine',
          exerciseType: 'strength',
          description: 'load-plan-fixes seed',
          energyCost: 'low',
          complexity: 'beginner',
          typicalDurationMinutes: 8,
          requiresSpotter: false,
        })
        .onConflictDoNothing();
      const [row] = await db.select({ id: exercises.id }).from(exercises).where(eq(exercises.name, name));
      await db
        .insert(exerciseMuscleGroups)
        .values([{ exerciseId: row.id, muscleGroup: muscle, involvement: 'primary' }])
        .onConflictDoNothing();
      ids.set(name, row.id);
    }
    const bench = (await exerciseRepo.findAll()).find(e => e.name === 'Barbell Bench Press');
    if (!bench) {
      throw new Error('Seed exercise "Barbell Bench Press" not found — run with RUN_DB_TESTS=1');
    }
    ids.set('Barbell Bench Press', bench.id);
    userId = (await userRepo.create(createTestUserData({ username: `lpf_${Date.now()}` }))).id;

    // Lateral Raise Machine (replay C1): one 5 kg set in the oldest session, every later session 2.5 kg.
    await seedWorkout(daysAgo(19), 'Lateral Raise Machine', [
      [5, 10],
      [2.5, 10],
    ]);
    await seedWorkout(daysAgo(14), 'Lateral Raise Machine', [
      [2.5, 12],
      [2.5, 12],
      [2.5, 12],
    ]);
    await seedWorkout(daysAgo(9), 'Lateral Raise Machine', [
      [2.5, 12],
      [2.5, 11],
      [2.5, 8],
    ]);
    await seedWorkout(daysAgo(4), 'Lateral Raise Machine', [
      [2.5, 10],
      [2.5, 15],
      [2.5, 12],
      [2.5, 10],
    ]);
    // Bench (replay U2/U6): a single performance — Stage A insufficient data, but a reference exists.
    await seedWorkout(daysAgo(4), 'Barbell Bench Press', [
      [80, 10],
      [80, 10],
      [80, 9],
    ]);
    // Seated Calf Raise Machine: no history at all.
  });

  it('AC-LPF-1: the lateral-raise ladder prints the recent 2.5 kg, a floored conservative, and no 0 kg', async () => {
    const text = await loadPlanOf('Lateral Raise Machine');
    expect(text).toContain('working weight 2.5 kg');
    expect(text).toMatch(/recommend: 2\.5 kg × /);
    expect(text).toMatch(/conservative: 2\.5 kg × [^\n]*no lighter option/);
    expect(text).not.toMatch(/(^|[^.\d])0 kg/m);
  });

  it('AC-LPF-3: one performance with a reference prints the reference load and a lower conservative, low confidence', async () => {
    const text = await loadPlanOf('Barbell Bench Press');
    expect(text).toContain('decision: Stage A, insufficient data');
    expect(text).toMatch(
      /recommend: 80 kg × 8–12 — insufficient: 1 performances \/ 8 wk; last performance 80 kg 4 d ago/,
    );
    expect(text).toMatch(/conservative: 77\.5 kg × 8–12 — 2\.5 kg lower/);
    expect(text).toContain('confidence: low');
    expect(text).not.toContain('no record');
  });

  it('AC-LPF-3: no history at all prints no number and no conservative option', async () => {
    const text = await loadPlanOf('Seated Calf Raise Machine');
    expect(text).toContain('recommend: no number — no record, no reference load');
    expect(text).toContain('conservative: no conservative option — no record, no reference load');
  });
});
