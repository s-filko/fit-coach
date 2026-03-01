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
  startNextExercise(sessionId: string): Promise<SessionExercise | null>;
  skipCurrentExercise(sessionId: string, reason?: string): Promise<void>;
  completeCurrentExercise(sessionId: string): Promise<void>;

  // Lazily ensure an in_progress exercise exists (creates from plan or ad-hoc if needed)
  ensureCurrentExercise(
    sessionId: string,
    opts?: { exerciseId?: number; exerciseName?: string },
  ): Promise<SessionExercise>;

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
  ): Promise<{ set: SessionSet; setNumber: number }>;
}
