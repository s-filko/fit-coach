import { FastifyInstance } from 'fastify';
import { z } from 'zod';

const HTTP_UNAUTHORIZED = 401;
const HTTP_NOT_FOUND = 404;

const profileResponse = z.object({
  data: z.object({
    id: z.string(),
    username: z.string().nullable().optional(),
    firstName: z.string().nullable().optional(),
    lastName: z.string().nullable().optional(),
    gender: z.string().nullable().optional(),
    age: z.number().nullable().optional(),
    height: z.number().nullable().optional(),
    weight: z.number().nullable().optional(),
    fitnessGoal: z.string().nullable().optional(),
    fitnessLevel: z.string().nullable().optional(),
    profileStatus: z.string().nullable().optional(),
    timezone: z.string().nullable().optional(),
  }),
});

export async function registerAppProfileRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/profile',
    {
      schema: {
        summary: 'Get current user profile (authenticated via initData)',
        security: [{ InitDataAuth: [] }],
        response: {
          200: profileResponse,
          401: z.object({ error: z.object({ message: z.string() }) }),
          404: z.object({ error: z.object({ message: z.string() }) }),
        },
      },
    },
    async (req, reply) => {
      const userId = req.telegramUserId;
      if (!userId) {
        return reply.code(HTTP_UNAUTHORIZED).send({ error: { message: 'Not authenticated' } });
      }

      const user = await app.services.userService.getUser(userId);
      if (!user) {
        return reply.code(HTTP_NOT_FOUND).send({ error: { message: 'User not found' } });
      }

      return reply.send({
        data: {
          id: user.id,
          username: user.username,
          firstName: user.firstName,
          lastName: user.lastName,
          gender: user.gender,
          age: user.age,
          height: user.height,
          weight: user.weight,
          fitnessGoal: user.fitnessGoal,
          fitnessLevel: user.fitnessLevel,
          profileStatus: user.profileStatus,
          timezone: user.timezone,
        },
      });
    },
  );
}
