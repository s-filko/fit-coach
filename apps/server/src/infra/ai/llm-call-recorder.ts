/**
 * INV-LLM-008: durable, LOG_LEVEL-independent storage for every model invocation.
 * LangChain-free by design — `llm-log-handler.ts` is the only caller and owns
 * all the LangChain-shaped extraction; this module only knows the request/
 * response shape it is handed and how to persist it.
 */
import { createHash } from 'node:crypto';

import { createLogger } from '@shared/logger';

import {
  attributeCache,
  type CacheAttributionMessage,
  type CacheAttributionRequest,
  type PreviousCallLookup,
} from './cache-attribution';

const log = createLogger('llm-call-recorder');

/**
 * One message of the request as stored — a system message carries `contentHash`, never `content`
 * (INV-LLM-008 dedup).
 */
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
  // INV-LLM-008: the stored request is what was actually sent, not a hand-picked subset — these
  // are the other invocation_params LangChain builds per call, recorded whenever the profile/call
  // sets them (never fabricated, never a credential).
  maxTokens?: unknown;
  responseFormat?: unknown;
  topP?: unknown;
  stop?: unknown;
  toolChoice?: unknown;
}

export interface RecordLlmCallResponse {
  text: string;
  toolCalls?: unknown;
  finishReason: string | null;
  // D2: null means the provider did not report that field, never 0 — 0 is itself meaningful
  // ("reported, nothing cached/no reasoning this call"). promptTokens/completionTokens keep their
  // pre-cache-accounting names; cacheReadTokens/reasoningTokens are the two fields D1 adds.
  usage: {
    promptTokens: number | null;
    completionTokens: number | null;
    // D1: the two fields this plan adds — optional so a caller/fixture built before this plan
    // (e.g. an older test literal) stays valid; a missing key reads the same as null.
    cacheReadTokens?: number | null;
    reasoningTokens?: number | null;
  } | null;
}

export interface RecordLlmCallInput {
  runId: string;
  /** D1: from callback metadata (conversation-run.adapter.ts) — nullable like `runId`'s FK-free reasoning. */
  userId: string | null;
  model: string;
  request: RecordLlmCallRequest;
  /** Null when the call failed before any response. */
  response: RecordLlmCallResponse | null;
  /**
   * D5/close-out review (advisory R3): epoch ms when THIS call was sent (`pending.startedAt` in
   * llm-log-handler.ts) — `cache_gap_ms` is measured from here, never from record time (after the
   * response), which would fold the call's own latency (seconds, sometimes 10+) into the gap.
   */
  startedAt: number;
  latencyMs: number;
  errorClass?: string | null;
  errorMessage?: string | null;
}

export type RecordLlmCall = (input: RecordLlmCallInput) => Promise<void>;

/**
 * INV-LLM-008: one `llm_calls` row per call — `call_index` continues from this
 * run's own max (the Task 3 pattern: no in-memory per-run counter, so a
 * shared-singleton caller never needs to track run-scoped state itself).
 * EVERY system message (assemble-context.ts pushes up to six — the static
 * rules text, but also per-profile/per-episode/per-workout blocks that
 * change on nearly every call) is stored once per distinct content hash in
 * `prompt_blobs` and referenced, not repeated; their hashes are ALSO written
 * to this row's own `prompt_hashes` (BR-LLM-011), so a blob's liveness stays
 * answerable after `request` itself is pruned. The insert is an upsert, not
 * insert-if-absent: BR-LLM-011's blob-prune can null a blob's `content` once no
 * unpruned row references it any more, and identical content later hashing
 * to the same key must restore it, not leave it stuck null. `errorMessage`
 * arrives already truncated — @shared/classify-error is the one place that
 * decides the length policy, shared with conversation_runs.error_message —
 * so it is stored as given, never re-truncated here. Never throws
 * (D-F-style): the caller (a LangChain callback) must never fail the run
 * over this.
 */
/** D4: the recorder's own view of a message, before hashing — plain content either way. */
function toCacheAttributionMessage(message: RecordedRequestMessage): CacheAttributionMessage {
  return {
    role: message.role,
    content: message.content,
    toolCalls: message.tool_calls,
    toolCallId: message.tool_call_id,
  };
}

/**
 * D3/D4: the previous `llm_calls` row of the same user+model, its system messages resolved back to
 * text via `prompt_blobs` (never re-hashed content — the stored row already replaced it with a
 * hash). A pruned request (BR-LLM-011), or a referenced blob whose content already aged out, is
 * reported the same way — `unknown` from a resolvable but unrecoverable comparison either way.
 */
