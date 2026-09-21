/**
 * REPRODUCTION (RED) — AC-LSR-4 / BUG-030. Runs only via an explicit --testMatch (needs the local
 * fitcoach_test database); promoted to a regular scenario test when the fix lands.
 *
 * The training phase picks its "previous session" with findLastCompletedByUserAndKey — the last
 * completed session whose session_key is EXACTLY equal to today's. Real keys are unique per
 * session (hist_20260916_lower, …), so the lookup misses the recent leg sessions and reaches
 * arbitrarily far back to the one other session that happens to share the key. Live evidence:
 * 2026-09-21, lower_a → the 2026-02-20 session; Leg Curl of 2026-09-16 (3 x 12 @ 59 kg) invisible.
 * (The seed DB has four exercises, so Back Squat / Bench Press stand in for Leg Extension / Leg Curl below).
 *
 * Real training PhaseSpec.loadContext over real repositories; the block is rendered by the phase's
 * own previous-session block. Dates are explicit; "now" is pinned, nothing is relative to the clock.
 */
import { TrainingService } from '@domain/training/services/training.service';

import { buildTrainingSpec } from '@infra/ai/graph/phases/training.spec';
import { TRAINING_PREVIOUS_SESSION_V1 } from '@infra/ai/prompts/blocks';
import { db } from '@infra/db/drizzle';
import { ExerciseRepository } from '@infra/db/repositories/exercise.repository';
import { SessionExerciseRepository } from '@infra/db/repositories/session-exercise.repository';
import { SessionSetRepository } from '@infra/db/repositories/session-set.repository';
import { DrizzleUserRepository } from '@infra/db/repositories/user.repository';
import { WorkoutPlanRepository } from '@infra/db/repositories/workout-plan.repository';
import { WorkoutSessionRepository } from '@infra/db/repositories/workout-session.repository';
import { workoutSessions } from '@infra/db/schema';

import { createTestUserData } from '../../shared/test-factories';

/** Midday UTC keeps the calendar date identical in every plausible user timezone. */
const NOW = new Date('2026-09-21T09:30:00.000Z');
const TODAY_KEY = 'lower_a';

interface SeedSession {
  key: string;
  date: string;
  exercises: Array<{ name: string; sets: Array<{ reps: number; weight: number }> }>;
}

/**
 * The test DB seeds four exercises only (setup.ts), so the live session's exercises are mapped onto
 * them: Back Squat stands in for Leg Extension (done in every session) and Bench Press for Leg Curl
 * (done recently, absent from the old same-key session — the exercise the coach wrongly denied).
 */
const OLD_SAME_KEY: SeedSession = {
  key: TODAY_KEY,
  date: '2026-02-20',
  exercises: [
    { name: 'Barbell Back Squat', sets: [52, 59, 66, 66].map(weight => ({ reps: 12, weight })) },
    { name: 'Pull-ups', sets: [{ reps: 10, weight: 0 }] },
  ],
};
const RECENT: SeedSession[] = [
  {
    key: 'hist_20260909_lower',
    date: '2026-09-09',
    exercises: [
      { name: 'Barbell Back Squat', sets: [{ reps: 12, weight: 45 }] },
      { name: 'Barbell Bench Press', sets: [{ reps: 12, weight: 45 }] },
    ],
  },
  {
    key: 'hist_20260912_lower',
    date: '2026-09-12',
    exercises: [
      { name: 'Barbell Back Squat', sets: [{ reps: 12, weight: 52 }] },
      { name: 'Barbell Bench Press', sets: [{ reps: 12, weight: 52 }] },
    ],
  },
  {
    key: 'hist_20260916_lower',
    date: '2026-09-16',
    exercises: [
      { name: 'Barbell Back Squat', sets: [{ reps: 12, weight: 59 }] },
      { name: 'Barbell Bench Press', sets: Array.from({ length: 3 }, () => ({ reps: 12, weight: 59 })) },
    ],
  },
];
const [, , MOST_RECENT] = RECENT;

/** ISO, DD.MM.YYYY, "Sep 16" and "16 Sep(tember)" all count as "states the date". */
function datePattern(isoDate: string): RegExp {
  const [y, m, d] = isoDate.split('-').map(Number);
  const month = new Date(Date.UTC(y, m - 1, 1)).toLocaleString('en-US', { month: 'long', timeZone: 'UTC' });
  const mon = month.slice(0, 3);
  const dd = String(d).padStart(2, '0');
  const mm = String(m).padStart(2, '0');
  return new RegExp(`${isoDate}|${dd}\\.${mm}\\.${y}|${mon}[a-z]* 0?${d}\\b|\\b0?${d} ${mon}`, 'i');
}

