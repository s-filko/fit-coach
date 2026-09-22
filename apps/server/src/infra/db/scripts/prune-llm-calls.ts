/**
 * llm_calls / prompt_blobs retention SQL builder (AC-AT-6) — pure, no I/O:
 * mirrors `prune-checkpoints.ts`'s split (pure builder + CLI runner). `days`
 * is a parameter, not a hardcoded default here — the one default that
 * matters is `LLM_CALLS_RETENTION_DAYS` in `@config/index`, and the CLI
 * reads it, so the number is never duplicated between config and this module.
 *
 * Two statements:
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
 *    nulled) as the join key: a blob's CONTENT is dropped once no LIVE row
 *    still references its hash — never the blob row itself, matching the
 *    "keep the metadata, drop the payload" rule this plan already applies to
 *    `llm_calls`. A blob shared by a pruned row and a live one survives,
 *    because the check is "does ANY live row reference it", not "does THIS
 *    row".
 *
 * Both statements take `days` (second review round, 2026-09-22): "live" for
 * statement 2 means `request IS NOT NULL AND created_at` still inside the
 * window — the SAME predicate whether statement 1 has already run (apply: a
 * stale row's `request` is by then physically NULL, so the age half of the
 * predicate is redundant but harmless) or hasn't (dry run: nothing has
 * changed yet, so `request IS NOT NULL` alone would still count every row
 * statement 1 is ABOUT to prune as a live referencer, under-reporting every
 * blob only such a row still points at). One predicate, correct in both
 * modes, and the two statements no longer depend on running in a particular
 * order for correctness — only on the days value being the same for both.
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
const NOT_STALE = 'created_at >= now() - make_interval(days => $1::int)';
const HAS_PAYLOAD = '(request IS NOT NULL OR response IS NOT NULL)';

function callsStatement(apply: boolean): PruneLlmCallsStatement {
  const sql = apply
    ? `UPDATE llm_calls SET request = NULL, response = NULL WHERE ${CUTOFF} AND ${HAS_PAYLOAD}`
    : `SELECT count(*) FROM llm_calls WHERE ${CUTOFF} AND ${HAS_PAYLOAD}`;
  return { table: 'llm_calls', sql, params: [] };
}

/**
 * NOT EXISTS, never NOT IN: an unnested `prompt_hashes` element being NULL is
 * not something today's writer produces (every element is a sha256 digest),
 * but `NOT IN`'s three-valued logic means a SINGLE NULL anywhere in that
 * subquery's results makes the comparison NULL — never TRUE — for every row,
 * silently turning the whole prune into a permanent no-op with no error.
 * `NOT EXISTS` has no such trap: a row contributing NULL simply satisfies
 * neither side of the correlation and is skipped, regardless of NULLs on
 * either side. The explicit `h IS NOT NULL` below is belt-and-suspenders,
 * not load-bearing for that reason — kept because a NULL can never legitimately
 * match a hash anyway.
 */
function blobsStatement(apply: boolean): PruneLlmCallsStatement {
  const referenced = `
    SELECT 1 FROM llm_calls, unnest(llm_calls.prompt_hashes) AS h
    WHERE h IS NOT NULL
      AND h = prompt_blobs.hash
      AND llm_calls.request IS NOT NULL
      AND llm_calls.${NOT_STALE}`;
  const sql = apply
    ? `UPDATE prompt_blobs SET content = NULL WHERE content IS NOT NULL AND NOT EXISTS (${referenced})`
    : `SELECT count(*) FROM prompt_blobs WHERE content IS NOT NULL AND NOT EXISTS (${referenced})`;
  return { table: 'prompt_blobs', sql, params: [] };
}

export function buildPruneLlmCallsStatements(options: PruneLlmCallsOptions): PruneLlmCallsStatements {
  const { days, apply = false } = options;
  if (!Number.isFinite(days) || days < 0) {
    throw new Error(`days must be a non-negative number, got ${days}`);
  }

  const statements: PruneLlmCallsStatement[] = [
    { ...callsStatement(apply), params: [days] },
    { ...blobsStatement(apply), params: [days] },
  ];

  return { days, apply, statements };
}
