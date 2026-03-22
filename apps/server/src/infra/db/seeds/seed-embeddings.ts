/**
 * Generates and stores embeddings for all exercises that have a NULL embedding.
 *
 * Run once after migration:
 *   npx tsx src/infra/db/seeds/seed-embeddings.ts
 *
 * Safe to re-run — skips exercises that already have an embedding.
 */
import { eq, isNull, sql } from 'drizzle-orm';

import type { MuscleGroup } from '@domain/training/types';

import { buildEmbeddingText } from '@infra/ai/embedding-text.util';
import { EmbeddingService } from '@infra/ai/embedding.service';
import { db } from '@infra/db/drizzle';
import { exerciseMuscleGroups, exercises } from '@infra/db/schema';

import { createLogger } from '@shared/logger';

const log = createLogger('seed-embeddings');

export async function seedEmbeddings(): Promise<void> {
  const embeddingService = new EmbeddingService();

  // Load exercises that need embeddings
  const pending = await db.select().from(exercises).where(isNull(exercises.embedding));
  if (pending.length === 0) {
    log.info('All exercises already have embeddings — nothing to do');
    return;
  }

  log.info({ count: pending.length }, 'Generating embeddings for exercises');

  // Load all muscle groups in one query and group by exercise
  const allMuscles = await db.select().from(exerciseMuscleGroups);
  const musclesByExercise = new Map<number, typeof allMuscles>();
  for (const m of allMuscles) {
    const list = musclesByExercise.get(m.exerciseId) ?? [];
    list.push(m);
    musclesByExercise.set(m.exerciseId, list);
  }

  // Build composite texts for all pending exercises
  const texts = pending.map(ex => {
    const muscles = (musclesByExercise.get(ex.id) ?? []).map(m => ({
      muscleGroup: m.muscleGroup as MuscleGroup,
      involvement: m.involvement as 'primary' | 'secondary',
    }));
    return buildEmbeddingText({
      name: ex.name,
      category: ex.category as 'compound' | 'isolation' | 'cardio' | 'functional' | 'mobility',
      equipment: ex.equipment as 'barbell' | 'dumbbell' | 'bodyweight' | 'machine' | 'cable' | 'none',
      complexity: ex.complexity as 'beginner' | 'intermediate' | 'advanced',
      description: ex.description,
      muscleGroups: muscles,
    });
  });

  // Generate all embeddings in a single batch call (model loaded once)
  log.info({ count: texts.length }, 'Calling embedBatch');
  const vectors = await embeddingService.embedBatch(texts);

  // Persist each embedding via raw SQL (Drizzle doesn't support vector literals natively)
  for (let i = 0; i < pending.length; i++) {
    const exercise = pending[i];
    const vector = vectors[i];
    if (!exercise || !vector) {
      continue;
    }
    const vectorLiteral = `[${vector.join(',')}]`;
    await db
      .update(exercises)
      .set({ embedding: sql`${vectorLiteral}::vector` })
      .where(eq(exercises.id, exercise.id));
    log.debug({ id: exercise.id, name: exercise.name }, 'embedding stored');
  }

  log.info({ count: pending.length }, 'Embeddings seeded successfully');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await seedEmbeddings();
  // Small delay to let ONNX worker threads shut down cleanly before exit.
  // Without this, process.exit(0) races with ONNX internals and triggers
  // "mutex lock failed" from libc++abi — data is safe but exit looks like a crash.
  await new Promise(r => setTimeout(r, 500));
  process.exit(0);
}
