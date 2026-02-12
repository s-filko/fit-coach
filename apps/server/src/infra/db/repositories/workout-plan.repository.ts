import { and, eq } from 'drizzle-orm';

import type { IWorkoutPlanRepository } from '@domain/training/ports';
import type { CreateWorkoutPlanDto, WorkoutPlan, WorkoutPlanStatus } from '@domain/training/types';

import { db } from '@infra/db/drizzle';
import { workoutPlans } from '@infra/db/schema';

export class WorkoutPlanRepository implements IWorkoutPlanRepository {
  async create(userId: string, plan: CreateWorkoutPlanDto): Promise<WorkoutPlan> {
    const [created] = await db
      .insert(workoutPlans)
      .values({
        userId,
        name: plan.name,
        planJson: plan.planJson,
        status: plan.status ?? 'active',
      })
      .returning();

    return {
      ...created,
      planJson: created.planJson as WorkoutPlan['planJson'],
    };
  }

  async findById(planId: string): Promise<WorkoutPlan | null> {
    const [plan] = await db.select().from(workoutPlans).where(eq(workoutPlans.id, planId));

    if (!plan) {
      return null;
    }

    return {
      ...plan,
      planJson: plan.planJson as WorkoutPlan['planJson'],
    };
  }

  async findActiveByUserId(userId: string): Promise<WorkoutPlan | null> {
    const [plan] = await db
      .select()
      .from(workoutPlans)
      .where(and(eq(workoutPlans.userId, userId), eq(workoutPlans.status, 'active')))
      .limit(1);

    if (!plan) {
      return null;
    }

    return {
      ...plan,
      planJson: plan.planJson as WorkoutPlan['planJson'],
    };
  }

  async findByUserId(userId: string, status?: WorkoutPlanStatus): Promise<WorkoutPlan[]> {
    const conditions = [eq(workoutPlans.userId, userId)];
    if (status) {
      conditions.push(eq(workoutPlans.status, status as 'active' | 'draft' | 'archived'));
    }

    const plans = await db
      .select()
      .from(workoutPlans)
      .where(and(...conditions));

    return plans.map((plan) => ({
      ...plan,
      planJson: plan.planJson as WorkoutPlan['planJson'],
    }));
  }

  async update(planId: string, updates: Partial<WorkoutPlan>): Promise<WorkoutPlan> {
    const [updated] = await db
      .update(workoutPlans)
      .set({
        ...updates,
        updatedAt: new Date(),
      })
      .where(eq(workoutPlans.id, planId))
      .returning();

    return {
      ...updated,
      planJson: updated.planJson as WorkoutPlan['planJson'],
    };
  }

  async archive(planId: string): Promise<void> {
    await db
      .update(workoutPlans)
      .set({ status: 'archived', updatedAt: new Date() })
      .where(eq(workoutPlans.id, planId));
  }
}
