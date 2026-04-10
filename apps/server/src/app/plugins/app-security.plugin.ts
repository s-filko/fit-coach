import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';

import { initDataPreHandler } from '@app/middlewares/init-data';

export default fp(
  async (app: FastifyInstance): Promise<void> => {
    app.addHook('preHandler', async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
      if (request.method === 'OPTIONS') {
        return;
      }
      await initDataPreHandler(request, reply);
    });
  },
  {
    name: 'app-security',
  },
);
