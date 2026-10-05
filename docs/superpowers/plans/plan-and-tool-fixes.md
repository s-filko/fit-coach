# Plan and Tool Fixes — one active plan, empty search, weight carry-over tails

- Status: in progress
- Parent: `docs/superpowers/plans/coach-simplification.md` (governing plan; this is a side plan of code-only fixes
  found in the D15 live review and the 2026-10-04/05 findings). Branch `plan/plan-and-tool-fixes`, cut from `dev`.
- Executor: an autonomous orchestrator session (Opus) on the Orca host `finland-v4-8gb`, launched by the owner's
  order of 2026-10-05; it dispatches workers (GLM by default) and follows § 2a. Host facts (test DB, local stand,
  env symlinks, restricted `ssh filko.dev`) are in `CLAUDE.local.md` on that host. Server code is in
  `apps/server/src` (paths below are relative to it unless they start with `apps/` or `docs/`). Commands run from
  `apps/server`.

## 0. Rules for the worker (read first)

1. Base the branch on `origin/dev` and check it: `git merge-base --is-ancestor origin/dev HEAD` must succeed
   before the first commit (a previous worker branched from `main` by mistake).
2. Every task is **red first**: write the test, run it, see it fail on unchanged code, record the failing output
   line in § 3, then fix. A test that passes before the fix does not prove anything — rewrite it.
3. Code only. Do **not** change: prompt files, tool descriptions shown to the model beyond what a task names,
   anything in user facts (extraction, verifier, `manage_fact`, rendering), durable specs except the one BR in
   Task 1, `.env*`, CI, deploy scripts. No new dependencies, no migrations.
4. Tool reply texts written by this plan state facts only — no instructions, no "always/never", no advice to the
   model. (Owner rule 2026-10-05: behaviour is not patched with prose; see `.claude/agents/prompt-doctor.md`.)
5. One commit per task (`fix(<area>): … (plan-and-tool-fixes T<N>)`), no attribution lines. Push the plan branch
   to origin after each accepted task so progress is visible. Nobody in this run merges into `dev`, deploys or
   touches the VPS or the dev data — those wait for the owner (§ 2a).
6. Something unclear or a task cannot be done as written → stop that task, write the question into § 3 under the
   task, commit, push, continue with the next independent task. Do not guess.
7. Docs and code comments in English.

## 1. Tasks

### T1 — One active workout plan per user (AC-PTF-1)

Problem (BACKLOG § Findings "One user has three `active` workout plans"): `save_workout_plan`
(`infra/ai/tools/save-workout-plan.tool.ts:150-158`) only inserts an `active` row; nothing archives the user's
earlier active plans. `WorkoutPlanRepository.findActiveByUserId`
(`infra/db/repositories/workout-plan.repository.ts:40-46`) is `WHERE user_id AND status='active' LIMIT 1` with no
ORDER BY, so with several active rows the plan every reader gets is undefined.

Owner decision (2026-10-05): a user has at most one active plan; the newest saved plan is the active one.

Do:
- Saving a plan archives every other active plan of that user and inserts the new one **in one transaction**
  (add a repository method, e.g. `createActiveReplacingOthers(userId, plan)`, on the port
  `domain/training/ports/workout-plan.ports.ts`; the tool calls it instead of `create`).
- `findActiveByUserId` orders by `created_at DESC` (deterministic for rows already in the DB).
- `docs/domain/training.spec.md`: add **BR-TRAINING-046** — "A user has at most one active workout plan; saving a
  plan archives the user's other active plans; readers take the newest active plan." Nothing else in the spec.
- No unique index / migration (dev data still holds several active rows; the orchestrator fixes data separately).

Verify (DB-backed): a new `tests/integration/database/workout-plan.repository.integration.test.ts` — two saves for
one user → one `active` (the second), one `archived`; another user's active plan untouched; with two pre-existing
active rows inserted directly, `findActiveByUserId` returns the newer. Unit test of the tool
(`infra/ai/tools/__tests__/save-workout-plan.tool.unit.test.ts`) asserts the new repository method is called.
Commands: `npm run test:unit`, `npm run test:integration -- workout-plan.repository`.

### T2 — An empty exercise search is a result, not an error (AC-PTF-2)

Problem (BACKLOG § Findings "An empty exercise search is told to the user as a database outage"):
`infra/ai/tools/search-exercises.tool.ts:72` returns `userError('No exercises found…')` for zero matches, so the
model receives a failure and told the user the database was down.

