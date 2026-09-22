/**
 * Close-out review (2026-09-22, R2 finding 3): `prune-llm-calls.cli.ts` was a near-verbatim copy of
 * `prune-checkpoints.cli.ts` — same flag parsing, same statement loop, same `.catch`/`.finally`
 * shape. One shared runner; each caller supplies only what actually differs between them (the
 * statement builder, the default window, and how a result's row count and its log line read).
 */
import type { QueryResult } from 'pg';

import { createLogger } from '@shared/logger';

export interface PruneStatementLike {
  table: string;
  sql: string;
  params: unknown[];
}

export interface PruneCliOptions<TStatement extends PruneStatementLike> {
  /** `createLogger` module name — distinguishes the two prune jobs' log lines. */
  loggerModule: string;
  /** Named in the top-level "Pruning <label> (APPLY|dry run)" line. */
  label: string;
  /** Used when `--days` is not passed. */
  defaultDays: number;
  buildStatements: (options: { days: number; apply: boolean }) => { statements: TStatement[] };
  /** How many rows a statement's result represents — apply's DELETE/UPDATE and a dry run's SELECT read this differently. */
  countFrom: (result: QueryResult, apply: boolean) => number;
  /** The per-statement line, e.g. `count => \`Deleted ${count} rows\`` for apply, or the "would" phrasing for a dry run. */
  describeCount: (count: number, apply: boolean) => string;
  /** Printed once, only for a dry run — what flag turns this into the real thing. */
  dryRunHint: string;
}

/**
 * Parses `--days`/`--apply` from `process.argv`, builds and runs each statement in order (one
 * `pool.query` per statement, sequential — the caller's own statements may depend on that order),
 * logs one line per statement plus the overall verdict, and always closes the pool. A failure sets
 * `process.exitCode = 1` rather than throwing past this function, matching both CLIs' original
 * `.catch(...).finally(...)` shape.
 */
export async function runPruneCli<TStatement extends PruneStatementLike>(
  opts: PruneCliOptions<TStatement>,
): Promise<void> {
  const { pool } = await import('@infra/db/drizzle');
  const log = createLogger(opts.loggerModule);

  const args = process.argv.slice(2);
  const daysArg = args.find(a => a.startsWith('--days'));
  const days = daysArg ? Number(daysArg.split('=')[1] ?? args[args.indexOf(daysArg) + 1]) : opts.defaultDays;
  const apply = args.includes('--apply');

  try {
    const { statements } = opts.buildStatements({ days, apply });

    log.info({ days, apply }, apply ? `Pruning ${opts.label} (APPLY)` : `Pruning ${opts.label} (dry run)`);

    for (const statement of statements) {
      // eslint-disable-next-line no-await-in-loop -- run sequentially, one log line per statement
      const result = await pool.query(statement.sql, statement.params);
      const count = opts.countFrom(result, apply);
      log.info({ table: statement.table, count, apply }, opts.describeCount(count, apply));
    }

    if (!apply) {
      log.info(`Dry run complete — ${opts.dryRunHint}`);
    }
  } catch (err) {
    log.error({ err }, 'Prune failed');
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
