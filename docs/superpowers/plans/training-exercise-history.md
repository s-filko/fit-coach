# Training Exercise History (BUG-030, Roadmap R1.3a) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans and
> test-driven-development. Red tests first, then the fix.

- Status: planned
- Branch: plan/training-exercise-history

**Goal:** the training phase sees the user's real history. For every exercise of today's session
(planned or started) the coach gets its **last real performance, dated**, found by exercise — not
by `session_key`; and it gets every real workout of the **last 7 days**, dated, with overlaps on
today's muscles labelled (fatigue context). The prompt tells the model to state the age of every
number it quotes and never to deny work that is simply outside what it can see. Fixes BUG-030
(both halves) and turns the R0.2 red (AC-CB-3) green.

**Owner order (2026-09-26):** fix BUG-030 end to end autonomously — the orchestrator decides scope,
design, executor, review, merge and dev deploy; no questions to the owner. Every decision below
marked **(D)** was taken by the orchestrator under that order.

**Spec:** `docs/superpowers/specs/2026-09-24-coach-roadmap.md` step R1.3a (unit U3) and BUG-030 in
`docs/BUGS.md`. Live evidence: 2026-09-21 (`lower_a` → the 2026-02-20 session) and 2026-09-25
(`upper_a_20260925` matched nothing — "по верху данных в истории не сохранилось").

## Decisions (D)

- **D1 — scope = R1.3a only.** R1.3b (planning-side per-muscle overview) stays in U3; U3 shrinks to
  R1.3b. R1.2 (one shared set formatter across all history blocks, U2) is *not* pulled in — the new
  blocks reuse the training block's own `formatSetData`; U2 later unifies it.
- **D2 — anchor by exercise, unbounded in time.** "Last real performance" = the newest
  `session_exercises` row for that `exercise_id` with ≥ 1 `session_sets` row, in a
  `completed` session of this user other than today's. Old data is still shown — with its date and
  age — because a months-old number is better than none, as long as its age is visible.
- **D3 — fatigue window = 7 days** before `now`, real workouts only (the BUG-031 rule), today's
  session excluded, newest first, at most 7 sessions loaded. Overlap = any muscle group (primary or
  secondary) shared with any of today's exercises, labelled with both involvements. Other
  exercises' kg are shown as they are but the prompt forbids transferring them.
- **D4 — two new blocks** replace `training.previous_session` in the training spec:
  `training.exercise_history` v1 and `training.recent_workouts` v1. The old
  `TRAINING_PREVIOUS_SESSION_V1` stays exported only if the frozen legacy `TRAINING_V1`
  byte-identity tests still need it; `findLastCompletedByUserAndKey` is removed from the port, the
  repository and all stubs once nothing in production calls it.
- **D5 — dates:** every history line carries the calendar date in the user's timezone
  (`YYYY-MM-DD`) plus the existing `humanTimeAgo` form, e.g. `2026-09-16 · 5d ago (Wed)`.
- **D6 — prompt `training` v6** = v5 with TASK rule 1 rewritten around the new blocks and one new
  RULE (see Task 1 step 5). Directive text otherwise unchanged.
- **D7 — executor:** one Sonnet subagent for the single task (coupled files: loader, blocks, prompt,
  tests). One combined close-out review (economical-work rule).
- **D8 — `training.recent_workouts` fallback wording** (not specified by D3): when nothing falls
  inside the 7-day window, the block names the single most recent real workout's date with
  "outside the 7-day window, not detailed here" rather than showing nothing; a user with zero real
  workouts ever gets "No completed workouts on record." Each exercise's sets collapse to a compact
  summary by grouping consecutive identical sets ("3× 8 reps @ 80 kg" for three equal sets), not a
  per-set list — that stays in `training.exercise_history` only.
