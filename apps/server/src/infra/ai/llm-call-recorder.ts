/**
 * AC-AT-3: durable, LOG_LEVEL-independent storage for every model invocation.
 * LangChain-free by design — `llm-log-handler.ts` is the only caller and owns
 * all the LangChain-shaped extraction; this module only knows the request/
 * response shape it is handed and how to persist it.
 */
import { createHash } from 'node:crypto';

/** One message of the request as stored — a system message carries `contentHash`, never `content` (AC-AT-3 dedup). */
export interface RecordedRequestMessage {
  role: string;
  content?: unknown;
  contentHash?: string;
  tool_calls?: unknown;
  tool_call_id?: string;
}

export interface RecordLlmCallRequest {
  model: string;
  messages: RecordedRequestMessage[];
  temperature?: unknown;
  tools?: unknown[];
  reasoningEffort?: unknown;
}

export interface RecordLlmCallResponse {
  text: string;
  toolCalls?: unknown;
  finishReason: string | null;
  usage: { promptTokens: number; completionTokens: number } | null;
}

export interface RecordLlmCallInput {
  runId: string;
  model: string;
  request: RecordLlmCallRequest;
  /** Null when the call failed before any response. */
  response: RecordLlmCallResponse | null;
  latencyMs: number;
  errorClass?: string | null;
  errorMessage?: string | null;
}

export type RecordLlmCall = (input: RecordLlmCallInput) => Promise<void>;

/**
 * AC-AT-3: one `llm_calls` row per call — `call_index` continues from this
 * run's own max (the Task 3 pattern: no in-memory per-run counter, so a
 * shared-singleton caller never needs to track run-scoped state itself).
 * EVERY system message (assemble-context.ts pushes up to six — the static
 * rules text, but also per-profile/per-episode/per-workout blocks that
 * change on nearly every call) is stored once per distinct content hash in
 * `prompt_blobs` and referenced, not repeated; their hashes are ALSO written
 * to this row's own `prompt_hashes` (AC-AT-6), so a blob's liveness stays
 * answerable after `request` itself is pruned. The insert is an upsert, not
 * insert-if-absent: AC-AT-6's blob-prune can null a blob's `content` once no
 * unpruned row references it any more, and identical content later hashing
 * to the same key must restore it, not leave it stuck null. `errorMessage`
 * arrives already truncated — @shared/classify-error is the one place that
 * decides the length policy, shared with conversation_runs.error_message —
 * so it is stored as given, never re-truncated here. Never throws
 * (D-F-style): the caller (a LangChain callback) must never fail the run
 * over this.
 */
export const recordLlmCall: RecordLlmCall = async input => {
  const { db } = await import('@infra/db/drizzle');
  const { llmCalls, promptBlobs } = await import('@infra/db/schema');
  const { eq, max } = await import('drizzle-orm');

  const promptHashes: string[] = [];
  const messages = await Promise.all(
    input.request.messages.map(async message => {
      if (message.role !== 'system' || typeof message.content !== 'string') {
        return message;
      }
      const hash = createHash('sha256').update(message.content).digest('hex');
      promptHashes.push(hash);
      await db
        .insert(promptBlobs)
        .values({ hash, content: message.content })
        .onConflictDoUpdate({ target: promptBlobs.hash, set: { content: message.content } });
      const { content: _content, ...rest } = message;
      return { ...rest, contentHash: hash };
    }),
  );

  // No unique constraint on (run_id, call_index) — a deliberate decision, not an
  // oversight. A recorder error is swallowed by design (D-F-style), so a unique
  // violation on a rare race would turn into a LOST call record; a duplicated
  // index instead costs nothing an audit trail cannot survive, since created_at
  // still orders same-index rows within a run.
  const [{ maxIndex }] = await db
    .select({ maxIndex: max(llmCalls.callIndex) })
    .from(llmCalls)
    .where(eq(llmCalls.runId, input.runId));

  await db.insert(llmCalls).values({
    runId: input.runId,
    callIndex: (maxIndex ?? 0) + 1,
    model: input.model,
    request: { ...input.request, messages },
    response: input.response,
    promptHashes,
    latencyMs: input.latencyMs,
    errorClass: input.errorClass ?? null,
    errorMessage: input.errorMessage ?? null,
  });
};
