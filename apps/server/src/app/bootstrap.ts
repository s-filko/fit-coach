import dotenv from 'dotenv';
import path from 'path';
import { buildServer } from './server';
import { loadConfig } from '@infra/config';
import { Container } from '@infra/di/container';
import { TOKENS } from '@infra/di/tokens';
import { InMemoryUserRepository, DrizzleUserRepository } from '@infra/db/repositories/user.repository';
import { ensureSchema } from '@infra/db/init';
import { UserService } from '@domain/user/services/user.service';

export async function bootstrap() {
  const envFile = process.env.NODE_ENV === 'test' ? '.env.test' : '.env';
  dotenv.config({ path: path.resolve(process.cwd(), envFile) });
  const config = loadConfig();

  const app = buildServer();

  // DI registration (MVP, in-memory)
  const c = Container.getInstance();
  // Prefer DB repo if DB env is present
  // Always require DB in non-test env
  if (process.env.NODE_ENV !== 'test') {
    if (!(process.env.DB_HOST && process.env.DB_USER && process.env.DB_PASSWORD && process.env.DB_NAME)) {
      throw new Error('Database environment variables are required');
    }
    await ensureSchema();
    c.register(TOKENS.USER_REPO, new DrizzleUserRepository());
  } else {
    // For test env, also use DB to mirror prod
    process.env.DB_HOST = process.env.DB_HOST || 'localhost';
    process.env.DB_USER = process.env.DB_USER || 'postgres';
    process.env.DB_PASSWORD = process.env.DB_PASSWORD || 'postgres';
    process.env.DB_NAME = process.env.DB_NAME || 'fit_coach_test';
    await ensureSchema();
    c.register(TOKENS.USER_REPO, new DrizzleUserRepository());
  }
  c.registerFactory(TOKENS.USER_SERVICE, (c) => new UserService(c.get(TOKENS.USER_REPO)));

  const port = config.PORT;
  const host = process.env.HOST || '0.0.0.0';

  try {
    await app.ready();
    await app.listen({ port, host });
    app.log.info(`Server running on http://${host}:${port}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}


