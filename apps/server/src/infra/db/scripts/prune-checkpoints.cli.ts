/**
 * CLI entry for checkpoint pruning (BR-LLM-005). Dry-run by default; pass
 * --apply to delete. A nightly cron job, owner-installed (`docs/CICD.md`);
 * no in-app scheduler.
 *
 * Run: npm run db:prune-checkpoints [-- --days N] [-- --apply]
 */
import { pool } from '@infra/db/drizzle';

import { createLogger } from '@shared/logger';

import { buildPruneStatements, DEFAULT_DAYS } from './prune-checkpoints';

const log = createLogger('prune-checkpoints');

async function run(): Promise<void> {
  const args = process.argv.slice(2);
  const daysArg = args.find(a => a.startsWith('--days'));
  const days = daysArg ? Number(daysArg.split('=')[1] ?? args[args.indexOf(daysArg) + 1]) : DEFAULT_DAYS;
  const apply = args.includes('--apply');

  const { statements } = buildPruneStatements({ days, apply });

  log.info({ days, apply }, apply ? 'Pruning checkpoints (APPLY)' : 'Pruning checkpoints (dry run)');

  for (const statement of statements) {
    // eslint-disable-next-line no-await-in-loop
    const result = await pool.query(statement.sql, statement.params);
    const count = result.rowCount ?? 0;
    log.info({ table: statement.table, count, apply }, apply ? `Deleted ${count} rows` : `Would delete ${count} rows`);
  }

  if (!apply) {
    log.info('Dry run complete — pass --apply to delete.');
  }
}

run()
  .catch((err: unknown) => {
    log.error({ err }, 'Prune failed');
    process.exit(1);
  })
  .finally(() => {
    void pool.end();
  });
