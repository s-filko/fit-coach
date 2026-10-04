# Plan and Tool Fixes — one active plan, empty search, weight carry-over tails

- Status: planned
- Parent: `docs/superpowers/plans/coach-simplification.md` (governing plan; this is a side plan of code-only fixes
  found in the D15 live review and the 2026-10-04/05 findings). Branch `plan/plan-and-tool-fixes`, cut from `dev`.
- Executor: one independent worker on a remote machine; picks the plan up from git. Server code is in
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
5. One commit per task (`fix(<area>): … (plan-and-tool-fixes T<N>)`), no attribution lines. Push the branch to
   origin after each task so progress is visible. Never merge into `dev`, never deploy, never touch the VPS.
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

## 2. Close (worker)

All four tasks committed and pushed, then from `apps/server`:
`npm run check-all` (0 errors), `npm run test:unit`, `npm run test:integration`, `npm run test:scenarios` — paste
the summary lines into § 3. If the machine has no test database, say so in § 3 instead of skipping silently.
Do not change `Status:`; review, merge and deploy are the orchestrator's.

## 3. Worker log (append; newest last)

