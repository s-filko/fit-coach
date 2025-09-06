import { FastifyInstance, FastifyPluginOptions } from 'fastify';
import fp from 'fastify-plugin';

import { registerUserRoutes } from '@app/routes/user.routes';

import { IContainer } from '@domain/ports/container.ports';

export default fp(async (
  app: FastifyInstance,
  opts: FastifyPluginOptions & { container: IContainer },
): Promise<void> => {
  await registerUserRoutes(app, opts.container);
}, {
  name: 'user-routes',
});
