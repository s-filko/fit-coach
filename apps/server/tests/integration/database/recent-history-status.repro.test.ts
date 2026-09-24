/**
 * REPRODUCTION (RED) — AC-CB-4 / BUG-031. Runs only via an explicit --testMatch (needs the local
 * fitcoach_test database); promoted to a regular integration test when the fix lands.
 *
 * "Recent sessions" for the session_planning and chat phases is findRecentByUserIdWithDetails —
 * findRecentByUserId filtered by user only, so skipped, planning and in_progress rows enter the
 * history, and so does a session that ended `completed` with zero logged sets (an explicit
 * "закончил" with nothing logged ends completed via completeSession). daysSinceLastWorkout is
 * then computed from whichever row is newest (completedAt ?? createdAt).
 *
 * Real workout (owner, 2026-09-24): status `completed` AND at least one session_sets row. Only
 * those may appear in the two history loaders; getActiveSession must keep seeing planning /
 * in_progress rows (control — its query is unchanged by design D-1).
 *
 * Real builders and repositories over the real test DB; dates are explicit and "now" is pinned,
 * nothing is relative to the clock.
 */
import { SessionPlanningContextBuilder } from '@domain/training/services/session-planning-context.builder';
import { buildChatSpec } from '@infra/ai/graph/phases/chat.spec';
import { db } from '@infra/db/drizzle';
import { workoutSessions } from '@infra/db/schema';
import { WorkoutPlanRepository } from '@infra/db/repositories/workout-plan.repository';

import { buildRealTrainingService } from '../../helpers/training-service';
import { createTestUserData } from '../../shared/test-factories';

/** Mid-morning UTC keeps the calendar date identical in every plausible user timezone. */
const NOW = new Date('2026-09-24T09:30:00.000Z');

/** jest's `FakeableAPI` minus 'Date' — the union itself is not exported by @types/jest. */
type RealTimerApi =
  | 'setTimeout'
  | 'clearTimeout'
  | 'setInterval'
  | 'clearInterval'
  | 'setImmediate'
  | 'clearImmediate'
  | 'nextTick'
  | 'queueMicrotask'
  | 'performance'
  | 'hrtime'
  | 'requestAnimationFrame'
  | 'cancelAnimationFrame'
  | 'requestIdleCallback'
  | 'cancelIdleCallback';

/** Timer APIs that must stay REAL — pg schedules work through them; only `Date` is faked. */
const REAL_TIMER_APIS: RealTimerApi[] = [
  'setTimeout',
  'clearTimeout',
  'setInterval',
  'clearInterval',
  'setImmediate',
  'clearImmediate',
  'nextTick',
  'queueMicrotask',
  'performance',
  'hrtime',
  'requestAnimationFrame',
  'cancelAnimationFrame',
  'requestIdleCallback',
  'cancelIdleCallback',
];

interface SeedSession {
  key: string;
  status: 'completed' | 'skipped' | 'planning' | 'in_progress';
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  lastActivityAt: string;
  /** One logged set on the seeded stand-in exercise — only the real workout has it. */
  withSet?: boolean;
}

/**
 * The five sessions of one user, oldest first. The real workout was imported into history
 * (`hist_…` key, as real imported sessions are), so its createdAt is LATER than its completedAt —
 * which also proves daysSinceLastWorkout reads completedAt, not createdAt. The in_progress
 * session's lastActivityAt is fresh so getActiveSession's 2-hour auto-close leaves it alone.
 */
const SEEDS: SeedSession[] = [
  {
    key: 'hist_20260920_upper',
    status: 'completed',
    createdAt: '2026-09-22T10:00:00.000Z',
    startedAt: '2026-09-20T04:00:00.000Z',
    completedAt: '2026-09-20T05:00:00.000Z',
    lastActivityAt: '2026-09-20T05:00:00.000Z',
    withSet: true,
  },
  {
    key: 'empty_done_20260921',
    status: 'completed',
    createdAt: '2026-09-21T09:00:00.000Z',
    startedAt: '2026-09-21T09:00:00.000Z',
    completedAt: '2026-09-21T10:00:00.000Z',
    lastActivityAt: '2026-09-21T10:00:00.000Z',
  },
  {
    key: 'skipped_20260922',
    status: 'skipped',
    createdAt: '2026-09-22T08:00:00.000Z',
    lastActivityAt: '2026-09-22T08:00:00.000Z',
  },
  {
    key: 'plan_20260923',
    status: 'planning',
    createdAt: '2026-09-23T08:00:00.000Z',
    lastActivityAt: '2026-09-23T08:00:00.000Z',
  },
  {
    key: 'live_20260923',
    status: 'in_progress',
    createdAt: '2026-09-23T12:00:00.000Z',
    startedAt: '2026-09-23T12:00:00.000Z',
    lastActivityAt: '2026-09-24T08:00:00.000Z',
  },
];
const REAL = SEEDS[0];
const IN_PROGRESS = SEEDS[SEEDS.length - 1];

