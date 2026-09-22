/**
 * llm_calls retention SQL builder (AC-AT-6) — pure, no I/O: mirrors
 * `prune-checkpoints.ts`'s split (pure builder + CLI runner). `days` is a
 * parameter, not a hardcoded default here — the one default that matters is
 * `LLM_CALLS_RETENTION_DAYS` in `@config/index`, and the CLI reads it, so the
 * number is never duplicated between config and this module.
 *
 * Prunes the PAYLOAD, never the row: `request`/`response` null out past the
 * window; `run_id`, `call_index`, `model`, `latency_ms`, `error_class`,
 * `error_message` and `created_at` are ordinary columns on the same row and
 * are untouched — a pruned call is still "this run made this call, on this
 * model, at this time, taking this long, and it did/didn't fail", forever.
 *
 * `prompt_blobs` is deliberately NOT touched here. A blob is shared by every
 * call whose system prompt hashed to it, across every run — the whole point
 * of AC-AT-3's dedup. Once a row's `request` is nulled it no longer carries
 * which hash it referenced, so "is this blob still referenced" can only ever
 * be answered by scanning every UNPRUNED row's `request` for that hash — a
 * blob referenced only by rows that have since been pruned is indistinguishable
 * from one that was orphaned the moment it was written, and a whole-table JSON
 * scan to tell the two apart buys back one row of a few KB (the prompt content
 * is deduplicated already — one row per distinct version, not per call, so its
 * footprint does not grow with call volume the way `request`/`response` do).
 * Retaining every prompt_blobs row forever is the safe, cheap choice; nothing
 * here deletes one.
 */
export interface PruneLlmCallsOptions {
  days: number;
  apply?: boolean;
}

export interface PruneLlmCallsStatement {
  sql: string;
  params: unknown[];
}

const CUTOFF = 'created_at < now() - make_interval(days => $1::int)';
const HAS_PAYLOAD = '(request IS NOT NULL OR response IS NOT NULL)';

export function buildPruneLlmCallsStatement(options: PruneLlmCallsOptions): PruneLlmCallsStatement {
  const { days, apply = false } = options;
  if (!Number.isFinite(days) || days < 0) {
    throw new Error(`days must be a non-negative number, got ${days}`);
  }

  const sql = apply
    ? `UPDATE llm_calls SET request = NULL, response = NULL WHERE ${CUTOFF} AND ${HAS_PAYLOAD}`
    : `SELECT count(*) FROM llm_calls WHERE ${CUTOFF} AND ${HAS_PAYLOAD}`;

  return { sql, params: [days] };
}
