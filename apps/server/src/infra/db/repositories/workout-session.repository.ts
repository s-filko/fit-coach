import { and, desc, eq, exists, inArray, isNotNull, lt, ne, sql } from 'drizzle-orm';

import { ActiveSessionExistsError } from '@domain/training/errors';
import type { ExerciseLastPerformance, IWorkoutSessionRepository, RecentSessionsFilter } from '@domain/training/ports';
import type {
  CreateSessionDto,
  Involvement,
  MuscleGroup,
  SessionExerciseWithDetails,
  WorkoutSession,
  WorkoutSessionWithDetails,
} from '@domain/training/types';

import { db } from '@infra/db/drizzle';
import { exerciseMuscleGroups, exercises, sessionExercises, sessionSets, workoutSessions } from '@infra/db/schema';

import { findInErrorCauseChain } from '@shared/pg-error-cause';

/** The partial unique index behind INV-TRAINING-002 (migration 0010). */
const ONE_IN_PROGRESS_INDEX = 'uq_workout_sessions_one_in_progress_per_user';

/**
 * Postgres unique-violation on the one-active-session index — matched by SQLSTATE `23505` and the index
 * name, never by message text.
 */
function isActiveSessionViolation(err: unknown): boolean {
  return (
    findInErrorCauseChain(err, level =>
      level.code === '23505' && level.constraint === ONE_IN_PROGRESS_INDEX ? true : null,
    ) === true
  );
}

/** One `session_exercises` row left-joined with its `exercises` row — what both hydration call sites select. */
interface JoinedSessionExerciseRow {
  session_exercises: typeof sessionExercises.$inferSelect;
  exercises: typeof exercises.$inferSelect | null;
}

export class WorkoutSessionRepository implements IWorkoutSessionRepository {
  /**
   * Shared by `findByIdWithDetails` and `findLastPerformancesByExercise` (close-out review R2):
   * given already-joined session_exercises+exercises rows, batches the muscle-group and set
   * fetches (two queries total, never N+1) and assembles each into `SessionExerciseWithDetails`,
   * keyed by session_exercise id. A row whose exercise was not found (should not happen under the
   * FK, defensive) is left out of the map — callers already filter on map-miss.
   */
  private async hydrateSessionExercises(
    rows: JoinedSessionExerciseRow[],
  ): Promise<Map<string, SessionExerciseWithDetails>> {
    const exerciseIdsForMuscles = rows.map(r => r.exercises?.id).filter((id): id is string => id !== undefined);
    const muscleGroupsList =
      exerciseIdsForMuscles.length > 0
        ? await db
            .select()
            .from(exerciseMuscleGroups)
            .where(inArray(exerciseMuscleGroups.exerciseId, exerciseIdsForMuscles))
        : [];

    const sessionExerciseIds = rows.map(r => r.session_exercises.id);
    const sets =
      sessionExerciseIds.length > 0
        ? await db
            .select()
            .from(sessionSets)
            .where(inArray(sessionSets.sessionExerciseId, sessionExerciseIds))
            .orderBy(sessionSets.setNumber)
        : [];

    const result = new Map<string, SessionExerciseWithDetails>();
    for (const row of rows) {
      if (!row.exercises) {
        continue;
      }
      result.set(row.session_exercises.id, {
        ...row.session_exercises,
        exercise: {
          ...row.exercises,
          muscleGroups: muscleGroupsList
            .filter(mg => mg.exerciseId === row.exercises!.id)
            .map(mg => ({
              muscleGroup: mg.muscleGroup as MuscleGroup,
              involvement: mg.involvement as Involvement,
            })),
        },
        sets: sets.filter(s => s.sessionExerciseId === row.session_exercises.id),
      } as SessionExerciseWithDetails);
    }
    return result;
  }

  async create(userId: string, session: CreateSessionDto): Promise<WorkoutSession> {
    const [created] = await db
      .insert(workoutSessions)
      .values({
        userId,
        planId: session.planId ?? null,
        sessionKey: session.sessionKey ?? null,
        userContextJson: session.userContext ?? null,
        sessionPlanJson: session.sessionPlanJson ?? null,
        status: session.status ?? 'planning',
      })
      .returning();

    return {
      ...created,
      userContextJson: created.userContextJson as WorkoutSession['userContextJson'],
      sessionPlanJson: created.sessionPlanJson as WorkoutSession['sessionPlanJson'],
      autoCloseReason: created.autoCloseReason as WorkoutSession['autoCloseReason'],
    } as WorkoutSession;
  }

