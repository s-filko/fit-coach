import path from 'path';

import cors from '@fastify/cors';
import sensible from '@fastify/sensible';
import fastifyStatic from '@fastify/static';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import Fastify, { FastifyInstance } from 'fastify';
import { jsonSchemaTransform, serializerCompiler, validatorCompiler, ZodTypeProvider } from 'fastify-type-provider-zod';

import { apiKeyPreHandler } from '@app/middlewares/api-key';
import { registerErrorHandler } from '@app/middlewares/error';
import { healthPlugin } from '@app/plugins/health.plugin';
import { testPlugin } from '@app/plugins/test.plugin';
import { registerChatRoutes } from '@app/routes/chat.routes';
import { registerUserRoutes } from '@app/routes/user.routes';

import { IContainer } from '@domain/ports/container.ports';

export function buildServer(container?: IContainer): FastifyInstance {
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
  app.register(swagger, {
    mode: 'dynamic',
    openapi: {
      openapi: '3.0.3',
      info: { title: 'Fit Coach API', version: '1.0.0' },
      components: {
        securitySchemes: {
          ApiKeyAuth: {
            type: 'apiKey',
            in: 'header',
            name: 'X-Api-Key',
          },
        },
      },
    },
    transform: jsonSchemaTransform,
  });
  app.register(swaggerUi, { routePrefix: '/docs' });

  // Static files
  const __dirname = path.resolve();
  app.register(fastifyStatic, {
    root: path.join(__dirname, 'public'),
    prefix: '/public/',
  });

  // security guard on protected routes (exclude OPTIONS and public routes)
  app.addHook('preHandler', async(request, reply) => {
    // Skip API key check for OPTIONS requests (CORS preflight)
    if (request.method === 'OPTIONS') {
      return;
    }

    // Skip API key check for public routes
    if (request.url === '/health' || request.url.startsWith('/docs') || request.url.startsWith('/test')) {
      return;
    }

    // Apply API key check for protected routes
    await apiKeyPreHandler(request, reply);
  });

  registerErrorHandler(app);

  // Register plugins
  app.register(healthPlugin);
  
  // Register test plugin only in test environment
  if (process.env.NODE_ENV === 'test' && container) {
    app.register(testPlugin, { container });
  }

  // routes
  app.register(async instance => {
    if (container) {
      await registerUserRoutes(instance, container);
      await registerChatRoutes(instance, container);
    } else {
      // For testing without DI, create a mock container
      const mockContainer = {
        get: () => {
          throw new Error('Mock container - no services registered');
        },
        set: () => {},
        has: () => false,
      };
      await registerUserRoutes(instance, mockContainer);
      await registerChatRoutes(instance, mockContainer);
    }
  });

  return app;
}
