/**
 * `prompt_blobs` hash → content resolution, shared by every reader of a stored request (DRY,
 * cache-accounting plan Task 1 follow-up, R2): `observability/transcript-reader.ts` (print-transcript)
 * and `ai/llm-call-recorder.ts` (the previous-call lookup for cache attribution) both need the same
 * "given these hashes, what did the blob contain, or did BR-LLM-011 already prune it" query.
 */
import { inArray } from 'drizzle-orm';

import { db } from './drizzle';
import { promptBlobs } from './schema';

/**
 * A missing key (not in the returned map) means the hash was never stored at all — should not
 * happen; a present key with a `null` value means the row exists but BR-LLM-011's prune already
 * dropped its content.
 */
export async function resolveBlobContents(hashes: readonly string[]): Promise<Map<string, string | null>> {
  if (hashes.length === 0) {
    return new Map();
  }
  const rows = await db
    .select({ hash: promptBlobs.hash, content: promptBlobs.content })
    .from(promptBlobs)
    .where(inArray(promptBlobs.hash, hashes));
  return new Map(rows.map(r => [r.hash, r.content]));
}
