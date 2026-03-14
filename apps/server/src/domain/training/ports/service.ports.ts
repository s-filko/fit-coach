// Training service interfaces

import type {
  CreateSessionDto,
  CreateSessionExerciseDto,
  CreateSessionSetDto,
  SessionExercise,
  SessionRecommendation,
  SessionSet,
  SetData,
  WorkoutSession,
  WorkoutSessionWithDetails,
} from '@domain/training/types';

// --- DI Tokens ---

export const TRAINING_SERVICE_TOKEN = Symbol('TrainingService');

// --- Result Types ---

/** Metadata returned when ensureCurrentExercise auto-completes a previous exercise on switch. */
export interface AutoCompletedExercise {
  exerciseId: number;
  exerciseName: string;
  setsLogged: number;
}

/** Return type for ensureCurrentExercise — includes optional auto-complete metadata. */
export interface EnsureExerciseResult {
  exercise: SessionExercise;
  autoCompleted?: AutoCompletedExercise;
}

/** Details of a single deleted set, returned by deleteLastSets for LLM to relay to the user. */
export interface DeletedSetDetail {
  setNumber: number;
  setData: SessionSet['setData'];
  rpe: number | null;
}

export interface DeletedSetsResult {
  exerciseId: number;
  deletedSets: DeletedSetDetail[];
}

/** Before/after diff returned by updateLastSet. */
export interface UpdateSetResult {
  exerciseId: number;
  setNumber: number;
  before: Pick<SessionSet, 'setData' | 'rpe' | 'userFeedback'>;
  after: Pick<SessionSet, 'setData' | 'rpe' | 'userFeedback'>;
}

// --- Service Interfaces ---

export interface ITrainingService {
  getNextSessionRecommendation(userId: string): Promise<SessionRecommendation>;
  startSession(userId: string, dto: CreateSessionDto): Promise<WorkoutSession>;
  addExerciseToSession(sessionId: string, dto: CreateSessionExerciseDto): Promise<SessionExercise>;
  logSet(exerciseId: string, dto: CreateSessionSetDto): Promise<SessionSet>;
  completeSession(sessionId: string, durationMinutes?: number): Promise<WorkoutSession>;
  skipSession(sessionId: string): Promise<WorkoutSession>;
  getTrainingHistory(userId: string, limit?: number): Promise<WorkoutSessionWithDetails[]>;
  getSessionDetails(sessionId: string): Promise<WorkoutSessionWithDetails | null>;

  // Exercise management during training
  startNextExercise(sessionId: string, exerciseId?: number): Promise<SessionExercise | null>;
  skipCurrentExercise(sessionId: string, reason?: string): Promise<void>;
  completeCurrentExercise(sessionId: string): Promise<void>;

  // Lazily ensure an in_progress exercise exists (creates from plan or ad-hoc if needed).
  // Auto-completes the current in_progress exercise when switching to a different exerciseId.
  ensureCurrentExercise(
    sessionId: string,
    opts?: { exerciseId?: number; exerciseName?: string },
  ): Promise<EnsureExerciseResult>;

  // Correction tools (ADR-0011 Phase 2)
  deleteLastSets(sessionId: string, exerciseId: number, count?: number): Promise<DeletedSetsResult>;
  updateLastSet(
    sessionId: string,
    exerciseId: number,
    updates: { rpe?: number; feedback?: string; weight?: number; reps?: number },
  ): Promise<UpdateSetResult>;

  // Log a set for the current exercise, auto-computing setNumber from existing sets in DB
  logSetWithContext(
    sessionId: string,
    opts: {
      exerciseId?: number;
      exerciseName?: string;
      setData: SetData;
      rpe?: number;
      feedback?: string;
    },
  ): Promise<{ set: SessionSet; setNumber: number; autoCompleted?: AutoCompletedExercise }>;
}
