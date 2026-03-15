import type { IEmbeddingService } from '@domain/training/ports';

import { createLogger } from '@shared/logger';

const log = createLogger('embedding-service');

const MODEL_ID = 'Xenova/all-MiniLM-L6-v2';
const EMBEDDING_DIMS = 384;

type PipelineFn = (
  texts: string | string[],
  opts?: Record<string, unknown>,
) => Promise<{ data: Float32Array }>;

/**
 * Local embedding service using all-MiniLM-L6-v2 via @huggingface/transformers (ONNX).
 *
 * - ~80MB RAM, no API cost, runs entirely in-process
 * - 384-dimensional vectors, cosine similarity
 * - English-optimised: always pass English text (ADR-0012)
 * - Model is loaded lazily on first use and cached for the process lifetime
 */
export class EmbeddingService implements IEmbeddingService {
  private pipeline: PipelineFn | null = null;
  private initPromise: Promise<void> | null = null;

  private async init(): Promise<void> {
    if (this.pipeline) {
      return;
    }

    if (this.initPromise) {
      await this.initPromise;
      return;
    }

    this.initPromise = (async () => {
      log.info({ model: MODEL_ID }, 'Loading embedding model (first use)');
      const start = Date.now();
      const { pipeline } = await import('@huggingface/transformers');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment
      this.pipeline = (await pipeline('feature-extraction', MODEL_ID, { dtype: 'fp32' })) as any;
      log.info({ model: MODEL_ID, ms: Date.now() - start }, 'Embedding model loaded');
    })();

    await this.initPromise;
  }

  async embed(text: string): Promise<number[]> {
    await this.init();
    if (!this.pipeline) {
      throw new Error('Embedding pipeline failed to initialize');
    }
    const output = await this.pipeline(text, { pooling: 'mean', normalize: true });
    return Array.from(output.data);
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) {
      return [];
    }
    await this.init();
    if (!this.pipeline) {
      throw new Error('Embedding pipeline failed to initialize');
    }
    const output = await this.pipeline(texts, { pooling: 'mean', normalize: true });
    // output.data is a flat Float32Array of shape [n, 384]
    const flat = Array.from(output.data);
    return texts.map((_, i) => flat.slice(i * EMBEDDING_DIMS, (i + 1) * EMBEDDING_DIMS));
  }

  /** Call during bootstrap to pre-warm the model so the first user request is fast. */
  async warmUp(): Promise<void> {
    try {
      await this.init();
      log.info('Embedding model warm-up complete');
    } catch (err) {
      log.error({ err }, 'Embedding model warm-up failed');
    }
  }
}
