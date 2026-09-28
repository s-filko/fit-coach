/**
 * BUG-030 (hidden-overlap half) / roadmap R0.2, AC-CB-3 — promoted from the overlapping-load repro
 * (training-exercise-history plan, Task 1).
 *
 * The old training context showed exactly one "previous session", chosen by exact session_key
 * (findLastCompletedByUserAndKey). Yesterday's hard session on OVERLAPPING muscles (Overhead
 * Press: shoulders_front + triceps; today's Bench Press works the same muscles as secondary) sat
 * under a different key, so the model never saw it — it could not factor yesterday's load into
 * today's coaching.
 *
 * The fix (D3): `training.recent_workouts` shows every real (completed, >= 1 set) workout in the
 * last 7 days regardless of key, labelling any exercise that shares a muscle group with today's
 * exercises. `training.exercise_history` still anchors Bench Press on its own last performance
 * (D2), unbounded in time — here that anchor happens to be exactly 7 days old.
 *
 * Real training PhaseSpec.loadContext over real repositories; every context block of the phase is
 * rendered and joined — this is what the model sees. Dates are explicit; "now" is pinned, nothing
 * is relative to the clock.
 */
import { buildTrainingSpec, type TrainingData } from '@infra/ai/graph/phases/training.spec';
import { db } from '@infra/db/drizzle';
import { exerciseMuscleGroups, exercises } from '@infra/db/schema';
import { humanTimeAgo } from '@shared/date-utils';

import { buildRealTrainingService } from '../../helpers/training-service';
import { createTestUserData } from '../../shared/test-factories';
import { createSessionSeeder, datePattern } from './session-seed';

/** Midday UTC keeps the calendar date identical in every plausible user timezone. */
const NOW = new Date('2026-09-24T09:30:00.000Z');
const TIMEZONE = 'Asia/Manila';

/** Test-local exercise (setup.ts seeds four only); fixed UUID, idempotent insert. */
const OVERHEAD_PRESS_ID = '2f2f7a26-1bd0-4702-829a-71d4a3f5e001';

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

