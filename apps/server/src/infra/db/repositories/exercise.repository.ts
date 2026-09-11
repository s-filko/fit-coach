import { eq, ilike, inArray, sql } from 'drizzle-orm';

import type { ExerciseSearchFilters, IExerciseRepository } from '@domain/training/ports';
import type { Exercise, ExerciseWithMuscles, MuscleGroup } from '@domain/training/types';

import { db } from '@infra/db/drizzle';
import { exerciseMuscleGroups, exercises } from '@infra/db/schema';

export class ExerciseRepository implements IExerciseRepository {
  async findById(id: string): Promise<Exercise | null> {
    const [exercise] = await db.select().from(exercises).where(eq(exercises.id, id));
    return (exercise as Exercise) ?? null;
  }

  async findByIdWithMuscles(id: string): Promise<ExerciseWithMuscles | null> {
    const exercise = await this.findById(id);
    if (!exercise) {
      return null;
    }

    const muscles = await db.select().from(exerciseMuscleGroups).where(eq(exerciseMuscleGroups.exerciseId, id));

    return {
      ...exercise,
      muscleGroups: muscles.map(m => ({
        muscleGroup: m.muscleGroup as MuscleGroup,
        involvement: m.involvement as 'primary' | 'secondary',
      })),
    } as ExerciseWithMuscles;
  }

  async findByIds(ids: string[]): Promise<Exercise[]> {
    if (ids.length === 0) {
      return [];
    }
    return db.select().from(exercises).where(inArray(exercises.id, ids)) as Promise<Exercise[]>;
  }

  async findByIdsWithMuscles(ids: string[]): Promise<ExerciseWithMuscles[]> {
    if (ids.length === 0) {
      return [];
    }

    const exercisesList = await this.findByIds(ids);
    const muscles = await db.select().from(exerciseMuscleGroups).where(inArray(exerciseMuscleGroups.exerciseId, ids));

    return exercisesList.map(exercise => ({
      ...exercise,
      muscleGroups: muscles
        .filter(m => m.exerciseId === exercise.id)
        .map(m => ({
          muscleGroup: m.muscleGroup as MuscleGroup,
          involvement: m.involvement as 'primary' | 'secondary',
        })),
    })) as ExerciseWithMuscles[];
  }

  async findByMuscleGroup(muscleGroup: MuscleGroup, primaryOnly = false): Promise<ExerciseWithMuscles[]> {
    const muscleFilter = eq(exerciseMuscleGroups.muscleGroup, muscleGroup);
    const involvementFilter = primaryOnly ? eq(exerciseMuscleGroups.involvement, 'primary') : undefined;

    const matchingMuscles = await db
      .select()
      .from(exerciseMuscleGroups)
      .where(involvementFilter ? sql`${muscleFilter} AND ${involvementFilter}` : muscleFilter);

    const exerciseIds = [...new Set(matchingMuscles.map(m => m.exerciseId))];
    return this.findByIdsWithMuscles(exerciseIds);
  }

  async search(query: string, limit = 20): Promise<Exercise[]> {
    return db
      .select()
      .from(exercises)
      .where(ilike(exercises.name, `%${query}%`))
      .limit(limit) as Promise<Exercise[]>;
  }

  async findAll(filters?: {
    category?: string;
    equipment?: string;
    energyCost?: string;
    complexity?: string;
  }): Promise<Exercise[]> {
    if (!filters) {
      return db.select().from(exercises) as Promise<Exercise[]>;
    }

    const conditions = [];
    if (filters.category) {
      conditions.push(eq(exercises.category, filters.category));
    }
    if (filters.equipment) {
      conditions.push(eq(exercises.equipment, filters.equipment));
    }
    if (filters.energyCost) {
      conditions.push(eq(exercises.energyCost, filters.energyCost));
    }
    if (filters.complexity) {
      conditions.push(eq(exercises.complexity, filters.complexity));
    }

    if (conditions.length === 0) {
      return db.select().from(exercises) as Promise<Exercise[]>;
    }

    return db
      .select()
      .from(exercises)
      .where(sql`${sql.join(conditions, sql` AND `)}`) as Promise<Exercise[]>;
  }

  async findAllWithMuscles(filters?: {
    category?: string;
    equipment?: string;
    energyCost?: string;
    complexity?: string;
  }): Promise<ExerciseWithMuscles[]> {
    const exercisesList = await this.findAll(filters);
    if (exercisesList.length === 0) {
      return [];
    }
    const ids = exercisesList.map(e => e.id);
    return this.findByIdsWithMuscles(ids);
  }

  async searchByEmbedding(
    queryVector: number[],
    opts?: { limit?: number; filters?: ExerciseSearchFilters },
  ): Promise<ExerciseWithMuscles[]> {
    const limit = opts?.limit ?? 10;
    const filters = opts?.filters;

    const filterConditions: ReturnType<typeof sql>[] = [];

    if (filters?.category) {
      filterConditions.push(sql`${exercises.category} = ${filters.category}`);
    }
    if (filters?.equipment) {
      filterConditions.push(sql`${exercises.equipment} = ${filters.equipment}`);
    }
    if (filters?.muscleGroup) {
      // Join to exercise_muscle_groups for muscle group filter
      filterConditions.push(
        sql`${exercises.id} IN (
          SELECT exercise_id FROM exercise_muscle_groups
          WHERE muscle_group = ${filters.muscleGroup}
        )`,
      );
    }

    const whereClause =
      filterConditions.length > 0
        ? sql`${exercises.embedding} IS NOT NULL AND ${sql.join(filterConditions, sql` AND `)}`
        : sql`${exercises.embedding} IS NOT NULL`;

    // Cast vector literal using pgvector operator
    const vectorLiteral = `[${queryVector.join(',')}]`;

    const rows = await db
      .select({ id: exercises.id })
      .from(exercises)
      .where(whereClause)
      .orderBy(sql`${exercises.embedding} <=> ${vectorLiteral}::vector`)
      .limit(limit);

    if (rows.length === 0) {
      return [];
    }

    const ids = rows.map(r => r.id);
    // Preserve order from similarity ranking
    const withMuscles = await this.findByIdsWithMuscles(ids);
    const byId = new Map(withMuscles.map(e => [e.id, e]));
    return ids.map(id => byId.get(id)).filter((e): e is ExerciseWithMuscles => e !== undefined);
  }

  async updateEmbedding(exerciseId: string, embedding: number[]): Promise<void> {
    const vectorLiteral = `[${embedding.join(',')}]`;
    await db
      .update(exercises)
      .set({ embedding: sql`${vectorLiteral}::vector` })
      .where(eq(exercises.id, exerciseId));
  }
}
