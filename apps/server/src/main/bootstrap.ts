import path from 'path';

import dotenv from 'dotenv';
import { FastifyInstance } from 'fastify';

import { buildServer } from '@app/server';

import { LLMService } from '@domain/ai/ports';
import { IRegistrationService, IUserService } from '@domain/user/ports';

import { Container } from '@infra/di/container';

import { loadConfig } from '@config/index';

import { registerInfraServices } from './register-infra-services';

async function gracefulShutdown(app: FastifyInstance, signal: string): Promise<void> {
  app.log.info(`Received ${signal}, shutting down gracefully...`);
  try {
    await app.close();
    app.log.info('Server closed successfully');
    process.exit(0);
  } catch (err) {
    app.log.error({ err }, 'Error during shutdown');
    process.exit(1);
  }
}

async function startServer(app: FastifyInstance, port: number, host: string): Promise<void> {
  try {
    await app.ready();
    await app.listen({ port, host });
    app.log.info(`Server running on http://${host}:${port}`);
  } catch (err) {
    app.log.error({ err }, 'Failed to start server');
    process.exit(1);
  }
}

async function decorateAppWithServices(app: FastifyInstance, container: Container): Promise<void> {
  const { 
    USER_SERVICE_TOKEN,
    REGISTRATION_SERVICE_TOKEN,
  } = await import('@domain/user/ports');
  const { LLM_SERVICE_TOKEN } = await import('@domain/ai/ports');
  
  app.decorate('services', {
    userService: container.get<IUserService>(USER_SERVICE_TOKEN),
    registrationService: container.get<IRegistrationService>(REGISTRATION_SERVICE_TOKEN),
    llmService: container.get<LLMService>(LLM_SERVICE_TOKEN),
  });
}

export async function bootstrap(): Promise<void> {
  const envFile = process.env.NODE_ENV === 'production' ? '.env.production' : '.env';
  dotenv.config({ path: path.resolve(process.cwd(), envFile) });
  const config = loadConfig();

  // Create local container and server instance
  const container = new Container();
  const app: FastifyInstance = buildServer();

  // Register implementations (no DB side effects here)
  try {
    await registerInfraServices(container, { ensureDb: false });
    app.log.info('Infrastructure services registered successfully');
  } catch (err) {
    app.log.error({ err }, 'Failed to register infrastructure services');
    process.exit(1);
  }

  // Decorate app with services for cleaner DI
  await decorateAppWithServices(app, container);

  const port = config.PORT;
  const host = config.HOST;

  // Register signal handlers
  process.on('SIGINT', () => void gracefulShutdown(app, 'SIGINT'));
  process.on('SIGTERM', () => void gracefulShutdown(app, 'SIGTERM'));

  await startServer(app, port, host);
}
