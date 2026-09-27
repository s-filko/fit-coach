import {
  NoSpeechError,
  type SpeechTranscriberPort,
  SttUnavailableError,
  type TranscribeInput,
  type TranscribeResult,
} from '@domain/speech/ports';

import { createLogger } from '@shared/logger';

const log = createLogger('stt');

/**
 * D4: one constant instruction — verbatim in the original language, only the
 * transcript, numbers as digits, empty output when there is no intelligible
 * speech. English works for every language the model covers.
 */
const TRANSCRIBE_INSTRUCTION =
  'Transcribe the audio verbatim in its original language. ' +
  'Output only the transcript text, nothing else. ' +
  'Write numbers as digits. ' +
  'If there is no intelligible speech, output nothing.';

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export interface GeminiTranscriberOptions {
  /** Provider key. Unset = disabled (D2) — the server still boots. */
  apiKey?: string;
  model: string;
  apiUrl: string;
  timeoutMs: number;
  /** Injected in tests; the global fetch in production. */
  fetchImpl?: FetchLike;
}

interface GeminiPart {
  text?: string;
  thought?: boolean;
}

/**
 * Joins the text of the non-thought parts and trims. Returns `null` for a
 * malformed body (no candidates / no parts / no text part at all), which the
 * caller reports as STT_UNAVAILABLE.
 */
function extractTranscript(json: unknown): string | null {
  const candidates = (json as { candidates?: unknown } | null)?.candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return null;
  }
  const parts = (candidates[0] as { content?: { parts?: unknown } } | undefined)?.content?.parts;
  if (!Array.isArray(parts)) {
    return null;
  }
  let sawTextPart = false;
  const joined = parts
    .map((part: GeminiPart) => {
      if (part?.thought === true || typeof part?.text !== 'string') {
        return '';
      }
      sawTextPart = true;
      return part.text;
    })
    .join('');
  if (!sawTextPart) {
    return null;
  }
  return joined.trim();
}

/**
 * SpeechTranscriberPort adapter over Google AI Studio `generateContent`
 * (voice-transcription plan, D1). The request shape is fixed by the live probe
 * of 2026-09-27 (plan § "Verified facts"): `x-goog-api-key` header,
 * `inline_data` part, `thinkingLevel: "low"` — and never `thinkingBudget` or
 * `thinkingLevel: "minimal"`, both of which the endpoint rejects on this
 * model. Plain `fetch`, no new dependency.
 */
export class GeminiTranscriber implements SpeechTranscriberPort {
  private readonly apiKey?: string;
  private readonly model: string;
  private readonly apiUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: FetchLike;

  constructor(opts: GeminiTranscriberOptions) {
    this.apiKey = opts.apiKey;
    this.model = opts.model;
    this.apiUrl = opts.apiUrl;
    this.timeoutMs = opts.timeoutMs;
    this.fetchImpl = opts.fetchImpl ?? ((url, init) => fetch(url, init));
  }

  isEnabled(): boolean {
    return Boolean(this.apiKey);
  }

  async transcribe(input: TranscribeInput): Promise<TranscribeResult> {
    if (!this.apiKey) {
      throw new SttUnavailableError('STT is disabled (STT_API_KEY unset)');
    }

    const url = `${this.apiUrl}/models/${this.model}:generateContent`;
    const body = JSON.stringify({
      contents: [
        {
          parts: [
            { text: TRANSCRIBE_INSTRUCTION },
            { inline_data: { mime_type: input.mimeType, data: input.audioBase64 } },
          ],
        },
      ],
      generationConfig: { temperature: 0, thinkingConfig: { thinkingLevel: 'low' } },
    });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: 'POST',
        headers: {
          'x-goog-api-key': this.apiKey,
          'content-type': 'application/json',
        },
        body,
        signal: controller.signal,
      });
    } catch (err) {
      throw new SttUnavailableError('STT request failed', err);
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      const providerBody = await response.text().catch(() => '');
      // INV-LLM-006: the provider's message goes to the log, never to a response body.
      log.warn(
        { status: response.status, model: this.model, providerBody: providerBody.slice(0, 500) },
        'STT provider error',
      );
      throw new SttUnavailableError(`STT provider returned ${response.status}`);
    }

    let json: unknown;
    try {
      json = await response.json();
    } catch (err) {
      throw new SttUnavailableError('Malformed STT response body', err);
    }

    const text = extractTranscript(json);
    if (text === null) {
      log.warn({ model: this.model }, 'STT response without usable candidates/parts');
      throw new SttUnavailableError('Malformed STT response body');
    }
    if (text === '') {
      throw new NoSpeechError();
    }
    return { text };
  }
}
