import { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

import { registerChatRoutes } from '@app/routes/chat.routes';

export default fp(async (app: FastifyInstance): Promise<void> => {
  await registerChatRoutes(app);
}, {
  name: 'chat-routes',
});

