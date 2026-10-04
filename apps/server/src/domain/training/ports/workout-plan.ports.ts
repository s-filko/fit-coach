// Workout plan repository port

import type { CreateWorkoutPlanDto, WorkoutPlan } from '@domain/training/types';

// --- DI Tokens ---

export const WORKOUT_PLAN_REPOSITORY_TOKEN = Symbol('WorkoutPlanRepository');

// --- Repository Interface ---

export interface IWorkoutPlanRepository {
  create(userId: string, plan: CreateWorkoutPlanDto): Promise<WorkoutPlan>;
  /**
   * BR-TRAINING-046: saves the plan as the user's single active plan — the user's
   * other active plans are archived and the new one inserted in one transaction.
   */
  createActiveReplacingOthers(userId: string, plan: CreateWorkoutPlanDto): Promise<WorkoutPlan>;
  findById(planId: string): Promise<WorkoutPlan | null>;
  findActiveByUserId(userId: string): Promise<WorkoutPlan | null>;
  findByUserId(userId: string, status?: string): Promise<WorkoutPlan[]>;
  update(planId: string, updates: Partial<WorkoutPlan>): Promise<WorkoutPlan>;
  archive(planId: string): Promise<void>;
}