  async findById(sessionId: string): Promise<WorkoutSession | null> {
    const [session] = await db.select().from(workoutSessions).where(eq(workoutSessions.id, sessionId));

    if (!session) {
      return null;
    }

    return {
      ...session,
      userContextJson: session.userContextJson as WorkoutSession['userContextJson'],
      autoCloseReason: session.autoCloseReason as WorkoutSession['autoCloseReason'],
    } as WorkoutSession;
  }

  async findByIdWithDetails(sessionId: string): Promise<WorkoutSessionWithDetails | null> {
    const session = await this.findById(sessionId);
    if (!session) {
      return null;
    }

    // Get session exercises with exercise details, in plan order.
    const sessionExercisesList = await db
      .select()
      .from(sessionExercises)
      .leftJoin(exercises, eq(sessionExercises.exerciseId, exercises.id))
      .where(eq(sessionExercises.sessionId, sessionId))
      .orderBy(sessionExercises.orderIndex);

    const hydrated = await this.hydrateSessionExercises(sessionExercisesList);

    return {
      ...session,
      exercises: sessionExercisesList
        .map(se => hydrated.get(se.session_exercises.id))
        .filter((ex): ex is SessionExerciseWithDetails => ex !== undefined),
    } as WorkoutSessionWithDetails;
  }

  async findRecentByUserId(userId: string, limit: number, filter?: RecentSessionsFilter): Promise<WorkoutSession[]> {
    // One query: the EXISTS predicate sits in the WHERE, so `limit` counts real workouts only.
    const conditions = [eq(workoutSessions.userId, userId)];
    if (filter?.realWorkoutsOnly) {
      conditions.push(
        eq(workoutSessions.status, 'completed'),
        exists(
          db
            .select({ one: sql`1` })
            .from(sessionExercises)
            .innerJoin(sessionSets, eq(sessionSets.sessionExerciseId, sessionExercises.id))
            .where(eq(sessionExercises.sessionId, workoutSessions.id)),
        ),
      );
    }
    // realWorkoutsOnly: every row is completed (non-null completedAt), and an imported session's
    // createdAt does not track when it actually happened — order by completedAt (review advisory
    // 4), not createdAt. Without the filter, keep createdAt DESC exactly (getActiveSession depends
    // on it seeing planning/in_progress rows in that order).
    const sessions = await db
      .select()
      .from(workoutSessions)
      .where(and(...conditions))
      .orderBy(filter?.realWorkoutsOnly ? desc(workoutSessions.completedAt) : desc(workoutSessions.createdAt))
      .limit(limit);

    return sessions.map(s => ({
      ...s,
      userContextJson: s.userContextJson as WorkoutSession['userContextJson'],
      autoCloseReason: s.autoCloseReason as WorkoutSession['autoCloseReason'],
    })) as WorkoutSession[];
  }

  async findRecentByUserIdWithDetails(
    userId: string,
    limit: number,
    filter?: RecentSessionsFilter,
  ): Promise<WorkoutSessionWithDetails[]> {
    const sessions = await this.findRecentByUserId(userId, limit, filter);
    const detailed = await Promise.all(sessions.map(s => this.findByIdWithDetails(s.id)));
    return detailed.filter((s): s is WorkoutSessionWithDetails => s !== null);
  }

  async findActiveByUserId(userId: string): Promise<WorkoutSession | null> {
    const [session] = await db
      .select()
      .from(workoutSessions)
      .where(and(eq(workoutSessions.userId, userId), eq(workoutSessions.status, 'in_progress')))
      .limit(1);

    if (!session) {
      return null;
    }

    return {
      ...session,
      userContextJson: session.userContextJson as WorkoutSession['userContextJson'],
      autoCloseReason: session.autoCloseReason as WorkoutSession['autoCloseReason'],
    } as WorkoutSession;
  }

  async update(sessionId: string, updates: Partial<WorkoutSession>): Promise<WorkoutSession> {
    // A concurrent begin/start that lost the race against the one-in_progress index gets the same
    // domain error the service's sequential check throws — never a driver-shaped failure.
    const [updated] = await db
      .update(workoutSessions)
      .set({
        ...updates,
        updatedAt: new Date(),
      })
      .where(eq(workoutSessions.id, sessionId))
      .returning()
      .catch((err: unknown) => {
        throw isActiveSessionViolation(err) ? new ActiveSessionExistsError() : err;
      });

    return {
      ...updated,
      userContextJson: updated.userContextJson as WorkoutSession['userContextJson'],
      autoCloseReason: updated.autoCloseReason as WorkoutSession['autoCloseReason'],
    } as WorkoutSession;
  }

