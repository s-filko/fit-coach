# Training Journey Scenarios — Deterministic over the Real Test DB + Live L3 Implementation Plan

- Status: planned
- Branch: plan/training-journey-scenarios
- After: structured-output-json-object-mode

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans and superpowers:test-driven-development. One plan task per worker session; stop after the task.

**Goal (owner, 2026-09-20):** several tests that reproduce a whole training journey end to end —
"привет" → session planning → the person trains (sets across exercises, a question mid-workout, a
pause) → finishes — with **past events already in place** (previous workouts, a saved plan, facts,
older conversation). **Mandatory: a real test database.** Two layers share one scenario definition:
(1) deterministic — a scripted model on the production-wired graph over the real test Postgres,
asserting at every step what the model **saw**, what got **persisted** and what was **delivered**;
(2) live — the same scenarios as a multi-turn L3 eval level, authored now, run only by the owner.
Owner rule: reproduction before fixes — assertions that fail today are committed as `test.failing`.

**Why a real DB (not only the owner's requirement):** the eval stub world (`evals/lib/build-stub-deps.ts`)
is not stateful — a started session never reaches `getSessionDetails`, `searchByEmbedding` returns
`[]` — so a full journey cannot run on it. No test runs the real graph against a real DB today.

**Findings this plan builds on (verified 2026-09-20, paths under `apps/server/`):**
- Flow: chat → session_planning via `request_transition` (`tools/request-transition.tool.ts:28-50`);
  session_planning → training via `start_training_session` (`tools/start-training-session.tool.ts:63-97`:
  session `planning`, `pendingTransition training`, `activeSessionId`); training → chat via
  `finish_training` (`tools/finish-training.tool.ts:21-72`); in between `log_set`,
  `complete_current_exercise`, `delete_last_sets`, `update_last_set` (`graph/phases/training.spec.ts:55-87`).
  Commit applies transitions (`commit.node.ts:89-172`); `session-lifecycle.handler.ts:20-43` sets
  `in_progress`/completes; `prepare.node.ts:55-89` returns a training run to chat if the session ended.
- Past workouts reach the model through `WorkoutSessionRepository.findRecentByUserIdWithDetails`
  (`infra/db/repositories/workout-session.repository.ts:123`, ordered by `createdAt` — seeds need
  explicit timestamps) and `findLastCompletedByUserAndKey` (`:221`); blocks: chat "RECENT TRAINING
  HISTORY (last 5 sessions)", session_planning RECENT TRAINING HISTORY / RECOVERY TIMELINE / active
  plan `[ID:…]`, training WORKOUT OVERVIEW / STALE SESSION (> 2 h) / PREVIOUS SESSION. Wall-clock
  reads (not `ctx.now`): `daysSinceLastWorkout` (context builder :40), `finish_training` staleness (:34).
- DB tests: `npm run test:integration` (`RUN_DB_TESTS=1`); `src/app/test/setup.ts:36-150` drops and
  recreates schema `public`, applies `drizzle/*.sql` once per file, seeds 4 exercises. `.env.test`
  → `DB_NAME=fitcoach_test` (the local dev DB is `fitcoach_dev` — never touched).
- Composition root `registerInfraServices` (`src/main/register-infra-services.ts:74-128`) wires the
  real repositories, `PostgresSaver`, gateway, graph and the mutex-wrapped runner; the graph itself
  is not exposed. CI (`.github/workflows/ci.yml:61`) has no Postgres.
- Reusable: `graph-test-support.ts` (`USER`, `ctxConfig` with controlled `now`); the scripted model
  beneath the real gateway in `user-facts.scenario.unit.test.ts`; `run-case.ts` seeding via
  `graph.updateState` (:160-178); `ModelInputRecorder`, `ToolRecorder`; case-schema pieces
  (`FixtureUserSchema`, `FixtureFactSchema`, `StateMessageSchema`, `toBaseMessages`). L3 is specified
  (`docs/PROMPT_EVAL_FRAMEWORK.md:36`) but not built.

**Architecture:**
- **One scenario format** — a zod-validated TS module per scenario in `evals/scenarios/`: `past`
  (user, active plan, dated workouts with exercises/sets, facts, checkpoint conversation incl.
  summaries and `lastUserMessageAt`) + `steps[]` (`advance` relative time, `user` text, `script` for
  the deterministic layer only, `expect`: `seen` / `tools` / `phaseAfter` / `delivered` / `persisted`,
  each assertion optionally tagged `knownBug: "BUG-018/AC-CC-1"`). Relative times (`-3d`, `+6h`)
  from `T0`.
- **One runner** `evals/lib/run-scenario.ts` for both layers: `registerInfraServices(new Container())`
  (real wiring), seed real rows (user, extra exercises `ON CONFLICT`, plan, sessions/exercises/sets
  with explicit timestamps, facts via `UserFactsRepository.upsertMany`) and the checkpoint via
  `graph.updateState`; each step through `ConversationRunPort.run`; per step it observes the
  delivered text, the `conversation_runs` row (tools, transition), the phase (`getState`) and a DB
  snapshot of the user's sessions. **Hard guard: refuses to run unless `DB_NAME` ends in `_test`.**
- Isolation: a random user UUID per scenario (`thread_id` = `userId`); schema reset per file (setup.ts).
- Clock: `jest.setSystemTime` with Date-only fake timers (`advanceTimers: true`, timer APIs in
  `doNotFake`) — spiked in Task 2; fallback is an optional `now` seam on the runner deps.
- Deterministic test shape: `beforeAll` runs the journey once and stores observations; each
  assertion is its own `test`, or `test.failing` when it carries `knownBug` (the scripted model
  ignores its input, so the flow is identical with or without the bug).

**Spec:** `docs/PROMPT_EVAL_FRAMEWORK.md` §2 (L3), §7a (guard); ADR-0013 §3.3/§3.4; BUG-018;
`docs/superpowers/plans/chat-continuity.md` AC-CC-1..3.

**Acceptance criteria:**
- **AC-TJ-1** — one scenario format with a schema unit test; scenarios A, B, C authored in it.
- **AC-TJ-2** — each scenario has a deterministic test over the real test DB with past events seeded
  as rows + checkpoint, asserting seen / persisted / delivered at every step.
- **AC-TJ-3** — every assertion failing today is `test.failing` whose failure names the bug; all
  others pass.
- **AC-TJ-4** — `--level L3` runs the same scenario modules live, gated by `RUN_LLM_EVALS=1` + a call
  ceiling (steps × samples) + the `_test` DB guard; proven by a unit test only (never run by a task).
- **AC-TJ-5** — `npm run test:scenarios` runs the deterministic layer; not part of `test:unit` or
  pre-commit.

## Global Constraints

- `RUN_LLM_EVALS` / `EVALS_FULL_RUN` never set; no real-model call in any task. Only the model is
  mocked; repositories, services, gateway and checkpointer are real.
- The local DB container is started by the orchestrator (`docker compose up -d db` from the repo
  root); tests use `.env.test` (`fitcoach_test`). Never write any `.env*`.
- Reserved to the orchestrator: push, merge, deploy, `npm run db:*`, `docker compose`, CI workflows,
  durable specs, `docs/STATE.md`, `docs/BUGS.md`, any `Status:`.
- **Coordination with `chat-continuity`:** its fix tasks (1–3) start only after this plan's Tasks
  1–3 (format, runner, journey A) are accepted — the owner wants the DB-backed reproduction first.
  Each chat-continuity fix then also flips the matching `knownBug` cases here to `test`.

---

### Task 1: Scenario format (AC-TJ-1, format)

**Files:** `evals/schema/case.schema.ts` (export the reused sub-schemas), `evals/schema/scenario.schema.ts`
(+ relative-time parser), `evals/schema/__tests__/scenario.schema.unit.test.ts`.

- [ ] Tests first: a valid scenario, invalid ones, time parsing (`-3d`, `+6h`, `-14h`), the
  `knownBug` format. Implement.
- [ ] Commit `test(evals): scenario format for multi-turn training journeys (AC-TJ-1)`. STOP.

**Verification:** `npx jest --ci evals/schema` → pass; `npm run test:unit` → green; type-check clean.

### Task 2: DB world + runner (AC-TJ-2, infra)

**Files:** `src/main/register-infra-services.ts` (register the compiled graph under a
`CONVERSATION_GRAPH_TOKEN`), `evals/lib/scenario-world.ts` (seeding), `evals/lib/run-scenario.ts`,
`tests/integration/scenarios/scripted-model.ts` (shared jest mock of `@infra/ai/model.factory`:
records every input; chat FIFO from step scripts; `structured()` returns a scripted or minimal valid
summary), `tests/integration/scenarios/harness.integration.test.ts` (smoke: one seeded workout, one
step — row, seen block, delivered text), `package.json` script
`"test:scenarios": "RUN_DB_TESTS=1 NODE_ENV=test jest --testMatch='**/tests/integration/scenarios/**/*.integration.test.ts'"`.

- [ ] **Spike first:** Date-only fake timers with `pg` and `PostgresSaver`; report in STOP (fallback:
  a `now` seam on the runner deps + the wall-clock reads listed in Findings).
- [ ] The `_test` DB guard with a unit test.
- [ ] Commit `test(ai): DB-backed scenario runner with a scripted model beneath the real gateway`. STOP.

**Verification:** `npm run test:scenarios` → green; `npm run test:unit` → green (quote the known
teardown exit 134 from BACKLOG if it occurs).

### Task 3: Journey A — greeting after a pause, with past workouts (AC-TJ-2/3)

Past: two completed workouts (−4d `upper_a`, −2d `lower_a`), an active plan, one fact, one stored
episode summary ("plan ready, pending save" style `openItems`), a one-turn chat exchange with
`lastUserMessageAt` 14 h back. Step: "привет"; the script writes the greeting text **and**
`request_transition(session_planning)` in one AI message, then a final text after the tool result.

**Files:** `evals/scenarios/a-greeting-after-pause.scenario.ts`,
`tests/integration/scenarios/a-greeting-after-pause.integration.test.ts`.

- Expected to pass today: `seen` — chat context lists both workouts with the right ages, GREETING
  directive, `## User Facts`, `## Previous episodes`; persisted — `conversation_turns` + run row with
  the transition; phase after — session_planning.
- `test.failing` today: the earlier exchange verbatim (AC-CC-1); the gap note before "привет"
  (AC-CC-2); the delivered text contains the greeting (AC-CC-3).
- [ ] Quote each failing case's real failure message in STOP (a case failing for another reason is
  not a reproduction).
