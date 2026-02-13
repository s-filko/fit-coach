// Training service interfaces

import type {
  CreateSessionDto,
  CreateSessionExerciseDto,
  CreateSessionSetDto,
  SessionExercise,
  SessionRecommendation,
  SessionSet,
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
  getTrainingHistory(userId: string, limit?: number): Promise<WorkoutSessionWithDetails[]>;
  getSessionDetails(sessionId: string): Promise<WorkoutSessionWithDetails | null>;
  
  // Exercise management during training
  startNextExercise(sessionId: string): Promise<SessionExercise | null>;
  skipCurrentExercise(sessionId: string, reason?: string): Promise<void>;
  completeCurrentExercise(sessionId: string): Promise<void>;
}
