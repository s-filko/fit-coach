# Training History Lookup and Plan Name Check Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans and
> test-driven-development. Red tests first, then the fix.

- Status: planned
- Branch: plan/training-history-lookup
- After: training-exercise-history

**Goal:** close the two gaps left by `training-exercise-history` (BUG-030):
1. The coach cannot see an exercise that is neither in today's session nor in the last 7 days
   (e.g. "а сколько я в прошлый раз жал гантели?" while the plan has a barbell press). A read-only
   tool `get_exercise_history` in the training phase returns that exercise's recent real
   performances, dated.
2. A session plan can name one exercise and carry another's id (live 2026-09-25: "Treadmill" with
   Rowing Machine's id — `BACKLOG.md` § Findings). Plan-saving tools check the name against the
   catalog row of the id.

**Owner order (2026-09-26):** "продолжай сам до конца" after BUG-030 — the orchestrator continues
autonomously; every decision is recorded here as **(D)** for the owner's later review.

## Decisions (D)

- **D1 — tool, not a bigger block.** Unbounded history in the context costs tokens every turn; a
  read-only tool costs only when asked. Training phase only (chat/session_planning have their own
  recent-history blocks).
- **D2 — tool contract.** `get_exercise_history({ exerciseId?, exerciseName?, limit? })` — one of
  id/name required; the name is resolved in the catalog the same way `log_set` resolves
  `exerciseName` (reuse that resolver, do not copy it). `limit` default 3, max 5. Returns the last
  `limit` real performances of that exercise (completed session, ≥ 1 set; today's active session
  excluded), newest first, each as `YYYY-MM-DD · <age>` + its sets — the same date and set
  formatting as the `training.exercise_history` block (shared helpers, not copies). No record → a
  plain "no completed record of <catalog name>" result (an `ok` outcome, not an error).
  Unresolvable name → `llmError` suggesting `search_exercises`.
- **D3 — tool priority:** `get_exercise_history` gets priority 0 alongside `search_exercises`
  (read-only lookups run before writes) in `TRAINING_TOOL_PRIORITY`; the availability filter is
  unchanged.
- **D4 — prompt `training` v7** = v6 + the tool in TOOLS and two edits: TASK rule 1 — "If the user
  asks about an exercise that EXERCISE HISTORY does not show, call get_exercise_history before
  answering"; and the "past data exists only in …" rule widened to include get_exercise_history
  results (still: never tell the user they did not do something — say it is not in the records).
- **D5 — name/id check at plan save** (`start_training_session`, `save_workout_plan`): both already
  load the catalog rows (`findByIdsWithMuscles`). One shared helper compares each plan entry's
  `exerciseName` with the catalog name: words of ≥ 3 letters, lower-cased; **no shared word →
  `llmError`** listing each mismatch (`"Treadmill" → id is "Rowing Machine"`) and telling the model to
  fix the id via `search_exercises` or use the catalog name; otherwise the stored `exerciseName` is
  replaced by the catalog name. Nothing is persisted on rejection.

## Acceptance criteria

| AC | Criterion | Verification |
|---|---|---|
| AC-HL-1 | `get_exercise_history` by id returns the last ≤ 3 real performances, newest first, dated, excluding today's session and non-real workouts | DB-backed integration test |
| AC-HL-2 | by name → resolved via the shared catalog resolver; unknown name → `llmError` with a `search_exercises` hint; no record → ok "no completed record" | unit + integration |
| AC-HL-3 | a scripted-model training scenario: the user asks about an exercise absent from the blocks, the model calls the tool, and the tool result carries the dated numbers | scenario test (scripted model) |
| AC-HL-4 | prompt v7 carries D4; snapshots updated deliberately | unit / snapshot |
| AC-HL-5 | plan save with "Treadmill" + Rowing Machine's id is rejected with nothing persisted; "Bench Press" + Barbell Bench Press's id is stored as "Barbell Bench Press" — both tools | unit + integration |

## Task 1 — Lookup tool, prompt v7, plan name check (AC-HL-1..5)

Files: new `apps/server/src/infra/ai/tools/get-exercise-history.tool.ts` (+ export in `tools/index.ts`),
`training.spec.ts` (tool list), `graph/tool-policy.ts` (priority), repository/port
(`findLastPerformancesByExercise` or a sibling returning up to N per exercise — extend, don't
duplicate the query/hydration), shared formatting helpers from
`prompts/blocks/training-exercise-history.v1.ts` / `training-workout-overview.v1.ts`,
`prompts/phases/training/v7.ts` + `index.ts`, `start-training-session.tool.ts`,
`save-workout-plan.tool.ts`, one shared name-check helper under `tools/`, tests.

Verification (from `apps/server/`): `npm run check-all`; `npm run test:unit`;
`/Users/filko/orca/workspaces/fit_coach/db-test-lock.sh npm run test:integration`;
repo root `node scripts/state.mjs --check`.

## Not in scope

- The same lookup in `chat` / `session_planning`.
- Live model runs.