describe('training previous-session block (BUG-030)', () => {
  const sessionRepo = new WorkoutSessionRepository();
  const sessionExerciseRepo = new SessionExerciseRepository();
  const sessionSetRepo = new SessionSetRepository();
  const exerciseRepo = new ExerciseRepository();
  let trainingService: TrainingService;
  let loadContext: ReturnType<typeof buildTrainingSpec>['loadContext'];
  let userId: string;
  let currentSessionId: string;
  const exerciseIds = new Map<string, string>();

  const seedSession = async (
    status: 'completed' | 'in_progress',
    s: { key: string; date: string; exercises?: SeedSession['exercises'] },
  ): Promise<string> => {
    const at = new Date(`${s.date}T12:00:00.000Z`);
    const [row] = await db
      .insert(workoutSessions)
      .values({
        userId,
        sessionKey: s.key,
        status,
        startedAt: at,
        completedAt: status === 'completed' ? new Date(at.getTime() + 60 * 60 * 1000) : null,
        lastActivityAt: at,
        createdAt: at,
        updatedAt: at,
      })
      .returning();
    for (const [i, ex] of (s.exercises ?? []).entries()) {
      const se = await sessionExerciseRepo.create(row.id, { exerciseId: exerciseIds.get(ex.name)!, orderIndex: i });
      for (const set of ex.sets) {
        await sessionSetRepo.create(se.id, {
          setData: { type: 'strength', reps: set.reps, weight: set.weight, weightUnit: 'kg' },
          createdAt: at,
        });
      }
    }
    return row.id;
  };

  beforeAll(async () => {
    const userRepo = new DrizzleUserRepository();
    trainingService = new TrainingService(
      new WorkoutPlanRepository(),
      sessionRepo,
      exerciseRepo,
      sessionExerciseRepo,
      sessionSetRepo,
      userRepo,
    );

    const all = await exerciseRepo.findAll();
    for (const name of ['Barbell Back Squat', 'Barbell Bench Press', 'Pull-ups']) {
      const found = all.find(e => e.name === name);
      if (!found) {
        throw new Error(
          `Seed exercise "${name}" not found — run with RUN_DB_TESTS=1 against an initialised fitcoach_test`,
        );
      }
      exerciseIds.set(name, found.id);
    }

    userId = (await userRepo.create(createTestUserData({ username: `prev_sess_repro_${Date.now()}` }))).id;
    await seedSession('completed', OLD_SAME_KEY);
    for (const s of RECENT) {
      await seedSession('completed', s);
    }
    currentSessionId = await seedSession('in_progress', { key: TODAY_KEY, date: '2026-09-21' });

    const spec = buildTrainingSpec({
      trainingService,
      workoutSessionRepo: sessionRepo,
      exerciseRepository: exerciseRepo,
      embeddingService: {},
      userService: {},
      userFacts: {},
    } as never);
    ({ loadContext } = spec);
  });

  const previousSession = async () => {
    const loaded = await loadContext({ userId, user: null, activeSessionId: currentSessionId }, {
      trainingService,
      workoutSessionRepo: sessionRepo,
    } as never);
    if (!loaded.ok) {
      throw new Error(`loadContext failed: ${loaded.reply}`);
    }
    return loaded.data.previousSession;
  };

  const renderBlock = (session: Awaited<ReturnType<typeof previousSession>>): string | null =>
    TRAINING_PREVIOUS_SESSION_V1.render(
      { previousSession: session },
      { now: NOW, timezone: 'Asia/Manila', user: null },
      0,
    );

  it('control: a previous-session block is built and carries a relative age', async () => {
    const block = renderBlock(await previousSession());

    expect(block).toMatch(/^=== PREVIOUS SESSION \(same template — \d+d ago/);
  });

  it('selects the most recent completed leg session, not the old one that shares the session_key', async () => {
    const previous = await previousSession();

    expect(previous?.sessionKey).toBe(MOST_RECENT.key);
  });

  it('shows the model the exercise done on 2026-09-16 that the old session lacks (Bench Press, stand-in for Leg Curl)', async () => {
    const block = renderBlock(await previousSession());

    expect(block).toContain('Barbell Bench Press');
  });

  it('states the calendar date of the session it shows', async () => {
    // Independent of selection: whichever session was picked, its own date must appear in the block.
    const previous = await previousSession();
    const isoDate = previous!.completedAt!.toISOString().slice(0, 10);

    expect(renderBlock(previous)).toMatch(datePattern(isoDate));
  });
});
