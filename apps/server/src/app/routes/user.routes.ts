import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { Container } from '@infra/di/container';
import { TOKENS } from '@infra/di/tokens';
import { UserService } from '@domain/user/services/user.service';

const createUserBody = z.object({
  provider: z.string().min(1),
  providerUserId: z.string().min(1),
  username: z.string().optional(),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  languageCode: z.string().optional(),
});

export async function registerUserRoutes(app: FastifyInstance) {
  app.post('/api/user', {
    schema: {
      summary: 'Create or get user by provider',
      body: createUserBody,
      security: [{ ApiKeyAuth: [] } as any],
      response: {
        200: z.object({ data: z.object({ id: z.string().uuid().or(z.string()) }) }),
      },
    },
  }, async (req, reply) => {
    const container = Container.getInstance();
    const service = container.get<UserService>(TOKENS.USER_SERVICE);
    const user = await service.upsertUser(req.body as any);
    return reply.send({ data: { id: user.id } });
  });

  app.get('/api/user/:id', {
    schema: {
      summary: 'Get user by id',
      params: z.object({ id: z.string() }),
      security: [{ ApiKeyAuth: [] } as any],
      response: {
        200: z.object({ data: z.object({ id: z.string() }) }),
        404: z.object({ error: z.object({ message: z.string() }) }),
      },
    },
  }, async (req, reply) => {
    const container = Container.getInstance();
    const service = container.get<UserService>(TOKENS.USER_SERVICE);
    const { id } = (req.params as any);
    const user = await service.getUser(id);
    if (!user) return reply.code(404).send({ error: { message: 'User not found' } });
    return reply.send({ data: { id: user.id } });
  });
}


