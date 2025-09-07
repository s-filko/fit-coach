import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';

import { apiKeyPreHandler } from '@app/middlewares/api-key';

/**
 * Security plugin: applies API key guard to all routes in this context.
 * Since this plugin is registered under /api prefix, it only affects /api routes.
 */

function shouldSkipSecurityCheck(request: FastifyRequest): boolean {
  return request.method === 'OPTIONS';
}

export default fp(async(app: FastifyInstance): Promise<void> => {
  app.addHook('preHandler', async(request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (shouldSkipSecurityCheck(request)) {
      return;
    }
    await apiKeyPreHandler(request, reply);
  });
}, {
  name: 'security',
});
