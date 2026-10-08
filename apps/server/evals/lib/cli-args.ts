/** Shared CLI plumbing of the eval entry points (run.ts, the judge, the sidecar backfill). */

/** The value after `flag` in argv, or `fallback` when the flag or its value is absent. */
export function argValue(flag: string, fallback: string): string {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? (process.argv[index + 1] ?? fallback) : fallback;
}

/** Closes the app's DB pool (dynamic import: no pool is opened where none was used). */
export async function closePool(): Promise<void> {
  const { pool } = await import('@infra/db/drizzle');
  await pool.end();
}
