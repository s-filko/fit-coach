# Set Kind — Warm-up vs Working Sets, Dumbbell Load Basis, Session Place, Skipped Plan Items (Roadmap U4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans and
> test-driven-development. Red tests first, then the fix. Every task's step 1 is a test that
> must fail on unchanged code for the stated reason; commit it red before any production change.

- Status: in progress
- Branch: plan/set-kind
- After: —

**Goal:** the journal stops mixing data that the load advisor (design
`docs/superpowers/specs/2026-09-28-load-recommendation-architecture-design.md`, §9–§10) will
compute on. Four data-shape fixes, all additive, so that history accrues correctly from the day
they land (roadmap rule 6): (1) every set carries its **kind** — warm-up or working — and only
working sets count toward plan targets; (2) a dumbbell/kettlebell set states whether the weight
is **per hand**; (3) a workout knows its **place**; (4) a planned exercise the user never touched
becomes **`skipped`** at finish instead of vanishing (BUG-042), and an exercise closed with zero
sets is `skipped`, not `completed`.

**Why now (owner 2026-09-28):** Stage 4 (load advisor) is pulled ahead of the session-planning
redesign; U4 is its first unit because working weight, e1RM trend and rep drop-off are computed
on polluted data until warm-ups are marked, and dumbbell trends jump until the load basis is
explicit. Roadmap step R1.4 widened per design §9.

**Owner order (2026-09-28, autonomy):** «подними другую сессию оркестратора, который проведёт сам
всё от начала до конца». The orchestrator runs this plan to the dev deploy without questions to the
owner: it decides executor, review fixes, merge and deploy, records every decision as a **(D)**
bullet below, and lists them in the STATE handoff for the owner to review. D11's durable-spec ids
(BR-TRAINING-027..029) are **proposed** in the plan section "Proposed durable-spec text" and
flagged for the owner; the `training.spec.md` edit itself waits for the owner unless it is purely
factual.

**Spec:** roadmap `docs/superpowers/specs/2026-09-24-coach-roadmap.md` R1.4 / U4; design
`2026-09-28-load-recommendation-architecture-design.md` §3.2 (legacy sets), §9 (U4 row), §10
(prerequisites 1–3); load spec `2026-09-24-load-advisor-design.md` §11 items 1, 2, 3;
`docs/BUGS.md` BUG-042 (and BUG-025 kin: zero-set exercise reported as completed);
`docs/BACKLOG.md` entries "Warmup sets are indistinguishable from working sets" and "Training
places and the user's own machines" (2026-09-27, point 5 only — the session place; places as an
entity, machine instances and the clarifying question are **not** this plan).

## Decisions (D)

- **D1 — scope.** Set kind, dumbbell load basis, session place, BUG-042 skipped rows. **Not in
  scope:** BUG-023 (isometric holds as reps — the owner's triage item 3 "fold BUG-023 into U4" is
  still an open owner decision; ask when it comes up, not here), machine instances / places as an
  entity (own spec), any load computation (U9a).
- **D2 — `session_sets.set_kind`** is a new Postgres enum `set_kind ('warmup','working')`,
  **nullable, no default**. `NULL` means "recorded before this plan — unknown"; the load advisor
  treats NULL rows with its documented heuristic (design §3.2) and never as certain working sets.
  Every new write sets it explicitly: `log_set` defaults to `working` when the model passes
  nothing; `update_last_set` can change it. Not backfilled.
- **D3 — `log_set` input** gains `setKind: 'warmup' | 'working'` (optional, default `working`).
  The tool description and prompt rule: the user's words decide ("разминка", "разминочный",
  "warm-up", "для разогрева" → `warmup`); the model never infers `warmup` from a light weight
  alone. The confirmation line names it: `Set 1 logged — Bench Press: 10 reps @ 40 kg (warm-up)`.
  `update_last_set` gains the same optional field. Warm-up sets keep their own `set_number` in the
  same sequence (no renumbering; the sequence is DB-derived and must stay stable for corrections).
