# Plan and Tool Fixes — one active plan, empty search, weight input (no carry-over)

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

### T3 — Weight carry-over works when the exercise is named inexactly (AC-PTF-3) — **superseded by T5** (owner 2026-10-05; the carry-over is removed)

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
- Reps-only without a weight keeps the D15 carry-over unchanged. *(Superseded by T5 and T6: no carry-over; reps without a weight are rejected, BR-TRAINING-047.)*

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

### T6 — Weight is required with reps; bodyweight is named "bodyweight" everywhere (AC-PTF-6)

Owner decisions (2026-10-05…08): the weight has no default — the coach passes it, 0 is the coach's decision "no
external load", never "unknown"; the tool feedback and every history the model reads say "bodyweight", in full (not
"BW": ambiguous with the user's body weight, needs a legend). BR-TRAINING-047 (owner-approved 2026-10-08).

Do (code):
- `log_set`: with `reps`, `weight` is required (schema refine; a call with reps and no weight is rejected by the
  schema); `weight: 0` → `functional_reps` (as T4). Without reps (duration/distance) weight stays optional.
- One formatter for a bodyweight set, used by every renderer the model reads: `formatSetData` (tool confirmations of
  `log_set` / `update_last_set` / `get_exercise_history`) → `8 reps @ bodyweight`; `formatSetShort`
  (`training-facts.ts`, today + history) → `8×bodyweight`; `session-planning-recent-history.v1.ts` the same short form.
  A `strength` set with a null weight (legacy rows) renders the same way. Legacy `functional_reps` rows from the
  omitted-weight era also read "bodyweight" (owner accepted, no migration).
- Do NOT change prompt files or tool descriptions in this task.

Do (texts, via `prompt-doctor`, after the code): the `weight` argument description states the meaning only — "Weight in
kg, required with reps. 0 = no external load (a bodyweight set) — a decision, not 'unknown'."; one rule in the training
prompt: the weight comes from the conversation and history; if it is clear, log it and say briefly which weight was
logged; if not, ask. Baseline vs candidate on GLM (stand), guard cases: «ещё 8» after 55 kg → 55 logged and said;
pull-ups without a belt → 0 / bodyweight; weight not named and unclear → asks; «нет, было 60» → corrected; plus the
existing control cases. Accepted only if not worse.

Verify: unit — `log_set` reps without weight → schema rejection, no write; weight 0 → `functional_reps`, reply
`… 8 reps @ bodyweight.`; renderers print `8×bodyweight` / `@ bodyweight` for functional_reps and null-weight strength;
snapshots updated deliberately (list them in § 3). `npm run test:unit`; DB suites run by the orchestrator.

### T7 — Weight requirement per exercise: required / optional / not used (AC-PTF-7)

Owner decision (2026-10-08, refines T6): the weight is mandatory only where the exercise works with a weight. The
catalog carries it explicitly — three values, no counterweight value (the Gravitron is "required"; its meaning comes
from its name "Assisted …"; checked live in plan `coach-quality-proof`).

Do:
- Migration (`npm run drizzle:generate`): `exercises.weight_mode text not null default 'required'` with a check
  (`required` | `optional` | `none`); backfill in the same migration: equipment `bodyweight` → `optional`; category
  `cardio` or equipment `none` → `none`; everything else (barbell, dumbbell, cable, machine incl. the Gravitron) →
  `required`. The exercise seed sets it for fresh databases. Domain type + repository mapping.
- `log_set` validation by the resolved exercise's `weight_mode` (in the service/tool after the exercise is known,
  replacing T6's blanket refine): `required` + reps without weight → `llmError` stating the fact
  ("<exercise>: weight is required"); `optional` + reps without weight → a bodyweight set (`functional_reps`), with a
  number → added load (`strength`, weight ≥ 0); `none` → any weight is not stored (cardio stays duration/distance).
  `weight: 0` keeps meaning bodyweight on any mode.
- Tool texts — facts only: `weight` describe: "Weight in kilograms (kg). Required for exercises that use a weight;
  optional for bodyweight exercises (omitted = bodyweight, a number = added load); not used for cardio."; the
  bodyweight line of the description accordingly. Today's plan line in the training context names the mode for each
  planned exercise only when it is not `required` (e.g. "bodyweight; weight optional").
- BR-TRAINING-047 is re-worded after owner approval (orchestrator).

Verify: migration applies on the test DB; unit — required/optional/none paths, weight 0, the rejection text;
integration — backfill values for Pull-ups (optional), Running (none), Barbell Bench Press and the Gravitron
(required); scenarios green.

