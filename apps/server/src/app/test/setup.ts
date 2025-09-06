import path from 'path';

import dotenv from 'dotenv';

import { LLM_SERVICE_TOKEN } from '@domain/ai/ports';
import { USER_REPOSITORY_TOKEN, USER_SERVICE_TOKEN } from '@domain/user/ports';
import { UserService } from '@domain/user/services/user.service';

import { LLMService } from '@infra/ai/llm.service';
import { DrizzleUserRepository } from '@infra/db/repositories/user.repository';
import { Container } from '@infra/di/container';

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

export async function setupTestDI(): Promise<void> {
  await loadTestEnv();

  // Create pool after env is loaded
  const { Pool } = await import('pg');
  const pool = new Pool({
    host: process.env.DB_HOST!,
    user: process.env.DB_USER!,
    password: process.env.DB_PASSWORD!,
    database: process.env.DB_NAME!,
    port: Number(process.env.DB_PORT),
  });

  const client = await pool.connect();
  try {
    await client.query('drop schema if exists public cascade; create schema public;');
  } finally {
    client.release();
  }

  // Apply migrations
  const { readFile } = await import('fs/promises');
  const path = await import('path');
  const sqlPath = path.resolve(process.cwd(), 'drizzle/0000_familiar_stark_industries.sql');
  const sql = await readFile(sqlPath, 'utf8');
  await client.query(sql);

  // Register services
  const c = Container.getInstance();
  if (!c.has(USER_REPOSITORY_TOKEN)) {c.register(USER_REPOSITORY_TOKEN, new DrizzleUserRepository());}
  if (!c.has(USER_SERVICE_TOKEN)) {
    c.registerFactory(USER_SERVICE_TOKEN, (c) => new UserService(c.get(USER_REPOSITORY_TOKEN)));
  }
  if (!c.has(LLM_SERVICE_TOKEN)) {c.register(LLM_SERVICE_TOKEN, new LLMService());}

  // Close the pool to avoid connection leaks
  await pool.end();
}

beforeAll(async() => {
  await setupTestDI();
});

