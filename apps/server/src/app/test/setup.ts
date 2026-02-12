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

    // Seed minimal test exercises data
    const client3 = await pool.connect();
    try {
      // Insert test exercises
      await client3.query(`
        INSERT INTO exercises (
          name, category, equipment, exercise_type, description, 
          energy_cost, complexity, typical_duration_minutes, requires_spotter
        )
        VALUES 
          ('Barbell Bench Press', 'compound', 'barbell', 'strength', 
           'Chest compound movement', 'high', 'intermediate', 12, true),
          ('Barbell Back Squat', 'compound', 'barbell', 'strength', 
           'Leg compound movement', 'very_high', 'advanced', 15, true),
          ('Pull-ups', 'compound', 'bodyweight', 'strength', 
           'Back compound movement', 'high', 'intermediate', 10, false),
          ('Running', 'cardio', 'none', 'cardio_distance', 
           'Cardio exercise', 'medium', 'beginner', 30, false)
        ON CONFLICT (name) DO NOTHING
        RETURNING id;
      `);
      
      // Get exercise IDs
      const result = await client3.query(`
        SELECT id, name FROM exercises 
        WHERE name IN (
          'Barbell Bench Press', 'Barbell Back Squat', 'Pull-ups', 'Running'
        )
      `);
      
      // Insert muscle group mappings
      for (const row of result.rows) {
        if (row.name === 'Barbell Bench Press') {
          await client3.query(`
            INSERT INTO exercise_muscle_groups (exercise_id, muscle_group, involvement)
            VALUES ($1, 'chest', 'primary'), ($1, 'shoulders_front', 'secondary'), ($1, 'triceps', 'secondary')
            ON CONFLICT DO NOTHING
          `, [row.id]);
        } else if (row.name === 'Barbell Back Squat') {
          await client3.query(`
            INSERT INTO exercise_muscle_groups (exercise_id, muscle_group, involvement)
            VALUES ($1, 'quads', 'primary'), ($1, 'glutes', 'primary'), ($1, 'hamstrings', 'secondary')
            ON CONFLICT DO NOTHING
          `, [row.id]);
        } else if (row.name === 'Pull-ups') {
          await client3.query(`
            INSERT INTO exercise_muscle_groups (exercise_id, muscle_group, involvement)
            VALUES ($1, 'back_lats', 'primary'), ($1, 'biceps', 'secondary')
            ON CONFLICT DO NOTHING
          `, [row.id]);
        } else if (row.name === 'Running') {
          await client3.query(`
            INSERT INTO exercise_muscle_groups (exercise_id, muscle_group, involvement)
            VALUES ($1, 'cardio_system', 'primary'), ($1, 'lower_body_endurance', 'secondary')
            ON CONFLICT DO NOTHING
          `, [row.id]);
        }
      }
    } finally {
      client3.release();
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
