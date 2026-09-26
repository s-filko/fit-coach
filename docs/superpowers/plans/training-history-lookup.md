# Training History Lookup and Plan Name Check Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans and
> test-driven-development. Red tests first, then the fix.

- Status: done
- Branch: plan/training-history-lookup
- After: training-exercise-history
- Review: 2026-09-26 | clean | R1,R2,R3,R4

**Review note:** one combined reviewer; first pass blocked on 1 (BACKLOG currency) with 6 advisories — all fixed in fb3560ac; re-run clean with one advisory (any-overlap name rule let "Leg Curl"/Leg Extension through) — fixed as D16 in 77a44542.

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
- **D6 — `resolveExerciseIdByName` made public, not copied.** `TrainingService.resolveExerciseIdByName`
  was `private`; `get_exercise_history` needs the same resolver `log_set` uses (D2 says reuse, not
  copy), so it was changed to a public method (unchanged body) and added to `ITrainingService`.
- **D7 — repository sibling, not a parameterised `findLastPerformancesByExercise`.** Added
  `findRecentPerformancesForExercise(userId, exerciseId, excludeSessionId, limit)` to
  `IWorkoutSessionRepository`/`WorkoutSessionRepository` rather than overloading the existing
  DISTINCT-ON method: that one anchors ONE performance per exercise across MANY ids (the
  today's-exercises loader); this one returns UP TO N performances for a SINGLE id (the tool). Both
  share `hydrateSessionExercises`; the query itself is a plain filter + order + limit, no DISTINCT ON
  needed since it is already scoped to one exercise id.
- **D8 — "no completed record" wording is exact and lower-cased**, per D2's literal quote:
  `` `no completed record of ${exerciseName}` `` (an `ok` outcome). The unresolvable-name path is an
  `llm_error` with a `search_exercises` hint, also per D2.
- **D9 — name-check helper signature.** `checkExerciseNamesAgainstCatalog(entries, catalogNameById)`
  (`src/infra/ai/tools/exercise-name-check.ts`) takes a `ReadonlyMap<exerciseId, catalogName>` (built
  by each tool from its own `findByIdsWithMuscles` result) and returns `{ rejection, corrected }` —
  `rejection` is a ready-made `llm_error` `ToolOutcome` naming every mismatch; `corrected` is the same
  entries with `exerciseName` swapped to the catalog name where checked and matched (identity-preserved
  when already equal, to keep existing tool tests' `toHaveBeenCalledWith(...)` assertions stable). Both
  tools run it right after their missing-id check and before `guardFactConstraints`, so a name mismatch
  never reaches the constraint check or persists anything.
- **D10 — word-match rule implementation.** ">= 3 letters" words are tokenised with the Unicode-aware
  regex `/[\p{L}\p{N}]+/gu`, lower-cased, so Cyrillic/other-script names match the same way (the app is
  bilingual — RU/EN); a single shared token of length >= 3 in either direction is enough to pass.
- **D11 — AC-HL-3 test exercise.** The test DB's seed catalog (`src/app/test/setup.ts`) has only four
  exercises (Barbell Bench Press, Barbell Back Squat, Pull-ups, Running) — no treadmill/rowing pair.
  The scripted scenario test uses `Running`, seeded 10 days back (outside the 7-day RECENT WORKOUTS
  window, and not in journey B's `upper_a` plan) as the "exercise absent from the blocks"; the
  DB-backed AC-HL-5 test uses `Running` as the "Treadmill" stand-in for the live "Rowing Machine" case,
  since the real mismatch pair isn't in the test catalog.

### Close-out review fixes (2026-09-26)

- **D12 — word-match rule widened: shared prefix (>= 4 chars) + equipment/modifier stop words.**
  Item 2 (false rejections): exact-word match alone missed plural/compound drift ("Squats"/"Squat",
  "Lunges"/"Lunge", "Pullups"/"Pull-ups") — added a second pass: any pair of (non-stop-word) tokens
  sharing a >= 4-char prefix also passes. Item 3 (false acceptances): equipment/modifier words name
  almost every exercise of a kind, so sharing one is not evidence of a correct id ("Barbell Row" vs
  "Barbell Bench Press" must NOT pass on "barbell" alone) — both the exact-match and the new prefix
  pass now run on tokens with a stop-word set removed first: `barbell, dumbbell, cable, machine,
  lever, seated, standing, incline, decline, plate, loaded, smith, rope, grip, wide, narrow, close,
  single, arm`. `leg` is deliberately NOT in the list — it is a body part, not equipment/a modifier,
  so "45° Leg Press" still matches "Leg Press" on "leg" + "press". A non-English name (e.g. "Жим
  лёжа") is still rejected against an English catalog name by construction (no shared token/prefix
  across scripts) — the rejection message now says "use the English catalog name", and
  `start_training_session`'s `exerciseName` schema description now says "English catalog name" too
  (`save_workout_plan`'s already did).
- **D13 — `get_exercise_history` error split; no similarity threshold added.** Item 4: added
  `ExerciseNotFoundError` (`domain/training/errors.ts`) — `resolveExerciseIdByName` throws it instead
  of a bare `Error` on a genuine miss (same message text, so the one existing test asserting on it by
  regex is unaffected). The tool now returns `llm_error` (pointing at `search_exercises`) only for
  that typed miss; any other failure (DB, embedding service) is `system_error`, mirroring `log_set`'s
  DB/not-found split but keyed on the typed error rather than `isDatabaseFailure` (an embedding
  failure is not a DB failure). Checked whether a similarity score could be exposed "cheaply" to add
  a match threshold: `ExerciseRepository.searchByEmbedding` only ever `SELECT`s `id` and orders by
  the pgvector distance expression — the distance itself is never fetched, so exposing it needs a
  repository/port contract change, not a cheap read. Also: neither `search_exercises` nor `log_set`
  apply any similarity threshold today (no results are ever filtered by score), so there is no
  existing threshold to stay consistent with. Left as-is; a real threshold is a separate, larger
  change (repository return shape + picking a cutoff) — candidate for the backlog, not this task.
  Both tool/schema descriptions (`get_exercise_history` itself and its `exerciseName` field) now say
  "English catalog name; prefer search_exercises → exerciseId when unsure".
- **D14 — `excludeSessionId: string | null`, never `''`.** Item 5: passing `''` into
  `ne(workoutSessions.id, excludeSessionId)` on a `uuid` column is a Postgres type error, not a
  harmless no-match — `get_exercise_history` could 500 with no active session (should not happen
  from the training phase, but defensive). `findRecentPerformancesForExercise`'s `excludeSessionId`
  is now `string | null`; the tool passes `sessionIdOf(config)` directly (already nullable) instead
  of defaulting to `''`; the repository skips the `ne()` condition entirely when null.
- **D15 — shared predicate/hydrate-tail extraction.** Item 6: `findLastPerformancesByExercise` and
  `findRecentPerformancesForExercise` now both call two new private helpers —
  `realPerformanceConditions(userId, excludeSessionId)` (the WHERE predicate: completed, has
  `completedAt`, >= 1 real set, optional exclusion) and `rehydratePerformances(picked, exerciseIdOf)`
  (the rejoin/hydrate/map tail) — instead of each carrying its own copy.
- **D16 — containment, not any-overlap (reviewer advisory, accepted).** D12's "any shared word/prefix
  passes" was too loose: "Leg Curl" shared "leg" with "Leg Extension" and would have wrongly passed.
  Replaced with containment: after stop-word removal, every word of the SHORTER name's remaining
  word list must match some word of the OTHER (exactly, or by the D12 >= 4-char shared prefix — now
  additionally capped at a <= 3-char tail on the longer word, so "dead"/"deadlift" — tail "lift", 4
  — no longer false-passes "Dead Bug" against "Deadlift" while "pull"/"pullups" — tail "ups", 3 —
  still passes). `Array.prototype.every` on an empty list is vacuously true, so a name emptied
  entirely by stop-word removal (e.g. "Smith Machine") accepts automatically — nothing is left to
  contradict the catalog name. Side effect, intentional: the old "Up" (empty after the >= 3-letter
  filter, unrelated to stop words) now also accepts for the same vacuous-truth reason — the existing
  test for it was updated to expect acceptance rather than rejection.

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
