# Refactor P4 — Evals Verify (mini-freeze + compare) Micro-Task

- Status: planned
- Branch: folded into plan/refactor-p4-episode-memory (executed by the orchestrator 2026-09-18 with owner-released budget: «запусти остальные таски»)
- After: refactor-p4-episode-memory

**Why this exists:** `refactor-p4-episode-memory` closes with AC-1344's statistics
recorded as pending because its budget covers only ≈15 model calls (SUPERPOWERS_INTEGRATION.md
§ Delivering: an AC that needs more budget than the plan has is the entry ticket of a
dedicated micro-task). The owner released that budget on 2026-09-18, so this micro-task
runs on the parent plan's branch rather than a separate one.

**Scope (10 calls total, under the 30-call red-button ceiling):**

- [x] **Step 1: Mini-freeze `v2`** — `plan_creation/id-reuse`, n=1, on the **Task 1 commit**
  (`56696947`, throwaway worktree `../fit_coach-v2-freeze`):
  `RUN_LLM_EVALS=1 npm run evals -- --level L1 --phase plan_creation --dataset id-reuse --samples 1 --baseline write --baseline-version v2 --quota-before <n>`;
  the raw `no_redundant_search` count (expected low) is the pre-P4 number. Ledger row completed
  with `npm run evals:ledger -- --after <n>`.
- [x] **Step 2: Working-check** — parent plan Task 9 Step 1 (≈9–10 calls, id-reuse + one
  transition case per phase; error-surfacing, not scoring). Recorded in `COST_LEDGER.md`.
- [ ] **Step 3: Compare on merged `dev`** — same command with
  `--baseline compare --baseline-version v2` after the parent plan merges; evidence JSON →
  `docs/superpowers/plans/evidence/refactor-p4-episode-memory-l1-compare.json`.
- [ ] **Step 4: Verdict** — gate: `no_redundant_search` ≥ +15 pp vs v2 (at n=1 × 5 cases:
  ≥ 1 more case passing; raw counts recorded, statistics labelled n=1). L2 half = the manual
  rubric pass (CH/PC/SP/TR, PROMPT_EVAL_FRAMEWORK.md §5.1) on the dev smoke transcripts.
  Fail → the parent plan reverts as a unit (master plan P4 rollback).

**Not in scope:** the full `v2` sweep (62 cases × 3 ≈ 186 calls) — red-button item, owner-launched.
