import dotenv from 'dotenv';
import path from 'path';
import { buildServer } from '@app/server';
import { loadConfig } from '@infra/config';
import { Container } from '@infra/di/container';
import { TOKENS } from '@infra/di/tokens';
import { DrizzleUserRepository } from '@infra/db/repositories/user.repository';
import { ensureSchema } from '@infra/db/init';
import { UserService } from '@domain/user/services/user.service';
import { LLMService } from '@infra/ai/llm.service';

export async function bootstrap() {
  const envFile = process.env.NODE_ENV === 'production' ? '.env.production' : '.env';
  dotenv.config({ path: path.resolve(process.cwd(), envFile) });
  const config = loadConfig();

  const app = buildServer();

  // DI registration (MVP, in-memory)
  const c = Container.getInstance();

  // Require all database environment variables
  if (!(process.env.DB_HOST && process.env.DB_USER && process.env.DB_PASSWORD && process.env.DB_NAME)) {
    throw new Error('Database environment variables are required: DB_HOST, DB_USER, DB_PASSWORD, DB_NAME');
  }

  await ensureSchema();
  c.register(TOKENS.USER_REPO, new DrizzleUserRepository());
  c.registerFactory(TOKENS.USER_SERVICE, (c) => new UserService(c.get(TOKENS.USER_REPO)));
  c.register(TOKENS.LLM, new LLMService());

  const port = config.PORT;
  const host = process.env.HOST;

  try {
    await app.ready();
    await app.listen({ port, host });
    app.log.info(`Server running on http://${host}:${port}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}


