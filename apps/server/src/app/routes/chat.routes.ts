import { FastifyInstance } from 'fastify';
import { z } from 'zod';

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
          500: z.object({ error: z.object({ message: z.string(), details: z.string().optional() }) }),
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
        // INV-LLM-006 half-step: no `details` — the field is optional in the
        // schema and no client reads it (verified by grep in apps/bot).
        return reply.code(500).send({ error: { message: 'Processing failed' } });
      }
    },
  );
}
