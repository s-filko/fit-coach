import pino from 'pino';

const logger = pino({ level: 'error' });
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

export default async function globalTeardown(): Promise<void> {
  await loadTestEnv();

  // Close database connection
  try {
    const { pool } = await import('../../infra/db/drizzle');
    if (pool) {
      await pool.end();
    }
  } catch (error) {
    logger.error({ err: error }, 'Test teardown: failed to close DB pool');
  }
}