- **D4 — counting.** Wherever sets are counted against a plan target, only working sets count:
  `training-workout-overview.v1.ts` (`(n/targetSets sets)` in the guide, `setsLeft` in ACTIVE
  STATUS, EXERCISE DETAIL target line), `format-exercise-summary.ts` (volume vs target on
  completion), and `session_exercises.actual_reps_range` if it is derived from sets. Warm-up sets
  are still **shown** in every per-set listing with a `(w/u)` marker via the one shared
  `formatSetData` (`training-workout-overview.v1.ts`, reused by history blocks and the
  `get_exercise_history` tool — one formatter, no copies). "Real workout" (BUG-031 rule, ≥ 1 set)
  is **unchanged**: a warm-up-only session is still a session that happened.
- **D5 — dumbbell load basis** lives in `set_data` (JSONB, no migration): `StrengthSetDataSchema`
  gains `perHand: boolean` (optional). The tool sets it **in code** from the catalog: when the
  exercise's `equipment` is a dumbbell/kettlebell kind (worker: list the distinct `equipment`
  values in the seeded catalog and pick the exact strings; record them in the plan under this
  D), `perHand = true` unless the model passed `weightBasis: 'total'` (new optional `log_set`
  field, only for the case the user said "в сумме"/"total"). For every other equipment the field
  is absent. Confirmation and `formatSetData` render `@ 12 kg per hand`. The prompt rule: for
  dumbbells the coach assumes per hand and says so in the confirmation; it asks only if the user's
  words make it ambiguous. Kettlebell single-arm work is per hand by the same rule.
  - **Worker note (Task 1):** the seeded catalog (`src/infra/db/seeds/exercises.seed.ts`,
    `Exercise['equipment']` in `types.ts`) has exactly six distinct `equipment` values —
    `'barbell' | 'dumbbell' | 'bodyweight' | 'machine' | 'cable' | 'none'`. There is **no**
    separate `'kettlebell'` value anywhere in the catalog or the type — kettlebell exercises, if
    any are added later, would need their own catalog `equipment` string first. `applyPerHand`
    (`training.service.ts`) therefore triggers on `equipment === 'dumbbell'` only; the D5 rule's
    "kettlebell" mentions describe intent for when that equipment value exists, not code today.
- **D6 — session place** is `workout_sessions.place text` (nullable), free text in the user's
  words ("Fitness House на Ленина", "дома"). Written by an optional `place` argument on
  `start_training_session` and by a new narrow tool `set_session_place(place)` available in
  `training` (for "я сегодня в другом зале" said after the start). No inference, no question in
  every session: the prompt says to record the place **only when the user names it**; the coach
  asks once per session only if the user's last 10 real workouts carry ≥ 2 distinct places
  (loader-computed boolean `placeAmbiguous`, rendered as one line in WORKOUT OVERVIEW: `Place:
  <text>` or `Place: not stated (ask — recent workouts were at 2 places)`). `NULL` = not stated;
  U9a compares loads within the same place or unknown.
- **D7 — BUG-042 at finish.** `completeSession` (a) creates a `session_exercises` row with
  `status = 'skipped'` and the plan's `targetSets`/`targetReps` for every `session_plan_json`
  exercise that has no row (valid UUID only — reuse the existing plan-id guard, D11 of
  `training-exercise-history`), and (b) marks an `in_progress` row with **zero sets** `skipped`,
  not `completed` (the same rule `ensureCurrentExercise` already applies on a switch). Auto-close
  (`autoCloseTimedOut`) goes through the same code path so a timed-out session reconciles too.
  History blocks then show "skipped on 2026-09-27" instead of "no completed record" — the
  `findLastPerformancesByExercise` anchor still requires ≥ 1 set (a skipped row is not a
  performance), but `training.exercise_history` gains a second line when the newest row for the
  exercise is a skip newer than the anchor: `last done … · skipped 2026-09-27`.
- **D8 — migration `0020`** (one file, both columns): `set_kind` enum + `session_sets.set_kind`
  nullable; `workout_sessions.place text`. Generated with `npm run drizzle:generate` from
  `schema.ts` (HB-01 rule), applied locally with `npm run db:local:migrate`; durable envs via
  `deploy.sh`. Additive only — rollback is "ignore the columns".
