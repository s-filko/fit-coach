// Training domain ports (repository interfaces)

import type {
  CreateSessionDto,
  CreateSessionExerciseDto,
  CreateSessionSetDto,
  CreateWorkoutPlanDto,
  Exercise,
  ExerciseWithMuscles,
  MuscleGroup,
  SessionExercise,
  SessionRecommendation,
  SessionSet,
  WorkoutPlan,
  WorkoutSession,
  WorkoutSessionWithDetails,
} from './types.js';

// --- DI Tokens ---

export const WORKOUT_PLAN_REPOSITORY_TOKEN = Symbol('WorkoutPlanRepository');
export const EXERCISE_REPOSITORY_TOKEN = Symbol('ExerciseRepository');
export const WORKOUT_SESSION_REPOSITORY_TOKEN = Symbol('WorkoutSessionRepository');
export const SESSION_EXERCISE_REPOSITORY_TOKEN = Symbol('SessionExerciseRepository');
export const SESSION_SET_REPOSITORY_TOKEN = Symbol('SessionSetRepository');
export const TRAINING_SERVICE_TOKEN = Symbol('TrainingService');

// --- Repository Interfaces ---

export interface IWorkoutPlanRepository {
  /**
   * Create a new workout plan for a user
   */
  create(userId: string, plan: CreateWorkoutPlanDto): Promise<WorkoutPlan>;

  /**
   * Find a plan by ID
   */
  findById(planId: string): Promise<WorkoutPlan | null>;

  /**
   * Find the active plan for a user
   */
  findActiveByUserId(userId: string): Promise<WorkoutPlan | null>;

  /**
   * Find all plans for a user (optionally filter by status)
   */
  findByUserId(userId: string, status?: string): Promise<WorkoutPlan[]>;

  /**
   * Update a plan
   */
  update(planId: string, updates: Partial<WorkoutPlan>): Promise<WorkoutPlan>;

  /**
   * Archive a plan (soft delete)
   */
  archive(planId: string): Promise<void>;
}

export interface IExerciseRepository {
  /**
   * Find an exercise by ID
   */
  findById(id: number): Promise<Exercise | null>;

  /**
   * Find an exercise with muscle group mappings
   */
  findByIdWithMuscles(id: number): Promise<ExerciseWithMuscles | null>;

  /**
   * Find multiple exercises by IDs
   */
  findByIds(ids: number[]): Promise<Exercise[]>;

  /**
   * Find multiple exercises with muscle groups
   */
  findByIdsWithMuscles(ids: number[]): Promise<ExerciseWithMuscles[]>;

  /**
   * Find exercises by muscle group (primary or secondary)
   */
  findByMuscleGroup(muscleGroup: MuscleGroup, primaryOnly?: boolean): Promise<ExerciseWithMuscles[]>;

  /**
   * Search exercises by name
   */
  search(query: string, limit?: number): Promise<Exercise[]>;

  /**
   * Get all exercises (with optional filters)
   */
  findAll(filters?: {
    category?: string;
    equipment?: string;
    energyCost?: string;
    complexity?: string;
  }): Promise<Exercise[]>;
}

export interface IWorkoutSessionRepository {
  /**
   * Create a new workout session
   */
  create(userId: string, session: CreateSessionDto): Promise<WorkoutSession>;

  /**
   * Find a session by ID
   */
  findById(sessionId: string): Promise<WorkoutSession | null>;

  /**
   * Find a session with full details (exercises, sets)
   */
  findByIdWithDetails(sessionId: string): Promise<WorkoutSessionWithDetails | null>;

  /**
   * Find recent sessions for a user
   */
  findRecentByUserId(userId: string, limit: number): Promise<WorkoutSession[]>;

  /**
   * Find recent sessions with full details
   */
  findRecentByUserIdWithDetails(userId: string, limit: number): Promise<WorkoutSessionWithDetails[]>;

  /**
   * Find active (in_progress) session for a user
   */
  findActiveByUserId(userId: string): Promise<WorkoutSession | null>;

  /**
   * Update a session
   */
  update(sessionId: string, updates: Partial<WorkoutSession>): Promise<WorkoutSession>;

  /**
   * Complete a session
   */
  complete(sessionId: string, completedAt: Date, durationMinutes: number): Promise<WorkoutSession>;

  /**
   * Update last activity timestamp
   */
  updateActivity(sessionId: string): Promise<void>;

  /**
   * Find timed-out sessions (for auto-close)
   */
  findTimedOut(cutoffTime: Date): Promise<WorkoutSession[]>;

  /**
   * Auto-close timed-out sessions for a user
   */
  autoCloseTimedOut(userId: string, cutoffTime: Date): Promise<number>;
}

export interface ISessionExerciseRepository {
  /**
   * Create a new exercise in a session
   */
  create(sessionId: string, exercise: CreateSessionExerciseDto): Promise<SessionExercise>;

  /**
   * Find an exercise by ID
   */
  findById(exerciseId: string): Promise<SessionExercise | null>;

  /**
   * Find all exercises in a session
   */
  findBySessionId(sessionId: string): Promise<SessionExercise[]>;

  /**
   * Update an exercise
   */
  update(exerciseId: string, updates: Partial<SessionExercise>): Promise<SessionExercise>;
}

export interface ISessionSetRepository {
  /**
   * Create a new set for an exercise
   */
  create(exerciseId: string, set: CreateSessionSetDto): Promise<SessionSet>;

  /**
   * Find a set by ID
   */
  findById(setId: string): Promise<SessionSet | null>;

  /**
   * Find all sets for an exercise
   */
  findByExerciseId(exerciseId: string): Promise<SessionSet[]>;

  /**
   * Update a set
   */
  update(setId: string, updates: Partial<SessionSet>): Promise<SessionSet>;
}

// --- Service Interfaces ---

export interface ITrainingService {
  /**
   * Get AI-powered recommendation for next session
   */
  getNextSessionRecommendation(userId: string): Promise<SessionRecommendation>;

  /**
   * Start a new workout session
   */
  startSession(userId: string, dto: CreateSessionDto): Promise<WorkoutSession>;

  /**
   * Add an exercise to an active session
   */
  addExerciseToSession(sessionId: string, dto: CreateSessionExerciseDto): Promise<SessionExercise>;

  /**
   * Log a set for an exercise
   */
  logSet(exerciseId: string, dto: CreateSessionSetDto): Promise<SessionSet>;

  /**
   * Complete a session
   */
  completeSession(sessionId: string, durationMinutes?: number): Promise<WorkoutSession>;

  /**
   * Get training history for a user
   */
  getTrainingHistory(userId: string, limit?: number): Promise<WorkoutSessionWithDetails[]>;

  /**
   * Get session details
   */
  getSessionDetails(sessionId: string): Promise<WorkoutSessionWithDetails | null>;
}
