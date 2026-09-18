/**
 * Checkpoint pruning SQL builder (BR-LLM-005) — pure, no I/O: `buildPruneStatements`
 * returns dry-run SELECTs by default (counts what would go) or DELETEs with
 * `apply: true`. Never touches the latest checkpoint per `(thread_id,
 * checkpoint_ns)` or the blob versions it references — that checkpoint must
 * stay loadable. The CLI entry point (`prune-checkpoints.cli.ts`) runs these
 * statements against the DB; kept separate so this module has zero side
 * effects and is safely importable by tests.
 *
 * `checkpoints` has no timestamp column of its own — LangGraph stores the
 * checkpoint's creation time as an ISO string at `checkpoint->>'ts'`
 * (verified against the running schema, 2026-09-19); age is computed from
 * that, not from row insert order.
 */
export const DEFAULT_DAYS = 14;

export interface PruneOptions {
  days?: number;
  apply?: boolean;
}

export interface PruneStatement {
  table: 'checkpoints' | 'checkpoint_blobs' | 'checkpoint_writes';
  sql: string;
  params: unknown[];
}

export interface PruneStatements {
  days: number;
  apply: boolean;
  statements: PruneStatement[];
}

/**
 * The "latest checkpoint per (thread_id, checkpoint_ns)" pick, shared by all
 * three tables: rank checkpoints within each (thread_id, checkpoint_ns) by
 * checkpoint_id descending (checkpoint_id is a UUID6/monotonic id — sorts by
 * creation order) and keep rank 1. `cutoff` is `now() - $1 days`, bound as a
 * parameterized interval, never string-interpolated.
 */
const LATEST_CHECKPOINT_CTE = `
  WITH ranked AS (
    SELECT
      thread_id,
      checkpoint_ns,
      checkpoint_id,
      checkpoint,
      (checkpoint->>'ts')::timestamptz AS ts,
      ROW_NUMBER() OVER (PARTITION BY thread_id, checkpoint_ns ORDER BY checkpoint_id DESC) AS rn
    FROM checkpoints
  ),
  latest AS (
    SELECT thread_id, checkpoint_ns, checkpoint_id, checkpoint
    FROM ranked
    WHERE rn = 1
  ),
  stale AS (
    SELECT thread_id, checkpoint_ns, checkpoint_id
    FROM ranked
    WHERE rn > 1 AND ts < now() - make_interval(days => $1::int)
  )
`;

function checkpointsStatement(apply: boolean): PruneStatement {
  const sql = apply
    ? `${LATEST_CHECKPOINT_CTE}
DELETE FROM checkpoints
USING stale
WHERE checkpoints.thread_id = stale.thread_id
  AND checkpoints.checkpoint_ns = stale.checkpoint_ns
  AND checkpoints.checkpoint_id = stale.checkpoint_id`
    : `${LATEST_CHECKPOINT_CTE}
SELECT stale.thread_id, stale.checkpoint_ns, stale.checkpoint_id FROM stale`;
  return { table: 'checkpoints', sql, params: [] };
}

function writesStatement(apply: boolean): PruneStatement {
  const sql = apply
    ? `${LATEST_CHECKPOINT_CTE}
DELETE FROM checkpoint_writes
USING stale
WHERE checkpoint_writes.thread_id = stale.thread_id
  AND checkpoint_writes.checkpoint_ns = stale.checkpoint_ns
  AND checkpoint_writes.checkpoint_id = stale.checkpoint_id`
    : `${LATEST_CHECKPOINT_CTE}
SELECT checkpoint_writes.thread_id, checkpoint_writes.checkpoint_ns, checkpoint_writes.checkpoint_id
FROM checkpoint_writes
JOIN stale
  ON checkpoint_writes.thread_id = stale.thread_id
 AND checkpoint_writes.checkpoint_ns = stale.checkpoint_ns
 AND checkpoint_writes.checkpoint_id = stale.checkpoint_id`;
  return { table: 'checkpoint_writes', sql, params: [] };
}

/**
 * A blob row (thread_id, checkpoint_ns, channel, version) survives if its
 * version is referenced in the SURVIVING (rn = 1) checkpoint's
 * channel_versions for that (thread_id, checkpoint_ns) — everything else for
 * a (thread_id, checkpoint_ns) pair that HAS at least one stale checkpoint is
 * a pruning candidate. A pair with no stale checkpoints is left untouched
 * entirely (its blobs are never scanned) — cheaper and matches "older blobs
 * go", not "unreferenced blobs go" globally.
 */
function blobsStatement(apply: boolean): PruneStatement {
  const referencedVersions = `
  referenced AS (
    SELECT latest.thread_id, latest.checkpoint_ns, kv.key AS channel, kv.value AS version
    FROM latest, jsonb_each_text(latest.checkpoint->'channel_versions') AS kv
  )`;
  const sql = apply
    ? `${LATEST_CHECKPOINT_CTE},
${referencedVersions}
DELETE FROM checkpoint_blobs
USING stale
WHERE checkpoint_blobs.thread_id = stale.thread_id
  AND checkpoint_blobs.checkpoint_ns = stale.checkpoint_ns
  AND NOT EXISTS (
    SELECT 1 FROM referenced
    WHERE referenced.thread_id = checkpoint_blobs.thread_id
      AND referenced.checkpoint_ns = checkpoint_blobs.checkpoint_ns
      AND referenced.channel = checkpoint_blobs.channel
      AND referenced.version = checkpoint_blobs.version
  )`
    : `${LATEST_CHECKPOINT_CTE},
${referencedVersions}
SELECT DISTINCT checkpoint_blobs.thread_id, checkpoint_blobs.checkpoint_ns, checkpoint_blobs.channel, checkpoint_blobs.version
FROM checkpoint_blobs
JOIN stale
  ON checkpoint_blobs.thread_id = stale.thread_id
 AND checkpoint_blobs.checkpoint_ns = stale.checkpoint_ns
WHERE NOT EXISTS (
  SELECT 1 FROM referenced
  WHERE referenced.thread_id = checkpoint_blobs.thread_id
    AND referenced.checkpoint_ns = checkpoint_blobs.checkpoint_ns
    AND referenced.channel = checkpoint_blobs.channel
    AND referenced.version = checkpoint_blobs.version
)`;
  return { table: 'checkpoint_blobs', sql, params: [] };
}

export function buildPruneStatements(options: PruneOptions): PruneStatements {
  const days = options.days ?? DEFAULT_DAYS;
  const apply = options.apply ?? false;
  if (!Number.isFinite(days) || days < 0) {
    throw new Error(`days must be a non-negative number, got ${days}`);
  }

  // Order matters when applying: children first (FK-less, but consistent with cleanup-orphan-checkpoints.ts's convention).
  const statements: PruneStatement[] = [writesStatement(apply), blobsStatement(apply), checkpointsStatement(apply)].map(
    s => ({ ...s, params: [days] }),
  );

  return { days, apply, statements };
}
