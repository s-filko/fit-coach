/**
 * AC-CB-4 / BUG-031 regression test — needs the local fitcoach_test database.
 * Promoted from the reproduction test written before the fix.
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
import { WorkoutPlanRepository } from '@infra/db/repositories/workout-plan.repository';
import { workoutSessions } from '@infra/db/schema';

import { REAL_TIMER_APIS } from '../../helpers/real-timers';
import { buildRealTrainingService } from '../../helpers/training-service';
import { createTestUserData } from '../../shared/test-factories';

/** Mid-morning UTC keeps the calendar date identical in every plausible user timezone. */
const NOW = new Date('2026-09-24T09:30:00.000Z');

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
 * The six sessions of one user, oldest first. Both real workouts were imported into history
 * (`hist_…` key, as real imported sessions are), each with a createdAt that does NOT track its
 * completedAt — `hist_20260921_lower` was imported FIRST (earliest createdAt) even though it was
 * completed LATER than `hist_20260920_upper` (imported after it). This proves two things at once:
 * daysSinceLastWorkout reads completedAt, not createdAt (AC-CB-4), and ordering "recent" by
 * completedAt DESC — not createdAt DESC (review advisory 4) — is what puts the truly most
 * recently completed workout first when there is more than one. The in_progress session's
 * lastActivityAt is fresh so getActiveSession's 2-hour auto-close leaves it alone.
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
    key: 'hist_20260921_lower',
    status: 'completed',
    createdAt: '2026-09-18T10:00:00.000Z',
    startedAt: '2026-09-21T05:00:00.000Z',
    completedAt: '2026-09-21T06:00:00.000Z',
    lastActivityAt: '2026-09-21T06:00:00.000Z',
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
const [REAL, REAL_LATER_COMPLETED] = SEEDS;
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
  let realLaterCompletedId: string;
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
      if (seed === REAL_LATER_COMPLETED) {
        realLaterCompletedId = row.id;
      }
      if (seed === IN_PROGRESS) {
        inProgressId = row.id;
      }
    }
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  it('session_planning context: recentSessions is both real workouts, most recently COMPLETED first (review advisory 4)', async () => {
    const { recentSessions } = await contextBuilder.buildContext(userId);

    // hist_20260921_lower completed 09-21 (after hist_20260920_upper's 09-20) but was imported
    // FIRST (createdAt 09-18, before the other's 09-22) — ordering by createdAt would reverse this.
    expect(recentSessions.map(s => s.id)).toEqual([realLaterCompletedId, realId]);
  });

  it("session_planning context: daysSinceLastWorkout is 3, from the LATEST real workout's completedAt (review advisory 4)", async () => {
    const { daysSinceLastWorkout } = await contextBuilder.buildContext(userId);

    // NOW is 2026-09-24T09:30Z, the latest completedAt (hist_20260921_lower) is 2026-09-21T06:00Z
    // → 3; the other real workout's completedAt (09-20) would say 4, its createdAt (09-22) would say 1.
    expect(daysSinceLastWorkout).toBe(3);
  });

  it('chat loadContext: data.recentSessions is both real workouts, most recently completed first', async () => {
    const loaded = await chatSpec.loadContext({ userId, user: null, activeSessionId: inProgressId }, {
      workoutPlanRepo: new WorkoutPlanRepository(),
      workoutSessionRepo: sessionRepo,
    } as never);
    if (!loaded.ok) {
      throw new Error(`loadContext failed: ${loaded.reply}`);
    }

    expect(loaded.data.recentSessions.map(s => s.id)).toEqual([realLaterCompletedId, realId]);
  });

  it('control: getActiveSession still returns the in_progress session', async () => {
    const active = await trainingService.getActiveSession(userId);

    expect(active?.id).toBe(inProgressId);
    expect(active?.status).toBe('in_progress');
  });
});
