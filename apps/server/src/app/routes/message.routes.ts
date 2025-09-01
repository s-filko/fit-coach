import { FastifyInstance } from 'fastify';
import { z } from 'zod';

const messageBody = z.object({
  userId: z.string().min(1).describe('Internal user UUID (from /api/user)'),
  message: z.string().min(1).describe('User message text'),
}).describe('Message processing payload');

export async function registerMessageRoutes(app: FastifyInstance) {
  app.post('/api/message', {
    schema: {
      summary: 'Process user message (stub)',
      body: messageBody,
      security: [{ ApiKeyAuth: [] } as any],
      response: {
        200: z.object({ data: z.object({ echo: z.string() }) }),
        401: z.object({ error: z.object({ message: z.string() }) }),
        403: z.object({ error: z.object({ message: z.string() }) }),
      },
    },
  }, async (req, reply) => {
    const { message } = req.body as any;
    return reply.send({ data: { echo: message } });
  });
}


