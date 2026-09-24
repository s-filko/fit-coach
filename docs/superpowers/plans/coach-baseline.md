# Coach Baseline (Roadmap U1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans and
> test-driven-development. Execute only the task you were dispatched. Steps use checkbox (`- [ ]`)
> syntax. Red files (`*.repro.test.ts`) are committed **failing** on purpose — never "fix" a red
> test by changing its assertion.

- Status: planned
- Branch: plan/coach-baseline

**Goal:** a clean test runner and the coach roadmap's safety net: two red scenario tests that pin
BUG-022 and the hidden-overlapping-load defect, one eval draft rewritten for the post-R2.1
world, and the first data fix — recent-history queries count only real workouts.

**Spec:** `docs/superpowers/specs/2026-09-24-coach-roadmap.md` — unit U1 = steps R0.1–R0.4 + R1.1
(§ 3 Stage 0 and Stage 1), rules § 2. Design background:
`docs/superpowers/specs/2026-09-24-session-planning-redesign-design.md`.

**Architecture:** production code changes only in Task 1 (test teardown/runner) and Task 4
(one repository filter + two callers). Tasks 2–3 add red tests that stay red after this plan:
they are the acceptance tests of later units (R0.1 → U5 `transition-handoff`, R0.2 → U3
`muscle-centric-history`). Real repositories over the local test DB; only the chat model is
scripted (`tests/integration/scenarios/scripted-model.ts`).

**Tech Stack:** TypeScript, jest 30 + ts-jest, Drizzle ORM over Postgres (`fitcoach_test`),
LangGraph conversation graph.

## Global Constraints

- Work only in the plan worktree; commands run from `apps/server`.
- **Never run jest in two worktrees against `fitcoach_test` at once**; never touch a DB by hand.
- Red files live outside the default suites: `*.repro.test.ts`, run with
  `RUN_DB_TESTS=1 NODE_ENV=test npx jest --testMatch='**/*.repro.test.ts'` (the "repro glob").
  Before this plan the repro glob shows **2 failing suites** (BUG-027, BUG-030).
- No live LLM calls, no eval runs (drafts are edited, never run).
- Docs are English-only; commit messages end with the attribution trailer the orchestrator gives.
- `npm run check-all` must be clean at the end of every task.

## Acceptance

| ID | Roadmap | Observable evidence | State after this plan |
|---|---|---|---|
| AC-CB-1 | — (owner decision 2026-09-24) | `npm run test:unit`, `test:integration`, `test:scenarios` exit **0** after an all-green run and **non-zero** when a test fails; no `libc++abi … mutex lock failed` | green |
| AC-CB-2 | R0.1 | In `session_planning` the user reports a set; the scripted model calls `log_set`; after the turn `session_sets` holds 110 kg × 12 | **red** (U5 turns it green) |
| AC-CB-3 | R0.2 | Training context for today's bench names yesterday's overhead press (overlapping triceps / front delts) with its date | **red** (U3 turns it green) |
| AC-CB-4 | R0.3 + R1.1 | Only real workouts (owner, 2026-09-24: `completed` **and** ≥1 logged set) appear in the recent history of `session_planning` and `chat`; `skipped`, `planning`, `in_progress` and a completed-but-empty session do not; `daysSinceLastWorkout` is computed from the last real workout's `completedAt` | green |
| AC-CB-5 | R0.4 | Eval draft LS-0001 expects `log_set` (post-R2.1 world) and still parses | draft, not run |

## Owner decisions (2026-09-24)

- The exit-134 runner fix is Task 1 of this plan, not a separate plan.
- **Real workout = `status = 'completed'` and at least one logged set.** An explicit "закончил"
  with nothing logged ends `completed` via `completeSession` (`training.service.ts:243`), so the
  status alone is not enough.

## Decided without the owner (2026-09-24) — for review

| # | Decision | Why |
|---|---|---|
| D-1 | The filter is an optional argument of the existing `findRecentByUserIdWithDetails`, not a new port method; only the two history callers pass it. | `getActiveSession` (`training.service.ts:282`) **needs** `planning` rows from the same query; `getTrainingHistory` feeds the frozen mini-app route (`session.routes.ts:389`) — both stay unchanged. |
| D-2 | R0.4 (LS-0001) is folded into Task 2 — same bug (BUG-022), a one-line data change. | Task right-sizing; no reviewer would accept one and reject the other. |
| D-3 | The R0.1 script's call order is not part of the contract: U5 may reorder the scripted answers (e.g. a transition call before `log_set`); the assertion on `session_sets` may not change. | The graph shape is U5's decision; the observable outcome is BUG-022's. |

