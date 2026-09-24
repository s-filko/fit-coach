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
import { buildTrainingSpec } from '@infra/ai/graph/phases/training.spec';
import { TRAINING_PREVIOUS_SESSION_V1 } from '@infra/ai/prompts/blocks';

import { buildRealTrainingService } from '../../helpers/training-service';
import { createTestUserData } from '../../shared/test-factories';
import { createSessionSeeder, datePattern, type SeedSession } from './session-seed';

/** Midday UTC keeps the calendar date identical in every plausible user timezone. */
const NOW = new Date('2026-09-21T09:30:00.000Z');
const TODAY_KEY = 'lower_a';

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

describe('training previous-session block (BUG-030)', () => {
  // One wiring for the whole file; the repositories are stateless, so building it at describe time is safe.
  const {
    service: trainingService,
    userRepo,
    exerciseRepo,
    sessionRepo,
    sessionExerciseRepo,
    sessionSetRepo,
  } = buildRealTrainingService();
  let loadContext: ReturnType<typeof buildTrainingSpec>['loadContext'];
  let userId: string;
  let currentSessionId: string;
  let seedSession: ReturnType<typeof createSessionSeeder>;
  const exerciseIds = new Map<string, string>();

  beforeAll(async () => {
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
    seedSession = createSessionSeeder({ userId, exerciseIds, sessionExerciseRepo, sessionSetRepo });
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
