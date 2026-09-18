/**
 * Typed conversation errors (D-B, ADR-0013 §6). The conversation-run adapter
 * throws these instead of raw errors so `chat.routes.ts` can map them to an
 * HTTP status without ever putting an exception message in a response body
 * (INV-LLM-006). Pure domain: no imports with runtime effect outside `node:`.
 */

export type ConversationErrorCode = 'LLM_UNAVAILABLE' | 'THREAD_BUSY' | 'CORE_ERROR';

/**
 * The provider (or the network path to it) failed or timed out. Mapped to
 * HTTP 503. The adapter's `isProviderError` picks this outcome; the run row
 * records `outcome: 'llm_unavailable'`.
 */
export class LlmUnavailableError extends Error {
  readonly code: ConversationErrorCode = 'LLM_UNAVAILABLE';
  readonly cause?: unknown;

  constructor(message = 'LLM provider unavailable', cause?: unknown) {
    super(message);
    this.name = 'LlmUnavailableError';
    if (cause !== undefined) {
      this.cause = cause;
    }
  }
}

/**
 * The per-user run mutex (D-12, D-A) rejected a waiter because the key was
 * still held after `waitMs`. Mapped to HTTP 409. Thrown before the graph is
 * ever entered — no run row is written for it (D-D).
 */
export class ThreadBusyError extends Error {
  readonly code: ConversationErrorCode = 'THREAD_BUSY';
  readonly cause?: unknown;

  constructor(message = 'Another run is already in progress for this user', cause?: unknown) {
    super(message);
    this.name = 'ThreadBusyError';
    if (cause !== undefined) {
      this.cause = cause;
    }
  }
}

/**
 * Anything else: a bug, an unexpected exception, or (D-C) a `ToolSystemError`
 * raised when the tool executor's error budget was exhausted by a system
 * error. Mapped to HTTP 500. The run row records `outcome: 'core_error'`.
 */
export class CoreError extends Error {
  readonly code: ConversationErrorCode = 'CORE_ERROR';
  readonly cause?: unknown;

  constructor(message = 'Internal error', cause?: unknown) {
    super(message);
    this.name = 'CoreError';
    if (cause !== undefined) {
      this.cause = cause;
    }
  }
}

export type ConversationError = LlmUnavailableError | ThreadBusyError | CoreError;

/**
 * Single source of truth for `code → HTTP status`, shared by the chat routes,
 * the bot's error-text mapper and the tests (D-B).
 */
export const HTTP_STATUS_BY_CODE: Record<ConversationErrorCode, number> = {
  LLM_UNAVAILABLE: 503,
  THREAD_BUSY: 409,
  CORE_ERROR: 500,
};
