import dotenv from 'dotenv';
import path from 'path';

export default async function globalTeardown() {
  // Load env file for teardown
  dotenv.config({ path: path.resolve(process.cwd(), '.env') });

  const { pool } = await import('../../infra/db/drizzle');
  await pool.end();
}


