import { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { IContainer } from '@domain/ports/container.ports';
import { USER_SERVICE_TOKEN } from '@domain/user/ports';
import { UserService } from '@domain/user/services/user.service';

const createUserBody = z.object({

  provider: z.string().min(1).describe('Auth provider, e.g. "telegram"'),
  providerUserId: z.string().min(1).describe('User ID from the provider'),
  username: z.string().optional().describe('Public username/handle from provider'),
  firstName: z.string().optional().describe('First name (if provided by provider)'),
  lastName: z.string().optional().describe('Last name (if provided by provider)'),
  languageCode: z.string().optional().describe('IETF language code, e.g. "en"'),
}).describe('Create or upsert user payload');

export async function registerUserRoutes(app: FastifyInstance, container: IContainer): Promise<void> {
  app.post('/api/user', {
    schema: {
      summary: 'Create or get user by provider',
      body: createUserBody,
      security: [{ ApiKeyAuth: [] }],
      response: {
        200: z.object({ data: z.object({ id: z.string().uuid().or(z.string()) }) }),
        401: z.object({ error: z.object({ message: z.string() }) }),
        403: z.object({ error: z.object({ message: z.string() }) }),
      },
    },
  }, async(req, reply) => {
    const service = container.get<UserService>(USER_SERVICE_TOKEN);
    const user = await service.upsertUser(req.body as {
      provider: string;
      providerUserId: string;
      username?: string;
      firstName?: string;
      lastName?: string;
      languageCode?: string;
    });
    return reply.send({ data: { id: user.id } });
  });

  app.get('/api/user/:id', {
    schema: {
      summary: 'Get user by id',
      params: z.object({ id: z.string() }),
      security: [{ ApiKeyAuth: [] }],
      response: {
        200: z.object({ data: z.object({ id: z.string() }) }),
        401: z.object({ error: z.object({ message: z.string() }) }),
        403: z.object({ error: z.object({ message: z.string() }) }),
        404: z.object({ error: z.object({ message: z.string() }) }),
      },
    },
  }, async(req, reply) => {
    const service = container.get<UserService>(USER_SERVICE_TOKEN);
    const { id } = req.params as { id: string };
    const user = await service.getUser(id);
    if (!user) {return reply.code(404).send({ error: { message: 'User not found' } });}
    return reply.send({ data: { id: user.id } });
  });
}
