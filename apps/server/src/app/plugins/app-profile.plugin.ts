import { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

import { registerAppProfileRoutes } from '@app/routes/app/profile.routes';

export default fp(
  async (app: FastifyInstance): Promise<void> => {
    await registerAppProfileRoutes(app);
  },
  {
    name: 'app-profile-routes',
  },
);
