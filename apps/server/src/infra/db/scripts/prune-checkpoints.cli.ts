/**
 * CLI entry for checkpoint pruning (BR-LLM-005). Dry-run by default; pass
 * --apply to delete. A nightly cron job, owner-installed (`docs/CICD.md`);
 * no in-app scheduler.
 *
 * Run: npm run db:prune-checkpoints [-- --days N] [-- --apply]
 */
import { buildPruneStatements, DEFAULT_DAYS } from './prune-checkpoints';
import { runPruneCli } from './prune-cli-runner';

runPruneCli({
  loggerModule: 'prune-checkpoints',
  label: 'checkpoints',
  defaultDays: DEFAULT_DAYS,
  buildStatements: buildPruneStatements,
  countFrom: result => result.rowCount ?? 0,
  describeCount: (count, apply) => (apply ? `Deleted ${count} rows` : `Would delete ${count} rows`),
  dryRunHint: 'pass --apply to delete.',
});
