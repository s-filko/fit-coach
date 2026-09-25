/**
 * The reusable embedding-backfill logic behind `seed-embeddings.ts`'s CLI
 * script. Split out (close-out review correction, 2026-09-25) so it can be
 * imported by `evals/lib/scenario-world.ts` (itself required by every
 * scenario test through Jest/ts-jest) without dragging in `seed-embeddings.ts`'s
 * bottom-of-file `import.meta`/top-level-`await` CLI bootstrap — ts-jest
 * compiles every file with a CommonJS-targeted tsconfig regardless of what
 * `tsc --noEmit` accepts, and rejects both.
 */
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';

import type { IEmbeddingService } from '@domain/training/ports';
import type { MuscleGroup } from '@domain/training/types';

import { buildEmbeddingText } from '@infra/ai/embedding-text.util';
import { db } from '@infra/db/drizzle';
import { exerciseMuscleGroups, exercises } from '@infra/db/schema';

import { createLogger } from '@shared/logger';

const log = createLogger('seed-embeddings');

/**
 * Embeds and persists every exercise with a NULL embedding, optionally
 * narrowed to `names` (the scenario-test seed reuses this for its own
 * newly-inserted exercises, passing the caller's already-loaded
 * `IEmbeddingService` instead of loading a second copy of the model).
 * Returns how many rows it embedded.
 */
export async function embedPendingExercises(embeddingService: IEmbeddingService, names?: string[]): Promise<number> {
  const pending = await db
    .select()
    .from(exercises)
    .where(names ? and(isNull(exercises.embedding), inArray(exercises.name, names)) : isNull(exercises.embedding));
  if (pending.length === 0) {
    return 0;
  }

  log.info({ count: pending.length }, 'Generating embeddings for exercises');

  // Load all muscle groups in one query and group by exercise
  const allMuscles = await db
    .select()
    .from(exerciseMuscleGroups)
    .where(
      inArray(
        exerciseMuscleGroups.exerciseId,
        pending.map(ex => ex.id),
      ),
    );
  const musclesByExercise = new Map<string, typeof allMuscles>();
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

  // One SEQUENTIAL `embed()` call per text, not a single `embedBatch()` call:
  // a batch of more than one text hits a real onnxruntime bug in this
  // environment ("A float32 tensor's data must be type of Float32Array") the
  // moment it is exercised from inside Jest (discovered by this change —
  // embedBatch was previously only ever run from the standalone
  // `seed-embeddings.ts` CLI script via `npx tsx`, never from a test
  // process). Sequential, not `Promise.all`, since the underlying ONNX
  // session is not known to be safe for concurrent calls. The model loads
  // once regardless — cached on the instance after the first call.
  log.info({ count: texts.length }, 'Calling embed');
  const vectors: number[][] = [];
  for (const text of texts) {
    vectors.push(await embeddingService.embed(text));
  }

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
  return pending.length;
}
