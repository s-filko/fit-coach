import { pool } from '@infra/db/drizzle';

export async function ensureSchema(): Promise<void> {
  // Check if tables exist, if not - apply migrations
  const client = await pool.connect();
  try {
    // Check if user_accounts table exists
    const result = await client.query(`
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'public'
        AND table_name = 'user_accounts'
      );
    `);

    const tablesExist = (result.rows[0] as { exists: boolean }).exists;

    if (!tablesExist) {
      // Tables don't exist, apply migrations
      const { exec } = await import('child_process');
      const { promisify } = await import('util');
      const execAsync = promisify(exec);

      await execAsync('npx drizzle-kit migrate');
    }
  } finally {
    client.release();
  }
}