Do: zero matches return `ok(...)` (`domain/conversation/tool-outcome.ts:35`) with a factual line naming the query
and the filters used, e.g. `0 exercises match "<query>" (filters: category=…, equipment=…)`. Real failures
(embedding or DB throws) keep their current error path.

Verify: `infra/ai/tools/__tests__/search-exercises.tool.unit.test.ts` — empty repository result → outcome kind is
`ok`, text contains the query; a thrown repository error → still an error outcome. `npm run test:unit`.

### T3 — Weight carry-over works when the exercise is named inexactly (AC-PTF-3)

Problem (D15 review advisory): `carryWeight` in `infra/ai/tools/log-set.tool.ts:39-65` finds the session exercise
by exact lower-case name when no `exerciseId` is given, while the service resolves names fuzzily
(`TrainingService.resolveExerciseIdByName`, exact → embedding, `domain/training/services/training.service.ts:536`).
"Bench press" vs catalog "Barbell Bench Press" → the set is logged on the right exercise, but without the carried
weight.

Do: when `exerciseId` is absent and `exerciseName` is given, resolve the id once through
`trainingService.resolveExerciseIdByName` (already on the port, `training-service.ports.ts:124`) before
`carryWeight`, match the session exercise by that id, and pass the resolved id to `logSetWithContext` so the name
is not resolved twice. If resolution throws, keep today's behaviour (no carry; the service reports the error).

Verify: `infra/ai/tools/__tests__/log-set.carry-over.unit.test.ts` — a session exercise "Barbell Bench Press" with a
set at 60 kg, `log_set` with `exerciseName: "bench press"` and reps only → logged as 60 kg, confirmation says
"carried over"; resolver called once. `npm run test:unit`.

### T4 — Weight 0 means bodyweight (AC-PTF-4)

Problem (D15 review advisories): `log_set` with `weight: 0` stores a strength set "@ 0 kg"
(`log-set.tool.ts:93-95`); after a weighted pull-up a plain set gets the weight carried, and the only correction is
`update_last_set` with weight 0, which again yields "@ 0 kg".

Decision (D, orchestrator 2026-10-05): an explicit weight of 0 means a bodyweight set.

Do:
- `log_set` with `reps` and `weight: 0` → a `functional_reps` set, **no carry-over**, no "@ 0 kg" in the
  confirmation.
- `update_last_set` with `weight: 0` on a `strength` set → converts it to `functional_reps` with the same reps
  (mirror of the existing D15 conversion at `training.service.ts:481-490`).
- Reps-only without a weight keeps the D15 carry-over unchanged.

Verify: unit tests next to the existing D15 ones (`log-set.carry-over.unit.test.ts` and the service's
`update_last_set` tests): weighted pull-up 10 kg, then `log_set` reps 8 weight 0 → functional_reps 8, no carry;
`update_last_set` weight 0 on a 10 kg set → functional_reps, same reps; reps-only still carries.
`npm run test:unit`.

### T5 — No algorithmic weight carry-over; the model sets the weight (AC-PTF-5)

