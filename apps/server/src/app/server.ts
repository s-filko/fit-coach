import Fastify from 'fastify';
import cors from '@fastify/cors';
import sensible from '@fastify/sensible';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { serializerCompiler, validatorCompiler, ZodTypeProvider, jsonSchemaTransform } from 'fastify-type-provider-zod';
import { registerErrorHandler } from '@app/middlewares/error';
import { apiKeyPreHandler } from '@app/middlewares/api-key';
import { registerUserRoutes } from '@app/routes/user.routes';
import { registerChatRoutes } from '@app/routes/chat.routes';
import { Container } from '@infra/di/container';
import { TOKENS } from '@infra/di/tokens';
import { UserService } from '@domain/user/services/user.service';
import { LLMService } from '@infra/ai/llm.service';

export function buildServer() {
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

  // health
  app.get('/health', async () => ({ status: 'ok' }));

  // security guard on protected routes
  app.addHook('preHandler', apiKeyPreHandler);

  registerErrorHandler(app);

  // routes
  app.register(async (instance) => {
    // Ensure DI defaults for tests/local usage without bootstrap
    const c = Container.getInstance();
    if (!c.has(TOKENS.USER_SERVICE)) c.registerFactory(TOKENS.USER_SERVICE, (c) => new UserService(c.get(TOKENS.USER_REPO)));
    if (!c.has(TOKENS.LLM)) c.register(TOKENS.LLM, new LLMService());

    await registerUserRoutes(instance);
    await registerChatRoutes(instance);
  });

  return app;
}


