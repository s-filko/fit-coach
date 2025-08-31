import Fastify from 'fastify';
import cors from '@fastify/cors';
import sensible from '@fastify/sensible';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { serializerCompiler, validatorCompiler, ZodTypeProvider } from 'fastify-type-provider-zod';
import { registerErrorHandler } from './middlewares/error';
import { registerUserRoutes } from './routes/user.routes';
import { registerMessageRoutes } from './routes/message.routes';
import { Container } from '@infra/di/container';
import { TOKENS } from '@infra/di/tokens';
import { InMemoryUserRepository } from '@infra/db/repositories/user.repository';
import { UserService } from '@domain/user/services/user.service';

export function buildServer() {
  const app = Fastify({
    logger: {
      level: 'info',
      transport: process.env.NODE_ENV !== 'production' ? { target: 'pino-pretty' } : undefined,
    },
    requestTimeout: 30000,
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  app.register(cors, { origin: true });
  app.register(sensible);
  app.register(swagger, {
    openapi: {
      info: { title: 'Fit Coach API', version: '1.0.0' },
    },
  });
  app.register(swaggerUi, { routePrefix: '/docs' });

  // health
  app.get('/health', async () => ({ status: 'ok' }));

  registerErrorHandler(app);

  // routes
  app.register(async (instance) => {
    // Ensure DI defaults for tests/local usage without bootstrap
    const c = Container.getInstance();
    if (!c.has(TOKENS.USER_REPO)) c.register(TOKENS.USER_REPO, new InMemoryUserRepository());
    if (!c.has(TOKENS.USER_SERVICE)) c.registerFactory(TOKENS.USER_SERVICE, (c) => new UserService(c.get(TOKENS.USER_REPO)));

    await registerUserRoutes(instance);
    await registerMessageRoutes(instance);
  });

  return app;
}


