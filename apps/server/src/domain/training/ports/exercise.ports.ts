// Exercise repository port

import type { Exercise, ExerciseWithMuscles, MuscleGroup } from '@domain/training/types';

// --- DI Tokens ---

export const EXERCISE_REPOSITORY_TOKEN = Symbol('ExerciseRepository');

// --- Repository Interfaces ---

export interface ExerciseSearchFilters {
  category?: string;
  equipment?: string;
  muscleGroup?: MuscleGroup;
}

export interface IExerciseRepository {
  findById(id: string): Promise<Exercise | null>;
  findByIdWithMuscles(id: string): Promise<ExerciseWithMuscles | null>;
  findByIds(ids: string[]): Promise<Exercise[]>;
  findByIdsWithMuscles(ids: string[]): Promise<ExerciseWithMuscles[]>;
  findByMuscleGroup(muscleGroup: MuscleGroup, primaryOnly?: boolean): Promise<ExerciseWithMuscles[]>;
  search(query: string, limit?: number): Promise<Exercise[]>;
  findAll(filters?: {
    category?: string;
    equipment?: string;
    energyCost?: string;
    complexity?: string;
  }): Promise<Exercise[]>;
  findAllWithMuscles(filters?: {
    category?: string;
    equipment?: string;
    energyCost?: string;
    complexity?: string;
  }): Promise<ExerciseWithMuscles[]>;
  /**
   * Vector similarity search using cosine distance on the embedding column.
   * Applies optional SQL filters before ranking by similarity.
   * Returns exercises with muscles, sorted by descending similarity score.
   */
  searchByEmbedding(
    queryVector: number[],
    opts?: { limit?: number; filters?: ExerciseSearchFilters },
  ): Promise<ExerciseWithMuscles[]>;
  /**
   * Store the computed embedding for an exercise.
   */
  updateEmbedding(exerciseId: string, embedding: number[]): Promise<void>;
}