---

### Task 1: Test runner exits with the real result (AC-CB-1)

**Background.** After an all-green run, `test:scenarios`, `test:integration` and even a plain
`npx jest --ci` unit run end with `libc++abi: terminating … mutex lock failed` and exit **134**
(`docs/BACKLOG.md`, two entries: "Integration runner exits 134 after an all-green run" and the
2026-09-21 `test:scenarios` one). Proven pre-existing on clean `dev`. Suspects, unverified:
`@huggingface/transformers` (onnxruntime native session never released) and the pool close in
`src/app/test/teardown.ts`. This task is diagnostic: the code of the fix follows from the cause.

**Files:**
- Investigate: `src/app/test/teardown.ts`, `src/app/test/setup.ts`, `jest.config.cjs`, the
  embedding service (`grep -rn "@huggingface/transformers" src`)
- Modify: whichever of them holds the cause (expected: one of the above)
- Modify: `docs/BACKLOG.md` — remove both exit-134 entries in the same commit

**Forbidden fixes** (they hide the code instead of fixing it): `|| true`, a wrapper script that
maps 134 to 0, `process.exit(0)` in teardown, `--forceExit` alone if the abort persists,
skipping the suites that load the embedding model.

- [ ] **Step 1: Reproduce and record.** Run each and record the exit code:
  `npm run test:unit; echo "exit=$?"`, `npm run test:integration; echo "exit=$?"`,
  `npm run test:scenarios; echo "exit=$?"`. Expected today: all tests pass, `exit=134`.
- [ ] **Step 2: Narrow.** Run single files (`npx jest <file>; echo $?`) — one pure unit file
  with no embedding import, one that imports the embedding service, one DB integration file —
  until one import or one teardown step is shown to cause the abort. Write the finding (cause,
  evidence command, output line) into the commit message body.
- [ ] **Step 3: Fix at the cause** (e.g. release/dispose the native session in teardown, or
  keep the native module out of processes that do not need it). Minimal change.
- [ ] **Step 4: Verify green exits 0.** The three commands from Step 1 → `exit=0`, no `libc++abi` line.
- [ ] **Step 5: Verify red exits non-zero.** Temporarily add
  `it('canary', () => expect(1).toBe(2));` to any unit file, run `npm run test:unit; echo $?`
  → non-zero, not 134; remove the canary (never committed).
- [ ] **Step 6:** `npm run check-all` clean; commit
  `fix(test): runner exit code reflects the result — <cause in 5 words> (AC-CB-1)`.

**Verification (orchestrator re-runs at acceptance):** the three commands of Step 1 → `exit=0`.

---

### Task 2: BUG-022 red — a set reported while planning is logged (AC-CB-2, AC-CB-5)

**Background.** Live 2026-09-21 (`BUGS.md` BUG-022): in `session_planning` the user reported
"ноги 110кгх12 первый подход", "второй подход повторил"; `log_set` does not exist in that phase,
so nothing was stored while the reply implied it was. After U5 (R2.1) the turn will hop to
`training` and log there. This test pins the outcome, not the route.

**Files:**
- Create: `tests/integration/scenarios/planning-set-logging.repro.test.ts`
- Modify: `evals/datasets/drafts/session-2026-09-21.jsonl` — line `LS-0001` only

**Interfaces (existing, reuse — do not copy):**
- `evals/scenarios/b-full-workout.scenario.ts`: `sharedPast`, `setupSteps` (steps 0–1 reach
  `session_planning` with a proposal; step 2 "да, поехали" starts training — **not** used here).
- `runScenario(scenario, { onAdvance, onStep })` from `evals/lib/run-scenario.ts` →
  `ScenarioRunResult { userId, planId, t0, steps }`.
- `installScriptedModel()` → handle with `enqueueChat(script)`, `drainChatInputs()`; the run
  pattern is `runJourney` in `c-catch-up-logging.integration.test.ts:101-126` (fake timers,
  `jest.setSystemTime`, `REAL_TIMER_APIS`) — follow it.
- Tables: `sessionSets`, `sessionExercises`, `workoutSessions` from `@infra/db/schema`.
- Bench Press id: `BENCH_PRESS_ID` (exported by the B scenario module).

- [ ] **Step 1: Write the red test.**