Owner decision (2026-10-05, after reading the T3 live check): the code must not decide a set's weight. The model reads
the context; when the weight is clear it passes it (if it assumed it, it says so in a few words — "записал 8 повторов с
тем же весом 55 кг"); when it is unclear it asks; the user corrects and the model applies the correction
(`update_last_set`). This supersedes the carry-over half of D15 (`coach-simplification.md`) and T3 of this plan.

Do:
- `log_set` stores what the model passed: remove `carryWeight` and the `carried` confirmation sentence
  ("… carried over from set N — correct it if different." — an instruction in a tool reply, against § 0 rule 4); reps
  without a weight → `functional_reps` as before D15.
- Revert T3's name pre-resolution in `log_set` (it existed only to find the set to carry from); the service resolves the
  name once, as before T3.
- Keep: T4 (explicit weight 0 = bodyweight), the D15 correction path in `updateLastSet` (a weight on a reps-only set
  converts it to strength with the per-hand basis), and the factual confirmation ("8 reps" / "8 reps @ 55 kg").
- Prompt/model behaviour (take the weight from context, ask when unclear, state an assumption briefly) is **not** in
  this task: it goes through `prompt-doctor` (baseline on the eval set first; change only if the baseline shows a gap).

Verify: unit — after a 60 kg set, `log_set` reps-only stores `functional_reps` (no weight), confirmation has no
"carried over"; `log_set` with `exerciseName` calls the resolver zero times in the tool; existing carry-over tests are
removed or inverted, not skipped. `npm run test:unit`, `npm run test:scenarios`.

## 2. Close (suites)

All four tasks committed and pushed, then from `apps/server`:
`npm run check-all` (0 errors), `npm run test:unit`, `npm run test:integration`, `npm run test:scenarios` — paste
the summary lines into § 3. DB suites run one at a time (one shared test DB on the host).

## 2a. Orchestrator on the Orca host (autonomous run)

Goal: the branch `plan/plan-and-tool-fixes` reaches a working, verified state without the owner.

1. Set `- Status: in progress`; one plan worktree from `origin/dev` with env symlinks per `CLAUDE.local.md`.
   Workers: GLM by default (host `CLAUDE.md` § Agents); T1 and T3 may go to Sonnet if a GLM attempt fails twice —
   record it as (D). Tasks are independent, but run DB suites serially. Review every `worker_done` against the task's
   AC before accepting it.
2. Suites of § 2 green on the plan branch.
3. One independent review on Opus over the branch diff against this plan (the `close-out-review` skill); fix
   blocking findings; record the verdict as `- Review:` in this header.
4. **Live check on the local stand** (one task owns the stand; record take/release in § 3): point `~/fitcoach-stand`
   at the plan worktree, run migrations on `fitcoach_local` if needed, restart `fitcoach-local-server`, then through
   `POST http://127.0.0.1:3000/api/bot/chat` (header `X-Api-Key` from the stand env; never print it) with a test user:
   - save a plan twice → `fitcoach_local` has one `active` plan for that user, the newest (T1);
   - a `search_exercises` call that matches nothing (e.g. a nonsense query with a narrow filter) → the reply does not
     claim an outage or failure (T2) — model behaviour, record what happened either way;
   - in a training session log a weighted set, then reps only under an inexact name → carried weight (T3);
   - a bodyweight set with weight 0 → no "@ 0 kg" (T4).
   Keep it short (Z.AI quota is shared). Paste the evidence (DB query results, reply excerpts, run ids) into § 3.
   Point the stand back to `~/projects/fit-coach` and restart it.
5. Set `- Status: done` only when 2–4 are green; push the plan branch. **Stop there** and report: merge into `dev`,
   dev deploy, the dev data fix for the owner's three active plans and every deletion (worktrees, task branches)
   are listed for the owner, not done.
6. Decisions taken without the owner → `(D)` lines in § 3 with a one-line reason.

## 3. Worker log (append; newest last)

### T1 — One active workout plan per user (AC-PTF-1)

- Red first, recorded before any fix:
  - unit (`infra/ai/tools/__tests__/save-workout-plan.tool.unit.test.ts`): `223:17 - error TS2339: Property
    'createActiveReplacingOthers' does not exist on type 'Mocked<IWorkoutPlanRepository>'` —
    Test Suites: 1 failed, 180 passed, 181 total.
  - integration (`tests/integration/database/workout-plan.repository.integration.test.ts`): `40:31 - error TS2339:
    Property 'createActiveReplacingOthers' does not exist on type 'WorkoutPlanRepository'` (× 4 call sites) —
    suite failed to run.
  - behaviour of the ordering fix, after the repository method existed but before `ORDER BY`:
    `expect(active?.name).toBe('Newer active')` → `Expected: "Newer active", Received: "Older active"`.
- Implementation: `createActiveReplacingOthers(userId, plan)` on the port and in the repository — one
  transaction archives the user's every active plan, then inserts the new one as `active`;
  `findActiveByUserId` now orders `created_at DESC`; `save_workout_plan` calls the new method;
  `BR-TRAINING-046` added to `docs/domain/training.spec.md` (nothing else in the spec). No migration.
- Port fakes updated: the tool unit test (method added to the mock; save-path assertions moved from
  `create` to the new method, plus a new test asserting `create` is NOT called), the single-cast mock in
  `tests/unit/domain/training/session-planning-context.builder.unit.test.ts` (compile), and the spies in
  `tests/integration/database/plan-name-check.integration.test.ts` (`create` → `createActiveReplacingOthers`;
  that suite went red on the first full integration run and was green after the retarget).
- Verification (from `apps/server`):
  - `npm run test:unit` → Test Suites: 181 passed, 181 total / Tests: 1805 passed, 1805 total.
  - `npm run test:integration -- workout-plan.repository` → Test Suites: 55 passed, 55 total / Tests:
    1 todo, 660 passed, 661 total. (Note: the positional pattern after `npm run … --` does not filter —
    jest runs the whole integration suite; useful for T2–T4 workers quoting this command.)
  - `npm run test:scenarios` → Test Suites: 23 passed, 23 total / Tests: 1 todo, 392 passed, 393 total.


### T2 — An empty exercise search is a result, not an error (AC-PTF-2)

- Red first, recorded before the fix (`infra/ai/tools/__tests__/search-exercises.tool.unit.test.ts`):
  - `154:17` 'returns an ok outcome naming the query when results are empty';
  - `169:17` 'names the filters actually used in the empty-result line' — received
    `{ kind: "user_error", message: "No exercises found matching the search criteria. Try a broader query or remove filters.", ok: false }`;
  - `188:54` 'omits the filters part when the empty search used none'.
  - Summary: Tests: 3 failed, 8 passed, 11 total.
- Implementation (`infra/ai/tools/search-exercises.tool.ts`): zero matches now return
  `ok('0 exercises match "<query>" (filters: category=…, equipment=…, muscleGroup=…)')` — only the filters
  actually sent, no filters part when none; facts only, the advice sentence is gone. Real failures
  (embedding or repository throws) keep the unchanged `userError` catch path. Tool description untouched.
- Verification (from `apps/server`):
  - `npm run test:unit` → Test Suites: 181 passed, 181 total / Tests: 1808 passed, 1808 total.
  - `npm run test:scenarios` → Test Suites: 23 passed, 23 total / Tests: 1 todo, 392 passed, 393 total.

### T3 — Weight carry-over works when the exercise is named inexactly (AC-PTF-3)

- Red first, recorded before the fix (`infra/ai/tools/__tests__/log-set.carry-over.unit.test.ts`):
  `139:53` 'carries the weight when the exercise is named inexactly (resolver resolves it)' —
  `expect(trainingService.resolveExerciseIdByName).toHaveBeenCalledTimes(1)` → `Expected number of calls: 1,
  Received number of calls: 0`, and the audit line shows the set stored as `functional_reps` (no carry).
  Summary: Tests: 1 failed, 6 passed, 7 total.
- Implementation (`infra/ai/tools/log-set.tool.ts`): a name-only call (no `exerciseId`) resolves the id once via
  `trainingService.resolveExerciseIdByName` before `carryWeight`; the session exercise is matched by that id
  (carryWeight receives `{ ...input, exerciseId }`), and the resolved id is passed to `logSetWithContext` (and the
  audit line) so the name is not resolved twice. A thrown resolution keeps today's behaviour: debug log, no carry,
  name-only call through which the service reports the error. `resolveExerciseIdByName: jest.fn()` added to the
  shared test-support fake; the tool description is untouched.
- Verification (from `apps/server`):
  - `npm run test:unit` → Test Suites: 181 passed, 181 total / Tests: 1810 passed, 1810 total.
  - `npm run test:scenarios` → Test Suites: 23 passed, 23 total / Tests: 1 todo, 392 passed, 393 total.
  - `DB_PORT=5999 npm run test:unit` not run: no imports under infra/ were added.

### T4 — Weight 0 means bodyweight (AC-PTF-4)

- Red first, recorded before the fix:
  - tool (`infra/ai/tools/__tests__/log-set.carry-over.unit.test.ts:179`): `log_set` with
    `weight: 0` → `Received tool input did not match expected schema — Too small: expected number to be >0
    → at weight` (zod `.positive()` rejected 0 before it could mean anything);
  - service (`training-service-update-last-set.unit.test.ts:65` and `:76`): both weight-0 updates
    produced `{"type": "strength", "weight": 0, "weightUnit": "kg"}` — the "@ 0 kg" bug.
  - Summary: Tests: 3 failed, 10 passed, 13 total.
- Implementation:
  - `log_set`: the weight schema accepts 0 (`.min(0)`); `reps` + `weight > 0` builds a strength set, so
    weight 0 falls to `functional_reps`; `carryWeight` never carries when an explicit weight was given
    (0 included — an explicit weight is a statement, not shorthand). Description text unchanged.
  - `updateLastSet` (service): weight 0 on a strength set converts it to `functional_reps` with the same
    reps (mirror of the D15 conversion, which no longer fires for 0 — a reps-only set given weight 0 stays
    `functional_reps`, no per-hand lookup); the weight spread skips 0 so no `weight: 0` lands in the setData.
  - `evals/snapshots/__tests__/tool-surface.unit.test.ts.snap` updated with `jest -u`: the only diff is the
    log_set weight schema `exclusiveMinimum: 0` → `minimum: 0`.
- Verification (from `apps/server`):
  - `npm run test:unit` → Test Suites: 181 passed, 181 total / Tests: 1813 passed, 1813 total.
  - `npm run test:scenarios` → Test Suites: 23 passed, 23 total / Tests: 1 todo, 392 passed, 393 total.


### § 2 close suites (orchestrator, 2026-10-04, branch head `aa456b21`, from `apps/server`)

- `npm run check-all` → `✖ 1248 problems (0 errors, 1248 warnings)` (the first run at `886c6d97` had 2 errors — closed by
  the review fixes `25446488`/`3400c5a8`).
- `npm run test:unit` → Test Suites: 181 passed, 181 total / Tests: 1814 passed, 1814 total.
- `DB_PORT=5999 npm run test:unit` (CI parity, no DB) → 181/181 suites, 1814/1814 tests.
- `npm run test:integration` → Test Suites: 55 passed, 55 total / Tests: 1 todo, 660 passed, 661 total.
- `npm run test:scenarios` → Test Suites: 23 passed, 23 total / Tests: 1 todo, 392 passed, 393 total.
- (D) T4 changed the `log_set` input schema `weight` from `.positive()` to `.min(0)` (tool-surface snapshot: only
  `exclusiveMinimum` → `minimum`). Before the branch a weight of 0 was rejected by validation rather than stored as
  "@ 0 kg" as the task text assumed; accepting 0 is required for "weight 0 means bodyweight". Description unchanged.


### § 2a step 4 — live check on the local stand (orchestrator, 2026-10-04)

- Stand taken 20:44:50Z (`~/fitcoach-stand` → plan worktree at `64f70ece`, `fitcoach-local-server` restarted, health 200,
  server cwd verified); released 20:54:30Z (→ `~/projects/fit-coach`, restarted, health 200). No migrations on the branch.
  Model: `glm-5.3-flash` via Z.AI. 17 chat calls.
- (D) A dedicated test user, not the owner's stand user: created through `POST /api/bot/user` (provider `live-check`,
  id `d53bcdc4-ff8b-45a2-8bc4-309f7d47b5b2`) and its profile set `complete` by SQL on `fitcoach_local` to skip the
  registration turns (quota). Left in `fitcoach_local` with one `in_progress` session — local stand data only.