- **D9 — prompt `training` v8** = v7 plus: set-kind rule (D3), per-hand rule (D5), place rule (D6),
  `set_session_place` in TOOLS, and the confirmation examples updated. No other line changes.
  `session_planning`'s prompt is **not** versioned here (U7 rewrites it); only the
  `start_training_session` tool description gains the `place` argument text.
- **D10 — executor and review.** Two tasks, serial (Task 2 depends on Task 1's migration and
  formatter). Task 1 (schema, tool, counting, formatter, prompt v8) → Sonnet worker; Task 2 (place,
  BUG-042 finish reconciliation) → GLM worker. One combined close-out review for the plan
  (economical-work rule). Per-task worktrees `set-kind-t1`, `set-kind-t2`; DB tests serialized via
  `db-test-lock.sh`.
- **D11 — docs touched by this plan (worker lists exact edits in the task commit):**
  `docs/domain/training.spec.md` — INV-TRAINING-003 unchanged; add BR-TRAINING-027 (set kind:
  only working sets count toward targets; NULL counted as working for plan targets, unknown for
  load metrics), BR-TRAINING-028 (dumbbell weight is per hand unless stated total),
  BR-TRAINING-029 (finish reconciles untouched plan items to `skipped`; zero-set exercises are
  `skipped`), and `workout_sessions.place` in the entity list — **escalate to the owner in the
  plan section "Proposed durable-spec text"; durable spec ids are minted by the
  owner** (`docs/DOCUMENTATION_GUIDE.md`), so the worker proposes the text and numbers, the
  orchestrator confirms with the owner before merge. `docs/BUGS.md` BUG-042 → fixed, BUG-025 note.
  `docs/BACKLOG.md` — the warm-up entry closed; the places entry keeps points 1–4 open and
  records point 5 as delivered. Roadmap R1.4 row → delivered by this plan.
- **D12 (orchestrator, 2026-09-28) — merge without the owner's confirmation of D11.** The owner's
  autonomy order supersedes "confirms with the owner before merge": code merges into `dev` with the
  BR text only **proposed** (section at the end of this plan), `training.spec.md` untouched; the
  owner mints or renumbers the ids later. The R1 meta note (docs-first gate) is recorded, not acted on.
- **D13 (orchestrator) — per hand only for `equipment = 'dumbbell'`.** The catalog has no kettlebell
  value (Task 1 worker note under D5); kettlebell per-hand waits for a catalog value.
- **D14 (orchestrator) — reconciliation also closes `pending` zero-set rows as `skipped`** (plan text
  said `in_progress`); consistent with D7's intent, accepted at Task 2 review.
- **D15 (orchestrator) — worker incidents.** The GLM Task 2 worker's turn died on a network error
  (`ENOTFOUND`) with work done but uncommitted; the orchestrator nudged it via `orca terminal send`
  and it finished. Both workers' `worker-release` answered `retained / user_takeover`; their tabs
  are closed at final cleanup. Worktree deletions are deferred to the very end of the run (owner
  2026-09-29: an approval prompt stalls an autonomous run).
- **D16 (orchestrator) — review fixes stay on this branch** (economical-work rule): all six blocking
  findings plus the cheap advisories listed in § Review are fixed by one Sonnet fix worker in
  `set-kind-t1`; the rest go to one grouped `docs/BACKLOG.md` entry.

## Acceptance criteria

