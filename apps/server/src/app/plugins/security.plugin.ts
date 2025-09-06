import { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

import { apiKeyPreHandler } from '@app/middlewares/api-key';

// Security plugin: applies API key guard to /api routes only.
// Uses fastify-plugin to disable encapsulation so hooks work across contexts.
export default fp(async (app: FastifyInstance): Promise<void> => {
  app.addHook('preHandler', async (request, reply) => {
    // Only apply to /api routes, skip OPTIONS requests
    if (request.method === 'OPTIONS') {
      return;
    }
    if (!request.url.startsWith('/api')) {
      return;
    }
    await apiKeyPreHandler(request, reply);
  });
}, {
  name: 'security',
  encapsulate: false, // Disable encapsulation so hooks work across contexts
});