## 2. Close (suites)

All tasks committed and pushed, then from `apps/server`:
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
   - in a training session log a weighted set, then reps only (no weight) → stored as given, a bodyweight set, no "carried over" (T5; T3 superseded);
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
  The carry-over on an inexact name was proven by `log-set.carry-over.unit.test.ts` at the time; T5 then removed the carry-over (file renamed `log-set.weight-input.unit.test.ts`).
- **T4 — passed.** "Подтягивания: +10 кг на 6, второй без отягощения, вес 0, 8 раз" (run `41b295bc`):
  `log_set {reps 8, weight 0, exerciseName "Pull-up"}` → stored `{"reps":8,"type":"functional_reps"}`, tool text
  `Set 1 logged — Pull-ups: 8 reps.` — no "@ 0 kg", no carry; the weighted set stored `strength 10 kg × 6`.
- Seen on the way, outside this plan (pre-existing, model or training-flow behaviour; for the owner's triage):
  (a) a catalog search request in chat moved the user into `plan_creation` and the coach then "ran" the workout there and
  twice claimed «сессия запущена / записано» with no session or set in the DB (runs `702880c9`, `913ae71b`, `25cae79f`);
  (b) logging an off-plan exercise auto-completed Barbell Bench Press at 2/4 sets; (c) "Barbell Curl" (absent from the
  catalog) resolved by embedding to Dumbbell Hammer Curl / Dumbbell Bicep Curl and the 30 kg barbell load was stored
  "per hand"; (d) two parallel `log_set` calls were stored in reverse order (bodyweight set #1, weighted set #2).

### § 2 close suites after T5 (orchestrator, branch head `d65886b6`, from `apps/server`)

- `npm run check-all` → `✖ 1247 problems (0 errors, 1247 warnings)`.
- `npm run test:unit` → 181/181 suites, 1809/1809 tests; `DB_PORT=5999 npm run test:unit` → the same.
- `npm run test:integration` → 55/55 suites, 660 passed + 1 todo.
- `npm run test:scenarios` → 23/23 suites, 392 passed + 1 todo.

### § 2 close suites after T6 (orchestrator, `2081d474` + `f78ca5db`, from `apps/server`)

- `npm run check-all` → 0 errors; `npm run test:unit` → 182/182 suites, 1818/1818 tests (at `f78ca5db`).
- `flock … npm run test:integration` → 55/55 suites, 660 passed + 1 todo (at `2081d474`).
- `flock … npm run test:scenarios` → 23/23 suites, 392 passed + 1 todo (at `2081d474` and again at `f78ca5db`).
- Journey B pinned the pre-T6 `8 reps` rendering; fixed in `2081d474` (`8×bodyweight`).
- Live evidence for T1–T6 after T5/T6: plan `coach-quality-proof` journeys i–n and b (report in that plan).

## Review

Close-out review 2026-10-04 (orchestrator; four independent Opus zones R1–R4 over `git diff $(merge-base origin/dev)...HEAD`
at `886c6d97`). **First pass: blocked. Second pass (at `aa456b21`): one blocker, fixed → clean. Third pass after T5 (at `d65886b6`): blocked — one owner-gated BR.**

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

Advisories of both passes → `docs/BACKLOG.md` § plan-and-tool-fixes close-out review advisories (7 entries filed; the `carryWeight` one dropped in `d65886b6` as moot after T5). Owner-gated,
not backlog (durable specs / bug status): a BR for "weight 0 = bodyweight, explicit weight never carried, update to 0
converts" (the D15 carry-over half is gone after T5 — see pass 3) (R4, `training.spec.md`); FEAT-0008 AC-0203 still describes replanning via
`archivedAt` and does not cite BR-TRAINING-046 (R4); BUG-033's "name half" says name resolution is exact-match, stale
against `resolveExerciseIdByName` (R4, `BUGS.md:1712`). Dropped: `MVP_TRAINING_SESSION_MANAGEMENT.md:212` lists `create`
(historical design doc).

**Pass 3** (after T5, four fresh Opus zones at `d65886b6`): R1 no findings; R2 no findings; R3 advisories only (T3
text not marked superseded, live-check step for T3 stale, unreachable `{strength, reps 0, weight 0}` fallback in
`log-set.tool.ts:58`); R4:

7. `blocking | R4 | docs/domain/training.spec.md:40 | SUPERPOWERS_INTEGRATION.md rule 1 (durable content never lives only in docs/superpowers/) | the owner's T5 rule ("log_set stores the weight the model passes; reps without a weight are stored as functional_reps; the code never decides a set's weight") and the T4 rule ("explicit weight 0 = bodyweight, in log_set and update_last_set") live only in working docs; no BR-TRAINING-* covers them.` — **Open, owner-gated.** Proposed wording put to the owner on 2026-10-05 (BR-TRAINING-047: "log_set stores the weight the model passes and never derives one — reps without a weight are stored as a bodyweight (functional_reps) set; an explicit weight of 0 means a bodyweight set. update_last_set with a weight on a bodyweight set makes it a weighted set; weight 0 on a weighted set makes it a bodyweight set with the same reps."); owner answer: **"not now"**. Until the owner decides, the verdict stays **blocked** and the plan stays `in progress`.

R4 advisories (closed in the plan text, same commit): T3 marked superseded; live-check step for T3 replaced by the T5
check; stale pointers in § 3 and this section corrected; title no longer says "carry-over tails". Open advisory: the
`log_set` description says only "Omit for bodyweight exercises" — the meaning of `weight: 0` is visible nowhere to the
model (a tool-description change → `prompt-doctor`, see the inventory).

**Pass 4** (2026-10-08, after T6; four independent zones run as subagents by a GLM reviewer session — owner order
2026-10-08, GLM accent; (D) instead of Opus; raw findings `data/investigations/2026-10-08-review-ptf-pass4.md`, local).
Closures of passes 1–3 re-verified by search: all hold. Blocking:

8. `blocking | R3/R4 | apps/server/src/infra/ai/tools/log-set.tool.ts:154,183 | BR-TRAINING-047 | the tool description
   still taught "For bodyweight exercises: provide reps only." / "Omit for bodyweight exercises." — exactly the calls the
   T6 refine rejects` — closed in `f78ca5db` (T6 texts step 1, a tool-contract fix: "provide reps and weight 0 (no
   external load)", "Weight in kilograms (kg); required with reps. 0 = no external load (a bodyweight set).").
9. `blocking | R4 | docs/domain/training.spec.md:40 | BR-TRAINING-040 + SUPERPOWERS_INTEGRATION rule 7 | "a reps-only call
   on an isometric exercise is stored as given" (owner-approved 2026-10-01) is false after T6 — the refine rejects every
   reps-without-weight call, isometric included; BR-040 and BR-047 conflict` — **open, owner-gated.** Proposed: amend
   BR-TRAINING-040's last clause to "a reps call on an isometric exercise carries a weight like any reps call
   (BR-TRAINING-047)".

Pass-4 advisories → BACKLOG § plan-and-tool-fixes close-out review advisories (appended): the port still offers
`update`/`archive` around BR-046; `set-format.ts` is now a shared tool-reply module living under prompts/blocks; the
bodyweight classification is repeated in `session-planning-recent-history.v1.ts:30`; that line mixes `8x80kg` with
`8×bodyweight`; ADR-0011 Fix 6a still describes `update_last_set` as a plain merge; FEAT-0008 AC-0203 (pass 2, owner).

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
- Note for the orchestrator: the BACKLOG T3 advisory (already dropped by the orchestrator in `d65886b6` — dead exact-name branch of `carryWeight`, double
  resolution) is now moot: `carryWeight` no longer exists. Left untouched — outside this task's file ownership.
- Verification (from `apps/server`):
  - `npm run check-all` → `✖ 1247 problems (0 errors, 1247 warnings)`.
  - `npm run test:unit` → Test Suites: 181 passed, 181 total / Tests: 1809 passed, 1809 total.
  - `npm run test:scenarios` → Test Suites: 23 passed, 23 total / Tests: 1 todo, 392 passed, 393 total.

### T6 — Weight is required with reps; bodyweight is named "bodyweight" everywhere (AC-PTF-6)

- Ownership extended by the orchestrator (ask → answer C, 2026-10-07): besides the four named files, also
  `infra/ai/tools/update-last-set.tool.ts` (Before/After through the shared formatter instead of raw
  `JSON.stringify(setData)`), `infra/ai/tools/format-exercise-summary.ts` (auto-complete notes), and — from the
  pre-commit sweep the answer ordered — `infra/ai/tools/delete-last-sets.tool.ts` (deleted-set lines, also raw JSON
  before). Sweep result: no other renderer prints a logged set to the model (`grep` over `setData` consumers and
  `reps` template strings in tools/blocks; the `reps` hits left in `prompts/phases/*` are plan-template prompt text,
  not logged-set renderings — untouched per "no prompt files"). `session-planning.types.ts:25` mentions "BW" only in
  a comment about normalizing model *input* (planned weight), not a rendering — left as is.
- Red first, recorded before the fix:
  - `log-set.weight-input.unit.test.ts:59` 'rejects reps without a weight at the schema level, nothing stored
    (AC-PTF-6)' — `expect(...).rejects.toThrow()` → `Received promise resolved instead of rejected`;
  - `log-set.weight-input.unit.test.ts` (AC-PTF-4/6 weight-0 reply) — `Expected substring: "8 reps @ bodyweight"`,
    `Received string: "Set 2 logged — Barbell Bench Press: 8 reps."`;
  - `set-format.unit.test.ts` (new) — `Expected: "8 reps @ bodyweight" / "12 reps @ bodyweight"`, `Received: "8 reps"
    / "12 reps"`;
  - `training-facts.unit.test.ts` formatSetShort table — `Expected: "12×bodyweight" / "20×bodyweight"`, `Received:
    "12 reps" / "20 reps"`;
  - `session-planning-blocks.v1.unit.test.ts` — `Expected substring: "8×bodyweight"` (rendered `8xBW` / the bare type
    name `functional_reps`);
  - `update-last-set.tool.unit.test.ts` — `Before: {"type":"strength","reps":10,"weight":10,…} After:
    {"type":"functional_reps","reps":10}` (raw JSON);
  - `delete-last-sets.tool.unit.test.ts` — `Set 2: {"type":"functional_reps","reps":8}` (raw JSON);
  - `format-exercise-summary.unit.test.ts` — bodyweight lines rendered bare (`Set 1: 8 reps`).
  - Summary of the red run over the six files: Tests: 11 failed, 89 passed (plus the set-format file's 3).
- Implementation:
  - `set-format.ts`: one wording in one place — `BODYWEIGHT_LABEL` + `formatBodyweightLong(reps)` = `8 reps @
    bodyweight` and `formatBodyweightShort(reps)` = `8×bodyweight`; `formatSetData` uses the long form for
    `functional_reps` and for a `strength` set with a null weight (legacy rows); weighted/cardio forms unchanged.
  - `log-set.tool.ts`: schema refine `reps → weight !== undefined` with message `weight is required with reps
    (0 = a bodyweight set)` — a reps-only call is rejected before the handler, nothing stored; duration/distance calls
    keep weight optional; `weight: 0` → `functional_reps` unchanged (T4); handler and description untouched.
  - `training-facts.ts` `formatSetShort`: `8×bodyweight` for `functional_reps` and null-weight `strength`.
  - `session-planning-recent-history.v1.ts`: `8×bodyweight` for null-weight `strength` and for `functional_reps`
    (previously `8xBW` / the bare type name); weighted `8x80kg` shape unchanged.
  - `update-last-set.tool.ts` / `delete-last-sets.tool.ts`: Before/After and deleted-set lines render through
    `formatSetData` — no more raw setData JSON to the model.
  - `format-exercise-summary.ts`: a set with reps and no external load prints `8 reps @ bodyweight` in the
    sets-performed lines.
  - Scenario fixtures (DB suites — orchestrator runs them): the five scripted bodyweight pull-up `log_set` calls
    (`evals/scenarios/b-full-workout.scenario.ts` ×2, `c-catch-up-logging.scenario.ts` ×3) gained `weight: 0` —
    same stored `functional_reps` set, now schema-valid. No other scripted `log_set` call passes reps without a weight.
  - Snapshots: **none updated, deliberately** — `tool-surface` (log_set schema) is unchanged because a zod `.refine`
    does not serialize into the JSON schema, and no snapshot contains a bodyweight rendering (62 snapshots pass
    untouched). The `log-set.tool.repro.test.ts` W-3 probe (excluded from the default run) now fails one step
    earlier — its `reps`-only plank call is schema-rejected instead of stored — left as is: still red by design.
- Verification (from `apps/server`):
  - `npm run check-all` → `✖ 1256 problems (0 errors, 1256 warnings)` (2 import-order errors introduced and fixed
    before the final run).
  - `npm run test:unit` → Test Suites: 182 passed, 182 total / Tests: 1817 passed, 1817 total.
  - `DB_PORT=5999 npm run test:unit` (CI parity, no DB) → 182/182 suites, 1817/1817 tests.
  - DB suites not run by the worker (shared test DB) — orchestrator's § 2 run covers them.

### T6 — Do (texts), step 1: the declared contract states the weight rule (AC-PTF-6)

- Red first, recorded before the fix (`infra/ai/tools/__tests__/log-set.weight-input.unit.test.ts`):
  `137:31` 'description and the weight describe name weight 0 for bodyweight sets (AC-PTF-6)' —
  `Expected substring: "For bodyweight exercises: provide reps and weight 0 (no external load)."`,
  received description still carrying "For bodyweight exercises: provide reps only." — Summary:
  Tests: 1 failed, 4 passed, 5 total. (The first red run failed to compile — TS2339 on
  `toJsonSchema(...).properties`; the recorded red above is against the unchanged texts.)
- Implementation (`infra/ai/tools/log-set.tool.ts`, exactly two strings, facts only):
  - description line → 'For bodyweight exercises: provide reps and weight 0 (no external load).'
  - weight `.describe` → 'Weight in kilograms (kg); required with reps. 0 = no external load (a bodyweight set).'
  No other description, tool text or prompt file changed; handler and schema untouched.
- Snapshot updated deliberately (listed per plan): `evals/snapshots/__tests__/__snapshots__/tool-surface.unit.test.ts.snap`
  via `jest -u` — exactly the two strings in the training phase's log_set entry (tool description +
  weight property), verified by reading the snapshot diff; nothing else moved.
- Left untouched, noted: `log-set.tool.repro.test.ts:50` (excluded from the default run, red by design)
  still quotes the old sentence in a comment — outside this step's two-string ownership.
- Verification (from `apps/server`):
  - `npm run check-all` → 0 errors (eslint, prettier "All matched files use Prettier code style!",
    `tsc --noEmit` clean).
  - `npm run test:unit` → Test Suites: 182 passed, 182 total / Tests: 1818 passed, 1818 total /
    Snapshots: 62 passed, 62 total.
  - `flock /tmp/fitcoach-testdb.lock npm run test:scenarios` → Test Suites: 23 passed, 23 total /
    Tests: 1 todo, 392 passed, 393 total.
- (D) T6 texts step 1 — description contradiction fixed (class 3); the training-prompt rule is decided
  after the live measurement.

### T7 — Weight requirement per exercise: required / optional / not used (AC-PTF-7)

- Red first, recorded before any fix:
  - `src/domain/training/__tests__/weight-mode.unit.test.ts:1:34` — `TS2307: Cannot find module '../weight-mode'`
    — suite failed to run (the module did not exist).
  - `src/infra/ai/tools/__tests__/log-set.weight-input.unit.test.ts:5:37` — `TS2305: Module
    '"@domain/training/types"' has no exported member 'WeightMode'`; `log-set-test-support.ts:49:53` —
    `TS2353: 'exerciseRepository' does not exist in type 'LogSetToolDeps'` — suites failed to run.
  - `src/infra/ai/prompts/blocks/__tests__/training-facts.unit.test.ts:295:32` — `Expected substring:
    "- Seated Leg Curl [id …] — plan 3×15 (bodyweight; weight optional) — nothing yet"`, rendered line had
    no mode note. Red-run summary over the touched suites: Test Suites: 4 failed, 177 passed, 181 total;
    Tests: 1 failed, 1762 passed.
  - integration, first DB run: `exercise-weight-mode.integration.test.ts:86:32` — `Expected length: 2,
    Received length: 1` — the backfill extraction read only the second UPDATE (the first shared its
    statement chunk with the migration's comment header), so the bodyweight rows stayed `required`.
- Implementation:
  - Migration `drizzle/0024_flawless_felicia_hardy.sql` (`npm run drizzle:generate` + hand-written
    backfill): `exercises.weight_mode text NOT NULL DEFAULT 'required'` with the check
    (`required|optional|none`); backfill in the same migration — equipment `bodyweight` → `optional`,
    category `cardio` or equipment `none` → `none` (cardio wins over bodyweight), everything else keeps
    the default `required` (the Gravitron included — machine). Journal + meta snapshot updated by
    drizzle-kit.
  - Domain: `WeightMode` on `Exercise` (`types.ts`); `deriveWeightMode(category, equipment)` in
    `domain/training/weight-mode.ts` — one rule in code, applied by `exercises.seed.ts` on insert for
    fresh databases.
  - `log_set` (`log-set.tool.ts`): T6's blanket refine removed. The tool resolves the target exercise
    first — an id verbatim, a name through `resolveExerciseIdByName` (resolved once; the resolved id
    rides along so the service does not resolve the name twice; a resolution failure keeps the pre-T7
    pass-through path and the service reports the error). Then, by the row's `weight_mode`: `required` +
    reps without a weight → `llmError("<exercise>: weight is required")`; `optional` + reps without a
    weight → `functional_reps`, with a number → `strength`; `none` → the weight never enters setData;
    `weight: 0` still means a bodyweight set on any mode (T4). The resolution runs inside the handler's
    try, so a DB failure keeps the `systemError` classification.
  - Tool texts (facts only, weight describe verbatim from this plan): weight describe → "Weight in
    kilograms (kg). Required for exercises that use a weight; optional for bodyweight exercises
    (omitted = bodyweight, a number = added load); not used for cardio."; the description bodyweight
    line → "For bodyweight exercises: provide reps and optionally a weight — omitted = a bodyweight set,
    a number = added load."
  - Training context: `ExerciseHistory.weightMode` (null = catalog row unknown), filled by the phase
    loader in `graph/phases/training.spec.ts` (started exercise's catalog row, or the
    `findByIdsWithMuscles` lookup it already made for not-started plan exercises); the Today plan line
    names the mode only when it is not `required`: `— plan 3×6-8 (bodyweight; weight optional) — …` /
    `— plan 2×45 s (weight not used) — …`.
  - Test DB (`src/app/test/setup.ts`): the four seeded exercises carry their derived modes
    (Barbell Bench Press / Barbell Back Squat `required`, Pull-ups `optional`, Running `none`).
  - Scenario fixture: `b-full-workout.scenario.ts`'s two Pull-ups plan lines gain
    `(bodyweight; weight optional)` — the deliberate T7 rendering; no other scripted line or log_set
    call changed (all scripted calls already pass a weight or a duration).
  - Files beyond the plan's ownership list, touched to compile/wire the feature: the phase loader
    `graph/phases/training.spec.ts` (also passes `exerciseRepository` into the tool), `weightMode`
    fixture fields in ten unit-test files, `log-set-test-support.ts` (repo mock), the tool-surface test
    and two integration call sites (the new tool dependency).
- Migration on the test DB (inside the flock): `NODE_ENV=test npx drizzle-kit migrate` printed
  "migrations applied successfully!" but applied nothing — `fitcoach_test` has no drizzle journal
  (jest rebuilds `public` per file from the .sql files; no `drizzle.__drizzle_migrations` exists) and
  the command left no trace anywhere. 0024 was therefore applied by executing its four statements on
  the standing 0023 schema inside the same lock: `0024 applied: 4 statements`; standing rows after the
  backfill — Barbell Bench Press `required`, Barbell Back Squat `required`, Running `none`,
  Pull-ups `optional`. Every jest DB file re-applies 0024 from the file anyway (setup.ts), and the new
  `exercise-weight-mode.integration.test.ts` replays the migration's own UPDATE statements against
  inserted pre-migration rows (Gravitron/machine → `required` included) inside a rolled-back
  transaction.
- One wasted DB run (worker mistake, recorded for honesty): I edited the migration SQL and the new
  integration test while a diagnostic integration run was executing; the migration file held a broken
  quote for ~1 minute and every suite whose per-file schema reset fell in that window failed
  (`syntax error at or near "none"`, 113 failures in c-catch-up). Both files were fixed before the
  final run; the final runs quoted below are from the fixed tree.
- Snapshots updated deliberately (listed per plan): `evals/snapshots/__tests__/__snapshots__/
  tool-surface.unit.test.ts.snap` via `jest -u` — exactly the two strings in the training phase's
  log_set entry (tool description + weight property description), verified by reading the snapshot
  diff; nothing else moved.
- Verification (from `apps/server`):
  - `npm run check-all` → `✖ 1264 problems (0 errors, 1264 warnings)`; `tsc --noEmit` clean.
  - `npm run test:unit` → Test Suites: 183 passed, 183 total / Tests: 1828 passed, 1828 total /
    Snapshots: 62 passed, 62 total.
  - `DB_PORT=5999 npm run test:unit` (CI parity, no DB) → 183/183 suites, 1828/1828 tests.
  - `flock /tmp/fitcoach-testdb.lock … npm run test:integration` → Test Suites: 56 passed, 56 total /
    Tests: 1 todo, 663 passed, 664 total.
  - `flock /tmp/fitcoach-testdb.lock … npm run test:scenarios` → Test Suites: 23 passed, 23 total /
    Tests: 1 todo, 392 passed, 393 total.
