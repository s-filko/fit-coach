/**
 * GeminiTranscriber (voice-transcription plan Task 1 AC-VT-1 + Task 3 R1–R4):
 * the adapter builds the request exactly as probed live on 2026-09-27 (see the
 * plan's "Verified facts") — x-goog-api-key header, inline_data part,
 * thinkingLevel:"low" and never thinkingBudget — with `fetch` injected, so no
 * test touches the network.
 */
import { NoSpeechError, SttUnavailableError } from '@domain/speech/ports';

jest.mock('@shared/logger', () => {
  const fns = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
  return { createLogger: () => fns, __logFns: fns };
});

import { GeminiTranscriber } from '../gemini-transcriber';

const { __logFns: logFns } = jest.requireMock('@shared/logger') as {
  __logFns: { info: jest.Mock; warn: jest.Mock; error: jest.Mock; debug: jest.Mock };
};

const fetchImpl = jest.fn();

const OPTS = {
  apiKey: 'test-key',
  model: 'gemini-3.8-flash',
  apiUrl: 'https://generativelanguage.googleapis.com/v1beta',
  timeoutMs: 30000,
  maxOutputTokens: 4096,
  fetchImpl: fetchImpl as unknown as (url: string, init: RequestInit) => Promise<Response>,
};

/** R1: the instruction text, exactly as the plan's Task 3 fixes it. */
const R1_INSTRUCTION =
  'Transcribe the audio verbatim in its original language. ' +
  'Output only the transcript text, nothing else. ' +
  'Write numbers as digits. ' +
  'If the audio contains no clearly spoken words (silence, noise, music, breathing), output exactly: <NO_SPEECH>. ' +
  'Never guess or invent words that are not clearly spoken.';

function okResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } });
}

function build(overrides: Partial<typeof OPTS> = {}): GeminiTranscriber {
  return new GeminiTranscriber({ ...OPTS, ...overrides });
}

