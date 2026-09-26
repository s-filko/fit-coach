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
| 2026-09-18 | npm run evals -- --level L1 --phase plan_creation --dataset id-reuse --samples 1 | L1 plan_creation/id-reuse (5×1) | 7 | 27206 | 6489 | 27866 | 27784 | -82 | -0.1% |
| 2026-09-18 | npm run evals -- --level L1 --phase registration --dataset field-extraction-smoke --samples 1 | L1 registration/field-extraction-smoke (1×1) | 2 | 3026 | 456 | 27580 | 27568 | -12 | -0.0% |
| 2026-09-18 | npm run evals -- --level L1 --phase chat --dataset transitions-smoke --samples 1 | L1 chat/transitions-smoke (1×1) | 2 | 3222 | 186 | 27568 | 27566 | -2 | -0.0% |
| 2026-09-18 | npm run evals -- --level L1 --phase session_planning --dataset transitions-smoke --samples 1 | L1 session_planning/transitions-smoke (1×1) | 2 | 7269 | 1127 | 27566 | 27561 | -5 | -0.0% |
| 2026-09-18 | npm run evals -- --level L1 --phase training --dataset transitions-smoke --samples 1 | L1 training/transitions-smoke (1×1) | 2 | 11055 | 376 | 27561 | 27555 | -6 | -0.0% |
| 2026-09-25 | npm run smoke (run 1) | L3 smoke (8 user steps × 1) — U1 live check | ≈8 agent turns + tool hops + course check/summariser (L3 does not meter) | n/a | n/a | n/a | n/a | n/a | n/a |
| 2026-09-25 | npm run smoke (run 2) | L3 smoke (9 user steps × 1) — U1 live check, passed 34/0 | ≈9 agent turns + tool hops + course check/summariser (L3 does not meter) | n/a | n/a | n/a | n/a | n/a | n/a |
| 2026-09-25 | R2.0 provider probe (scratchpad script, dev container) | U5 gate — history with a tool call absent from the tool set; Gemini `google/gemini-3.8-flash` via OpenRouter, reasoning low: 200, 2× `log_set` | 1 | 331 | 136 | n/a (OpenRouter) | n/a | n/a | n/a |
| 2026-09-25 | R2.0 provider probe (scratchpad script, local .env) | U5 gate — same history on Z.AI `glm-5.3`: 200, 2× `log_set` | 1 | 420 | 193 | n/a | n/a | n/a | n/a |
| 2026-09-25 | LLM_MODEL=glm-5.3-flash npm run smoke (run 4) | L3 smoke (9 user steps × 1) — model comparison for dev, passed 34/0; 2–3 calls per turn, 10–15 s per turn | ≈22 agent calls + course check/summariser (L3 does not meter) | n/a | n/a | n/a | n/a | n/a | n/a |
| 2026-09-25 | FlashX probe (scratchpad script, local .env) | glm-5.3-flashx on the coding endpoint: 429 "subscription plan does not yet include access" (LangChain retried, all rejected) | 1 (+SDK retries) | 0 | 0 | n/a | n/a | n/a | n/a |
| 2026-09-25 | LLM_MODEL=glm-5.3 npm run smoke (run 5) | L3 smoke (9 user steps × 1) — speed baseline vs run 4, passed 34/0; avg 11.0 s/turn (Flash 12.7 s) | ≈20 agent calls + course check/summariser (L3 does not meter) | n/a | n/a | n/a | n/a | n/a | n/a |
| 2026-09-25 | npm run smoke (run 6, plan/transition-handoff, flag training,session_planning) | L3 smoke (10 user steps × 1) — U5 live check, 31/9: hand-offs work; scenario step order + Russian exercise search fail | ≈25 agent calls + course check/summariser (L3 does not meter) | n/a | n/a | n/a | n/a | n/a | n/a |
| 2026-09-25 | npm run smoke (run 7, plan/transition-handoff after review fixes, flag training,session_planning) | L3 smoke (10 user steps × 1) — U5 live check AC-TH-7, passed 41/0 | ≈25 agent calls + course check/summariser + catalog embeddings (L3 does not meter) | n/a | n/a | n/a | n/a | n/a | n/a |
