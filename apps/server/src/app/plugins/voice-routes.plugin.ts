import { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

import { registerVoiceRoutes } from '@app/routes/voice.routes';

export default fp(
  async (app: FastifyInstance): Promise<void> => {
    await registerVoiceRoutes(app);
  },
  {
    name: 'voice-routes',
  },
);
