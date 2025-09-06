import { FastifyInstance, FastifyPluginOptions } from 'fastify';
import fp from 'fastify-plugin';

import { registerChatRoutes } from '@app/routes/chat.routes';

import { IContainer } from '@domain/ports/container.ports';

export default fp(async (
  app: FastifyInstance,
  opts: FastifyPluginOptions & { container: IContainer },
): Promise<void> => {
  await registerChatRoutes(app, opts.container);
}, {
  name: 'chat-routes',
});
