import { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { type ConversationErrorCode, HTTP_STATUS_BY_CODE } from '@domain/conversation/ports';

/** Any thrown value carrying a ConversationErrorCode (D-B) — duck-typed so a thrown
 * LlmUnavailableError/ThreadBusyError/CoreError all match without an instanceof chain. */
function conversationErrorCodeOf(err: unknown): ConversationErrorCode | undefined {
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === 'string' && code in HTTP_STATUS_BY_CODE ? (code as ConversationErrorCode) : undefined;
}

const chatMessageBody = z
  .object({
    userId: z.string().min(1).describe('User ID'),
    message: z.string().min(1).describe('User message'),
  })
  .describe('Chat message payload');

const clearContextBody = z
  .object({
    userId: z.string().min(1).describe('User ID'),
  })
  .describe('Clear context payload');

export async function registerChatRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    '/chat/clear-context',
    {
      schema: {
        summary: 'Clear conversation context and LangGraph checkpoints for a user',
        body: clearContextBody,
        security: [{ ApiKeyAuth: [] }],
        response: {
          200: z.object({ data: z.object({ ok: z.boolean() }) }),
          500: z.object({ error: z.object({ message: z.string() }) }),
        },
      },
    },
    async (req, reply) => {
      try {
        const { userId } = req.body as { userId: string };

        // D-F: the port deletes the thread and notes it in the transcript —
        // the route touches no tables and no checkpointer.
        await app.services.conversationRun.clearContext(userId);

        req.log.info({ userId }, 'Context cleared');
        return reply.send({ data: { ok: true } });
      } catch (error) {
        req.log.error({ err: error }, 'clear-context failed');
        return reply.code(500).send({ error: { message: 'Failed to clear context' } });
      }
    },
  );

  app.post(
    '/chat/compact',
    {
      schema: {
        summary: 'Fold the conversation so far into memory on demand (manual compaction)',
        body: clearContextBody,
        security: [{ ApiKeyAuth: [] }],
        response: {
          200: z.object({ data: z.object({ outcome: z.enum(['compacted', 'nothing_to_compact']) }) }),
          400: z.object({ error: z.object({ message: z.string() }) }),
          401: z.object({ error: z.object({ message: z.string() }) }),
          403: z.object({ error: z.object({ message: z.string() }) }),
          404: z.object({ error: z.object({ message: z.string() }) }),
          409: z.object({ error: z.object({ code: z.literal('THREAD_BUSY') }) }),
          500: z.object({ error: z.object({ code: z.literal('CORE_ERROR') }) }),
          503: z.object({ error: z.object({ code: z.literal('LLM_UNAVAILABLE') }) }),
        },
      },
    },
    async (req, reply) => {
      try {
        const { userId } = req.body as { userId: string };
        const outcome = await app.services.conversationRun.compact(userId);
        req.log.info({ userId, outcome }, 'Manual compaction requested');
        return reply.send({ data: { outcome } });
      } catch (error) {
        req.log.error({ err: error }, 'compact failed');
        // Same mapping as /chat (INV-LLM-006): the body carries only `code`.
        const code = conversationErrorCodeOf(error) ?? 'CORE_ERROR';
        return reply.code(HTTP_STATUS_BY_CODE[code]).send({ error: { code } });
      }
    },
  );

  app.post(
    '/chat',
    {
      schema: {
        summary: 'Send chat message to AI',
        body: chatMessageBody,
        security: [{ ApiKeyAuth: [] }],
        response: {
          200: z.object({
            data: z.object({
              content: z.string(),
              timestamp: z.string(),
            }),
          }),
          400: z.object({ error: z.object({ message: z.string() }) }),
          401: z.object({ error: z.object({ message: z.string() }) }),
          403: z.object({ error: z.object({ message: z.string() }) }),
          404: z.object({ error: z.object({ message: z.string() }) }),
          409: z.object({ error: z.object({ code: z.literal('THREAD_BUSY') }) }),
          500: z.object({ error: z.object({ code: z.literal('CORE_ERROR') }) }),
          503: z.object({ error: z.object({ code: z.literal('LLM_UNAVAILABLE') }) }),
        },
      },
    },
    async (req, reply) => {
      try {
        const { userId, message } = req.body as { userId: string; message: string };

        const result = await app.services.conversationRun.run({ userId, text: message });

        return reply.send({
          data: {
            content: result.text,
            timestamp: new Date().toISOString(),
          },
        });
      } catch (error) {
        req.log.error({ err: error }, 'Chat processing failed');
        // INV-LLM-006: the body carries only `code`, never the exception's
        // message or a stack — logs (above) may keep the message.
        const code = conversationErrorCodeOf(error) ?? 'CORE_ERROR';
        return reply.code(HTTP_STATUS_BY_CODE[code]).send({ error: { code } });
      }
    },
  );
}
