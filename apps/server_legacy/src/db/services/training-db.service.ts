import { eq, and, desc } from 'drizzle-orm';
import { BaseDbService } from '../base/base-db.service';
import { db } from '@db/services/db';
import { trainings, exercises, exerciseProgress } from '@db/schema';
import { Training, Exercise, ExerciseProgress } from '@models/training.types';
import { AppError } from '@middleware/error';

export class TrainingDbService extends BaseDbService {
  constructor() {
    super(db);
  }

  async findById(trainingId: string): Promise<Training | null> {
    return this.withErrorHandling(async () => {
      return this.db.query.trainings.findFirst({
        where: eq(trainings.id, trainingId)
      });
    });
  }

  async getTrainingWithDetails(trainingId: string) {
    return this.withErrorHandling(async () => {
      return this.db.query.trainings.findFirst({
        where: eq(trainings.id, trainingId),
        with: {
          exercises: {
            with: {
              progress: true
            }
          }
        }
      });
    });
  }

  async getUserTrainings(userId: string, options: { 
    limit?: number;
    status?: string;
    includeExercises?: boolean;
  } = {}) {
    return this.withErrorHandling(async () => {
      const where = options.status 
        ? and(
            eq(trainings.userId, userId),
            eq(trainings.status, options.status)
          )
        : eq(trainings.userId, userId);

      return this.db.query.trainings.findMany({
        where,
        limit: options.limit,
        orderBy: desc(trainings.createdAt),
        with: options.includeExercises ? {
          exercises: {
            with: {
              progress: true
            }
          }
        } : undefined
      });
    });
  }

  async createTraining(data: {
    userId: string;
    type: string;
    status: string;
    exercises: Array<{
      name: string;
      sets: number;
      reps: number;
      weight?: number;
    }>;
  }) {
    return this.transaction(async (tx) => {
      const [training] = await tx.insert(trainings)
        .values({
          userId: data.userId,
          type: data.type,
          status: data.status
        })
        .returning();

      if (!training) {
        throw new AppError(500, 'Failed to create training');
      }

      await tx.insert(exercises)
        .values(
          data.exercises.map(exercise => ({
            trainingId: training.id,
            name: exercise.name,
            sets: exercise.sets,
            reps: exercise.reps,
            weight: exercise.weight
          }))
        );

      return this.getTrainingWithDetails(training.id);
    });
  }

  async updateTrainingProgress(trainingId: string, exerciseId: string, data: {
    completedSets: number;
    completedReps: number;
    weight?: number;
  }) {
    return this.withErrorHandling(async () => {
      const [progress] = await this.db.insert(exerciseProgress)
        .values({
          trainingId,
          exerciseId,
          completedSets: data.completedSets,
          completedReps: data.completedReps,
          weight: data.weight
        })
        .returning();

      if (!progress) {
        throw new AppError(500, 'Failed to update training progress');
      }

      return progress;
    });
  }
} 