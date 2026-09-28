/**
 * BUG-030 (session_key half) — promoted from the previous-session repro (training-exercise-history
 * plan, Task 1). The old training phase picked its "previous session" with
 * findLastCompletedByUserAndKey — the last completed session whose session_key was EXACTLY equal
 * to today's. Real keys are unique per session (hist_20260916_lower, …), so the lookup missed the
 * recent leg sessions and reached arbitrarily far back to the one other session that happened to
 * share the key. Live evidence: 2026-09-21, lower_a → the 2026-02-20 session; the 2026-09-16 Bench
 * Press performance was invisible. (The seed DB has four exercises, so Back Squat / Bench Press
 * stand in for Leg Extension / Leg Curl below.)
 *
 * The fix (D2): anchor "last real performance" per exercise, unbounded in time, across ANY
 * completed session — not by session_key. This test covers AC-EH-1 (correct anchor, old session's
 * data invisible), AC-EH-2 (a planned-only exercise still gets its history) and AC-EH-3 (an
 * exercise with no real history ever renders an explicit "no completed record" line).
 *
 * Real training PhaseSpec.loadContext over real repositories; every context block of the phase is
 * rendered and joined — this is what the model sees. Dates are explicit; "now" is pinned, nothing
 * is relative to the clock.
 */
import { buildTrainingSpec, type TrainingData } from '@infra/ai/graph/phases/training.spec';

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

describe('training exercise history (BUG-030, AC-EH-1/2/3)', () => {
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
    const all = await exerciseRepo.findAll();
    const exerciseIds = new Map<string, string>();
    for (const name of ['Barbell Back Squat', 'Barbell Bench Press', 'Pull-ups', 'Running']) {
      const found = all.find(e => e.name === name);
      if (!found) {
        throw new Error(
          `Seed exercise "${name}" not found — run with RUN_DB_TESTS=1 against an initialised fitcoach_test`,
        );
      }
      exerciseIds.set(name, found.id);
    }

    userId = (await userRepo.create(createTestUserData({ username: `prev_sess_repro_${Date.now()}` }))).id;
    const seedSession = createSessionSeeder({ userId, exerciseIds, sessionExerciseRepo, sessionSetRepo });
    await seedSession('completed', OLD_SAME_KEY);
    for (const s of RECENT) {
      await seedSession('completed', s);
    }
    // Today: Back Squat started (0 sets yet); Bench Press and Running only planned (AC-EH-2/EH-3).
    todayId = await seedSession('in_progress', {
      key: TODAY_KEY,
      date: '2026-09-21',
      exercises: [{ name: 'Barbell Back Squat', sets: [] }],
      plan: [{ name: 'Barbell Back Squat' }, { name: 'Barbell Bench Press' }, { name: 'Running' }],
    });
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
    const ctx = { now: NOW, timezone: 'Asia/Manila', user: null };
    const context = spec.contextBlocks
      .map(b => b.render(loaded.data as never, ctx, 0))
      .filter(Boolean)
      .join('\n');
    return { data: loaded.data, context };
  };

  it('control: an EXERCISE HISTORY block is built', async () => {
    const { context } = await loadAndRender();

    expect(context).toContain("=== EXERCISE HISTORY (today's exercises — last completed performance) ===");
  });

  it('anchors Back Squat on the most recent completed session (2026-09-16), not the old same-key one', async () => {
    const { context } = await loadAndRender();

    expect(context).toMatch(/Barbell Back Squat \[ID:[^\]]+\] — last done 2026-09-16/);
    // Pull-ups only ever appears in the old (2026-02-20) same-key session — never today's exercises.
    expect(context).not.toContain('Pull-ups');
  });

  it('AC-EH-2: Bench Press, planned but never started today, still gets its 2026-09-16 history', async () => {
    const { context } = await loadAndRender();

    expect(context).toMatch(/Barbell Bench Press \[ID:[^\]]+\] — last done 2026-09-16/);
    expect(context).toContain('3× 12 reps @ 59 kg');
  });

  it('AC-EH-3: Running, never done, renders an explicit "no completed record" line', async () => {
    const { context } = await loadAndRender();

    expect(context).toMatch(/Running \[ID:[^\]]+\] — no completed record/);
  });

  it('states the calendar date of the anchor it shows', async () => {
    const { context } = await loadAndRender();

    expect(context).toMatch(datePattern('2026-09-16'));
  });
});
