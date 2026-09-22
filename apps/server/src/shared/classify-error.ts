/**
 * The one policy for what a stored error looks like. `conversation-run.adapter.ts` (writing
 * `conversation_runs.error_class`/`error_message`) and `llm-log-handler.ts` (writing the same pair
 * on `llm_calls`) both classify a caught value and truncate its message to `ERROR_MESSAGE_MAX_CHARS`
 * through here — a second copy would let the two tables disagree about the same failure.
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