describe('GeminiTranscriber (AC-VT-1)', () => {
  beforeEach(() => {
    fetchImpl.mockReset();
    logFns.info.mockClear();
    logFns.warn.mockClear();
  });

  it('reports disabled without an apiKey and throws SttUnavailableError on transcribe', async () => {
    const transcriber = new GeminiTranscriber({
      model: OPTS.model,
      apiUrl: OPTS.apiUrl,
      timeoutMs: OPTS.timeoutMs,
      maxOutputTokens: OPTS.maxOutputTokens,
      fetchImpl,
    });
    expect(transcriber.isEnabled()).toBe(false);
    await expect(transcriber.transcribe({ audioBase64: 'AQID', mimeType: 'audio/ogg' })).rejects.toBeInstanceOf(
      SttUnavailableError,
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('builds the probed request: URL, x-goog-api-key header, inline_data body, thinkingLevel low, no thinkingBudget', async () => {
    fetchImpl.mockResolvedValue(
      okResponse({
        candidates: [{ content: { parts: [{ text: 'привет 5' }] } }],
      }),
    );

    const result = await build().transcribe({ audioBase64: 'AQID', mimeType: 'audio/ogg' });

    expect(result).toEqual({ text: 'привет 5' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent');
    const headers = init.headers as Record<string, string>;
    expect(headers['x-goog-api-key']).toBe('test-key');
    expect(init.method).toBe('POST');
    expect(String(init.body)).not.toContain('thinkingBudget');

    const body = JSON.parse(String(init.body)) as {
      contents: Array<{ parts: Array<{ text?: string; inline_data?: { mime_type: string; data: string } }> }>;
      generationConfig: { temperature: number; thinkingConfig: { thinkingLevel: string } };
    };
    expect(body.contents).toHaveLength(1);
    const [instructionPart, audioPart] = body.contents[0].parts;
    expect(typeof instructionPart.text).toBe('string');
    expect(instructionPart!.text!.length).toBeGreaterThan(0);
    expect(audioPart!.inline_data).toEqual({ mime_type: 'audio/ogg', data: 'AQID' });
    expect(body.generationConfig.temperature).toBe(0);
    expect(body.generationConfig.thinkingConfig).toEqual({ thinkingLevel: 'low' });
  });

  it('R1: sends the exact no-speech-sentinel instruction and the R2 output cap in generationConfig', async () => {
    fetchImpl.mockResolvedValue(
      okResponse({ candidates: [{ content: { parts: [{ text: 'ok' }] }, finishReason: 'STOP' }] }),
    );

    await build().transcribe({ audioBase64: 'AQID', mimeType: 'audio/ogg' });

    const body = JSON.parse(String((fetchImpl.mock.calls[0] as [string, RequestInit])[1].body)) as {
      contents: Array<{ parts: Array<{ text?: string }> }>;
      generationConfig: { maxOutputTokens: number };
    };
    expect(body.contents[0].parts[0].text).toBe(R1_INSTRUCTION);
    expect(body.generationConfig.maxOutputTokens).toBe(4096);
  });

  it('R1: a trimmed transcript of <NO_SPEECH> (or empty) → NoSpeechError', async () => {
    fetchImpl.mockResolvedValueOnce(
      okResponse({ candidates: [{ content: { parts: [{ text: '  <NO_SPEECH> \n' }] } }] }),
    );
    await expect(build().transcribe({ audioBase64: 'AQID', mimeType: 'audio/ogg' })).rejects.toBeInstanceOf(
      NoSpeechError,
    );

    fetchImpl.mockResolvedValueOnce(okResponse({ candidates: [{ content: { parts: [{ text: '<NO_SPEECH>' }] } }] }));
    await expect(build().transcribe({ audioBase64: 'AQID', mimeType: 'audio/ogg' })).rejects.toBeInstanceOf(
      NoSpeechError,
    );
  });

  it('R2: finishReason MAX_TOKENS warns and returns the truncated text as is', async () => {
    fetchImpl.mockResolvedValue(
      okResponse({
        candidates: [{ content: { parts: [{ text: 'truncated transcript…' }] }, finishReason: 'MAX_TOKENS' }],
      }),
    );

    const result = await build().transcribe({ audioBase64: 'AQID', mimeType: 'audio/ogg' });

    expect(result).toEqual({ text: 'truncated transcript…' });
    expect(logFns.warn).toHaveBeenCalledWith(
      expect.objectContaining({ finishReason: 'MAX_TOKENS' }),
      expect.stringContaining('maxOutputTokens'),
    );
  });

  it('R4: logs one info line per successful call with usage, finishReason and text length (D5)', async () => {
    fetchImpl.mockResolvedValue(
      okResponse({
        candidates: [{ content: { parts: [{ text: 'привет 5' }] }, finishReason: 'STOP' }],
        usageMetadata: {
          promptTokenCount: 121,
          candidatesTokenCount: 12,
          thoughtsTokenCount: 34,
        },
      }),
    );

    await build().transcribe({ audioBase64: 'AQID', mimeType: 'audio/ogg' });

    expect(logFns.info).toHaveBeenCalledTimes(1);
    const fields = logFns.info.mock.calls[0][0] as Record<string, unknown>;
    expect(fields.model).toBe('gemini-3.8-flash');
    expect(fields.promptTokenCount).toBe(121);
    expect(fields.candidatesTokenCount).toBe(12);
    expect(fields.thoughtsTokenCount).toBe(34);
    expect(fields.finishReason).toBe('STOP');
    expect(fields.textLength).toBe('привет 5'.length);
    expect(typeof fields.latencyMs).toBe('number');
  });

  it('joins non-thought text parts and trims the result', async () => {
    fetchImpl.mockResolvedValue(
      okResponse({
        candidates: [
          {
            content: {
              parts: [
                { text: '  hi ' },
                { text: 'thought payload', thought: true, thoughtSignature: 'sig' },
                { text: 'there  ' },
              ],
            },
          },
        ],
      }),
    );

    const result = await build().transcribe({ audioBase64: 'AQID', mimeType: 'audio/ogg' });

    expect(result).toEqual({ text: 'hi there' });
  });

  it('throws NoSpeechError when the transcript is empty after trim', async () => {
    fetchImpl.mockResolvedValue(okResponse({ candidates: [{ content: { parts: [{ text: '   \n' }] } }] }));

    await expect(build().transcribe({ audioBase64: 'AQID', mimeType: 'audio/ogg' })).rejects.toBeInstanceOf(
      NoSpeechError,
    );
  });

  it.each([
    ['non-2xx', Promise.resolve(new Response('{"error":{"message":"secret detail"}}', { status: 500 }))],
    ['malformed body', Promise.resolve(new Response('not json', { status: 200 }))],
    ['no candidates', Promise.resolve(okResponse({ candidates: [] }))],
    ['no parts', Promise.resolve(okResponse({ candidates: [{ content: {} }] }))],
  ])('throws SttUnavailableError on %s', async (_name, response) => {
    fetchImpl.mockReturnValue(response);

    await expect(build().transcribe({ audioBase64: 'AQID', mimeType: 'audio/ogg' })).rejects.toBeInstanceOf(
      SttUnavailableError,
    );
  });

  it('throws SttUnavailableError when fetch rejects (network)', async () => {
    fetchImpl.mockRejectedValue(new Error('ECONNRESET'));

    await expect(build().transcribe({ audioBase64: 'AQID', mimeType: 'audio/ogg' })).rejects.toBeInstanceOf(
      SttUnavailableError,
    );
  });

  it('aborts the request at timeoutMs and throws SttUnavailableError', async () => {
    // A fetch that only rejects when the abort signal fires — like the real one.
    fetchImpl.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
        }),
    );

    const promise = build({ timeoutMs: 20 }).transcribe({ audioBase64: 'AQID', mimeType: 'audio/ogg' });
    await expect(promise).rejects.toBeInstanceOf(SttUnavailableError);
  });

  it('R3: the timeout also covers reading the response body', async () => {
    // fetch resolves 200 immediately, but the body never finishes — only the
    // abort signal ends it. Without R3 the timer stopped at fetch-resolve and
    // this would hang forever.
    fetchImpl.mockImplementation((_url: string, init: RequestInit) =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
          }),
      } as unknown as Response),
    );

    const promise = build({ timeoutMs: 20 }).transcribe({ audioBase64: 'AQID', mimeType: 'audio/ogg' });
    await expect(promise).rejects.toBeInstanceOf(SttUnavailableError);
  });
});
