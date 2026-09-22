/**
 * CLI entry for llm_calls/prompt_blobs retention (AC-AT-6). Dry-run by
 * default; pass --apply to actually drop payloads. A nightly cron job,
 * owner-installed (docs/LOGGING_GUIDE.md), same operating model as
 * db:prune-checkpoints — no in-app scheduler.
 *
 * Run: npm run db:prune-llm-calls [-- --days N] [-- --apply]
 * `--days` overrides LLM_CALLS_RETENTION_DAYS for this run only; the default
 * is the configured window, read once here so the number lives in one place.
 * Both statements (llm_calls, then prompt_blobs) share that same `days` —
 * the blob pass's own liveness check needs it too (prune-llm-calls.ts's
 * header explains why), so the two no longer depend on running in a
 * particular order, only on the same window.
 */
import { loadConfig } from '@config/index';

import { runPruneCli } from './prune-cli-runner';
import { buildPruneLlmCallsStatements } from './prune-llm-calls';

runPruneCli({
  loggerModule: 'prune-llm-calls',
  label: 'llm_calls/prompt_blobs',
  defaultDays: loadConfig().LLM_CALLS_RETENTION_DAYS,
  buildStatements: buildPruneLlmCallsStatements,
  countFrom: (result, apply) => (apply ? (result.rowCount ?? 0) : Number(result.rows[0]?.count ?? 0)),
  describeCount: (count, apply) =>
    apply ? `Dropped the payload of ${count} rows` : `Would drop the payload of ${count} rows`,
  dryRunHint: 'pass --apply to drop payloads.',
});
