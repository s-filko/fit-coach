/**
 * REPRODUCTION (RED) — AC-CB-3 / roadmap R0.2. Runs only via the repro glob (needs the local
 * fitcoach_test database); promoted to a regular scenario test when U3 `muscle-centric-history`
 * lands.
 *
 * Training shows exactly one "previous session", chosen by exact session_key
 * (findLastCompletedByUserAndKey, training.spec.ts). Yesterday's hard session on OVERLAPPING
 * muscles (Overhead Press: shoulders_front + triceps; today's Bench Press works the same
 * muscles as secondary) sits under a different key, so the model never sees it — it cannot
 * factor yesterday's load into today's coaching.
 *
 * Real training PhaseSpec.loadContext over real repositories; every context block of the phase
 * is rendered and joined — this is what the model sees. Dates are explicit; "now" is pinned,
 * nothing is relative to the clock.
 *
 * Control deviation from the plan (coordinator-approved 2026-09-24): no training context block
 * ever renders a calendar date — humanTimeAgo renders the 2026-09-17 anchor as "7d ago (Thu)" —
 * so the control pins the anchor via loaded.data.previousSession (key + completedAt), and Red 2
 * accepts either the calendar date or the relative form humanTimeAgo gives for 2026-09-23.
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

describe('training context: hidden overlapping load (AC-CB-3, R0.2)', () => {
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
  let shouldersCompletedAt: Date;

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
    // The load anchor: last completed upper_a — the only session the exact-key lookup can find.
    await seedSession('completed', {
      key: 'upper_a',
      date: '2026-09-17',
      exercises: [{ name: 'Barbell Bench Press', sets: Array.from({ length: 3 }, () => ({ reps: 8, weight: 80 })) }],
    });
    // Yesterday's hard session on overlapping muscles, under a different key — invisible today.
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

    shouldersCompletedAt =
      (await sessionRepo.findLastCompletedByUserAndKey(userId, 'shoulders_b'))!.completedAt!;
  });

  /** Everything the model sees in the training phase, via the phase's own context blocks. */
  const loadAndRender = async (): Promise<{ data: TrainingData; context: string }> => {
    const loaded = await spec.loadContext({ userId, user: null, activeSessionId: todayId }, {
      trainingService,
      workoutSessionRepo: sessionRepo,
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

  it('control: the same-template anchor (upper_a, 2026-09-17) is what the context shows', async () => {
    const { data, context } = await loadAndRender();

    expect(data.previousSession?.sessionKey).toBe('upper_a');
    expect(data.previousSession?.completedAt?.toISOString().slice(0, 10)).toBe('2026-09-17');
    expect(context).toContain('Barbell Bench Press');
  });

  it("names yesterday's overlapping session's exercise (Overhead Press)", async () => {
    const { context } = await loadAndRender();

    expect(context).toContain('Overhead Press');
  });

  it("says when yesterday's overlapping session was (2026-09-23 / its relative form)", async () => {
    const { context } = await loadAndRender();
    const when = humanTimeAgo(shouldersCompletedAt, NOW, TIMEZONE);

    expect(context).toMatch(new RegExp(`${datePattern('2026-09-23').source}|${escapeRegExp(when)}`));
  });
});
