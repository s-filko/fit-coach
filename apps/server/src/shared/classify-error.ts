/**
 * Close-out review (2026-09-22, R2 finding 4/5): `conversation-run.adapter.ts` and
 * `llm-log-handler.ts` each grew their own `classifyError` + a 500-char truncation constant —
 * one policy (what a stored error looks like) in two places, free to diverge. `conversation_runs`
 * and `llm_calls` both truncate a caught value's message to `ERROR_MESSAGE_MAX_CHARS` the same way;
 * this is the one place that decides how.
 */

/** Run rows keep the error message short — the class name always survives untruncated. */
export const ERROR_MESSAGE_MAX_CHARS = 500;

/** The thrown value's class name and a truncated message — never throws itself, any `unknown` is safe to pass in. */
export function classifyError(err: unknown): { errorClass: string; errorMessage: string } {
  const errorClass = err instanceof Error ? err.constructor.name : typeof err;
  const message = err instanceof Error ? err.message : String(err);
  const errorMessage =
    message.length > ERROR_MESSAGE_MAX_CHARS ? `${message.slice(0, ERROR_MESSAGE_MAX_CHARS)}…` : message;
  return { errorClass, errorMessage };
}