async function lookupPreviousCall(
  db: (typeof import('@infra/db/drizzle'))['db'],
  llmCalls: (typeof import('@infra/db/schema'))['llmCalls'],
  userId: string,
  model: string,
): Promise<PreviousCallLookup> {
  const { eq, and, desc } = await import('drizzle-orm');
  const { resolveBlobContents } = await import('@infra/db/prompt-blobs');
  const [prevRow] = await db
    .select({ request: llmCalls.request, createdAt: llmCalls.createdAt })
    .from(llmCalls)
    .where(and(eq(llmCalls.userId, userId), eq(llmCalls.model, model)))
    .orderBy(desc(llmCalls.createdAt))
    .limit(1);
  if (!prevRow) {
    return { kind: 'none' };
  }
  if (prevRow.request === null) {
    return { kind: 'pruned', createdAt: prevRow.createdAt };
  }
  const stored = prevRow.request as RecordLlmCallRequest;
  const hashes = stored.messages.map(m => m.contentHash).filter((h): h is string => Boolean(h));
  const blobContent = await resolveBlobContents(hashes);
  if (hashes.some(h => blobContent.get(h) == null)) {
    // A referenced system blob already aged out (BR-LLM-011) — the comparison cannot be trusted.
    return { kind: 'pruned', createdAt: prevRow.createdAt };
  }
  const messages: CacheAttributionMessage[] = stored.messages.map(m =>
    m.contentHash
      ? { role: m.role, content: blobContent.get(m.contentHash) ?? null }
      : { role: m.role, content: m.content, toolCalls: m.tool_calls, toolCallId: m.tool_call_id },
  );
  const request: CacheAttributionRequest = { tools: stored.tools, responseFormat: stored.responseFormat, messages };
  return { kind: 'available', request, createdAt: prevRow.createdAt };
}

export const recordLlmCall: RecordLlmCall = async input => {
  const { db } = await import('@infra/db/drizzle');
  const { llmCalls, promptBlobs } = await import('@infra/db/schema');
  const { sql } = await import('drizzle-orm');

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

  const usage = input.response?.usage ?? null;

  // D3-D7: the cache attribution — a separate SELECT of the previous row (same user+model) plus
  // its resolved system content, then the pure attributeCache. D7: never fails the call — an
  // error here is logged and every cache_* column stays null, same as "no userId to compare by".
  let cacheExpected: string | null = null;
  let cacheDivergedAt: string | null = null;
  let cacheSharedPrefixTokens: number | null = null;
  let cacheGapMs: number | null = null;
  if (input.userId) {
    try {
      const { loadConfig } = await import('@config/index');
      const cfg = loadConfig();
      const prev = await lookupPreviousCall(db, llmCalls, input.userId, input.model);
      const currentRequest: CacheAttributionRequest = {
        tools: input.request.tools,
        responseFormat: input.request.responseFormat,
        messages: input.request.messages.map(toCacheAttributionMessage),
      };
      const result = attributeCache(
        prev,
        // D5: gap measured from when THIS call was sent, not from now (after the response) —
        // record time would fold the call's own latency into the gap (close-out review R3).
        { request: currentRequest, inputTokens: usage?.promptTokens ?? null, now: new Date(input.startedAt) },
        { ttlSeconds: cfg.LLM_CACHE_TTL_SECONDS ?? null, minPrefixTokens: cfg.LLM_CACHE_MIN_PREFIX_TOKENS ?? null },
      );
      ({ cacheExpected, cacheDivergedAt, cacheSharedPrefixTokens, cacheGapMs } = result);
    } catch (err) {
      log.error({ err, runId: input.runId }, 'Cache attribution failed — continuing with null cache columns (D7)');
    }
  }

  // No unique constraint on (run_id, call_index) — a deliberate decision, not an
  // oversight. A recorder error is swallowed by design (D-F-style), so a unique
  // violation on a rare race would turn into a LOST call record; a duplicated
  // index instead costs nothing an audit trail cannot survive, since created_at
  // still orders same-index rows within a run.
  //
  // As-users-grow hardening: callIndex used to be a separate SELECT max(...)
  // round trip before this INSERT — on the synchronous path of every model
  // call, against a forever-growing table. It is now a scalar subquery inside
  // this single INSERT (idx_llm_calls_run_id_call_index, schema.ts, makes the
  // max an index lookup): one round trip, and the race window between reading
  // the max and inserting is a single statement instead of two.
  await db.insert(llmCalls).values({
    runId: input.runId,
    userId: input.userId ?? null,
    callIndex: sql<number>`(SELECT coalesce(max(call_index), 0) + 1 FROM llm_calls WHERE run_id = ${input.runId})`,
    model: input.model,
    request: { ...input.request, messages },
    response: input.response,
    promptHashes,
    inputTokens: usage?.promptTokens ?? null,
    outputTokens: usage?.completionTokens ?? null,
    cacheReadTokens: usage?.cacheReadTokens ?? null,
    reasoningTokens: usage?.reasoningTokens ?? null,
    cacheExpected,
    cacheDivergedAt,
    cacheSharedPrefixTokens,
    cacheGapMs,
    latencyMs: input.latencyMs,
    errorClass: input.errorClass ?? null,
    errorMessage: input.errorMessage ?? null,
  });
};
