import { pool } from '@infra/db/drizzle';
import { readFile } from 'fs/promises';
import path from 'path';

export async function ensureSchema(): Promise<void> {
  // Temporary shim: run the initial SQL migration file
  const client = await pool.connect();
  try {
    const sqlPath = path.resolve(process.cwd(), 'drizzle/0000_initial.sql');
    const sql = await readFile(sqlPath, 'utf8');
    await client.query(sql);
  } finally {
    client.release();
  }
}


