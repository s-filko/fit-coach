import { FastifyInstance } from 'fastify';
import { z } from 'zod';

const createUserBody = z.object({

  provider: z.string().min(1).describe('Auth provider, e.g. "telegram"'),
  providerUserId: z.string().min(1).describe('User ID from the provider'),
  username: z.string().optional().describe('Public username/handle from provider'),
  firstName: z.string().optional().describe('First name (if provided by provider)'),
  lastName: z.string().optional().describe('Last name (if provided by provider)'),
  languageCode: z.string().optional().describe('IETF language code, e.g. "en"'),
}).describe('Create or upsert user payload');

export async function registerUserRoutes(app: FastifyInstance): Promise<void> {
  app.post('/user', {
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
    const user = await app.services.userService.upsertUser(req.body as {
      provider: string;
      providerUserId: string;
      username?: string;
      firstName?: string;
      lastName?: string;
      languageCode?: string;
    });
    return reply.send({ data: { id: user.id } });
  });

  app.get('/user/:id', {
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
    const { id } = req.params as { id: string };
    const user = await app.services.userService.getUser(id);
    if (!user) {return reply.code(404).send({ error: { message: 'User not found' } });}
    return reply.send({ data: { id: user.id } });
  });
}
