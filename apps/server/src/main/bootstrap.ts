import path from 'path';

import dotenv from 'dotenv';
import { FastifyInstance } from 'fastify';

import { buildServer } from '@app/server';

import { loadConfig } from '@config/index';

import { getGlobalContainer, registerInfraServices } from './register-infra-services';

export async function bootstrap(): Promise<void> {
  const envFile = process.env.NODE_ENV === 'production' ? '.env.production' : '.env';
  dotenv.config({ path: path.resolve(process.cwd(), envFile) });
  const config = loadConfig();

  const app: FastifyInstance = buildServer(getGlobalContainer());

  // DI registration (MVP, in-memory)
  // Register all infrastructure services with error handling
  try {
    await registerInfraServices();
    app.log.info('Infrastructure services registered successfully');
  } catch (err) {
    app.log.error({ err }, 'Failed to register infrastructure services');
    process.exit(1);
  }

  const port = config.PORT;
  const host = process.env.HOST;

  // Graceful shutdown handler
  const gracefulShutdown = async(signal: string): Promise<void> => {
    app.log.info(`Received ${signal}, shutting down gracefully...`);
    try {
      await app.close();
      app.log.info('Server closed successfully');
      process.exit(0);
    } catch (err) {
      app.log.error({ err }, 'Error during shutdown');
      process.exit(1);
    }
  };

  // Register signal handlers
  process.on('SIGINT', () => void gracefulShutdown('SIGINT'));
  process.on('SIGTERM', () => void gracefulShutdown('SIGTERM'));

  try {
    await app.ready();
    await app.listen({ port, host });
    app.log.info(`Server running on http://${host}:${port}`);
  } catch (err) {
    app.log.error({ err }, 'Failed to start server');
    process.exit(1);
  }
}