```ts
/**
 * REPRODUCTION (RED) — AC-CB-2 / BUG-022 (roadmap R0.1). Runs only via the repro glob; promoted to
 * a regular scenario test when U5 `transition-handoff` (R2.1) lands.
 *
 * In session_planning the user reports a set. Today the phase has no log_set tool, so the call is
 * rejected and nothing is stored. The script order may be changed by U5 (D-3); the
 * assertion on session_sets may not.
 */
const SET_REPORT = 'второй подход повторил 110×12';

const planningSetScenario: Scenario = {
  id: 'r01-planning-set-logging',
  description: 'a set reported during session_planning is stored (BUG-022)',
  past: sharedPast,
  steps: [
    ...setupSteps.slice(0, 2), // chat → session_planning → proposal; training NOT started
    {
      action: 'user',
      text: SET_REPORT,
      script: [
        { toolCall: { name: 'log_set', args: { exerciseId: BENCH_PRESS_ID, reps: 12, weight: 110 } } },
        { text: 'Записал второй подход: 110 × 12.' },
      ],
      expect: {},
    },
  ],
};

it('stores the set reported during planning', async () => {
  const sets = await db
    .select({ setData: sessionSets.setData })
    .from(sessionSets)
    .innerJoin(sessionExercises, eq(sessionSets.sessionExerciseId, sessionExercises.id))
    .innerJoin(workoutSessions, eq(sessionExercises.sessionId, workoutSessions.id))
    .where(eq(workoutSessions.userId, result.userId));

  expect(sets.map(s => s.setData)).toContainEqual(expect.objectContaining({ reps: 12, weight: 110 }));
});
```

  Add one **control** test that passes today: `result.steps` of the last user step reports
  phase `session_planning` before the set step (proves the setup reached planning, so the red
  is for the stated reason). Match `expect: {}` to whatever `ScenarioSchema` requires — parse it
  with `ScenarioSchema.parse` as `c-catch-up` does.
- [ ] **Step 2: Run red.**
  `RUN_DB_TESTS=1 NODE_ENV=test npx jest --testMatch='**/planning-set-logging.repro.test.ts'`
  Expected: control passes; `stores the set…` FAILS with an empty/missing set (not a setup
  error, not a schema error). Paste the failure line into the commit body.
- [ ] **Step 3: Rewrite LS-0001 for the post-R2.1 world.** In that one JSON line only:
  `expect.tools` → `{"must":["log_set"]}` (drop `mustNot`); drop `expect.text.mustNotMatch`
  (a "записал" is truthful once the set is logged; the "no claim of anything unlogged" rule
  stays with judge `LS-J1`); add tag `"post-R2.1"`; set `provenance.addedBy` to
  `"session-2026-09-21-repro Task 5; expectation rewritten by coach-baseline Task 2 (R0.4) — log_set happens in the training hop"`.
  Keep `phase`, `state`, `input`, `judge` as they are.
- [ ] **Step 4: Validate the draft file.**

```bash
npx tsx -e "import {readFileSync} from 'fs'; import {EvalCaseSchema} from './evals/schema/case.schema'; for (const l of readFileSync('evals/datasets/drafts/session-2026-09-21.jsonl','utf8').trim().split('\n')) EvalCaseSchema.parse(JSON.parse(l)); console.log('ok')"
```
  Expected: `ok`.
- [ ] **Step 5:** `npm run check-all` clean; commit
  `test(repro): BUG-022 — set reported while planning is not stored (AC-CB-2, R0.1, R0.4)`.

**Verification:** Step 2 command → exactly one failing test (the red), control green; Step 4 → `ok`.

---

### Task 3: Hidden overlapping load red (AC-CB-3)

**Background.** Training shows exactly one "previous session", chosen by exact `session_key`
(`training.spec.ts:104-109`, `findLastCompletedByUserAndKey`). A hard session yesterday on
overlapping muscles under a different key is invisible when today's exercise is bench.
Template: `tests/integration/scenarios/previous-session.repro.test.ts` (BUG-030) — same wiring
(`buildRealTrainingService`, `buildTrainingSpec(...).loadContext`, pinned `NOW`, direct inserts
into `workoutSessions`). Reuse its `seedSession`/`datePattern` approach; if you need them in both
files, move them to a shared helper in `tests/integration/scenarios/` and import from both
(no copy).

**Files:**
- Create: `tests/integration/scenarios/overlapping-load.repro.test.ts`
- Possibly create: `tests/integration/scenarios/session-seed.ts` (shared helper, see above)

