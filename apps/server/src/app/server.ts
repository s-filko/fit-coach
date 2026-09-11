import cors from '@fastify/cors';
import sensible from '@fastify/sensible';
import Fastify, { FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler, ZodTypeProvider } from 'fastify-type-provider-zod';

import { registerErrorHandler } from '@app/middlewares/error';
import appPlanPlugin from '@app/plugins/app-plan.plugin';
import appProfilePlugin from '@app/plugins/app-profile.plugin';
import appSecurityPlugin from '@app/plugins/app-security.plugin';
import appSessionPlugin from '@app/plugins/app-session.plugin';
import botSecurityPlugin from '@app/plugins/bot-security.plugin';
import chatRoutesPlugin from '@app/plugins/chat-routes.plugin';
import docsPlugin from '@app/plugins/docs.plugin';
import { healthPlugin } from '@app/plugins/health.plugin';
import { testPlugin } from '@app/plugins/test.plugin';
import userRoutesPlugin from '@app/plugins/user-routes.plugin';

import { loadConfig } from '@config/index';

async function registerBotRoutes(instance: FastifyInstance): Promise<void> {
  await instance.register(botSecurityPlugin);
  await instance.register(userRoutesPlugin);
  await instance.register(chatRoutesPlugin);
}

async function registerAppRoutes(instance: FastifyInstance): Promise<void> {
  await instance.register(appSecurityPlugin);
  await instance.register(appProfilePlugin);
  await instance.register(appPlanPlugin);
  await instance.register(appSessionPlugin);
}

async function registerCorePlugins(app: FastifyInstance): Promise<void> {
  const config = loadConfig();

  app.register(cors, { origin: true });
  app.register(sensible);
  registerErrorHandler(app);
  app.register(healthPlugin);

  if (config.NODE_ENV === 'test') {
    app.register(testPlugin);
  }

  app.register(docsPlugin);
}

export function buildServer(): FastifyInstance {
  const config = loadConfig();

  const app = Fastify({
    logger: {
      level: config.LOG_LEVEL ?? 'info',
      transport: config.NODE_ENV === 'development' ? { target: 'pino-pretty' } : undefined,
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers.cookie',
          'req.headers["x-api-key"]',
          'req.headers["x-init-data"]',
          '*.password',
          '*.apiKey',
          '*.token',
          '*.secret',
        ],
        censor: '[REDACTED]',
      },
    },
    requestTimeout: 30000,
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  void registerCorePlugins(app);

  app.register(registerBotRoutes, { prefix: '/api/bot' });
  app.register(registerAppRoutes, { prefix: '/api/app' });

  return app;
}
