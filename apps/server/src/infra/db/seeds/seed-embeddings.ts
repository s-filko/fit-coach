/**
 * CLI entry point: generates and stores embeddings for exercises that have a
 * NULL embedding.
 *
 * Run once after migration:
 *   npx tsx src/infra/db/seeds/seed-embeddings.ts
 *
 * Safe to re-run — skips exercises that already have an embedding. The
 * reusable logic lives in `embed-pending-exercises.ts` (never imported here
 * by a test — see that file's header for why).
 */
import { EmbeddingService } from '@infra/ai/embedding.service';

import { createLogger } from '@shared/logger';

import { embedPendingExercises } from './embed-pending-exercises';

const log = createLogger('seed-embeddings');

export async function seedEmbeddings(): Promise<void> {
  const embeddingService = new EmbeddingService();
  const count = await embedPendingExercises(embeddingService);
  if (count === 0) {
    log.info('All exercises already have embeddings — nothing to do');
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await seedEmbeddings();
  // Small delay to let ONNX worker threads shut down cleanly before exit.
  // Without this, process.exit(0) races with ONNX internals and triggers
  // "mutex lock failed" from libc++abi — data is safe but exit looks like a crash.
  await new Promise(r => setTimeout(r, 500));
  process.exit(0);
}