  async complete(sessionId: string, completedAt: Date, durationMinutes: number): Promise<WorkoutSession> {
    return this.update(sessionId, {
      status: 'completed',
      completedAt,
      durationMinutes,
    });
  }

  async updateActivity(sessionId: string): Promise<void> {
    await db.update(workoutSessions).set({ lastActivityAt: new Date() }).where(eq(workoutSessions.id, sessionId));
  }

  async findTimedOut(cutoffTime: Date): Promise<WorkoutSession[]> {
    const sessions = await db
      .select()
      .from(workoutSessions)
      .where(and(eq(workoutSessions.status, 'in_progress'), lt(workoutSessions.lastActivityAt, cutoffTime)));

    return sessions.map(s => ({
      ...s,
      userContextJson: s.userContextJson as WorkoutSession['userContextJson'],
      autoCloseReason: s.autoCloseReason as WorkoutSession['autoCloseReason'],
    })) as WorkoutSession[];
  }

  async autoCloseTimedOut(userId: string, cutoffTime: Date): Promise<number> {
    const timedOutSessions = await db
      .select()
      .from(workoutSessions)
      .where(
        and(
          eq(workoutSessions.userId, userId),
          eq(workoutSessions.status, 'in_progress'),
          lt(workoutSessions.lastActivityAt, cutoffTime),
        ),
      );

    for (const session of timedOutSessions) {
      const duration = session.startedAt
        ? Math.floor((session.lastActivityAt.getTime() - session.startedAt.getTime()) / 60000)
        : null;

      await db
        .update(workoutSessions)
        .set({
          status: 'completed',
          completedAt: session.lastActivityAt,
          durationMinutes: duration,
          autoCloseReason: 'timeout',
          updatedAt: new Date(),
        })
        .where(eq(workoutSessions.id, session.id));
    }

    return timedOutSessions.length;
  }

  async findLastPerformancesByExercise(
    userId: string,
    exerciseIds: string[],
    excludeSessionId: string,
  ): Promise<ExerciseLastPerformance[]> {
    if (exerciseIds.length === 0) {
      return [];
    }

    // One query for the pick: DISTINCT ON (exercise_id), newest completed session first — the
    // anchor is per exercise (BUG-030 D2), not per session_key, and never N+1 over sessions.
    const anchors = await db
      .selectDistinctOn([sessionExercises.exerciseId], {
        sessionExerciseId: sessionExercises.id,
        exerciseId: sessionExercises.exerciseId,
        completedAt: workoutSessions.completedAt,
      })
      .from(sessionExercises)
      .innerJoin(workoutSessions, eq(sessionExercises.sessionId, workoutSessions.id))
      .where(
        and(
          eq(workoutSessions.userId, userId),
          eq(workoutSessions.status, 'completed'),
          ne(workoutSessions.id, excludeSessionId),
          inArray(sessionExercises.exerciseId, exerciseIds),
          isNotNull(workoutSessions.completedAt),
          exists(
            db
              .select({ one: sql`1` })
              .from(sessionSets)
              .where(eq(sessionSets.sessionExerciseId, sessionExercises.id)),
          ),
        ),
      )
      // DISTINCT ON keeps the first row per exerciseId under this order — completedAt DESC picks
      // the anchor, orderIndex/id DESC only break an exact-timestamp tie deterministically
      // (close-out review advisory 7); they never affect which *session* wins.
      .orderBy(
        sessionExercises.exerciseId,
        desc(workoutSessions.completedAt),
        desc(sessionExercises.orderIndex),
        desc(sessionExercises.id),
      );

    if (anchors.length === 0) {
      return [];
    }

    // Hydrate the winning session_exercises rows through the same batched path as
    // findByIdWithDetails (close-out review R2) — no N+1 over the anchor ids.
    const sessionExerciseIds = anchors.map(a => a.sessionExerciseId);
    const rows = await db
      .select()
      .from(sessionExercises)
      .leftJoin(exercises, eq(sessionExercises.exerciseId, exercises.id))
      .where(inArray(sessionExercises.id, sessionExerciseIds));

    const hydrated = await this.hydrateSessionExercises(rows);

    return anchors
      .map(anchor => {
        const sessionExercise = hydrated.get(anchor.sessionExerciseId);
        if (!sessionExercise) {
          return null;
        }
        return {
          exerciseId: anchor.exerciseId,
          completedAt: anchor.completedAt!,
          sessionExercise,
        };
      })
      .filter((p): p is ExerciseLastPerformance => p !== null);
  }
}
