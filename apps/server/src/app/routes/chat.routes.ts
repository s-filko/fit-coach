import { FastifyInstance } from 'fastify';
import { z } from 'zod';

const chatMessageBody = z.object({
  userId: z.string().min(1).describe('User ID'),
  message: z.string().min(1).describe('User message'),
}).describe('Chat message payload');

export async function registerChatRoutes(app: FastifyInstance): Promise<void> {
  app.post('/chat', {
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
  }, async (req, reply) => {
    try {
      const { userId, message } = req.body as { userId: string; message: string };

      const result = await app.services.conversationGraph.invoke(
        { userId, userMessage: message },
        { configurable: { thread_id: userId, userId }, recursionLimit: 25 },
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
  });
}
