# Eval cost ledger (D-Q, owner requirement 2026-09-18)

Every model-backed run (mini or red-button) is metered here: one row per run.

**Quota endpoint (D-R corrected 2026-09-18, owner pointer):**
`GET https://api.z.ai/api/monitor/usage/quota/limit` with
`Authorization: <Claude Code subscription token>` (raw, no Bearer — the token
from `~/.claude/settings.json` `env.ANTHROPIC_AUTH_TOKEN`; the app's
`LLM_API_KEY` is a different, monitor-less key of the same subscription).
`readQuota()` (evals/lib/quota.ts) fills quota before/after automatically —
`ZAI_QUOTA_TOKEN` env overrides the token. When no endpoint/plan data is
readable, the manual flags take over exactly as before.

- **quota before/after, delta** — remaining **credits** in the weekly
  window (`CREDIT_LIMIT` unit 6). `delta = after − before` (negative = quota
  consumed).
- **% weekly** — `delta / EVALS_WEEKLY_LIMIT`, where `EVALS_WEEKLY_LIMIT` is
  the plan's weekly credit cap (pro = 60000), e.g. inline
  `EVALS_WEEKLY_LIMIT=60000 npm run evals …`.

Manual fallback workflow: `RUN_LLM_EVALS=1 npm run evals -- … --quota-before
<n>`, then `npm run evals:ledger -- --after <n>`.

| date | command | scope | requests | tokens in | tokens out | quota before | quota after | delta | % weekly |
|---|---|---|---|---|---|---|---|---|---|
| 2026-09-18 | npm run evals -- --level L1 --phase plan_creation --dataset id-reuse --samples 1 --baseline write --baseline-version v2 --quota-before 30182 | L1 plan_creation/id-reuse (5×1) | 13 | 14889 | 2853 | 30182 | 28347 | -1835 | ? |
