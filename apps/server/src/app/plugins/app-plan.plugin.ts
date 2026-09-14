import { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

import { registerAppPlanRoutes } from '@app/routes/app/plan.routes';

export default fp(
  async (app: FastifyInstance): Promise<void> => {
    await registerAppPlanRoutes(app);
  },
  {
    name: 'app-plan-routes',
  },
);
