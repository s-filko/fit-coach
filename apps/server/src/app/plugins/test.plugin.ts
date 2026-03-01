import { FastifyInstance } from 'fastify';

import { User } from '@domain/user/services/user.service';

/**
 * Test endpoints plugin for development and debugging.
 * Must be disabled in production.
 */
export async function testPlugin(fastify: FastifyInstance): Promise<void> {
  fastify.log.info('Test plugin registered');

  fastify.get('/test', async () => ({ message: 'Server is working' }));

  fastify.get('/test-config', async () => {
    const { loadConfig } = await import('@config/index');
    const config = loadConfig();
    return {
      nodeEnv: config.NODE_ENV,
      port: config.PORT,
    };
  });

  fastify.get('/test-di', async () => ({
    message: 'DI is working',
    hasUserService: !!fastify.services.userService,
    hasConversationGraph: !!fastify.services.conversationGraph,
  }));

  fastify.post('/test-profile-save', async request => {
    const { userId, profileData } = request.body as { userId: string; profileData: Partial<User> };

    try {
      const user = await fastify.services.userService.getUser(userId);
      if (!user) {
        return { success: false, error: 'User not found' };
      }
      const updatedUser = await fastify.services.userService.updateProfileData(userId, profileData);
      return { success: true, user: updatedUser };
    } catch (error) {
      request.log.error({ err: error }, 'Profile save failed');
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });
}
