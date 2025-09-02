import { Container } from '@infra/di/container';
import { TOKENS } from '@infra/di/tokens';
import { DrizzleUserRepository } from '@infra/db/repositories/user.repository';
import { UserService } from '@domain/user/services/user.service';
import { LLMService } from '@infra/ai/llm.service';
import dotenv from 'dotenv';
import path from 'path';

/**
 * Load environment variables for the specified NODE_ENV
 * @throws Error if NODE_ENV is not set or env file doesn't exist
 */
async function loadTestEnv(): Promise<void> {
  // Require NODE_ENV to be set
  if (!process.env.NODE_ENV) {
    throw new Error('NODE_ENV is not specified. Please set NODE_ENV=test for running tests.');
  }

  const envFile = `.env.${process.env.NODE_ENV}`;
  const envPath = path.resolve(process.cwd(), envFile);

  // Check if env file exists
  const fs = await import('fs');
  if (!fs.existsSync(envPath)) {
    throw new Error(`Environment file not found: ${envFile}. Please create ${envFile} file or set correct NODE_ENV.`);
  }

  dotenv.config({ path: envPath });
}

export async function setupTestDI() {
  await loadTestEnv();

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
  if (!c.has(TOKENS.LLM)) c.register(TOKENS.LLM, new LLMService());
}

beforeAll(async () => {
  await setupTestDI();
});


