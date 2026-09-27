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
 * D4 + R1: one constant instruction — verbatim in the original language, only
 * the transcript, numbers as digits, and the `<NO_SPEECH>` sentinel when
 * nothing is clearly spoken (live probes 2026-09-27: without the sentinel,
 * silence hallucinated invented words; with it, mic-like noise answers
 * `<NO_SPEECH>` reliably). Exact text fixed by the plan's Task 3.
 */
const TRANSCRIBE_INSTRUCTION =
  'Transcribe the audio verbatim in its original language. ' +
  'Output only the transcript text, nothing else. ' +
  'Write numbers as digits. ' +
  'If the audio contains no clearly spoken words (silence, noise, music, breathing), output exactly: <NO_SPEECH>. ' +
  'Never guess or invent words that are not clearly spoken.';

/** R1: the model answers with this sentinel when there is no speech. */
const NO_SPEECH_SENTINEL = '<NO_SPEECH>';

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export interface GeminiTranscriberOptions {
  /** Provider key. Unset = disabled (D2) — the server still boots. */
  apiKey?: string;
  model: string;
  apiUrl: string;
  timeoutMs: number;
  /** R2: generationConfig.maxOutputTokens — without a cap, a runaway clip burned 65k output tokens. */
  maxOutputTokens: number;
  /** Injected in tests; the global fetch in production. */
  fetchImpl?: FetchLike;
}

interface GeminiPart {
  text?: string;
  thought?: boolean;
}

interface GeminiCandidate {
  content?: { parts?: unknown };
  finishReason?: unknown;
}

interface GeminiUsageMetadata {
  promptTokenCount?: unknown;
  candidatesTokenCount?: unknown;
  thoughtsTokenCount?: unknown;
}

interface ParsedResponse {
  /** Joined text of the non-thought parts, trimmed; null when the body is unusable. */
  text: string | null;
  finishReason: string | undefined;
  usage: GeminiUsageMetadata | undefined;
}

/**
 * Joins the text of the non-thought parts and trims, and picks up
 * finishReason/usageMetadata for logging. `text === null` means malformed (no
 * candidates / no parts / no text part at all) → STT_UNAVAILABLE.
 */
function parseResponse(json: unknown): ParsedResponse {
  const candidates = (json as { candidates?: unknown } | null)?.candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return { text: null, finishReason: undefined, usage: undefined };
  }
  const candidate = candidates[0] as GeminiCandidate;
  const parts = candidate.content?.parts;
  if (!Array.isArray(parts)) {
    return { text: null, finishReason: undefined, usage: undefined };
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
  const finishReason = typeof candidate.finishReason === 'string' ? candidate.finishReason : undefined;
  const rawUsage = (json as { usageMetadata?: unknown } | null)?.usageMetadata;
  const usage = typeof rawUsage === 'object' && rawUsage !== null ? (rawUsage as GeminiUsageMetadata) : undefined;
  return {
    text: sawTextPart ? joined.trim() : null,
    finishReason,
    usage,
  };
}

function tokenCountOf(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
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
  private readonly maxOutputTokens: number;
  private readonly fetchImpl: FetchLike;

  constructor(opts: GeminiTranscriberOptions) {
    this.apiKey = opts.apiKey;
    this.model = opts.model;
    this.apiUrl = opts.apiUrl;
    this.timeoutMs = opts.timeoutMs;
    this.maxOutputTokens = opts.maxOutputTokens;
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
      generationConfig: {
        temperature: 0,
        thinkingConfig: { thinkingLevel: 'low' },
        maxOutputTokens: this.maxOutputTokens,
      },
    });

    const start = Date.now();
    // R3: one timer for the whole call — fetch AND reading the body. Clearing
    // it when the headers arrive (fetch resolves) left an unbounded body read.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let json: unknown;
    try {
      const response = await this.fetchImpl(url, {
        method: 'POST',
        headers: {
          'x-goog-api-key': this.apiKey,
          'content-type': 'application/json',
        },
        body,
        signal: controller.signal,
      });

      if (!response.ok) {
        const providerBody = await response.text().catch(() => '');
        // INV-LLM-006: the provider's message goes to the log, never to a response body.
        log.warn(
          { status: response.status, model: this.model, providerBody: providerBody.slice(0, 500) },
          'STT provider error',
        );
        throw new SttUnavailableError(`STT provider returned ${response.status}`);
      }

      json = await response.json();
    } catch (err) {
      if (err instanceof SttUnavailableError) {
        throw err;
      }
      throw new SttUnavailableError('STT request failed or timed out', err);
    } finally {
      clearTimeout(timer);
    }

    const { text, finishReason, usage } = parseResponse(json);
    if (text === null) {
      log.warn({ model: this.model }, 'STT response without usable candidates/parts');
      throw new SttUnavailableError('Malformed STT response body');
    }

    if (finishReason === 'MAX_TOKENS') {
      // R2: the cap stopped a runaway clip — return what was transcribed, loudly.
      log.warn(
        { model: this.model, finishReason, maxOutputTokens: this.maxOutputTokens },
        'STT transcript hit maxOutputTokens',
      );
    }

    // R4/D5: the STT call is logged (never written to llm_calls — run-scoped table).
    log.info(
      {
        model: this.model,
        latencyMs: Date.now() - start,
        promptTokenCount: tokenCountOf(usage?.promptTokenCount),
        candidatesTokenCount: tokenCountOf(usage?.candidatesTokenCount),
        thoughtsTokenCount: tokenCountOf(usage?.thoughtsTokenCount),
        finishReason,
        textLength: text.length,
      },
      'STT call completed',
    );

    // R1: the sentinel (or emptiness) after trim means nothing was spoken.
    if (text === NO_SPEECH_SENTINEL || text === '') {
      throw new NoSpeechError();
    }
    return { text };
  }
}