describe('recent history counts only real workouts (BUG-031)', () => {
  // One wiring for the whole file; the repositories are stateless, so building it at describe time is safe.
  const {
    service: trainingService,
    userRepo,
    exerciseRepo,
    sessionRepo,
    sessionExerciseRepo,
    sessionSetRepo,
  } = buildRealTrainingService();
  const contextBuilder = new SessionPlanningContextBuilder(new WorkoutPlanRepository(), sessionRepo);
  const chatSpec = buildChatSpec({ userService: {}, userFacts: {} } as never);
  let userId: string;
  let realId: string;
  let inProgressId: string;

  beforeAll(async () => {
    jest.useFakeTimers({ doNotFake: REAL_TIMER_APIS });
    jest.setSystemTime(NOW);

    const squat = (await exerciseRepo.findAll()).find(e => e.name === 'Barbell Back Squat');
    if (!squat) {
      throw new Error(
        'Seed exercise "Barbell Back Squat" not found — run with RUN_DB_TESTS=1 against an initialised fitcoach_test',
      );
    }

    userId = (await userRepo.create(createTestUserData())).id;
    for (const seed of SEEDS) {
      const [row] = await db
        .insert(workoutSessions)
        .values({
          userId,
          sessionKey: seed.key,
          status: seed.status,
          startedAt: seed.startedAt ? new Date(seed.startedAt) : null,
          completedAt: seed.completedAt ? new Date(seed.completedAt) : null,
          lastActivityAt: new Date(seed.lastActivityAt),
          createdAt: new Date(seed.createdAt),
          updatedAt: new Date(seed.createdAt),
        })
        .returning();
      if (seed.withSet) {
        const se = await sessionExerciseRepo.create(row.id, { exerciseId: squat.id, orderIndex: 0 });
        await sessionSetRepo.create(se.id, {
          setData: { type: 'strength', reps: 12, weight: 80, weightUnit: 'kg' },
          createdAt: new Date(seed.completedAt!),
        });
      }
      if (seed === REAL) {
        realId = row.id;
      }
      if (seed === IN_PROGRESS) {
        inProgressId = row.id;
      }
    }
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  it('session_planning context: recentSessions is exactly the real workout', async () => {
    const { recentSessions } = await contextBuilder.buildContext(userId);

    expect(recentSessions.map(s => s.id)).toEqual([realId]);
  });

  it("session_planning context: daysSinceLastWorkout is 4, from the real workout's completedAt", async () => {
    const { daysSinceLastWorkout } = await contextBuilder.buildContext(userId);

    // NOW is 2026-09-24T09:30Z, completedAt is 2026-09-20T05:00Z → 4; its createdAt (09-22) would say 1.
    expect(daysSinceLastWorkout).toBe(4);
  });

  it('chat loadContext: data.recentSessions is exactly the real workout', async () => {
    const loaded = await chatSpec.loadContext({ userId, user: null, activeSessionId: inProgressId }, {
      workoutPlanRepo: new WorkoutPlanRepository(),
      workoutSessionRepo: sessionRepo,
    } as never);
    if (!loaded.ok) {
      throw new Error(`loadContext failed: ${loaded.reply}`);
    }

    expect(loaded.data.recentSessions.map(s => s.id)).toEqual([realId]);
  });

  it('control: getActiveSession still returns the in_progress session', async () => {
    const active = await trainingService.getActiveSession(userId);

    expect(active?.id).toBe(inProgressId);
    expect(active?.status).toBe('in_progress');
  });
});
