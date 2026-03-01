import { FastifyInstance, FastifyPluginOptions } from 'fastify';

/**
 * Health and debug endpoints plugin
 * Provides basic health checks and debug information
 */
export async function healthPlugin(fastify: FastifyInstance, options: FastifyPluginOptions): Promise<void> {
  fastify.get('/health', async () => ({
    status: 'ok',
    version: process.env.APP_VERSION || 'local',
    commit: process.env.APP_GIT_SHA || 'dev',
    buildTime: process.env.APP_BUILD_TIME || null,
    env: process.env.NODE_ENV || 'unknown',
    uptime: Math.floor(process.uptime()),
  }));

  // Debug endpoint (redirects to debug page)
  fastify.get('/debug', async (request, reply) => {
    return reply.redirect('/public/llm-debug.html');
  });

  // Use options parameter to avoid unused variable warning
  if (options) {
    fastify.log.info('Health plugin registered');
  }
}
