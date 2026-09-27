/**
 * POST /api/bot/voice/transcribe (voice-transcription plan Task 1, AC-VT-3):
 * the route talks to the SpeechTranscriber port behind the /api/bot X-Api-Key
 * guard, with a 15 MiB route-level body limit. A stub port and no network —
 * INV-LLM-006 applies: the error body carries only `code`, never a provider
 * message.
 */
import Fastify, { type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler, type ZodTypeProvider } from 'fastify-type-provider-zod';

import { registerErrorHandler } from '@app/middlewares/error';
import botSecurityPlugin from '@app/plugins/bot-security.plugin';
import voiceRoutesPlugin from '@app/plugins/voice-routes.plugin';

import { NoSpeechError, SttUnavailableError } from '@domain/speech/ports';

import { loadConfig } from '@config/index';

const transcribe = jest.fn();
const isEnabled = jest.fn(() => true);

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false }).withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  registerErrorHandler(app);
  app.decorate('services', { speechTranscriber: { isEnabled, transcribe } } as never);
  await app.register(
    async instance => {
      await instance.register(botSecurityPlugin);
      await instance.register(voiceRoutesPlugin);
    },
    { prefix: '/api/bot' },
  );
  await app.ready();
  return app;
}

const VALID_BODY = { userId: 'u1', audioBase64: 'AQID', mimeType: 'audio/ogg' };

describe('POST /api/bot/voice/transcribe (AC-VT-3; AC-1417, AC-1419, AC-1421)', () => {
  let app: FastifyInstance;
  const headers = () => ({ 'x-api-key': loadConfig().BOT_API_KEY as string });

  beforeAll(async () => {
    app = await buildApp();
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(() => {
    transcribe.mockReset();
    isEnabled.mockReturnValue(true);
  });

  const call = (payload: unknown, h: Record<string, string> = headers()) =>
    app.inject({ method: 'POST', url: '/api/bot/voice/transcribe', headers: h, payload: payload as never });

  it('returns 200 {data:{text}} and passes the audio to the port', async () => {
    transcribe.mockResolvedValue({ text: 'привет, сделай 5 подходов' });

    const res = await call(VALID_BODY);

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ data: { text: 'привет, сделай 5 подходов' } });
    expect(transcribe).toHaveBeenCalledWith({ audioBase64: 'AQID', mimeType: 'audio/ogg' });
  });

  it('answers 503 STT_UNAVAILABLE without calling the port when STT is disabled', async () => {
    isEnabled.mockReturnValue(false);

    const res = await call(VALID_BODY);

    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ error: { code: 'STT_UNAVAILABLE' } });
    expect(transcribe).not.toHaveBeenCalled();
  });

  it('maps an empty transcript to 422 NO_SPEECH', async () => {
    transcribe.mockRejectedValue(new NoSpeechError());

    const res = await call(VALID_BODY);

    expect(res.statusCode).toBe(422);
    expect(res.json()).toEqual({ error: { code: 'NO_SPEECH' } });
  });

  it.each([
    [new SttUnavailableError('secret provider detail'), 503, 'STT_UNAVAILABLE'],
    [new Error('secret detail'), 500, 'CORE_ERROR'],
  ])('maps %p to %i with a code-only body (no provider message)', async (err, status, code) => {
    transcribe.mockRejectedValue(err);

    const res = await call(VALID_BODY);

    expect(res.statusCode).toBe(status);
    expect(res.json()).toEqual({ error: { code } });
    expect(res.body).not.toContain('secret');
  });

  it('rejects a missing key (401) and a wrong key (403) before the port is touched', async () => {
    expect((await call(VALID_BODY, {})).statusCode).toBe(401);
    expect((await call(VALID_BODY, { 'x-api-key': 'nope' })).statusCode).toBe(403);
    expect(transcribe).not.toHaveBeenCalled();
  });

  it.each([
    ['empty userId', { ...VALID_BODY, userId: '' }],
    ['missing audioBase64', { userId: 'u1', mimeType: 'audio/ogg' }],
    ['missing mimeType', { userId: 'u1', audioBase64: 'AQID' }],
  ])('rejects an invalid body (%s) with 400', async (_name, payload) => {
    expect((await call(payload)).statusCode).toBe(400);
    expect(transcribe).not.toHaveBeenCalled();
  });

  it('accepts a body up to 15 MiB and rejects one above it (413)', async () => {
    transcribe.mockResolvedValue({ text: 'ok' });

    const justUnder = await call({ ...VALID_BODY, audioBase64: 'A'.repeat(15 * 1024 * 1024 - 1024) });
    expect(justUnder.statusCode).toBe(200);

    const over = await call({ ...VALID_BODY, audioBase64: 'A'.repeat(15 * 1024 * 1024 + 2048) });
    expect(over.statusCode).toBe(413);
  });
});
