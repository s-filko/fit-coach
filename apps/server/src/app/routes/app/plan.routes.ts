import { FastifyInstance } from 'fastify';
import { z } from 'zod';

const HTTP_UNAUTHORIZED = 401;
const HTTP_GONE = 410;

const errorResponse = z.object({ error: z.object({ message: z.string() }) });
const retiredResponse = z.object({ error: z.object({ code: z.literal('RETIRED') }) });

export async function registerAppPlanRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/plan',
    {
      schema: {
        summary: 'Get active workout plan or null',
        security: [{ InitDataAuth: [] }],
        response: { 401: errorResponse },
      },
    },
    async (req, reply) => {
      const userId = req.telegramUserId;
      if (!userId) {
        return reply.code(HTTP_UNAUTHORIZED).send({ error: { message: 'Not authenticated' } });
      }

      const plan = await app.services.trainingService.getActivePlan(userId);
      return reply.send({ data: plan ?? null });
    },
  );

  // Retired — ADR-0013 §7 / OQ-1: plan generation is a bot conversation, not a mini-app call.
  app.post(
    '/plan',
    {
      schema: {
        summary: 'Retired: AI plan generation moved to the bot conversation (ADR-0013 OQ-1)',
        security: [{ InitDataAuth: [] }],
        response: { 401: errorResponse, 410: retiredResponse },
      },
    },
    async (req, reply) => {
      if (!req.telegramUserId) {
        return reply.code(HTTP_UNAUTHORIZED).send({ error: { message: 'Not authenticated' } });
      }
      return reply.code(HTTP_GONE).send({ error: { code: 'RETIRED' } });
    },
  );
}
