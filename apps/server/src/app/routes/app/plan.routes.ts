import { FastifyInstance } from 'fastify';
import { z } from 'zod';

const HTTP_UNAUTHORIZED = 401;

const errorResponse = z.object({ error: z.object({ message: z.string() }) });

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

  app.post(
    '/plan',
    {
      schema: {
        summary: 'Create a new workout plan via AI',
        security: [{ InitDataAuth: [] }],
        body: z.object({
          goal: z.string().min(1),
          daysPerWeek: z.number().min(1).max(7),
          equipment: z.string().optional(),
        }),
        response: { 401: errorResponse },
      },
    },
    async (req, reply) => {
      const userId = req.telegramUserId;
      if (!userId) {
        return reply.code(HTTP_UNAUTHORIZED).send({ error: { message: 'Not authenticated' } });
      }

      const body = req.body as { goal: string; daysPerWeek: number; equipment?: string };
      const plan = await app.services.trainingService.createPlanFromPrompt(userId, body);
      return reply.send({ data: plan });
    },
  );
}
