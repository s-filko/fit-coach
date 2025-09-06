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

    const tablesExist = result.rows[0].exists;

    if (!tablesExist) {
      // Tables don't exist, apply migrations
      console.log('Applying database migrations...');
      const { exec } = await import('child_process');
      const { promisify } = await import('util');
      const execAsync = promisify(exec);

      try {
        await execAsync('npx drizzle-kit migrate');
        console.log('Migrations applied successfully');
      } catch (error) {
        console.error('Migration failed:', error);
        throw error;
      }
    } else {
      console.log('Database tables already exist, skipping migrations');
    }
  } finally {
    client.release();
  }
}

