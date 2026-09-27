import { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { SPEECH_HTTP_STATUS_BY_CODE } from '@domain/speech/ports';

import { errorCodeOf } from './route-error';

/**
 * F2 (Task 4, B3): the speech statuses plus CORE_ERROR → 500 — CORE_ERROR
 * lives in the map, so the tail needs no special-case branch.
 */
const STATUS_BY_CODE = {
  ...SPEECH_HTTP_STATUS_BY_CODE,
  CORE_ERROR: 500,
} as const;

type VoiceErrorCode = keyof typeof STATUS_BY_CODE;

/** Route-level body limit (D3): 15 MiB covers a 5-minute voice at ~1.6 MiB base64 with headroom
 * over Fastify's 1 MiB default — the route must never reject an audio the plan accepts. */
const VOICE_BODY_LIMIT = 15 * 1024 * 1024;

const transcribeBody = z
  .object({
    userId: z.string().min(1).describe('User ID'),
    audioBase64: z.string().min(1).describe('Voice audio, base64-encoded'),
    mimeType: z.string().min(1).describe('Audio mime type, e.g. audio/ogg'),
  })
  .describe('Voice transcription payload');

export async function registerVoiceRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    '/voice/transcribe',
    {
      bodyLimit: VOICE_BODY_LIMIT,
      schema: {
        summary: 'Transcribe a voice message to text',
        body: transcribeBody,
        security: [{ ApiKeyAuth: [] }],
        response: {
          200: z.object({ data: z.object({ text: z.string() }) }),
          400: z.object({ error: z.object({ message: z.string() }) }),
          401: z.object({ error: z.object({ message: z.string() }) }),
          403: z.object({ error: z.object({ message: z.string() }) }),
          422: z.object({ error: z.object({ code: z.literal('NO_SPEECH') }) }),
          500: z.object({ error: z.object({ code: z.literal('CORE_ERROR') }) }),
          503: z.object({ error: z.object({ code: z.literal('STT_UNAVAILABLE') }) }),
        },
      },
    },
    async (req, reply) => {
      const { userId, audioBase64, mimeType } = req.body as {
        userId: string;
        audioBase64: string;
        mimeType: string;
      };

      const transcriber = app.services.speechTranscriber;
      if (!transcriber.isEnabled()) {
        req.log.warn({ userId }, 'Voice transcription requested while STT is disabled');
        return reply.code(503).send({ error: { code: 'STT_UNAVAILABLE' } });
      }

      const start = Date.now();
      try {
        const { text } = await transcriber.transcribe({ audioBase64, mimeType });
        // D5: the STT call is logged (userId, latency, text length), not written to llm_calls.
        req.log.info({ userId, ms: Date.now() - start, textLength: text.length }, 'Voice transcribed');
        return reply.send({ data: { text } });
      } catch (error) {
        req.log.error({ err: error, userId, ms: Date.now() - start }, 'Voice transcription failed');
        // INV-LLM-006: the body carries only `code`, never the exception's
        // message or a provider message — logs (above) may keep them.
        const code = errorCodeOf<VoiceErrorCode>(error, STATUS_BY_CODE) ?? 'CORE_ERROR';
        return reply.code(STATUS_BY_CODE[code]).send({ error: { code } });
      }
    },
  );
}