| AC | Criterion | Verification |
|---|---|---|
| AC-SK-1 | `log_set` with `setKind: 'warmup'` stores `session_sets.set_kind = 'warmup'`; without the field stores `'working'`; the confirmation text names a warm-up | `log-set.tool.unit.test.ts` (mocked service) + `tests/integration/scenarios/set-kind.integration.test.ts` (real test DB) |
| AC-SK-2 | Two warm-up sets and one working set against a 3-set target render `(1/3 sets)` in the guide and `2 remaining per plan` in ACTIVE STATUS; the exercise-completion summary's volume excludes warm-ups; all three sets are listed, warm-ups marked `(w/u)` | block unit test `training-workout-overview.v1.unit.test.ts`, `format-exercise-summary.unit.test.ts`, scenario |
| AC-SK-3 | Rows inserted before the migration read `set_kind = NULL`; the overview counts a NULL-kind set as working (today's behaviour, unchanged) and marks nothing | migration applied over seeded legacy rows in the integration test; block unit test |
| AC-SK-4 | A set on a dumbbell exercise stores `setData.perHand = true` and renders `@ 12 kg per hand`; the same call with `weightBasis: 'total'` stores `perHand = false`; a barbell set stores no `perHand` | `log-set.tool.unit.test.ts`, `set-data.types` unit test, scenario |
| AC-SK-5 | `start_training_session({ place })` and `set_session_place` write `workout_sessions.place`; the overview prints `Place: …`; with ≥ 2 distinct places in the last 10 real workouts and no place today the overview prints the ask line, otherwise not | tool unit tests, loader/block unit test, scenario |
| AC-SK-6 | Finishing a session whose plan lists an exercise with no row creates a `skipped` row with the plan's targets; an `in_progress` exercise with zero sets ends `skipped`; the next session's `training.exercise_history` shows `skipped <date>` for it, not "no completed record" | `tests/integration/scenarios/bug-042-skipped-plan-items.integration.test.ts`; `training-service-finish-reconcile.unit.test.ts`; block unit test |
| AC-SK-7 | Prompt `training` v8 carries the three rules and the tool entry; every existing training snapshot changes only in the expected lines (diff reviewed in the task commit) | prompt unit test + snapshot update via the documented command |
| AC-SK-8 | `update_last_set({ setKind })` changes the kind of the last set and reports before/after | tool unit test |

Verification commands (from `apps/server/`): `npm run check-all`, `npm run test:unit`,
`/Users/filko/orca/workspaces/fit_coach/db-test-lock.sh npm run test:integration`,
`/Users/filko/orca/workspaces/fit_coach/db-test-lock.sh npm run test:scenarios`, repro glob
`RUN_DB_TESTS=1 npx jest --testMatch='**/*.repro.test.ts'` (this plan's reds must be red before
the fix and gone — promoted — after), `node scripts/state.mjs --check` from the repo root.

## Task 1 — Set kind and dumbbell load basis (AC-SK-1..4, AC-SK-7, AC-SK-8)

**Files (ownership):**
- `apps/server/src/infra/db/schema.ts` (enum `set_kind`, `session_sets.set_kind`,
  `workout_sessions.place` — both columns in this task's migration `0020`, Task 2 only uses
  `place`), `apps/server/drizzle/0020_*.sql` (generated)
- `apps/server/src/domain/training/set-data.types.ts` (`perHand`), `types.ts` (`SessionSet.setKind`),
  `ports` + `services/training.service.ts` (`logSet` / `logSetWithContext` / `updateLastSet`
  carry `setKind`; equipment lookup for `perHand`), `infra/db/repositories/session-set.repository.ts`
- `apps/server/src/infra/ai/tools/log-set.tool.ts`, `update-last-set.tool.ts`,
  `format-exercise-summary.ts`
- `apps/server/src/infra/ai/prompts/blocks/training-workout-overview.v1.ts` (`formatSetData`
  marker, counting), `apps/server/src/infra/ai/prompts/phases/training/v8.ts` (new) +
  `training/index.ts` (current → v8)
- tests: `tests/integration/scenarios/set-kind.repro.test.ts` → promoted to
  `set-kind.integration.test.ts`; tool/block/summary unit tests; snapshots.

**Steps:**

1. **Red first.** (a) Scenario over the real test DB: seed a session with a 3-set Bench Press
   plan; scripted model calls `log_set` twice with `setKind: 'warmup'` (40 kg) and once without
   (60 kg); assert `session_sets.set_kind` = `warmup, warmup, working` and that the rendered
   overview contains `(1/3 sets)` — **fails today**: the tool schema rejects the unknown field
   (or ignores it) and the overview says `(3/3 sets)`. (b) Tool unit test: `log_set` on a dumbbell
   exercise stores `perHand: true` — fails today. (c) `update_last_set({ setKind })` — fails
   today. Commit red.
2. **Schema + migration `0020`** (D2, D8): enum, nullable column, `workout_sessions.place`.
   `npm run drizzle:generate`, inspect the SQL (two `ALTER TABLE … ADD COLUMN`, one `CREATE TYPE`),
   `npm run db:local:migrate`.
3. **Domain:** `SessionSet.setKind: 'warmup' | 'working' | null`; `logSet` requires `setKind`
   (the service, not the DB, defaults to `working` — the DB default stays absent so legacy rows
   stay NULL); `updateLastSet` accepts `setKind`. `StrengthSetDataSchema.perHand` optional
   boolean. Service resolves the exercise's `equipment` once (it already loads the session with
   exercises) and sets `perHand` per D5 unless the tool passed `weightBasis`.