- **T1 — passed.** Two saves through the chat (runs `a25c3b04`, `805ee90f`): `workout_plans` for the user →
  `497a5adf… 'Full Body Barbell & Pull-up Bar — 2 days/week' archived (updated 20:48:11.239)` and
  `850d4fff… 'Upper / Lower / Full Body Barbell — 3 days/week' active (created 20:48:11.238)` — one active, the newest.
  (The second save's first `save_workout_plan` call returned `llm_error` — plan-schema validation — and the retry was ok.)
- **T2 — passed.** "Подбери кардио-упражнение со штангой на предплечья" (run `3fe0e5d5`): `search_exercises` with
  category cardio + equipment barbell + muscleGroup forearms → outcome `ok`, tool text `0 exercises match "…" (filters: …)`
  (`fitcoach_local` has 0 cardio+barbell exercises). Reply: «в каталоге нет ничего по такому запросу: 0 упражнений совпадает
  с фильтрами «кардио + штанга + предплечья»» — no outage or failure claimed. One observation, not an eval.
- **T3 — not exercised live (model behaviour).** Every reps-only report was sent by the model with an explicit weight:
  `bench press ещё 7` → `log_set {reps 7, weight 60, exerciseId}` (run `a2b00f74`); `curls: ещё 9` →
  `{reps 9, weight 30, exerciseId}` (run `929e3980`). The name pre-resolution itself ran live: `exerciseName: "Barbell Curl"`
  (run `e71fc6b3`) and `"Pull-up (weighted)"` / `"Pull-up"` (run `41b295bc`) resolved to catalog exercises and logged.
  The carry-over on an inexact name stays proven by `log-set.carry-over.unit.test.ts` only.
- **T4 — passed.** "Подтягивания: +10 кг на 6, второй без отягощения, вес 0, 8 раз" (run `41b295bc`):
  `log_set {reps 8, weight 0, exerciseName "Pull-up"}` → stored `{"reps":8,"type":"functional_reps"}`, tool text
  `Set 1 logged — Pull-ups: 8 reps.` — no "@ 0 kg", no carry; the weighted set stored `strength 10 kg × 6`.
- Seen on the way, outside this plan (pre-existing, model or training-flow behaviour; for the owner's triage):
  (a) a catalog search request in chat moved the user into `plan_creation` and the coach then "ran" the workout there and
  twice claimed «сессия запущена / записано» with no session or set in the DB (runs `702880c9`, `913ae71b`, `25cae79f`);
  (b) logging an off-plan exercise auto-completed Barbell Bench Press at 2/4 sets; (c) "Barbell Curl" (absent from the
  catalog) resolved by embedding to Dumbbell Hammer Curl / Dumbbell Bicep Curl and the 30 kg barbell load was stored
  "per hand"; (d) two parallel `log_set` calls were stored in reverse order (bodyweight set #1, weighted set #2).

## Review

Close-out review 2026-10-04 (orchestrator; four independent Opus zones R1–R4 over `git diff $(merge-base origin/dev)...HEAD`
at `886c6d97`). **First pass: blocked. Second pass (at `aa456b21`): one blocker, fixed → clean.**

Blocking (verbatim):

1. `blocking | R2 | apps/server/src/infra/db/repositories/workout-plan.repository.ts:36 | CONTRIBUTING_AI.md "Principles & Boundaries" (DRY) | createActiveReplacingOthers copies the insert body and row mapping of create (workout-plan.repository.ts:11-24) almost line for line. After T1, create has no production caller … one insert path should serve both.`
2. `blocking | R3 | apps/server/src/domain/training/services/training.service.ts:486 | plan § 2 (check-all 0 errors) + SUPERPOWERS_INTEGRATION.md rule 2 | check-all fails on the branch head: no-nested-ternary (training.service.ts:486), prefer-destructuring (log-set.tool.ts:113), prettier (search-exercises.tool.ts).` — Root cause found by the orchestrator: `core.hooksPath` is unset in this host's repo config (husky `prepare` cannot find `.git` in a worktree), so the `.husky/pre-commit` gate never ran for any worker commit.
3. `blocking | R3 | docs/superpowers/plans/plan-and-tool-fixes.md:107 | SUPERPOWERS_INTEGRATION.md rule 2 | § 2 Close-suite evidence is missing.`
4. `blocking | R4 | docs/BACKLOG.md:113 | SUPERPOWERS_INTEGRATION.md § Backlog rule 4 | the finding "One user has three active workout plans" became T1 and is still an open entry, now claiming what the code no longer does.`
5. `blocking | R4 | docs/BACKLOG.md:115 | SUPERPOWERS_INTEGRATION.md § Backlog rule 4 | the finding "An empty exercise search is told to the user as a database outage" became T2 and is still open; its code half is now false.`

Advisory (verbatim summaries; not fixed on this branch unless noted):

- R1 `workout-plan.ports.ts:12` — the port still exposes `create()` that can break BR-TRAINING-046. *Closed by fix 1 (create retired).*
- R1 `save-workout-plan.tool.ts:146` — BR-TRAINING-046 lives in an infra repository method called by the tool, no domain service owns it (ADR-0013 §4.4); pre-existing shape, plan-prescribed.
- R1/R2 `log-set.tool.ts:62,71,94` + `training.service.ts:484` — "weight 0 = bodyweight" is implemented in two layers (tool for new sets, service for corrections); `logSetWithContext` still accepts a 0 kg strength set from other callers.
- R2 `log-set.tool.ts:48-51` — after T3 the exact-name branch of `carryWeight` is effectively dead; failed resolution resolves twice (plan accepts this).
- R2 `log-set.tool.ts:117` — `if (resolved != null)` is dead (the resolver throws, never returns null). *Closed with fix 2.*
- R3 `workout-plan.repository.ts:30` — two overlapping saves at READ COMMITTED can both stay `active`; the newest-first read hides it; no lock.
- R3 `log-set.tool.ts:100` — `.min(0)` makes `log_set {weight: 0}` with no reps reachable, which falls into the old `{strength, reps 0, weight 0}` fallback — an "@ 0 kg" set. *Not reachable — see (D) below; test added.*
- R3 `log-set.tool.ts:113` — passing the resolved id costs one extra `findById` for a new name-only exercise.
- R3 test names for AC-PTF-2/3/4 carry the AC only in comments. *Closed with fix 2 (names carry the AC).*
- R4 `training.spec.md:46` — the weight-0 / no-carry storage rules have no BR (nor does D15); spec gap for the owner.
- R4 `STATE.md:16` — the generated line says "(direct on integration branch)" for this plan; `state.mjs` did not detect the plan branch.
- R4 `BUGS.md:1712` — BUG-033's "name half" says name resolution is exact-match; stale against current code.

Meta (filed in `docs/REVIEW_FINDINGS.md`): R1 durable-spec escalation evidence; R1 (D) changing stored data needs a BR candidate;
R2 plan-prescribed duplicates; R3 zone lacks the close gate (lint/format); R3 prompt names a non-existent jest config;
R4 close-out must trim the source BACKLOG/BUGS entries.

**Closure of pass 1** (re-verified by search in pass 2 by R1/R2/R3/R4): 1 — `create` retired from port and repository, no
callers left (`25446488`); 2 — `check-all` 0 errors (`25446488`, `3400c5a8`), and `core.hooksPath` set; 3 — § 2 suites
recorded in § 3 above; 4/5 — BACKLOG entries removed / cut to the model half (`15d348b3`).

**Pass 2** (2026-10-04, four fresh Opus zones at `aa456b21`). Blocking:

6. `blocking | R4 | docs/features/FEAT-0008-training-plan-generation.md:26 | SUPERPOWERS_INTEGRATION.md rule 7 (stale pointer, fixable under rule 3) | the API Mapping line ends in save_workout_plan tool → IWorkoutPlanRepository.create(), and Implementation Notes at line 34 says the tool "calls workoutPlanRepository.create()" — a method that no longer exists.` — Closed by the orchestrator: both pointers now name `createActiveReplacingOthers()` (BR-TRAINING-046); a two-line pointer fix, verified by `grep -rn "WorkoutPlanRepository.create\b\|workoutPlanRepository.create()" docs apps` (only the historical `MVP_TRAINING_SESSION_MANAGEMENT.md:212` remains, left as history). Zones were not re-run for this doc-only change.

Advisories of both passes → `docs/BACKLOG.md` § plan-and-tool-fixes close-out review advisories (7 entries). Owner-gated,
not backlog (durable specs / bug status): a BR for "weight 0 = bodyweight, explicit weight never carried, update to 0
converts" and for the D15 carry-over (R4, `training.spec.md`); FEAT-0008 AC-0203 still describes replanning via
`archivedAt` and does not cite BR-TRAINING-046 (R4); BUG-033's "name half" says name resolution is exact-match, stale
against `resolveExerciseIdByName` (R4, `BUGS.md:1712`). Dropped: `MVP_TRAINING_SESSION_MANAGEMENT.md:212` lists `create`
(historical design doc).

Decisions:

- (D) Fix 1 retires `IWorkoutPlanRepository.create` (its only callers were the tool and one integration test) instead of
  a shared insert helper: one insert path, and the port no longer offers a way around BR-TRAINING-046.
- (D) R3's advisory "`log_set {weight: 0}` with no reps is reachable" was wrong: the schema's second refine (reps |
  durationSeconds | distanceKm) already rejects a weight-only payload. A first fix added a handler guard and widened the
  refine (25446488); reverted as YAGNI (3400c5a8), keeping an AC-PTF-4 test that proves the rejection.
- (D) BACKLOG: the T1 finding is removed (its open dev-data half is an owner item in this plan's report); the T2 finding is
  cut to its model half (whether the coach still invents a cause on a factual empty result — checked live in § 3).
- (D) `git config core.hooksPath .husky` set on the host repo (shared by all worktrees) so the committed pre-commit gate
  actually runs; this is the project's intended behaviour, not a new mechanism.

### Review fixes (close-out review pass 1 blockers)

- R2: `IWorkoutPlanRepository.create` retired — removed from the port and the repository;
  `createActiveReplacingOthers` is the only insert path. The two integration-test callers
  (`training.repository.integration.test.ts:101,128`) were retargeted and `create` cleaned from every port
  fake (save-workout-plan / start-training-session / request-transition tool tests, conversation.graph and
  review-prepare graph tests, session-planning-context.builder test).
- R3: `npm run check-all` → `✖ 1248 problems (0 errors, 1248 warnings)` (baseline this pass:
  `2 errors`) — the nested ternary in `updateLastSet` became if/else, `let exerciseId = input.exerciseId`
  became object destructuring, `prettier --write` on search-exercises.tool.ts and log-set.tool.ts; the dead
  `if (resolved != null)` check is dropped (the resolver throws, never returns null).
- T4 completeness (item 3): closed as "already rejected by the schema refine; test added" — the review's
  reachability claim was wrong (refine #2 blocks a weight-only payload before the handler), so the handler
  guard and the refine relaxation from 25446488 were reverted; the AC-PTF-4 test now proves the schema
  rejection ('Either reps, durationSeconds, or distanceKm must be provided') and that nothing is stored.
- Test names now carry the AC id (AC-PTF-2/3/4) in the search-exercises, log-set.carry-over and
  training-service-update-last-set tests — renames only.
- Verification: `npm run check-all` → `✖ 1248 problems (0 errors, 1248 warnings)`, `tsc --noEmit` clean;
  `npm run test:unit` → Test Suites: 181 passed, 181 total / Tests: 1814 passed, 1814 total.
  DB suites not run on purpose — the orchestrator owns them this pass.

### T5 — No algorithmic weight carry-over; the model sets the weight (AC-PTF-5)

- Red first, recorded before the fix (`infra/ai/tools/__tests__/log-set.weight-input.unit.test.ts`, renamed from
  `log-set.carry-over.unit.test.ts`):
  - `60:47` 'stores functional_reps for reps without a weight even after weighted sets of the exercise (AC-PTF-5)' —
    `logSetWithContext` received `setData: {"reps": 12, "type": "strength", "weight": 59, "weightUnit": "kg"}`,
    expected `functional_reps`;
  - `82:57` 'passes exerciseName through unresolved, resolver never called by the tool (AC-PTF-5)' —
    `resolveExerciseIdByName`: Expected number of calls: 0, Received number of calls: 1.
  - Summary: Tests: 2 failed, 2 passed, 4 total (the two AC-PTF-4 tests pass unchanged — T4 behaviour kept).
- Implementation (`infra/ai/tools/log-set.tool.ts`): `carryWeight` and the `Carried` type removed — reps without a
  weight store `functional_reps` exactly as given; the "… carried over from set N — correct it if different."
  sentence is gone from the confirmation; T3's name pre-resolution reverted — the tool never calls
  `resolveExerciseIdByName`, `exerciseName` passes through to `logSetWithContext` (the service resolves it once,
  as before T3); `weightBasis` is a plain pass-through of the input. T4 (weight 0 = bodyweight, `.min(0)` schema)
  and the D15 correction path in `updateLastSet` untouched; tool description and prompt files untouched.
- Tests: the carry-over file is renamed `log-set.weight-input.unit.test.ts` (it no longer tests carry-over): the
  two carry tests inverted (AC-PTF-5), the name-match / warm-up / total-basis carry tests removed (no carry left
  to test; explicit `weightBasis: 'total'` passthrough stays covered in `log-set.tool.unit.test.ts`), both AC-PTF-4
  tests kept verbatim — nothing skipped. Test-support fake unchanged (`resolveExerciseIdByName` stays on the port
  mock — asserted never called by the tool).
- Note for the orchestrator: `docs/BACKLOG.md:971` (T3 advisory — dead exact-name branch of `carryWeight`, double
  resolution) is now moot: `carryWeight` no longer exists. Left untouched — outside this task's file ownership.
- Verification (from `apps/server`):
  - `npm run check-all` → `✖ 1247 problems (0 errors, 1247 warnings)`.
  - `npm run test:unit` → Test Suites: 181 passed, 181 total / Tests: 1809 passed, 1809 total.
  - `npm run test:scenarios` → Test Suites: 23 passed, 23 total / Tests: 1 todo, 392 passed, 393 total.