**Seed (all dates explicit, `NOW = 2026-09-24T09:30:00Z`):**
- Test-local exercise **Overhead Press** inserted into `exercises` (copy the column set of the
  seed rows in `src/app/test/setup.ts:71-80`; `ON CONFLICT DO NOTHING` with a fixed UUID) and
  `exercise_muscle_groups`: `shoulders_front` primary, `triceps` secondary. Bench Press already
  has `triceps` and `shoulders_front` as secondary.
- `upper_a`, completed **2026-09-17**: Bench Press 3 × 8 @ 80 kg (the load anchor).
- `shoulders_b`, completed **2026-09-23** (yesterday): Overhead Press 5 × 6 @ 55 kg.
- Today: `upper_a`, `in_progress`, **2026-09-24**, Bench Press as its current exercise
  (`session_exercises` row, `status: 'in_progress'`).

**Render:** every block of the training spec, joined — this is what the model sees:

```ts
const spec = buildTrainingSpec(/* deps as in previous-session.repro.test.ts */ as never);
const loaded = await spec.loadContext({ userId, user: null, activeSessionId: todayId }, deps as never);
if (!loaded.ok) throw new Error(loaded.reply);
const ctx = { now: NOW, timezone: 'Asia/Manila', user: null };
const context = spec.contextBlocks.map(b => b.render(loaded.data, ctx, 0)).filter(Boolean).join('\n');
```

- [ ] **Step 1: Write the tests.** Control (passes today): `context` contains
  `Barbell Bench Press` and the 2026-09-17 date. Red 1: `context` contains `Overhead Press`.
  Red 2: `context` matches `datePattern('2026-09-23')`.
- [ ] **Step 2: Run red.**
  `RUN_DB_TESTS=1 NODE_ENV=test npx jest --testMatch='**/overlapping-load.repro.test.ts'`
  Expected: control green; both reds FAIL because the text lacks the overhead press (not a
  seed or render error). If the helper was extracted, also run
  `--testMatch='**/previous-session.repro.test.ts'` → same pass/fail split as before (1 control
  green, its reds red).
- [ ] **Step 3:** `npm run check-all` clean; commit
  `test(repro): yesterday's overlapping load is hidden from training (AC-CB-3, R0.2)`.

**Verification:** Step 2 commands.

---

### Task 4: Recent history counts only real workouts (AC-CB-4)

**Background.** `WorkoutSessionRepository.findRecentByUserId`
(`src/infra/db/repositories/workout-session.repository.ts:126`) filters by user only, so
`skipped`, `planning` and `in_progress` rows enter "recent sessions" and drive
`daysSinceLastWorkout` (`session-planning-context.builder.ts:34-40`, which also falls back to
`createdAt`). History callers: `session-planning-context.builder.ts:32` and
`chat.spec.ts:46`. **Not** to be changed (D-1): `training.service.ts:282`
(`getActiveSession` needs `planning` rows) and `:288` (`getTrainingHistory`, mini-app route).

**Files:**
- Create (red first): `tests/integration/database/recent-history-status.repro.test.ts`,
  renamed to `recent-history-status.integration.test.ts` in Step 5
- Modify: `src/domain/training/ports/workout-session.ports.ts:25-26`
- Modify: `src/infra/db/repositories/workout-session.repository.ts:126-145`
- Modify: `src/domain/training/services/session-planning-context.builder.ts:32`
- Modify: `src/infra/ai/graph/phases/chat.spec.ts:46`
- Modify: `docs/BUGS.md` — new entry `BUG-031` at the end

**Interfaces:**
- Produces:
  ```ts
  // workout-session.ports.ts
  export interface RecentSessionsFilter {
    /** Only real workouts: status 'completed' AND at least one session_sets row (owner, 2026-09-24). */
    realWorkoutsOnly?: boolean;
  }
  findRecentByUserId(userId: string, limit: number, filter?: RecentSessionsFilter): Promise<WorkoutSession[]>;
  findRecentByUserIdWithDetails(userId: string, limit: number, filter?: RecentSessionsFilter): Promise<WorkoutSessionWithDetails[]>;
  ```
  No `filter` = today's behaviour exactly.

- [ ] **Step 1: File BUG-031** in `docs/BUGS.md`, format of BUG-030: title "Recent history and
  'days since last workout' count skipped and unfinished sessions"; evidence = the query at
  `workout-session.repository.ts:126` and the two callers; severity Medium; Status: open; link
  AC-CB-4. Include the owner's definition of a real workout.
