import cors from '@fastify/cors';
import sensible from '@fastify/sensible';
import Fastify, { FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler, ZodTypeProvider } from 'fastify-type-provider-zod';

import { registerErrorHandler } from '@app/middlewares/error';
import chatRoutesPlugin from '@app/plugins/chat-routes.plugin';
import docsPlugin from '@app/plugins/docs.plugin';
import { healthPlugin } from '@app/plugins/health.plugin';
import securityPlugin from '@app/plugins/security.plugin';
import { testPlugin } from '@app/plugins/test.plugin';
import userRoutesPlugin from '@app/plugins/user-routes.plugin';

import { loadConfig } from '@config/index';

async function registerApiRoutes(instance: FastifyInstance): Promise<void> {
  await instance.register(securityPlugin);
  await instance.register(userRoutesPlugin);
  await instance.register(chatRoutesPlugin);
}

async function registerCorePlugins(app: FastifyInstance): Promise<void> {
  const config = loadConfig();
  
  app.register(cors, { origin: true });
  app.register(sensible);
  registerErrorHandler(app);
  app.register(healthPlugin);
  
  // Register test plugin only in test environment
  if (config.NODE_ENV === 'test') {
    app.register(testPlugin);
  }
  
  // Swagger/OpenAPI - register with encapsulate: false to see routes from other contexts
  app.register(docsPlugin);
}

export function buildServer(): FastifyInstance {
  const config = loadConfig();
  
  const app = Fastify({
    logger: {
      level: 'info',
      transport: config.NODE_ENV === 'development' ? { target: 'pino-pretty' } : undefined,
    },
    requestTimeout: 30000,
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  // Register core plugins
  void registerCorePlugins(app);

  // API routes with security
  app.register(registerApiRoutes, { prefix: '/api' });

  return app;
}
