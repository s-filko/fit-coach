// Workout session repository ports

import type {
  CreateSessionDto,
  CreateSessionExerciseDto,
  CreateSessionSetDto,
  SessionExercise,
  SessionExerciseWithDetails,
  SessionSet,
  WorkoutSession,
  WorkoutSessionWithDetails,
} from '@domain/training/types';

// --- DI Tokens ---

export const WORKOUT_SESSION_REPOSITORY_TOKEN = Symbol('WorkoutSessionRepository');
export const SESSION_EXERCISE_REPOSITORY_TOKEN = Symbol('SessionExerciseRepository');
export const SESSION_SET_REPOSITORY_TOKEN = Symbol('SessionSetRepository');

// --- Repository Interfaces ---

export interface RecentSessionsFilter {
  /** Only real workouts: status 'completed' AND at least one session_sets row (owner, 2026-09-24). */
  realWorkoutsOnly?: boolean;
}

/**
 * One exercise's last real performance (BUG-030 D2, training-exercise-history plan): the newest
 * `session_exercises` row for that exercise with >= 1 `session_sets` row, in a completed session
 * other than today's — unbounded in time, on purpose (old data beats none, as long as its age is
 * visible in the block that renders it).
 */
export interface ExerciseLastPerformance {
  exerciseId: string;
  completedAt: Date;
  sessionExercise: SessionExerciseWithDetails;
}

export interface IWorkoutSessionRepository {
  create(userId: string, session: CreateSessionDto): Promise<WorkoutSession>;
  findById(sessionId: string): Promise<WorkoutSession | null>;
  findByIdWithDetails(sessionId: string): Promise<WorkoutSessionWithDetails | null>;
  findRecentByUserId(userId: string, limit: number, filter?: RecentSessionsFilter): Promise<WorkoutSession[]>;
  findRecentByUserIdWithDetails(
    userId: string,
    limit: number,
    filter?: RecentSessionsFilter,
  ): Promise<WorkoutSessionWithDetails[]>;
  findActiveByUserId(userId: string): Promise<WorkoutSession | null>;
  update(sessionId: string, updates: Partial<WorkoutSession>): Promise<WorkoutSession>;
  complete(sessionId: string, completedAt: Date, durationMinutes: number): Promise<WorkoutSession>;
  updateActivity(sessionId: string): Promise<void>;
  findTimedOut(cutoffTime: Date): Promise<WorkoutSession[]>;
  autoCloseTimedOut(userId: string, cutoffTime: Date): Promise<number>;
  /**
   * The last real (completed, >= 1 set) performance of each exercise id, anchored by exercise —
   * not by session_key (BUG-030). At most one entry per exercise id, excluding `excludeSessionId`
   * (today's own session).
   */
  findLastPerformancesByExercise(
    userId: string,
    exerciseIds: string[],
    excludeSessionId: string,
  ): Promise<ExerciseLastPerformance[]>;
  /**
   * Up to `limit` most recent real (completed, >= 1 set) performances of ONE exercise, newest
   * first, excluding `excludeSessionId` (today's own session) — the `get_exercise_history` tool's
   * on-demand lookup (training-history-lookup plan D2). A sibling of `findLastPerformancesByExercise`
   * sharing its hydration path: that one anchors ONE entry per exercise id across many ids; this one
   * returns up to N entries for a SINGLE exercise id.
   *
   * `excludeSessionId: null` (close-out review item 5) means there is no session to exclude — the
   * caller must pass `null`, never `''`: a `uuid` column errors on an empty-string literal, it does
   * not just fail to match.
   */
  findRecentPerformancesForExercise(
    userId: string,
    exerciseId: string,
    excludeSessionId: string | null,
    limit: number,
  ): Promise<ExerciseLastPerformance[]>;
}

export interface ISessionExerciseRepository {
  create(sessionId: string, exercise: CreateSessionExerciseDto): Promise<SessionExercise>;
  findById(exerciseId: string): Promise<SessionExercise | null>;
  findBySessionId(sessionId: string): Promise<SessionExercise[]>;
  update(exerciseId: string, updates: Partial<SessionExercise>): Promise<SessionExercise>;
}

export interface ISessionSetRepository {
  create(exerciseId: string, set: CreateSessionSetDto): Promise<SessionSet>;
  findById(setId: string): Promise<SessionSet | null>;
  findByExerciseId(exerciseId: string): Promise<SessionSet[]>;
  update(setId: string, updates: Partial<SessionSet>): Promise<SessionSet>;
  deleteById(setId: string): Promise<void>;
}