- [ ] **Step 2: Write the red test** over the real DB (`buildRealTrainingService` from
  `tests/helpers/training-service`): one user; `completed` 2026-09-20 **with one set**; `completed`
  2026-09-21 **with no sets**; `skipped` 2026-09-22; `planning` 2026-09-23; `in_progress` 2026-09-23 (insert directly as the BUG-030 repro does —
  the one-in-progress partial index allows one). Pin `Date.now` to `2026-09-24T09:30:00Z`
  (`jest.useFakeTimers({ doNotFake: [...] })` + `setSystemTime`, as the scenarios do).
  Assertions:
  - `new SessionPlanningContextBuilder(planRepo, sessionRepo).buildContext(userId)` →
    `recentSessions` is exactly the 2026-09-20 session, `daysSinceLastWorkout === 4`
    (from its `completedAt`, not `createdAt`).
  - `buildChatSpec(deps).loadContext(...)` → `data.recentSessions` is exactly the 2026-09-20 one.
  - Control (green today and after): `trainingService.getActiveSession(userId)` still returns
    the `in_progress` session.
- [ ] **Step 3: Run red** —
  `RUN_DB_TESTS=1 NODE_ENV=test npx jest --testMatch='**/recent-history-status.repro.test.ts'`
  → the two history assertions FAIL (extra sessions), control green. Commit the red alone:
  `test(repro): recent history counts skipped/unfinished sessions (BUG-031, AC-CB-4, R0.3)`.
- [ ] **Step 4: Fix.** Repository: when `filter?.realWorkoutsOnly`, the `where` becomes
  `and(eq(userId), eq(status, 'completed'), exists(<select 1 from session_exercises join
  session_sets on … where session_exercises.session_id = workout_sessions.id>))` — one query,
  so `limit` counts real workouts only; pass `filter` through `findRecentByUserIdWithDetails`.
  Callers: pass `{ realWorkoutsOnly: true }` at `session-planning-context.builder.ts:32` and
  `chat.spec.ts:46`. Update in-memory fakes that
  implement the port only if type-check requires it (the optional argument should not).
- [ ] **Step 5: Promote.** `git mv` the file to
  `tests/integration/database/recent-history-status.integration.test.ts`, drop "REPRODUCTION
  (RED)" from its header; mark BUG-031 `Status: fixed` with the commit.
- [ ] **Step 6: Run green.**
  `RUN_DB_TESTS=1 NODE_ENV=test npx jest --testMatch='**/recent-history-status.integration.test.ts'`
  → all pass; then `npm run test:unit` and `npm run test:integration` → exit 0 (Task 1 made the
  exit code meaningful). Update any prompt snapshot only if it changed **because** a
  non-workout session disappeared — say so in the commit body.
- [ ] **Step 7:** `npm run check-all` clean; commit
  `fix(history): recent history and days-since count only completed sessions (BUG-031, AC-CB-4, R1.1)`.

**Verification:** Step 6 commands.

---

### Task 5: Close-out, deploy, live check (orchestrator — not delegated)

- [ ] **Acceptance of the whole branch:** `npm run check-all`; `npm run test:unit`,
  `npm run test:integration`, `npm run test:scenarios` → each exit 0; repro glob → exactly
  **4 failing suites**: BUG-027, BUG-030 (pre-existing), `planning-set-logging`,
  `overlapping-load` — each failing only in its red tests.
- [ ] **Close-out review** via the `close-out-review` skill (one review for the unit; test-heavy
  diff → one combined agent unless the diff says otherwise). Record it in `## Review`.
- [ ] `Status: done` before merge; merge into `dev`; push; deploy dev
  (`ssh filko.dev "cd /srv/docker/fitcoach && ./deploy/deploy.sh dev"`), `/health` → 200.
- [ ] **Live check (owner, ≤5 messages to `@MyFitAiCoachDevBot`).** Dev had no skipped session
  among the owner's last 8 (checked 2026-09-24), so one is created first:
  1. "хочу потренироваться" → 2. "погнали" (session starts) → 3. "всё, закончил" with no set
     logged. The orchestrator confirms read-only that this session ended with 0 sets
     (`completed` or `skipped` — both are excluded).
  4. "что я делал на этой неделе?" → **expected:** the reply lists the completed sessions of
     2026-09-20/21 (and later, if any) and does **not** mention today's empty session; no
     "0 дней назад" computed from it.
- [ ] Mark U1 `done` in the roadmap § 6 and mirror in `docs/STATE.md`; `node scripts/state.mjs --write`
  and `--check`; clean up worktree/branch per `CLAUDE.md` § Rules.

## Review

_(filled at close-out)_
