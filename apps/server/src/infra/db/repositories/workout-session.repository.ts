import { and, desc, eq, inArray, lt } from 'drizzle-orm';

import type { IWorkoutSessionRepository } from '@domain/training/ports';
import type {
  CreateSessionDto,
  Involvement,
  MuscleGroup,
  WorkoutSession,
  WorkoutSessionWithDetails,
} from '@domain/training/types';

import { db } from '@infra/db/drizzle';
import {
  exerciseMuscleGroups,
  exercises,
  sessionExercises,
  sessionSets,
  workoutSessions,
} from '@infra/db/schema';

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
    const [session] = await db
      .select()
      .from(workoutSessions)
      .where(eq(workoutSessions.id, sessionId));

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
      .map((se) => se.exercises?.id)
      .filter((id): id is number => id !== undefined);

    // Get muscle groups for all exercises
    const muscleGroupsList =
      exerciseIdsForMuscles.length > 0
        ? await db
            .select()
            .from(exerciseMuscleGroups)
            .where(inArray(exerciseMuscleGroups.exerciseId, exerciseIdsForMuscles))
        : [];

    // Get all sets for these exercises
    const sessionExerciseIds = sessionExercisesList.map((se) => se.session_exercises.id);
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
      exercises: sessionExercisesList.map((se) => ({
        ...se.session_exercises,
        exercise: {
          ...se.exercises!,
          muscleGroups: muscleGroupsList
            .filter((mg) => mg.exerciseId === se.exercises!.id)
            .map((mg) => ({
              muscleGroup: mg.muscleGroup as MuscleGroup,
              involvement: mg.involvement as Involvement,
            })),
        },
        sets: sets
          .filter((s) => s.sessionExerciseId === se.session_exercises.id)
          .map((s) => s),
      })),
    } as WorkoutSessionWithDetails;
  }

  async findRecentByUserId(userId: string, limit: number): Promise<WorkoutSession[]> {
    const sessions = await db
      .select()
      .from(workoutSessions)
      .where(eq(workoutSessions.userId, userId))
      .orderBy(desc(workoutSessions.createdAt))
      .limit(limit);

    return sessions.map((s) => ({
      ...s,
      userContextJson: s.userContextJson as WorkoutSession['userContextJson'],
      autoCloseReason: s.autoCloseReason as WorkoutSession['autoCloseReason'],
    })) as WorkoutSession[];
  }

  async findRecentByUserIdWithDetails(
    userId: string,
    limit: number,
  ): Promise<WorkoutSessionWithDetails[]> {
    const sessions = await this.findRecentByUserId(userId, limit);
    const detailed = await Promise.all(
      sessions.map((s) => this.findByIdWithDetails(s.id)),
    );
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
    const [updated] = await db
      .update(workoutSessions)
      .set({
        ...updates,
        updatedAt: new Date(),
      })
      .where(eq(workoutSessions.id, sessionId))
      .returning();

    return {
      ...updated,
      userContextJson: updated.userContextJson as WorkoutSession['userContextJson'],
      autoCloseReason: updated.autoCloseReason as WorkoutSession['autoCloseReason'],
    } as WorkoutSession;
  }

  async complete(
    sessionId: string,
    completedAt: Date,
    durationMinutes: number,
  ): Promise<WorkoutSession> {
    return this.update(sessionId, {
      status: 'completed',
      completedAt,
      durationMinutes,
    });
  }

  async updateActivity(sessionId: string): Promise<void> {
    await db
      .update(workoutSessions)
      .set({ lastActivityAt: new Date() })
      .where(eq(workoutSessions.id, sessionId));
  }

  async findTimedOut(cutoffTime: Date): Promise<WorkoutSession[]> {
    const sessions = await db
      .select()
      .from(workoutSessions)
      .where(
        and(
          eq(workoutSessions.status, 'in_progress'),
          lt(workoutSessions.lastActivityAt, cutoffTime),
        ),
      );

    return sessions.map((s) => ({
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
}