- **D9 — `todayMuscles`** is a flat set of muscle-group names touched by any of today's exercises
  (plan or started), independent of involvement in today's own exercise; `training.recent_workouts`
  labels an overlapping muscle with *its own* involvement in the past exercise (e.g. Overhead
  Press's own `primary`/`secondary`), not today's. `TrainingClientData` (the `training.client`
  block) is emptied to `{}` — its `render` never read the `previousSession` field it used to
  declare; that field only existed because `TrainingData` happened to carry it, and removing
  `previousSession` from `TrainingData` (D4) would otherwise break the block's structural type.

**Close-out review follow-up (2026-09-26, BLOCKED verdict — fixed in the same worktree, no owner
questions per the standing autonomy order):**

- **D10 — one hydrator, one set-formatter (R2).** `WorkoutSessionRepository` gained a private
  `hydrateSessionExercises(rows)` (join → muscle groups → sets → `SessionExerciseWithDetails`,
  two batched queries) used by both `findByIdWithDetails` and `findLastPerformancesByExercise` —
  was duplicated between them. `training-workout-overview.v1.ts` gained an exported
  `formatExerciseSets(sets, userFeedback)` (per-set lines + optional feedback line) used by both
  the legacy `buildPreviousSessionSection` and `training.exercise_history` — was duplicated there
  too. Both extractions are output-preserving: the legacy `TRAINING_V1` byte-identity tests
  (`training-blocks.v1.unit.test.ts`) pass unchanged.
- **D11 — bad legacy plan rows never reach a query.** `training.spec.ts` validates every
  `session_plan_json.exercises[].exerciseId` against a generic UUID shape before it enters
  `planExerciseIds` (and therefore `todayExerciseIds`/`notStartedPlanIds`/any DB call) — an empty
  string or a pre-catalog placeholder from an old plan row is dropped silently rather than
  reaching `findLastPerformancesByExercise` or `findByIdsWithMuscles` and failing the turn.
- **D12 — `findLastPerformancesByExercise`'s DISTINCT ON tie-break.** Same-`completedAt` ties
  (same anchor session) now break on `desc(orderIndex), desc(id)` — deterministic, never changes
  *which session* wins (only which of that session's own rows does, an edge case that cannot
  occur today since a session has one `session_exercises` row per exercise).
- **D13 — window semantics, made explicit.** `training.recent_workouts`'s "last 7 days" is
  `calendarDaysAgo(...) <= 7` — a workout exactly 7 calendar days old (in the resolved timezone)
  is IN the window, one 8 days old is not; "last 7 days" is read as "today back through 7 days
  ago" (8 possible calendar-day buckets: 0..7), matching the header text as written. No behaviour
  change — this documents the boundary the code already had.
- **D14 — null-timezone fallback, unified to UTC.** `resolveTz` (training-exercise-history.v1.ts)
  now defaults to `'UTC'` explicitly instead of passing `null` through: `formatInUserTz(date,
  null)` already fell back to UTC internally, but `humanTimeAgo`'s no-tz path used the *process's*
  local clock (`@shared/date-utils.ts` `calendarDaysAgo`'s no-tz branch is deliberately
  local-consistent for its own direct callers and was not touched) — near a UTC midnight in a
  non-UTC-running process this could put the date line and the age line on different calendar
  days. Fixed at the point of use (one resolver, not the shared util) so both agree and the 7-day
  window cut reads the same calendar day too.
- **D15 — `evals/fixtures/prompt-contexts.ts`'s `'phase.training'` fixture** now returns
  `exerciseHistory: [], recentWorkouts: [], todayMuscles: []` in place of the stale
  `previousSession: null` — the "nothing to show" equivalent under the new `TrainingData` shape.
  Legacy `TRAINING_V1` still only reads `session` from this fixture (its own `previousSession`
  field is simply absent now, same falsy behaviour as the old explicit `null`).
- **D16 — docs updated under the owner's 2026-09-26 autonomy order, for owner review**:
  `docs/BUGS.md` BUG-030 → `Status: fixed (training-exercise-history)`, Component and Regression
  test sections point at the new code/tests; `docs/superpowers/specs/2026-09-24-coach-roadmap.md`
  — the Stage 0 asset line now names the promoted (green) integration test, R1.3a's row records
  delivery by this plan, U3 shrinks to R1.3b only; `docs/adr/0013-llm-core-target-architecture.md`
  §10's "Exists" cell for progress awareness replaces "previous session by `sessionKey` (BUG-005)"
  with the factual current mechanism (its "Missing" cell narrows from "per-exercise / per-muscle
  history" to "per-muscle session_planning overview (R1.3b)"); `docs/ARCHITECTURE.md`'s block list
  gained `training-exercise-history.v1.ts`.
- **D17 — `docs/PLAN-muscle-centric-history.md` left untouched, for R1.3b.** It was already
  planned to be rewritten or deleted on R1.3b's own adoption (per the roadmap doc, §"R1.3a/b
  realise the two levels..."), not by this plan, which only delivers the level-2 (exercise) half.
- **D18 — accepted cost, not fixed: up to 7 `findByIdWithDetails` calls per training turn.**
  `findRecentByUserIdWithDetails(userId, 7, {realWorkoutsOnly: true})` hydrates each of its (at
  most 7) sessions with its own `findByIdWithDetails` call (`Promise.all` over the recent-session
  ids, pre-existing code this plan did not touch) — a small, capped fan-out (never unbounded, the
  `7` is hard-coded at the one D3 call site), acceptable for a per-turn read against a training
  phase whose response time is already dominated by the model call. Revisit only if profiling
  shows it matters.

## Acceptance criteria

| AC | Criterion | Verification |
|---|---|---|
| AC-EH-1 | With three recent leg sessions under unique keys and one 2026-02-20 session sharing today's key, the training context shows each of today's exercises with its **2026-09-16** performance and the date; nothing from 2026-02-20 is presented | promoted `previous-session` scenario test |
| AC-EH-2 | An exercise that is only **planned** (in `session_plan_json`, not started) still gets its last performance | same test, planned-only case |
| AC-EH-3 | An exercise with no real history renders an explicit "no completed record" line | block unit test + scenario |
| AC-EH-4 | Yesterday's overlapping session (Overhead Press, 2026-09-23) is named with its date and its overlap with today's Bench Press muscles; the Bench Press anchor (2026-09-17, 3×8 @ 80 kg) is shown | promoted `overlapping-load` scenario test (AC-CB-3 / R0.2) |
| AC-EH-5 | Workouts older than 7 days, non-real workouts (skipped / empty / planning / in_progress) and today's session never appear in `training.recent_workouts` | block unit test + scenario |
| AC-EH-6 | Training prompt v6: quote the age with every past number; no record → say so; no kg transfer between exercises; never say the user did not do something that is merely not shown | prompt unit / L0 tests, snapshots updated deliberately |

## Task 1 — Exercise history in the training phase (AC-EH-1..6)

**Files (ownership):**
- `apps/server/src/infra/ai/graph/phases/training.spec.ts` — `TrainingData`, `loadContext`, block list
- `apps/server/src/infra/ai/prompts/blocks/training-exercise-history.v1.ts` (new) + export from `blocks/index.ts`
- `apps/server/src/infra/ai/prompts/phases/training/v6.ts` (new), `training/index.ts` (current → v6)
- `apps/server/src/domain/training/ports/workout-session.ports.ts`, `apps/server/src/infra/db/repositories/workout-session.repository.ts` (new query; remove `findLastCompletedByUserAndKey`)
- tests: `tests/integration/scenarios/previous-session.repro.test.ts` and
  `overlapping-load.repro.test.ts` → promoted to `*.integration.test.ts` (regular scenario tests),
  `session-seed.ts` (may gain `sessionPlanJson` seeding), block unit tests under
  `src/infra/ai/prompts/blocks/__tests__/`, and every stub/fixture that breaks from the
  `TrainingData` / port change (`evals/fixtures/prompt-contexts.ts`, `evals/lib/build-stub-deps.ts`,
  `evals/scenarios/b-full-workout.scenario.ts`, `evals/snapshots/…`, the graph unit tests that stub
  `findLastCompletedByUserAndKey`).

**Steps:**

1. **Red first.** Rewrite the two repro tests' assertions against the new contract (render the
   phase's full context via `spec.contextBlocks`, like `overlapping-load.repro.test.ts` does) and run
   them — they must fail on unchanged production. Add the planned-only case (AC-EH-2): today's
   session carries a `session_plan_json` listing Bench Press, not started. Commit red.
2. **Repository:** `findLastPerformancesByExercise(userId, exerciseIds, excludeSessionId)` →
   per exercise id at most one entry `{ exerciseId, completedAt, sessionExercise }` (the
   `SessionExerciseWithDetails` shape `findByIdWithDetails` builds, sets included), per D2. One
   SQL query for the pick (`DISTINCT ON` or equivalent) — no N+1 over sessions.
3. **Loader:** today's exercise ids = plan exercises (plan order) then started off-plan ones; muscle
   groups for not-started ones via `deps.exerciseRepository.findByIdsWithMuscles`. Recent = 
   `findRecentByUserIdWithDetails(userId, 7, { realWorkoutsOnly: true })` minus today's session.
   `TrainingData = { session, exerciseHistory, recentWorkouts, todayMuscles }` (exact types your
   call). The loader never reads the clock; the 7-day cut is applied at render time from `ctx.now`.
4. **Blocks** (`training-exercise-history.v1.ts`):
   - `=== EXERCISE HISTORY (today's exercises — last completed performance) ===` — one entry per
     today's exercise: `Name [ID:…] — last done YYYY-MM-DD · <humanTimeAgo>` then its sets
     (reuse `formatSetData` — export it from `training-workout-overview.v1.ts`, do not copy it) and
     feedback; or `Name [ID:…] — no completed record`. Null when today has no exercises at all.
   - `=== RECENT WORKOUTS (last 7 days, fatigue context) ===` — per workout: date · age, then each
     exercise with a compact set summary and, when it overlaps today's muscles,
     `overlaps today: triceps (secondary), shoulders_front (primary)`. When none are in the window:
     one line naming the most recent real workout's date, or "no completed workouts on record".
   Dates in `ctx.timezone ?? ctx.user?.timezone`, fallback UTC.
5. **Prompt v6** (copy v5, change only): TASK rule 1 → "Before the first set of each exercise,
   look it up in EXERCISE HISTORY. Whenever you quote past numbers, say when (the date or 'N days
   ago'); data older than two weeks is never 'last time' without its age. No completed record →
   say so plainly and suggest a conservative start; never borrow kilograms from a different
   exercise. Check RECENT WORKOUTS for the same muscles: load within the last 48 h → name it and
   factor it into the recommendation." Plus a RULE: "Past training data exists only in EXERCISE
   HISTORY and RECENT WORKOUTS. If the user mentions a workout or exercise not shown there, say you
   do not see it in the records — never tell them they did not do it." Header comment like v5's.
6. Promote the two repro files (rename to `*.integration.test.ts`, drop the "REPRODUCTION (RED)"
   header wording); update `docs/BUGS.md` BUG-030 `Status: fixed (training-exercise-history)` with
   the regression test paths; roadmap: mark R1.3a delivered by this plan (one line) so U3 = R1.3b.
7. Update every broken stub/snapshot deliberately (snapshots via the repo's documented update
   command, diff reviewed: only training-context changes expected).

**Verification (from `apps/server/`, quote results):**
- `npm run check-all`
- `npm run test:unit`
- `/Users/filko/orca/workspaces/fit_coach/db-test-lock.sh npm run test:scenarios`
- `/Users/filko/orca/workspaces/fit_coach/db-test-lock.sh npm run test:integration`
- `node ../../scripts/state.mjs --check` (from repo root: `node scripts/state.mjs --check`)

## Not in scope

- Exercises the user names that are neither in today's session nor in the last 7 days (e.g. a
  substitution done a month ago) — would need a history lookup tool; noted in the close-out.
- Live model runs (none; dev check is deterministic over the dev DB, see close-out).
