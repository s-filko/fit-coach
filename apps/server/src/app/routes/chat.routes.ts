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

        // Insert context reset marker — getMessagesForPrompt will only return messages after this
        await app.services.conversationContextService.insertContextReset(userId);

        // Clear LangGraph checkpoints for this user (thread_id = userId by convention)
        const { db } = await import('@infra/db/drizzle');
        const { sql } = await import('drizzle-orm');
        await db.execute(sql`DELETE FROM checkpoint_writes WHERE thread_id = ${userId}`);
        await db.execute(sql`DELETE FROM checkpoint_blobs WHERE thread_id = ${userId}`);
        await db.execute(sql`DELETE FROM checkpoints WHERE thread_id = ${userId}`);

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

        const result = await app.services.conversationGraph.invoke(
          { userId, userMessage: message },
          { configurable: { thread_id: userId, userId }, recursionLimit: 50 },
        );

        return reply.send({
          data: {
            content: result.responseMessage,
            timestamp: new Date().toISOString(),
          },
        });
      } catch (error) {
        req.log.error({ err: error }, 'Chat processing failed');
        return reply.code(500).send({
          error: { message: 'Processing failed', details: error instanceof Error ? error.message : String(error) },
        });
      }
    },
  );
}
