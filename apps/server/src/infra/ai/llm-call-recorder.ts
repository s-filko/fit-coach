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

/** Run rows keep the error message short (Task 2's precedent) — the class name always survives untruncated. */
const ERROR_MESSAGE_MAX_CHARS = 500;

/**
 * AC-AT-3: one `llm_calls` row per call — `call_index` continues from this
 * run's own max (the Task 3 pattern: no in-memory per-run counter, so a
 * shared-singleton caller never needs to track run-scoped state itself).
 * The system message, if any, is stored once per distinct content hash in
 * `prompt_blobs` and referenced, not repeated. Never throws (D-F-style):
 * the caller (a LangChain callback) must never fail the run over this.
 */
export const recordLlmCall: RecordLlmCall = async input => {
  const { db } = await import('@infra/db/drizzle');
  const { llmCalls, promptBlobs } = await import('@infra/db/schema');
  const { eq, max } = await import('drizzle-orm');

  const messages = await Promise.all(
    input.request.messages.map(async message => {
      if (message.role !== 'system' || typeof message.content !== 'string') {
        return message;
      }
      const hash = createHash('sha256').update(message.content).digest('hex');
      await db.insert(promptBlobs).values({ hash, content: message.content }).onConflictDoNothing();
      const { content: _content, ...rest } = message;
      return { ...rest, contentHash: hash };
    }),
  );

  const [{ maxIndex }] = await db
    .select({ maxIndex: max(llmCalls.callIndex) })
    .from(llmCalls)
    .where(eq(llmCalls.runId, input.runId));

  const errorMessage =
    input.errorMessage && input.errorMessage.length > ERROR_MESSAGE_MAX_CHARS
      ? `${input.errorMessage.slice(0, ERROR_MESSAGE_MAX_CHARS)}…`
      : (input.errorMessage ?? null);

  await db.insert(llmCalls).values({
    runId: input.runId,
    callIndex: (maxIndex ?? 0) + 1,
    model: input.model,
    request: { ...input.request, messages },
    response: input.response,
    latencyMs: input.latencyMs,
    errorClass: input.errorClass ?? null,
    errorMessage,
  });
};
