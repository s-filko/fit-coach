export interface QuotaSnapshot {
  fiveHourRemaining: number;
  weeklyRemaining: number;
  unit: string;
}

/**
 * D-R spike verdict (2026-09-18): **no Z.AI quota endpoint confirmed — manual
 * flags take over.** Probed with the live subscription token (the same token
 * serves /chat/completions and this repo's dev route): the coding gateway
 * (api.z.ai/api/coding/paas/v4) answers `401 "token expired or incorrect"`
 * on every candidate usage/quota route AND on nonexistent routes, so 401 there
 * means "no such route for this token", not a dead key. Until a documented
 * endpoint appears, the runner requires `--quota-before <n>` (read from the
 * Z.AI dashboard) and `npm run evals:ledger -- --after <n>` completes the row.
 *
 * If a real endpoint is confirmed later, implement the fetch here — the
 * runner already branches on `readQuota() !== null`.
 */
export function readQuota(): QuotaSnapshot | null {
  return null;
}
