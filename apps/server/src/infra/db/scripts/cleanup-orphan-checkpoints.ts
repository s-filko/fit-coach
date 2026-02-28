import { sql } from 'drizzle-orm';

import { db, pool } from '@infra/db/drizzle';

import { createLogger } from '@shared/logger';

/**
 * One-time dev utility: removes LangGraph checkpoint rows that have no matching user.
 *
 * LangGraph stores graph state in checkpoint_* tables using thread_id = userId (text).
 * There is no FK to users, so orphan rows accumulate after test users are deleted.
 *
 * Run: npm run db:cleanup-orphan-checkpoints
 */

const log = createLogger('cleanup-orphan-checkpoints');

async function run(): Promise<void> {
  log.info('Scanning for orphan checkpoint rows (no matching user)...');

  // Order matters: delete child tables first to respect FK constraints
  const tables = ['checkpoint_blobs', 'checkpoint_writes', 'checkpoints'] as const;
  let totalDeleted = 0;

  for (const table of tables) {
    const result = await db.execute(
      sql.raw(`
        DELETE FROM ${table}
        WHERE thread_id NOT IN (SELECT id::text FROM users)
        RETURNING thread_id
      `),
    );
    const count = (result as { rows: unknown[] }).rows.length;
    totalDeleted += count;
    log.info({ table, deleted: count }, `Deleted ${count} orphan rows from ${table}`);
  }

  log.info({ totalDeleted }, `Done. Total orphan rows removed: ${totalDeleted}`);
}

run()
  .catch((err: unknown) => {
    log.error({ err }, 'Cleanup failed');
    process.exit(1);
  })
  .finally(() => {
    void pool.end();
  });
