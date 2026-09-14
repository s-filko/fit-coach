// Workout plan repository port

import type { CreateWorkoutPlanDto, WorkoutPlan } from '@domain/training/types';

// --- DI Tokens ---

export const WORKOUT_PLAN_REPOSITORY_TOKEN = Symbol('WorkoutPlanRepository');

// --- Repository Interface ---

export interface IWorkoutPlanRepository {
  create(userId: string, plan: CreateWorkoutPlanDto): Promise<WorkoutPlan>;
  findById(planId: string): Promise<WorkoutPlan | null>;
  findActiveByUserId(userId: string): Promise<WorkoutPlan | null>;
  findByUserId(userId: string, status?: string): Promise<WorkoutPlan[]>;
  update(planId: string, updates: Partial<WorkoutPlan>): Promise<WorkoutPlan>;
  archive(planId: string): Promise<void>;
}
