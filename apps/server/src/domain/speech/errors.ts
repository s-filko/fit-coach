/**
 * Typed speech-transcription errors (voice-transcription plan, D3): the
 * transcriber throws these instead of raw errors so `voice.routes.ts` can map
 * them to an HTTP status without ever putting an exception message or a
 * provider message in a response body (INV-LLM-006). Pure domain: no imports
 * with runtime effect outside `node:`.
 */

export type SpeechErrorCode = 'NO_SPEECH' | 'STT_UNAVAILABLE';

/**
 * The provider returned no intelligible speech (an empty transcript after
 * trim). Mapped to HTTP 422 — the audio reached the provider and the call
 * succeeded; the content is the problem.
 */
export class NoSpeechError extends Error {
  readonly code: SpeechErrorCode = 'NO_SPEECH';

  constructor(message = 'No intelligible speech in the audio') {
    super(message);
    this.name = 'NoSpeechError';
  }
}

/**
 * STT is unavailable: disabled (AISTUDIO_API_KEY unset, D2), the provider errored,
 * timed out, or answered with a body we cannot read. Mapped to HTTP 503.
 */
export class SttUnavailableError extends Error {
  readonly code: SpeechErrorCode = 'STT_UNAVAILABLE';
  readonly cause?: unknown;

  constructor(message = 'Speech-to-text unavailable', cause?: unknown) {
    super(message);
    this.name = 'SttUnavailableError';
    if (cause !== undefined) {
      this.cause = cause;
    }
  }
}

export type SpeechError = NoSpeechError | SttUnavailableError;

/** `code → HTTP status` for the speech errors, shared by the route and the tests. */
export const SPEECH_HTTP_STATUS_BY_CODE = {
  NO_SPEECH: 422,
  STT_UNAVAILABLE: 503,
} as const satisfies Record<SpeechErrorCode, number>;