4. **Tools:** `log_set` schema `setKind` + `weightBasis` with descriptions per D3/D5;
   confirmation text `(warm-up)` and `per hand`; `update_last_set` `setKind`.
5. **Counting and rendering** (D4): a single helper `workingSets(sets)` in
   `training-workout-overview.v1.ts` (exported, used by `format-exercise-summary.ts` too — no
   second copy); `formatSetData` appends ` (w/u)` for `warmup` and ` per hand` when `perHand`.
   Check `actual_reps_range` derivation and the completion summary's volume.
6. **Prompt v8** (D9): copy v7; add to TASK rule 2 "If the user calls the set a warm-up
   (разминка / warm-up / для разогрева), pass setKind 'warmup'; never mark a set warm-up from
   its weight alone"; add a per-hand sentence to RULE 6 ("dumbbell and kettlebell weights are
   per hand — say 'per hand' in the confirmation; ask only if the user says a total or it is
   ambiguous"); TOOLS: `set_session_place` entry (Task 2 builds the tool; the entry text is
   written here so v8 is the only new version — coordinate: Task 2 must not create a v9).
   Header comment in the v7 style: what changed and nothing else.
7. Promote the repro; update snapshots deliberately (only training-context lines may change —
   quote the diff in the commit); `docs/BACKLOG.md` warm-up entry → done by this plan.

**Verification:** the command list above, results quoted in the task report.

## Task 2 — Session place and finish reconciliation (AC-SK-5, AC-SK-6)

**Files (ownership):**
- `apps/server/src/infra/ai/tools/start-training-session.tool.ts` (`place`), new
  `set-session-place.tool.ts` + registration in the training tool set (`tool-policy` if the
  ordering table lists tools), `apps/server/src/domain/training/services/training.service.ts`
  (`completeSession` reconciliation, `autoCloseTimedOut` path, `setSessionPlace`),
  `infra/db/repositories/workout-session.repository.ts` (`place`, `distinctRecentPlaces`)
- `apps/server/src/infra/ai/graph/phases/training.spec.ts` (loader: `recentPlacesCount`),
  `apps/server/src/infra/ai/prompts/blocks/training-workout-overview.v1.ts` (`Place:` line),
  `training-exercise-history.v1.ts` (`skipped <date>` line; loader query for the newest skip)
- tests: `tests/integration/scenarios/bug-042-skipped-plan-items.integration.test.ts`;
  `training-service-finish-reconcile.unit.test.ts`; tool unit tests; block unit tests.

**Steps:**

1. **Red first.** (a) BUG-042 scenario: plan with Seated Calf Raise (never touched) and Leg Press
   (started, 2 sets); scripted model calls `finish_training`; assert a `session_exercises` row
   for Seated Calf Raise with `status = 'skipped'` and the plan's `target_sets`, and that the
   next session's rendered `EXERCISE HISTORY` line for it reads `skipped <date>` — **fails
   today** (no row, "no completed record"). (b) Service unit test: `completeSession` with an
   `in_progress` exercise and zero sets → `skipped` — fails today (`completed`). (c) Tool unit
   test: `start_training_session({ place: 'дома' })` writes `workout_sessions.place` — fails
   today (unknown field). Commit red.
