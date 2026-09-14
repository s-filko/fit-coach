import { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

import { registerAppSessionRoutes } from '@app/routes/app/session.routes';

export default fp(
  async (app: FastifyInstance): Promise<void> => {
    await registerAppSessionRoutes(app);
  },
  {
    name: 'app-session-routes',
  },
);
