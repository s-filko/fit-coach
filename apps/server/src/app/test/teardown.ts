import { pool } from '../../infra/db/drizzle';

export default async function globalTeardown() {
  await pool.end();
}


