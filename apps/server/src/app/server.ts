import cors from '@fastify/cors';
import sensible from '@fastify/sensible';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import Fastify, { FastifyInstance } from 'fastify';
import { jsonSchemaTransform, serializerCompiler, validatorCompiler, ZodTypeProvider } from 'fastify-type-provider-zod';

import { registerErrorHandler } from '@app/middlewares/error';
import chatRoutesPlugin from '@app/plugins/chat-routes.plugin';
import { healthPlugin } from '@app/plugins/health.plugin';
import securityPlugin from '@app/plugins/security.plugin';
import { testPlugin } from '@app/plugins/test.plugin';
import userRoutesPlugin from '@app/plugins/user-routes.plugin';

import { IContainer } from '@domain/ports/container.ports';

export async function buildServer(container?: IContainer): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: 'info',
      transport: process.env.NODE_ENV === 'development' ? { target: 'pino-pretty' } : undefined,
    },
    requestTimeout: 30000,
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  app.register(cors, { origin: true });
  app.register(sensible);
  app.register(securityPlugin);

  registerErrorHandler(app);

  // Register plugins
  app.register(healthPlugin);
  
  // Register test plugin only in test environment
  if (process.env.NODE_ENV === 'test' && container) {
    app.register(testPlugin, { container });
  }

  // Swagger/OpenAPI - register first so routes can use it
  await app.register(swagger, {
    mode: 'dynamic',
    openapi: {
      openapi: '3.0.3',
      info: { title: 'Fit Coach API', version: '1.0.0' },
      components: {
        securitySchemes: {
          ApiKeyAuth: { type: 'apiKey', in: 'header', name: 'X-Api-Key' },
        },
      },
    },
    transform: jsonSchemaTransform,
  });

  await app.register(swaggerUi, { routePrefix: '/docs' });

  // routes - register as plugins now that swagger is available
  if (container) {
    await app.register(userRoutesPlugin, { container });
    await app.register(chatRoutesPlugin, { container });
  } else {
    // For testing without DI, create a mock container
    const mockContainer = {
      get: () => {
        throw new Error('Mock container - no services registered');
      },
      set: () => {},
      has: () => false,
    };
    await app.register(userRoutesPlugin, { container: mockContainer });
    await app.register(chatRoutesPlugin, { container: mockContainer });
  }

  // Force OpenAPI schema regeneration after routes are registered
  await app.ready();

  return app;
}
