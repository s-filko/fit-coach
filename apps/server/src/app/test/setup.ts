import path from 'path';

import dotenv from 'dotenv';

import { LLM_SERVICE_TOKEN } from '@domain/ai/ports';
import { USER_REPOSITORY_TOKEN, USER_SERVICE_TOKEN } from '@domain/user/ports';
import { ParsedProfileData, User, UserService } from '@domain/user/services/user.service';

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
  // Skip DB setup unless explicitly requested (integration/e2e)
  if (process.env.RUN_DB_TESTS === '1') {
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

    // Apply all migrations in order
    const { readFile, readdir } = await import('fs/promises');
    const path = await import('path');
    const migrationsDir = path.resolve(process.cwd(), 'drizzle');
    const files = await readdir(migrationsDir);
    const sqlFiles = files
      .filter(f => f.endsWith('.sql'))
      .sort(); // Sort to apply in order

    for (const file of sqlFiles) {
      const sqlPath = path.join(migrationsDir, file);
      const sql = await readFile(sqlPath, 'utf8');
      const client2 = await pool.connect();
      try {
        await client2.query(sql);
      } finally {
        client2.release();
      }
    }

    // Seed exercises data using npm script
    const { execSync } = await import('child_process');
    try {
      execSync('npm run db:seed:exercises', {
        cwd: process.cwd(),
        stdio: 'ignore',
      });
    } catch (err) {
      // Ignore if already seeded (duplicate key error)
    }

    // Register services in test container
    const c = Container.getInstance();
    if (!c.has(USER_REPOSITORY_TOKEN)) {c.register(USER_REPOSITORY_TOKEN, new DrizzleUserRepository());}
    if (!c.has(USER_SERVICE_TOKEN)) {
      c.registerFactory(USER_SERVICE_TOKEN, (c) => new UserService(c.get(USER_REPOSITORY_TOKEN)));
    }
    if (!c.has(LLM_SERVICE_TOKEN)) {c.register(LLM_SERVICE_TOKEN, new LLMService());}

    // Close the pool to avoid connection leaks
    await pool.end();
  }
}

beforeAll(async() => {
  await setupTestDI();
});
