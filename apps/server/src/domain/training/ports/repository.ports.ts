// Training repository interfaces

import type {
  CreateSessionDto,
  CreateSessionExerciseDto,
  CreateSessionSetDto,
  CreateWorkoutPlanDto,
  Exercise,
  ExerciseWithMuscles,
  MuscleGroup,
  SessionExercise,
  SessionSet,
  WorkoutPlan,
  WorkoutSession,
  WorkoutSessionWithDetails,
} from '@domain/training/types';

// --- DI Tokens ---

export const WORKOUT_PLAN_REPOSITORY_TOKEN = Symbol('WorkoutPlanRepository');
export const EXERCISE_REPOSITORY_TOKEN = Symbol('ExerciseRepository');
export const WORKOUT_SESSION_REPOSITORY_TOKEN = Symbol('WorkoutSessionRepository');
export const SESSION_EXERCISE_REPOSITORY_TOKEN = Symbol('SessionExerciseRepository');
export const SESSION_SET_REPOSITORY_TOKEN = Symbol('SessionSetRepository');

// --- Repository Interfaces ---

export interface IWorkoutPlanRepository {
  create(userId: string, plan: CreateWorkoutPlanDto): Promise<WorkoutPlan>;
  findById(planId: string): Promise<WorkoutPlan | null>;
  findActiveByUserId(userId: string): Promise<WorkoutPlan | null>;
  findByUserId(userId: string, status?: string): Promise<WorkoutPlan[]>;
  update(planId: string, updates: Partial<WorkoutPlan>): Promise<WorkoutPlan>;
  archive(planId: string): Promise<void>;
}

export interface IExerciseRepository {
  findById(id: number): Promise<Exercise | null>;
  findByIdWithMuscles(id: number): Promise<ExerciseWithMuscles | null>;
  findByIds(ids: number[]): Promise<Exercise[]>;
  findByIdsWithMuscles(ids: number[]): Promise<ExerciseWithMuscles[]>;
  findByMuscleGroup(muscleGroup: MuscleGroup, primaryOnly?: boolean): Promise<ExerciseWithMuscles[]>;
  search(query: string, limit?: number): Promise<Exercise[]>;
  findAll(filters?: {
    category?: string;
    equipment?: string;
    energyCost?: string;
    complexity?: string;
  }): Promise<Exercise[]>;
}

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
}
