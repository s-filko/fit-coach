import { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

import { registerUserRoutes } from '@app/routes/user.routes';

export default fp(async (app: FastifyInstance): Promise<void> => {
  await registerUserRoutes(app);
}, {
  name: 'user-routes',
});