describe('training context: hidden overlapping load (BUG-030, AC-CB-3/AC-EH-4, R0.2)', () => {
  // One wiring for the whole file; the repositories are stateless, so building it at describe time is safe.
  const {
    service: trainingService,
    userRepo,
    exerciseRepo,
    sessionRepo,
    sessionExerciseRepo,
    sessionSetRepo,
  } = buildRealTrainingService();
  const spec = buildTrainingSpec({
    trainingService,
    workoutSessionRepo: sessionRepo,
    exerciseRepository: exerciseRepo,
    embeddingService: {},
    userService: {},
    userFacts: {},
  } as never);
  let userId: string;
  let todayId: string;

  beforeAll(async () => {
    // Overhead Press: shoulders_front primary, triceps secondary — overlaps Bench Press
    // (triceps + shoulders_front secondary, per setup.ts). Column set copied from the seed rows.
    await db
      .insert(exercises)
      .values({
        id: OVERHEAD_PRESS_ID,
        name: 'Overhead Press',
        category: 'compound',
        equipment: 'barbell',
        exerciseType: 'strength',
        description: 'Shoulder compound movement',
        energyCost: 'high',
        complexity: 'intermediate',
        typicalDurationMinutes: 12,
        requiresSpotter: true,
      })
      .onConflictDoNothing();
    await db
      .insert(exerciseMuscleGroups)
      .values([
        { exerciseId: OVERHEAD_PRESS_ID, muscleGroup: 'shoulders_front', involvement: 'primary' },
        { exerciseId: OVERHEAD_PRESS_ID, muscleGroup: 'triceps', involvement: 'secondary' },
      ])
      .onConflictDoNothing();

    const exerciseIds = new Map<string, string>();
    const all = await exerciseRepo.findAll();
    for (const name of ['Barbell Bench Press', 'Overhead Press']) {
      const found = all.find(e => e.name === name);
      if (!found) {
        throw new Error(
          `Seed exercise "${name}" not found — run with RUN_DB_TESTS=1 against an initialised fitcoach_test`,
        );
      }
      exerciseIds.set(name, found.id);
    }

    userId = (await userRepo.create(createTestUserData({ username: `overlap_load_repro_${Date.now()}` }))).id;
    const seedSession = createSessionSeeder({ userId, exerciseIds, sessionExerciseRepo, sessionSetRepo });
    // The exercise-history anchor: last completed Bench Press, exactly 7 days before NOW.
    await seedSession('completed', {
      key: 'upper_a',
      date: '2026-09-17',
      exercises: [{ name: 'Barbell Bench Press', sets: Array.from({ length: 3 }, () => ({ reps: 8, weight: 80 })) }],
    });
    // Yesterday's hard session on overlapping muscles, under a different key — the old lookup
    // never saw it; the new fatigue-context block always includes every real workout in 7 days.
    await seedSession('completed', {
      key: 'shoulders_b',
      date: '2026-09-23',
      exercises: [{ name: 'Overhead Press', sets: Array.from({ length: 5 }, () => ({ reps: 6, weight: 55 })) }],
    });
    // Today: upper_a in progress, Bench Press its current exercise.
    todayId = await seedSession('in_progress', {
      key: 'upper_a',
      date: '2026-09-24',
      exercises: [{ name: 'Barbell Bench Press', sets: [] }],
    });
    const [bench] = await sessionExerciseRepo.findBySessionId(todayId);
    await sessionExerciseRepo.update(bench.id, { status: 'in_progress' });
  });

  /** Everything the model sees in the training phase, via the phase's own context blocks. */
  const loadAndRender = async (): Promise<{ data: TrainingData; context: string }> => {
    const loaded = await spec.loadContext({ userId, user: null, activeSessionId: todayId }, {
      trainingService,
      workoutSessionRepo: sessionRepo,
      exerciseRepository: exerciseRepo,
    } as never);
    if (!loaded.ok) {
      throw new Error(`loadContext failed: ${loaded.reply}`);
    }
    const ctx = { now: NOW, timezone: TIMEZONE, user: null };
    const context = spec.contextBlocks
      .map(b => b.render(loaded.data as never, ctx, 0))
      .filter(Boolean)
      .join('\n');
    return { data: loaded.data, context };
  };

  it('control: the exercise-history anchor (Bench Press, 2026-09-17) is what the context shows', async () => {
    const { data, context } = await loadAndRender();

    const benchEntry = data.exerciseHistory.find(e => e.exerciseName === 'Barbell Bench Press');
    expect(benchEntry?.completedAt?.toISOString().slice(0, 10)).toBe('2026-09-17');
    expect(context).toContain('Barbell Bench Press');
  });

  it("names yesterday's overlapping session's exercise (Overhead Press) in RECENT WORKOUTS", async () => {
    const { context } = await loadAndRender();

    expect(context).toContain('=== RECENT WORKOUTS (last 7 days, fatigue context) ===');
    expect(context).toContain('Overhead Press');
  });

  it("says when yesterday's overlapping session was (2026-09-23 / its relative form)", async () => {
    const { data, context } = await loadAndRender();
    const overhead = data.recentWorkouts.find(s => s.exercises.some(ex => ex.exercise.name === 'Overhead Press'));
    const when = humanTimeAgo(overhead!.completedAt ?? overhead!.createdAt, NOW, TIMEZONE);

    expect(context).toMatch(new RegExp(`${datePattern('2026-09-23').source}|${escapeRegExp(when)}`));
  });

  it('labels the overlap with today (shoulders_front, triceps) on the Overhead Press line', async () => {
    const { context } = await loadAndRender();

    expect(context).toContain('overlaps today:');
    expect(context).toMatch(/overlaps today:.*shoulders_front \(primary\)/);
    expect(context).toMatch(/overlaps today:.*triceps \(secondary\)/);
  });
});
