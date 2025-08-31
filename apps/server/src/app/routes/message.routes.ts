import { FastifyInstance } from 'fastify';
import { z } from 'zod';

const messageBody = z.object({
  userId: z.string().min(1),
  message: z.string().min(1),
});

export async function registerMessageRoutes(app: FastifyInstance) {
  app.post('/api/message', {
    schema: {
      summary: 'Process user message (stub)',
      body: messageBody,
      security: [{ ApiKeyAuth: [] } as any],
      response: { 200: z.object({ data: z.object({ echo: z.string() }) }) },
    },
  }, async (req, reply) => {
    const { message } = req.body as any;
    return reply.send({ data: { echo: message } });
  });
}