2. **Finish reconciliation** (D7) in `completeSession`, shared by the auto-close path: one
   private method `reconcilePlanItems(session)`; reuse the plan-id UUID guard from
   `training.spec.ts` (move it to a shared domain helper if it is not already importable — no
   copy).
3. **Place** (D6): repository `update({ place })`, `distinctRecentPlaces(userId, 10)`;
   service `setSessionPlace(sessionId, place)`; tools; loader `recentPlacesCount`; overview line.
4. **History line** for skips (D7 last sentence): the exercise-history loader also fetches the
   newest `skipped` row per today's exercise; the block prints `· skipped YYYY-MM-DD` after the
   anchor when the skip is newer, or `— skipped YYYY-MM-DD, no completed record` when there is
   no anchor at all.
5. Promote the repro; `docs/BUGS.md` BUG-042 → `Status: fixed (set-kind)` with the test paths,
   BUG-025 gains a note that zero-set exercises now end `skipped` at finish too; `docs/BACKLOG.md`
   places entry: point 5 delivered, 1–4 open; roadmap R1.4 row → delivered by this plan;
   `docs/domain/training.spec.md` proposals per D11 in the plan section "Proposed durable-spec
   text".

**Verification:** the command list above, results quoted in the task report.

## Live check (dev, owner, ≤ 5 messages, expected replies written before the deploy)

1. In training: «разминка 40 на 10, потом рабочий 60 на 10» → two confirmations, the first
   says warm-up, the second does not; the overview line for the exercise reads 1 of N sets.
2. «гантели 12 кг на 10» on a dumbbell exercise → confirmation says «12 кг на руку».
3. At start: «я сегодня в Fitness House» → the reply acknowledges the place; DB row has it.
4. Finish with one planned exercise untouched → the next day's «что я делал?» / training
   history shows it as skipped on that date, never "not logged / never done".
5. A set with no kind stated → stored `working`, confirmation unchanged from today.

## Review

Run 1 — 2026-09-29, zones R1, R2, R3, R4 — **blocked** (6 blocking). Fixes dispatched per D16.

