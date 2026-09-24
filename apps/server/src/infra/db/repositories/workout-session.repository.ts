import { and, desc, eq, exists, inArray, isNotNull, lt, sql } from 'drizzle-orm';

import { ActiveSessionExistsError } from '@domain/training/errors';
import type { IWorkoutSessionRepository, RecentSessionsFilter } from '@domain/training/ports';
import type {
  CreateSessionDto,
  Involvement,
  MuscleGroup,
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

export class WorkoutSessionRepository implements IWorkoutSessionRepository {
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

    // Get session exercises with exercise details
    const sessionExercisesList = await db
      .select()
      .from(sessionExercises)
      .leftJoin(exercises, eq(sessionExercises.exerciseId, exercises.id))
      .where(eq(sessionExercises.sessionId, sessionId))
      .orderBy(sessionExercises.orderIndex);

    // Get exercise IDs to fetch muscle groups
    const exerciseIdsForMuscles = sessionExercisesList
      .map(se => se.exercises?.id)
      .filter((id): id is string => id !== undefined);

    // Get muscle groups for all exercises
    const muscleGroupsList =
      exerciseIdsForMuscles.length > 0
        ? await db
            .select()
            .from(exerciseMuscleGroups)
            .where(inArray(exerciseMuscleGroups.exerciseId, exerciseIdsForMuscles))
        : [];

    // Get all sets for these exercises
    const sessionExerciseIds = sessionExercisesList.map(se => se.session_exercises.id);
    const sets =
      sessionExerciseIds.length > 0
        ? await db
            .select()
            .from(sessionSets)
            .where(inArray(sessionSets.sessionExerciseId, sessionExerciseIds))
            .orderBy(sessionSets.setNumber)
        : [];

    return {
      ...session,
      exercises: sessionExercisesList.map(se => ({
        ...se.session_exercises,
        exercise: {
          ...se.exercises!,
          muscleGroups: muscleGroupsList
            .filter(mg => mg.exerciseId === se.exercises!.id)
            .map(mg => ({
              muscleGroup: mg.muscleGroup as MuscleGroup,
              involvement: mg.involvement as Involvement,
            })),
        },
        sets: sets.filter(s => s.sessionExerciseId === se.session_exercises.id).map(s => s),
      })),
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
    const sessions = await db
      .select()
      .from(workoutSessions)
      .where(and(...conditions))
      .orderBy(desc(workoutSessions.createdAt))
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

  async findLastCompletedByUserAndKey(userId: string, sessionKey: string): Promise<WorkoutSessionWithDetails | null> {
    const [session] = await db
      .select()
      .from(workoutSessions)
      .where(
        and(
          eq(workoutSessions.userId, userId),
          eq(workoutSessions.status, 'completed'),
          eq(workoutSessions.sessionKey, sessionKey),
          isNotNull(workoutSessions.completedAt),
        ),
      )
      .orderBy(desc(workoutSessions.completedAt))
      .limit(1);

    if (!session) {
      return null;
    }

    return this.findByIdWithDetails(session.id);
  }
}
