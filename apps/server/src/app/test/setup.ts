import path from 'path';

import dotenv from 'dotenv';

import { USER_REPOSITORY_TOKEN, USER_SERVICE_TOKEN } from '@domain/user/ports';
import { ParsedProfileData, User, UserService } from '@domain/user/services/user.service';

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

    const SCHEMA_RESET_ADVISORY_LOCK_KEY = 742_150_001;
    // Test-DB safety (training-journey-scenarios plan, 2026-09-20): the whole
    // per-file reset (drop + recreate + migrations + seeds) runs on ONE client
    // holding a Postgres advisory lock with a fixed key, so two concurrent jest
    // runs (e.g. two worktrees sharing one test DB) cannot drop the schema
    // under each other — the second waits for the lock instead of interleaving.
    // A crashed process loses the lock with its session, so nothing deadlocks.
    const resetClient = await pool.connect();
    try {
      await resetClient.query('select pg_advisory_lock($1)', [SCHEMA_RESET_ADVISORY_LOCK_KEY]);
      await resetClient.query('drop schema if exists public cascade; create schema public;');

      // Apply all migrations in order
      const { readFile, readdir } = await import('fs/promises');
      const path = await import('path');
      const migrationsDir = path.resolve(process.cwd(), 'drizzle');
      const files = await readdir(migrationsDir);
      const sqlFiles = files.filter(f => f.endsWith('.sql')).sort(); // Sort to apply in order

      for (const file of sqlFiles) {
        const sqlPath = path.join(migrationsDir, file);
        const sql = await readFile(sqlPath, 'utf8');
        await resetClient.query(sql);
      }

      // Seed minimal test exercises data
      // Insert test exercises with fixed UUIDs (matching seed file)
      await resetClient.query(`
        INSERT INTO exercises (
          id, name, category, equipment, exercise_type, description, 
          energy_cost, complexity, typical_duration_minutes, requires_spotter
        )
        VALUES 
          ('c7b0899c-a0f9-47ca-a69d-4bcd531b0c95', 'Barbell Bench Press', 'compound', 'barbell', 'strength', 
           'Chest compound movement', 'high', 'intermediate', 12, true),
          ('3818f94a-0543-4241-83b4-6840d06a4e6a', 'Barbell Back Squat', 'compound', 'barbell', 'strength', 
           'Leg compound movement', 'very_high', 'advanced', 15, true),
          ('8c88ebce-f5df-4d33-afdb-0b096a0dd7a8', 'Pull-ups', 'compound', 'bodyweight', 'strength', 
           'Back compound movement', 'high', 'intermediate', 10, false),
          ('da89020e-f54a-4573-b70b-764833ae761a', 'Running', 'cardio', 'none', 'cardio_distance', 
           'Cardio exercise', 'medium', 'beginner', 30, false)
        ON CONFLICT (id) DO NOTHING;
      `);

      // Get exercise IDs
      const result = await resetClient.query(`
        SELECT id, name FROM exercises 
        WHERE name IN (
          'Barbell Bench Press', 'Barbell Back Squat', 'Pull-ups', 'Running'
        )
      `);

      // Insert muscle group mappings
      for (const row of result.rows) {
        if (row.name === 'Barbell Bench Press') {
          await resetClient.query(
            `
            INSERT INTO exercise_muscle_groups (exercise_id, muscle_group, involvement)
            VALUES ($1, 'chest', 'primary'), ($1, 'shoulders_front', 'secondary'), ($1, 'triceps', 'secondary')
            ON CONFLICT DO NOTHING
          `,
            [row.id],
          );
        } else if (row.name === 'Barbell Back Squat') {
          await resetClient.query(
            `
            INSERT INTO exercise_muscle_groups (exercise_id, muscle_group, involvement)
            VALUES ($1, 'quads', 'primary'), ($1, 'glutes', 'primary'), ($1, 'hamstrings', 'secondary')
            ON CONFLICT DO NOTHING
          `,
            [row.id],
          );
        } else if (row.name === 'Pull-ups') {
          await resetClient.query(
            `
            INSERT INTO exercise_muscle_groups (exercise_id, muscle_group, involvement)
            VALUES ($1, 'back_lats', 'primary'), ($1, 'biceps', 'secondary')
            ON CONFLICT DO NOTHING
          `,
            [row.id],
          );
        } else if (row.name === 'Running') {
          await resetClient.query(
            `
            INSERT INTO exercise_muscle_groups (exercise_id, muscle_group, involvement)
            VALUES ($1, 'cardio_system', 'primary'), ($1, 'lower_body_endurance', 'secondary')
            ON CONFLICT DO NOTHING
          `,
            [row.id],
          );
        }
      }
    } finally {
      await resetClient.query('select pg_advisory_unlock($1)', [SCHEMA_RESET_ADVISORY_LOCK_KEY]).catch(() => {});
      resetClient.release();
    }

    // Register services in test container
    const c = Container.getInstance();
    if (!c.has(USER_REPOSITORY_TOKEN)) {
      c.register(USER_REPOSITORY_TOKEN, new DrizzleUserRepository());
    }
    if (!c.has(USER_SERVICE_TOKEN)) {
      c.registerFactory(USER_SERVICE_TOKEN, c => new UserService(c.get(USER_REPOSITORY_TOKEN)));
    }
    // Close the pool to avoid connection leaks
    await pool.end();
  }
}

beforeAll(async () => {
  await setupTestDI();
});

// Releases any embedding pipeline this test file's process loaded — otherwise its native ONNX
// session's thread pool outlives the process and jest's forceExit aborts it instead of joining
// cleanly (libc++abi: mutex lock failed). See EmbeddingService.dispose.
afterAll(async () => {
  const { disposeAllEmbeddingServices } = await import('@infra/ai/embedding.service');
  await disposeAllEmbeddingServices();
});
