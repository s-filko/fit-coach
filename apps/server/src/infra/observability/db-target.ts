/**
 * `print-transcript` used to pick a database silently — `.env` vs `.env.test`
 * vs `.env.dev` look identical until a query fails with a raw Postgres error naming a column that
 * does exist, just not in whichever database this happened to open. Two small, DB-free helpers close
 * that: which database a connection actually points at, printed unconditionally so nobody mistakes
 * one for another again, and a friendly sentence for the one failure mode that specifically means
 * "this is the wrong database" — the schema here is behind migrations (a column/table this code
 * expects does not exist yet in the one it opened).
 */
import { findInErrorCauseChain } from '@shared/pg-error-cause';

export interface DatabaseTargetInfo {
  host: string;
  port: number;
  database: string;
}

export function formatDatabaseTarget(target: DatabaseTargetInfo): string {
  return `Reading from postgres://${target.host}:${target.port}/${target.database}`;
}

/** Postgres error codes for "a column/table this query names does not exist" — undefined_column, undefined_table. */
const SCHEMA_BEHIND_CODES = new Set(['42703', '42P01']);

/**
 * Null when `err` is not a schema-behind error — the caller prints it as-is, unchanged. Non-null is
 * a full sentence naming the database that was actually opened, for a mistake this specific (running
 * against a database whose migrations have not caught up, most often because it was the wrong
 * database in the first place) never to surface as a bare driver error again.
 */
function findCodedError(err: unknown): { code?: string; message?: string } | null {
  return findInErrorCauseChain(err, level =>
    level.code
      ? { code: level.code as string, message: typeof level.message === 'string' ? level.message : undefined }
      : null,
  );
}

export function describeSchemaError(err: unknown, target: DatabaseTargetInfo): string | null {
  const coded = findCodedError(err);
  if (!coded?.code || !SCHEMA_BEHIND_CODES.has(coded.code)) {
    return null;
  }
  const detail = coded.message ?? 'a query referenced a missing column or table';
  return (
    `The database at ${target.host}:${target.port}/${target.database} does not have the schema this ` +
    `command expects (${detail}). It is behind migrations, or this is simply the wrong database — ` +
    'pass --env-file <path> to point at a different one (see docs/LOGGING_GUIDE.md).'
  );
}
