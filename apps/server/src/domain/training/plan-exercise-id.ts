/**
 * set-kind plan Task 2 (D7): the plan-id UUID guard, the ONE copy — moved
 * verbatim from `infra/ai/graph/phases/training.spec.ts` so `TrainingService`'s
 * finish reconciliation reuses it (a domain service must not import from infra).
 * A bad legacy `session_plan_json` row (empty string, missing, or a placeholder
 * that was never a real catalog id) must not reach a DB query — dropped before
 * it ever gets there.
 */

/** Generic UUID shape (any version/variant) — matches every real exerciseId the catalog issues. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidExerciseId(id: unknown): id is string {
  return typeof id === 'string' && UUID_RE.test(id);
}
