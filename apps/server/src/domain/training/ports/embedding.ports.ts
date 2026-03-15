export const EMBEDDING_SERVICE_TOKEN = Symbol('EmbeddingService');

export interface IEmbeddingService {
  /**
   * Generate a 384-dimensional embedding vector for the given text.
   * Text should be in English for best results (all-MiniLM-L6-v2 model).
   */
  embed(text: string): Promise<number[]>;

  /**
   * Embed multiple texts in a single batch call.
   * Returns arrays in the same order as the input.
   */
  embedBatch(texts: string[]): Promise<number[][]>;
}
