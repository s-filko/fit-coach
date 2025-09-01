import { Container } from '@infra/di/container';
import { TOKENS } from '@infra/di/tokens';
import { DrizzleUserRepository } from '@infra/db/repositories/user.repository';
import { UserService } from '@domain/user/services/user.service';
import dotenv from 'dotenv';
import path from 'path';

export async function setupTestDI() {
  dotenv.config({ path: path.resolve(process.cwd(), '.env') });

  // Reset schema and apply migrations
  const { pool } = await import('@infra/db/drizzle');
  const client = await pool.connect();
  try {
    await client.query('drop schema if exists public cascade; create schema public;');
  } finally {
    client.release();
  }

  const { ensureSchema } = await import('@infra/db/init');
  await ensureSchema();

  const c = Container.getInstance();
  if (!c.has(TOKENS.USER_REPO)) c.register(TOKENS.USER_REPO, new DrizzleUserRepository());
  if (!c.has(TOKENS.USER_SERVICE)) c.registerFactory(TOKENS.USER_SERVICE, (c) => new UserService(c.get(TOKENS.USER_REPO)));
}

beforeAll(async () => {
  await setupTestDI();
});


