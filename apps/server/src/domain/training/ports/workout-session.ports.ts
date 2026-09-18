// Workout session repository ports

import type {
  CreateSessionDto,
  CreateSessionExerciseDto,
  CreateSessionSetDto,
  SessionExercise,
  SessionSet,
  WorkoutSession,
  WorkoutSessionWithDetails,
} from '@domain/training/types';

// --- DI Tokens ---

export const WORKOUT_SESSION_REPOSITORY_TOKEN = Symbol('WorkoutSessionRepository');
export const SESSION_EXERCISE_REPOSITORY_TOKEN = Symbol('SessionExerciseRepository');
export const SESSION_SET_REPOSITORY_TOKEN = Symbol('SessionSetRepository');

// --- Repository Interfaces ---

export interface IWorkoutSessionRepository {
  create(userId: string, session: CreateSessionDto): Promise<WorkoutSession>;
  findById(sessionId: string): Promise<WorkoutSession | null>;
  findByIdWithDetails(sessionId: string): Promise<WorkoutSessionWithDetails | null>;
  findRecentByUserId(userId: string, limit: number): Promise<WorkoutSession[]>;
  findRecentByUserIdWithDetails(userId: string, limit: number): Promise<WorkoutSessionWithDetails[]>;
  findActiveByUserId(userId: string): Promise<WorkoutSession | null>;
  update(sessionId: string, updates: Partial<WorkoutSession>): Promise<WorkoutSession>;
  complete(sessionId: string, completedAt: Date, durationMinutes: number): Promise<WorkoutSession>;
  updateActivity(sessionId: string): Promise<void>;
  findTimedOut(cutoffTime: Date): Promise<WorkoutSession[]>;
  autoCloseTimedOut(userId: string, cutoffTime: Date): Promise<number>;
  findLastCompletedByUserAndKey(userId: string, sessionKey: string): Promise<WorkoutSessionWithDetails | null>;
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
