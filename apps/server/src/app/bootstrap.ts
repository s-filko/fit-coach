import dotenv from 'dotenv';
import path from 'path';
import { buildServer } from './server';
import { loadConfig } from '@infra/config';
import { Container } from '@infra/di/container';
import { TOKENS } from '@infra/di/tokens';
import { InMemoryUserRepository } from '@infra/db/repositories/user.repository';
import { UserService } from '@domain/user/services/user.service';

export async function bootstrap() {
  const envFile = process.env.NODE_ENV === 'test' ? '.env.test' : '.env';
  dotenv.config({ path: path.resolve(process.cwd(), envFile) });
  const config = loadConfig();

  const app = buildServer();

  // DI registration (MVP, in-memory)
  const c = Container.getInstance();
  c.register(TOKENS.USER_REPO, new InMemoryUserRepository());
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