- [ ] Commit `test(ai): journey A — greeting after a pause over the real DB (BUG-018 repro)`. STOP.

### Task 4: Journey B — a full workout, greeting to finish (AC-TJ-2/3)

Steps: "привет, хочу потренироваться" → session_planning; "давай верх" → proposal; "да, поехали" →
`start_training_session(upper_a, plan IDs)`; bench sets via `log_set` (one AI message carries both
"Записал!" and the tool call); pull-up sets (auto-completes bench); "всё, закончил" →
`finish_training`; "спасибо" in chat.

**Files:** `evals/scenarios/b-full-workout.scenario.ts`, `tests/integration/scenarios/b-full-workout.integration.test.ts`.

- Expected to pass: step 2 `seen` RECENT TRAINING HISTORY with the seeded weights, RECOVERY
  TIMELINE, plan `[ID:`; step 3 session `planning` → `in_progress` with `startedAt`; step 4 `seen`
  WORKOUT OVERVIEW + PREVIOUS SESSION with seeded weights; sets persisted in order; finish →
  `completed`, `durationMinutes`, `completedAt`; step 7 `seen` the new workout first in chat context.
- `test.failing` today: the previous turn not seen verbatim after each transition (AC-CC-1); step 4
  "Записал!" not delivered (AC-CC-3).
