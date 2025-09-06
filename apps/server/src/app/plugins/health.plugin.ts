import { FastifyInstance, FastifyPluginOptions } from 'fastify';

/**
 * Health and debug endpoints plugin
 * Provides basic health checks and debug information
 */
export async function healthPlugin(fastify: FastifyInstance, options: FastifyPluginOptions): Promise<void> {
  // Health check endpoint
  fastify.get('/health', async() => ({ status: 'ok' }));

  // Debug endpoint (redirects to debug page)
  fastify.get('/debug', async(request, reply) => {
    return reply.redirect('/public/llm-debug.html');
  });

  // Use options parameter to avoid unused variable warning
  if (options) {
    fastify.log.info('Health plugin registered');
  }
}
