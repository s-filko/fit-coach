/**
 * llm_calls / prompt_blobs retention SQL builder (AC-AT-6) — pure, no I/O:
 * mirrors `prune-checkpoints.ts`'s split (pure builder + CLI runner). `days`
 * is a parameter, not a hardcoded default here — the one default that
 * matters is `LLM_CALLS_RETENTION_DAYS` in `@config/index`, and the CLI
 * reads it, so the number is never duplicated between config and this module.
 *
 * Two statements, run IN ORDER (the second depends on the first already
 * having run):
 *
 * 1. `llm_calls`: past the window, `request`/`response` null out — never the
 *    row. `run_id`, `call_index`, `model`, `latency_ms`, `error_class`,
 *    `error_message`, `created_at` AND `prompt_hashes` are untouched.
 *
 * 2. `prompt_blobs`: review finding (2026-09-22) — assemble-context.ts pushes
 *    up to six SystemMessages per call (the static rules text, but also
 *    per-profile/per-episode/per-workout blocks that change almost every
 *    call), and the recorder hashes every one of them into its own blob. A
 *    first version of this prune left `prompt_blobs` untouched entirely,
 *    reasoning it held "one row per distinct prompt version, not per call" —
 *    true only of the one static block, and false of the rest: leaving every
 *    blob forever would have moved the bulky, ever-changing context OUT of
 *    the column being pruned and INTO a table kept permanently — the
 *    opposite of retention. The fix keeps `llm_calls.prompt_hashes` (never
 *    nulled) as the join key: a blob's CONTENT is dropped once no row whose
 *    `request` is still present references its hash — never the blob row
 *    itself, matching the "keep the metadata, drop the payload" rule this
 *    plan already applies to `llm_calls`. A blob shared by a pruned row and
 *    a live one survives, because the check is "does ANY unpruned row
 *    reference it", not "does THIS row". Unconditional on `days`: it runs
 *    after statement 1 and only ever drops content no live row needs any
 *    more, whatever "live" happens to be at that moment.
 */
export interface PruneLlmCallsOptions {
  days: number;
  apply?: boolean;
}

export interface PruneLlmCallsStatement {
  table: 'llm_calls' | 'prompt_blobs';
  sql: string;
  params: unknown[];
}

export interface PruneLlmCallsStatements {
  days: number;
  apply: boolean;
  statements: PruneLlmCallsStatement[];
}

const CUTOFF = 'created_at < now() - make_interval(days => $1::int)';
const HAS_PAYLOAD = '(request IS NOT NULL OR response IS NOT NULL)';

function callsStatement(apply: boolean): PruneLlmCallsStatement {
  const sql = apply
    ? `UPDATE llm_calls SET request = NULL, response = NULL WHERE ${CUTOFF} AND ${HAS_PAYLOAD}`
    : `SELECT count(*) FROM llm_calls WHERE ${CUTOFF} AND ${HAS_PAYLOAD}`;
  return { table: 'llm_calls', sql, params: [] };
}

function blobsStatement(apply: boolean): PruneLlmCallsStatement {
  const referenced = `
    SELECT DISTINCT h FROM llm_calls, unnest(prompt_hashes) AS h
    WHERE request IS NOT NULL AND prompt_hashes IS NOT NULL`;
  const sql = apply
    ? `UPDATE prompt_blobs SET content = NULL WHERE content IS NOT NULL AND hash NOT IN (${referenced})`
    : `SELECT count(*) FROM prompt_blobs WHERE content IS NOT NULL AND hash NOT IN (${referenced})`;
  return { table: 'prompt_blobs', sql, params: [] };
}

export function buildPruneLlmCallsStatements(options: PruneLlmCallsOptions): PruneLlmCallsStatements {
  const { days, apply = false } = options;
  if (!Number.isFinite(days) || days < 0) {
    throw new Error(`days must be a non-negative number, got ${days}`);
  }

  const statements: PruneLlmCallsStatement[] = [{ ...callsStatement(apply), params: [days] }, blobsStatement(apply)];

  return { days, apply, statements };
}