- [ ] Commit `test(ai): journey B — full workout with history over the real DB`. STOP.

### Task 5: Journey C — interrupted workout (AC-TJ-2/3)

Steps: two sets logged; a mid-workout question about rest time (text only); clock +3.5 h; "вернулся,
доделаю"; one more set; finish.

**Files:** `evals/scenarios/c-interrupted-workout.scenario.ts`,
`tests/integration/scenarios/c-interrupted-workout.integration.test.ts`.

- Expected to pass: the question answered, phase stays training; after the pause `seen` has STALE
  SESSION and a WORKOUT OVERVIEW still listing the pre-pause sets (from the DB); finish persisted.
- `test.failing` today: the mid-workout exchange not seen verbatim after the pause (AC-CC-1); the gap
  note missing (AC-CC-2).
- [ ] Commit `test(ai): journey C — interrupted workout over the real DB`. STOP.

### Task 6: Live layer L3 (AC-TJ-4)

**Files:** `evals/levels/l3.ts`, `evals/run.ts` (`--level L3 [--scenario id]`),
`evals/levels/__tests__/l3.unit.test.ts` (fake runner: gating, ceiling via
`planCallCount(steps, samples)`, the `_test` guard, per-step report with known-bug labels),
`evals/datasets/README.md`.

- The live layer ignores `script`, skips `seen`, reads tools from `conversation_runs`.
- [ ] Commit `feat(evals): L3 scenario level sharing the journey definitions (AC-TJ-4)`. STOP.

**Verification:** unit test green; `npm run evals -- --level L3` without the flag prints "skipped";
L0 green.

### Task 7: Close-out (orchestrator)

- [ ] `close-out-review`; `- Status: done`; `state.mjs --write`; merge, push.
- [ ] **Owner decision:** a CI job with a `pgvector` service running `npm run test:scenarios` (needs
  the embedding warm-up skipped in CI).
