/**
 * CLI entry for llm_calls payload retention (AC-AT-6). Dry-run by default;
 * pass --apply to actually drop payloads. A nightly cron job, owner-installed
 * (docs/LOGGING_GUIDE.md), same operating model as db:prune-checkpoints —
 * no in-app scheduler.
 *
 * Run: npm run db:prune-llm-calls [-- --days N] [-- --apply]
 * `--days` overrides LLM_CALLS_RETENTION_DAYS for this run only; the default
 * is the configured window, read once here so the number lives in one place.
 */
import { pool } from '@infra/db/drizzle';

import { loadConfig } from '@config/index';

import { createLogger } from '@shared/logger';

import { buildPruneLlmCallsStatement } from './prune-llm-calls';

const log = createLogger('prune-llm-calls');

async function run(): Promise<void> {
  const args = process.argv.slice(2);
  const daysArg = args.find(a => a.startsWith('--days'));
  const days = daysArg
    ? Number(daysArg.split('=')[1] ?? args[args.indexOf(daysArg) + 1])
    : loadConfig().LLM_CALLS_RETENTION_DAYS;
  const apply = args.includes('--apply');

  const { sql, params } = buildPruneLlmCallsStatement({ days, apply });

  log.info({ days, apply }, apply ? 'Pruning llm_calls payloads (APPLY)' : 'Pruning llm_calls payloads (dry run)');

  const result = await pool.query(sql, params);
  const count = apply ? (result.rowCount ?? 0) : Number(result.rows[0]?.count ?? 0);
  log.info(
    { count, apply },
    apply ? `Dropped the payload of ${count} rows` : `Would drop the payload of ${count} rows`,
  );

  if (!apply) {
    log.info('Dry run complete — pass --apply to drop payloads.');
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
