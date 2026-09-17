# Eval cost ledger (D-Q, owner requirement 2026-09-18)

Every model-backed run (mini or red-button) is metered here: one row per run.
The Z.AI coding plan exposes **no quota endpoint** readable with the
subscription token (D-R spike, 2026-09-18), so quota numbers come from the
owner's dashboard view:

- **quota before/after, delta** — the Z.AI dashboard's quota numbers in
  **prompt tokens** (the unit the dashboard shows). `delta = after − before`
  (negative = quota consumed).
- **% weekly** — `delta / EVALS_WEEKLY_LIMIT`, where `EVALS_WEEKLY_LIMIT` is
  the plan's stated weekly cap **in the same dashboard units**, set by the
  owner in `apps/server/.env`.

Workflow: `RUN_LLM_EVALS=1 npm run evals -- … --quota-before <n>` (the runner
refuses to start without it), then after the run read the dashboard again and
complete the row: `npm run evals:ledger -- --after <n>`.

| date | command | scope | requests | tokens in | tokens out | quota before | quota after | delta | % weekly |
|---|---|---|---|---|---|---|---|---|---|
