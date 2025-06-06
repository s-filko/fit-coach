import { eq } from 'drizzle-orm';
import { BaseDbService } from './base-db.service';
import { db } from '@db/db';
import { trainingContext } from '@db/schema';
import { AppError } from '@middleware/error';
import type { TrainingGoal, StrengthLevel, RecoveryStatus, IntensityPreference } from '@models/training.types';
import type { InferSelectModel } from 'drizzle-orm';

type TrainingContext = InferSelectModel<typeof trainingContext>;
type RecentProgress = { exercise: string; improvement: string; date: Date };

export class TrainingContextDbService extends BaseDbService {
  constructor() {
    super(db);
  }

  async getTrainingContext(userId: string): Promise<TrainingContext | null> {
    return this.withErrorHandling(async () => {
      const result = await this.db.select().from(trainingContext).where(eq(trainingContext.userId, userId));
      return result[0] || null;
    });
  }

  async upsertTrainingContext(context: Partial<TrainingContext> & { userId: string }): Promise<TrainingContext> {
    return this.withErrorHandling(async () => {
      const existing = await this.getTrainingContext(context.userId);
      
      if (existing) {
        const [updated] = await this.db
          .update(trainingContext)
          .set({
            ...context,
            lastUpdated: new Date()
          })
          .where(eq(trainingContext.userId, context.userId))
          .returning();
        return updated;
      }

      const [created] = await this.db
        .insert(trainingContext)
        .values({
          ...context,
          lastUpdated: new Date()
        })
        .returning();
      return created;
    });
  }

  async updateTrainingContext(
    userId: string,
    updates: Partial<Omit<TrainingContext, 'id' | 'userId' | 'lastUpdated'>>
  ): Promise<TrainingContext> {
    return this.withErrorHandling(async () => {
      const [updated] = await this.db
        .update(trainingContext)
        .set({
          ...updates,
          lastUpdated: new Date()
        })
        .where(eq(trainingContext.userId, userId))
        .returning();
      return updated;
    });
  }

  async updateRecoveryStatus(userId: string, status: RecoveryStatus): Promise<TrainingContext> {
    return this.updateTrainingContext(userId, { recoveryStatus: status });
  }

  async addProgress(
    userId: string,
    progress: { exercise: string; improvement: string }
  ): Promise<TrainingContext> {
    return this.withErrorHandling(async () => {
      const context = await this.getTrainingContext(userId);
      if (!context) {
        throw new AppError(404, 'Training context not found');
      }

      const recentProgress = [
        ...(context.recentProgress as RecentProgress[] || []),
        { ...progress, date: new Date() }
      ].slice(-5); // Keep only last 5 progress records

      return this.updateTrainingContext(userId, { recentProgress });
    });
  }

  async updateTargetAreas(
    userId: string,
    areas: { upper_body: number; lower_body: number; core: number; cardio: number }
  ): Promise<TrainingContext> {
    return this.updateTrainingContext(userId, { targetAreas: areas });
  }

  async updateTrainingSchedule(
    userId: string,
    schedule: { frequency: number; preferred_time: string; max_duration: number }
  ): Promise<TrainingContext> {
    return this.updateTrainingContext(userId, { trainingSchedule: schedule });
  }

  async updateTimeLimitations(
    userId: string,
    limitations: { max_session_duration: number; available_days: string[]; preferred_times: string[] }
  ): Promise<TrainingContext> {
    return this.updateTrainingContext(userId, { timeLimitations: limitations });
  }

  async updateEquipmentAvailable(userId: string, equipment: string[]): Promise<TrainingContext> {
    return this.updateTrainingContext(userId, { equipmentAvailable: equipment });
  }

  async updatePhysicalLimitations(userId: string, limitations: string[]): Promise<TrainingContext> {
    return this.updateTrainingContext(userId, { physicalLimitations: limitations });
  }
} 