**Verification evidence (orchestrator, from the workers' `worker_done` and its own re-runs):**
Task 1 (Sonnet) — check-all green; test:unit 1583/1583; test:integration 643/643; test:scenarios
399/399 (+1 todo); repro glob: only the pre-existing BUG-023/025/027 reds. Orchestrator re-run of
test:scenarios on `6cf32a69`: 20 suites, 399 passed, 1 todo. Task 2 (GLM) — check-all exit 0;
test:unit 160 suites / 1601; test:integration 49 suites / 648 (+1 todo); test:scenarios 21 suites /
404 (+1 todo); repro glob: the same 3 pre-existing reds; `state.mjs --check` OK. Orchestrator re-run
of test:scenarios on `35a99846`: 21 suites, 404 passed, 1 todo.

**Blocking (run 1):**
- B1 (R2) `log-set.tool.ts:111-112` — strength confirmation copies `formatSetData`, now with a second
  copy of the per-hand note. → fix: call `formatSetData`.
- B2 (R3) `phases/training/v8.ts:53` — AC-SK-7: v8 lacks the place rule (D6); the `set_session_place`
  TOOLS entry and tool description say "Do NOT ask", contradicting the overview's ask line.
  → fix: add the place rule; align the tool text.
- B3 (R3) `training.spec.ts:199` — AC-SK-5: `placeAmbiguous === true`, the `!session.place`
  short-circuit and `distinctRecentPlaces` (window 10, NULL excluded, dedupe after limit) untested.
  → fix: loader unit tests + a real-DB repository test.
- B4 (R3) plan — verification results not quoted anywhere on the branch. → closed by the evidence
  block above (orchestrator).
- B5 (R4) plan § Proposed durable-spec text — BR-TRAINING-014..016 already exist in
  `docs/features/FEAT-0010-training-session-management.md` (up to -026). → fix: propose free ids and
  flag the collision for the owner.
- B6 (R4) `docs/BACKLOG.md:360` — the delivered warm-up entry must be removed, not ticked.
  → fix: remove it.

**Advisory (run 1) — fixed on the branch (D16):** R1 `workingSets` domain rule lives in a prompt
block → move to `domain/training`; R1 `placeAmbiguous` literals 10/2 → named constants; R2 `SetKind`
union hand-written → import the domain type; R2 `placeLineOf` exported with one use → unexport;
R3 skipped-row insert for a UUID-shaped id not in the catalog would throw on the FK, and a duplicated
plan id gives two skipped rows → skip non-catalog ids, update `existingIds`; R3 no test for the
auto-close reconciliation path → unit test; R3 ask line hardcodes "2 places" → render the count;
R3 debug `console.log` in `bug-042-…integration.test.ts` afterAll → remove; R4 roadmap §6 U4 and
R1.4 "Delivered" premature → "code done, live check on dev pending"; R4 BR-014 proposal wording on
NULL → state both (counted as working for targets, unknown for load metrics); R4 stale test/method
names and "PR description" wording in this plan → corrected.

**Advisory (run 1) — to `docs/BACKLOG.md` (one grouped entry, filled after the fix):** R1
`findTimedOut` has no `userId` (two reads of "timed out"); R1 `CreateSessionExerciseDto` has no
status (create-then-update); R1 `SessionSet.setKind` optional + nullable for fixtures; R1
`format-exercise-summary.ts` mixes concerns; R1 `TOOL_OUTCOME_FORMAT_ID` not bumped; R2 plan-row
builder duplicated between `reconcilePlanItems` and `ensureCurrentExercise`; R2 warm-up/per-hand
wording in three places; R3 AC-SK-3/-4 DB halves only unit-tested; R4 places entry carries a
delivery note; R4 `API_SPEC.md` shared types lack `place`/`setKind`/`perHand`; R4 ADR-0011
tool-priority table stale.

**Meta (to `docs/REVIEW_FINDINGS.md`):** R1 ×2 rule candidates (TOOL_OUTCOME_FORMAT_ID, block
versioning), R1 blind spot (docs-first gate), R2 blind spot (versioned prompts vs DRY), R3 blind spot
(where verification evidence lives), R3 rule candidate (every D names an AC), R4 blind spot (BR id
grep across docs/), R4 rule candidate (BACKLOG `[x]` entries).

## Proposed durable-spec text (for the owner)

D11: durable-spec ids are minted by the owner, so this text is a PROPOSAL — the `docs/domain/
training.spec.md` edit itself waits for the owner's confirmation before merge.

**Collision note (B5, close-out review run 1):** `docs/domain/training.spec.md`'s own numbering
stops at BR-TRAINING-013, but `docs/features/FEAT-0010-training-session-management.md` already
uses BR-TRAINING-014..026 (its own, unrelated business rules — `grep -rhoE "BR-TRAINING-[0-9]+"
docs | sort -uV` confirms the highest used anywhere in `docs/` is BR-TRAINING-026). The ids below
are renumbered to the next free ones, BR-TRAINING-027..029, so the owner does not have to resolve
a collision before minting them.

In `docs/domain/training.spec.md`:

- Terms, amend the WorkoutSession line:
  `• WorkoutSession: actual workout session with status tracking (planning|in_progress|completed|skipped) and place (free text, NULL = not stated)`

- Business Rules, append:
  `• BR-TRAINING-027: Every set carries its kind — 'warmup' or 'working'; only working sets count toward plan targets; a NULL set_kind (pre-2026-09-28 legacy rows) is counted as working for plan targets and treated as unknown by load metrics (design §3.2)`
  `• BR-TRAINING-028: A dumbbell exercise's weight is per hand unless the user states a total; the confirmation says "per hand"`
  `• BR-TRAINING-029: Finishing a session (explicit or auto-close) reconciles the plan — every untouched plan exercise gets a session_exercises row with status='skipped' and the plan's targets, and a zero-set exercise ends 'skipped', not 'completed'`

Entity line for the entity list: `workout_sessions.place` — `text`, nullable, free text in the user's
words, written only when the user names it (`start_training_session({ place })` / `set_session_place`).
