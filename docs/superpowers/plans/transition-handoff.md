# Transition Hand-off (Roadmap U5) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans and
> test-driven-development. Execute only the task you were dispatched. Steps use checkbox (`- [ ]`)
> syntax. Never "fix" a red test by changing its assertion.

- Status: in progress
- Branch: plan/transition-handoff
- After: coach-baseline

**Goal:** a phase transition is answered by the phase it leads to, in the same run. A set
reported while planning ("сделал 2 подхода 110×12") opens training, and training logs it before
anything is confirmed — BUG-022 closed structurally. Then the same hand-off for chat →
`session_planning` ("что делать сегодня?" answered with the analysis at once).

**Spec:** `docs/superpowers/specs/2026-09-24-coach-roadmap.md` — unit U5 = steps R2.0–R2.2
(§ 3 Stage 2). Design: `docs/superpowers/specs/2026-09-24-session-planning-redesign-design.md` § 8.

**Architecture:** one conditional edge `commit → route` in `conversation.graph.ts`, taken only
when a transition was committed, its target is in `TRANSITION_HANDOFF_TARGETS` and the run has
not hopped yet (max 1 hop, no revisit). `prepare` does not re-run on the hop. The phase that
hands off stops right after the transition tool (no second model call, no text kept); the run's
hop facts live in the run context (`RunContext`), not in durable state. Flag empty = today's
graph, byte-for-byte.

**Tech Stack:** TypeScript, LangGraph conversation graph, jest 30 + ts-jest, Drizzle over
Postgres (`fitcoach_test`), scripted chat model (`tests/integration/scenarios/scripted-model.ts`).

## Gate (passed 2026-09-25)

- **Loop walkthrough** with the owner, on the R0.1 example — accepted, with four foreseen
  problems folded in as Tasks 1–5 (owner: "да, включай").
- **R2.0 provider probe — go.** Provider docs (OpenRouter tool-calling, Z.AI function-calling,
  Gemini thinking/signatures) do not say whether history may carry a call to a tool absent from
  the request's `tools`; so a probe, 2 calls total (`evals/COST_LEDGER.md`, 2026-09-25): system
  prompt of a training phase, history = human "сделал 2 подхода по 110×12 на жиме ногами" +
  AI `start_training_session` call + its tool result, tools = `log_set` + `finish_training`
  only. **Gemini `google/gemini-3.8-flash` via OpenRouter** (dev container, reasoning `low`):
  200, two `log_set` calls (110 × 12, order 1 and 2), 2.5 s. **Z.AI `glm-5.3`** (local `.env`):
  200, the same two calls, 7.1 s. The history AIMessage was fabricated (no Gemini thought
  signature) and still accepted; in the real loop it is the model's own output of the same run.

## Global Constraints

- Work only in the plan worktree; commands run from `apps/server`.
- **Never run jest in two worktrees against `fitcoach_test` at once**; use
  `/Users/filko/orca/workspaces/fit_coach/db-test-lock.sh` for DB suites; never touch a DB by hand.
- No live LLM calls in Tasks 1–5. The only model-backed run is the smoke in Task 6, run by the
  orchestrator.
- **Flag off must be today's behaviour.** Every existing test passes unchanged with
  `TRANSITION_HANDOFF_TARGETS` unset. New tests set the flag explicitly.
- Docs are English-only; commit messages end with the attribution trailer the orchestrator gives.
- `npm run check-all` must be clean at the end of every task.

## Acceptance

| ID | Roadmap | Observable evidence | Verification |
|---|---|---|---|
| AC-TH-1 | R2.1 / R0.1 | Flag `training`: in `session_planning` the user reports sets; the same run commits → training, training calls `log_set`; after the run `session_sets` holds 110 kg × 12 and the phase is `training` | `planning-set-logging` scenario (promoted from `.repro`) green |
| AC-TH-2 | R2.1 | The hand-off phase makes **no** model call after a successful transition tool, and no AI text of the hand-off phase is kept in `messages` or delivered; the user receives only the last phase's text | unit (executor / `afterTools`) + scenario assertions on `delivered` and the checkpoint |
| AC-TH-3 | R2.1 | One run = one `conversation_runs` row: `phase_in` = first phase, `phase_out` = last, `transition.path` = the phase path; transcript rows of the run have no duplicates, each row carries the phase that wrote it | scenario assertions over `conversation_runs` / `conversation_turns` |
| AC-TH-4 | R2.1 | The hop keeps the first commit's side effects: session `in_progress`, `activeSessionId` set, and the `phase_boundary` compaction flag is **not** cleared by the second commit | scenario + commit unit test |
| AC-TH-5 | R2.1 | The second hop's model call fails → the user gets the standard error text (never a set confirmation), a failed-run row is written, the committed transition stays (phase `training`, session `in_progress`); the next message is served by training | integration test with a scripted model that throws on the hop |
| AC-TH-6 | R2.2 | Flag `training,session_planning`: from `chat`, "что делать сегодня?" → `request_transition` → the same run answers from `session_planning`; one delivered text | scenario |
| AC-TH-7 | R2.1 live | Live smoke with the flag on: in planning "сделал 2 подхода 110×12" → training, both sets in `session_sets`, no unlogged claim; in planning "вчера делал 110×12 на жиме ногами" → stays in `session_planning`, no sets written | `npm run smoke` (orchestrator) |

## Decided without the owner (2026-09-25) — for review

| # | Decision | Why |
|---|---|---|
| D-1 | One env flag `TRANSITION_HANDOFF_TARGETS` (comma list of target phases; empty/unset = off) instead of two booleans | R2.1 and R2.2 roll back independently by editing one value; `training` alone = R2.1 |
| D-2 | Phase path goes into the existing `transition` jsonb (`{ toPhase, reason, path }`), no migration | `phase_in` / `phase_out` already hold both ends; a path column for a max-1-hop loop is premature |
| D-3 | Hop facts (`phasePath`, projected count, hop boundary index) live in `RunContext` (mutable per-run object like `metrics`) | they are run facts; durable state must not carry them into the next run (ADR-0013 §4.1) |
| D-4 | Negative case ("вчера делал…") is a live-smoke step plus one line in the planning tool/prompt, not a scripted test | it is a model-judgement case; a scripted model would only test the script |
| D-5 | The chat and planning transition tool results lose the "write a message to the user" wording **only** when their target is a hand-off target | with the flag off the hand-off phase must still write its reply (today) |

## Task 1 — Flag and silent hand-off (AC-TH-2, part)

**Files:** `src/config/index.ts` (flag, parse to `ConversationPhase[]`, pattern of
`COURSE_CHECK_ENABLED`), `src/infra/ai/graph/conversation.graph.ts` (thread the value into deps),
`src/infra/ai/graph/tool-executor.ts` (`afterTools`, `finish`), `src/infra/ai/tools/start-training-session.tool.ts:88-94`,
`src/infra/ai/tools/request-transition.tool.ts` (chat variant, `:30-35`).

- [ ] Config: `TRANSITION_HANDOFF_TARGETS`, default empty; unit test for parsing (unknown phase → config error).
- [ ] When a tool batch sets `pendingTransition` whose `toPhase` is a hand-off target, the phase
  subgraph ends after the tools node (no further `agent` call). Today `afterTools`
  (`tool-executor.ts:228`) ends only on a terminal AIMessage — extend it; keep the error-budget
  and system-error endings as they are.
- [ ] In that same case, the AIMessage that carried the transition call keeps its `tool_calls` but
  its text content is emptied (same message id, so the reducer replaces it) — nothing the hand-off
  phase wrote reaches the next phase or the user.
- [ ] Tool result wording (D-5): hand-off target → a neutral "Transition registered; the next
  phase answers the user." without "write a message"; otherwise today's text unchanged.
- [ ] Unit tests: flag off → subgraph path identical to today; flag on → `afterTools` returns END
  after `start_training_session`, and the carrier AIMessage has empty text.

**Verify:** `npm run test:unit -- tool-executor start-training-session request-transition config` and `npm run check-all`.

## Task 2 — The loop `commit → route` (AC-TH-1, AC-TH-3, AC-TH-4)

**Files:** `src/infra/ai/graph/conversation.graph.ts:137-145`, `src/infra/ai/graph/nodes/commit.node.ts`,
`src/infra/ai/graph/state.ts` (`RunContext`), `src/infra/ai/graph/episode.ts` (`runAiText`),
`src/infra/ai/graph/conversation-run.adapter.ts:151`,
`tests/integration/scenarios/planning-set-logging.repro.test.ts`.

- [ ] `commit` gets a conditional exit: to `route` when the verdict is ok, the target is a hand-off
  target, and `ctx.phasePath` has one entry (max 1 hop, no revisit); otherwise END. Keep
  LangGraph `recursionLimit` (adapter, 50) as the backstop.
- [ ] Incremental projection: each `commit` projects only messages of `current` it has not
  projected in this run (count kept in the run context), with its own phase label. Today it
  projects all of `current` (`commit.node.ts:76`) — the second commit would duplicate.
- [ ] One run row: a commit that loops does **not** call `recordRun`; the final commit writes it
  with `phaseIn` = `ctx.phasePath[0]`, `phaseOut` = last phase when a transition happened,
  `transition.path` (D-2), metrics and `toolCalls` of the whole run, `promptVersions` of every
  phase on the path.
- [ ] The final commit must not reset what the looping commit set: the `phase_boundary`
  `compactReason` and the handler-merged `activeSessionId` survive (today `commit` always returns
  its own `compactReason`, `commit.node.ts:170-178`, which would be `null` on the hop's commit).
- [ ] Delivery: `runAiText` returns only the texts after the hop boundary (index recorded by the
  looping commit) — the user gets the last phase's reply only. Flag off → unchanged (AC-CC-3).
- [ ] Promote `planning-set-logging.repro.test.ts` → `planning-set-logging.integration.test.ts`
  with the flag on; reorder its script for the hop (allowed by D-3 of `coach-baseline`: the
  script may change, the `session_sets` assertion may not). Add assertions: phase `training`,
  one run row with the path, no duplicate transcript rows, `delivered` has no planning text.
- [ ] Commit unit test: loop verdict, no `recordRun` on the looping commit, `compactReason` kept.

**Verify:** `npm run test:unit -- commit episode`, then through the lock
`npm run test:scenarios` (all green, including the promoted test) and the repro glob shows one
suite fewer than before (**5**). `npm run check-all`.

## Task 3 — Failure on the hop (AC-TH-5)

**Files:** a new `tests/integration/scenarios/handoff-failure.integration.test.ts`; code changes
only if the test shows a gap (adapter catch, `conversation-run.adapter.ts:160-190`).

- [ ] Scripted model: planning calls `start_training_session`; the training call throws a provider
  error. Assert: the delivered text is the standard error message (no "записал"/"saved"), one
  failed-run row, phase in the checkpoint = `training`, session `in_progress`.
- [ ] Next user message in the same test is served by `training` and its `log_set` is stored.

**Verify:** through the lock, `npm run test:scenarios -- handoff-failure`; `npm run check-all`.

## Task 4 — Chat → session_planning (R2.2, AC-TH-6)

**Files:** config value only (`training,session_planning`); tool wording from Task 1 already covers
the chat variant; a new scenario `tests/integration/scenarios/chat-to-planning-handoff.integration.test.ts`.

- [ ] Scenario with the flag `training,session_planning`: from `chat`, "что делать сегодня?" →
  `request_transition(session_planning)` → the same run's delivered text comes from
  `session_planning`; one run row with path `chat → session_planning`; no chat text delivered.
- [ ] Check that the max-1-hop rule holds: a planning reply in that run that itself calls
  `start_training_session` commits the transition but does not hop again.

**Verify:** through the lock, `npm run test:scenarios`; `npm run check-all`.

## Task 5 — Past sets are not today's session (AC-TH-7, negative half)

**Files:** `START_TRAINING_SESSION_DESCRIPTION` (start-training-session tool) or the
`session_planning` prompt module — one sentence: start the session only when the user is training
now; sets from a past day are history, never logged into today's session. Bump the prompt version
per the prompt-module convention; update its L0 snapshot.
`evals/scenarios/smoke.scenario.ts`: two steps in planning — negative ("вчера делал 110×12 на
жиме ногами" → phase stays `session_planning`, no sets) then positive ("сделал 2 подхода 110×12"
→ phase `training`, two 110 × 12 sets, reply claims nothing unlogged). The smoke runner's env
enables the flag for its run.

**Verify:** `npm run test:unit` (snapshots), `npm run check-all`. No smoke run by the worker.

## Task 6 — Close-out, deploy, live check (orchestrator)

- [ ] Docs: ADR-0013 (§3.2 delivery, §4.1 graph) and `API_SPEC` notes for the flag — **durable
  spec edit, owner approval first**; `BUGS.md` BUG-022 → Fixed (flag on) with the evidence;
  roadmap § 6 U5 status; `docs/STATE.md`.
- [ ] Local smoke with the flag on (≈ 11 user steps × 1–3 calls; state the count to the owner
  first), record in `COST_LEDGER.md` — AC-TH-7.
- [ ] Close-out review (one review for the phase), `Status: done`, merge to `dev`, push, deploy dev,
  set `TRANSITION_HANDOFF_TARGETS=training,session_planning` in `.env.dev` and recreate
  `fitcoach-dev-server` (`docker compose up -d`, not `docker restart`). Prod stays frozen.

## Task 7 — The coach knows the current time (BUG-032, owner priority 2026-09-25)

Added mid-plan by the owner ("есть что-то поважнее, тренер не знает текущее время") — a small prompt fix,
kept in this branch per the no-micro-plans rule. Dispatched **before** Task 4.

**Files:** `apps/server/src/infra/ai/prompts/directives/` (a new versioned directive or `timezone.v2`),
the directive lists in `directives/index.ts`, the phase modules that render `Current Date`
(`phases/session_planning/v2.ts:98-106`, `phases/plan_creation/v2.ts:74`), `shared/date-utils.ts`
(weekday formatting if needed), L0 prompt snapshots.

- [ ] Every phase (registration, chat, plan_creation, session_planning, training) gets one line:
  `NOW (user's local time): <Weekday> <YYYY-MM-DD> <HH:MM> (<IANA zone>)` from `ctx.now` and
  `user.timezone`; unknown timezone → the same in UTC, marked as UTC.
- [ ] The line is the **last** system section (after the stable prefix) — it changes every minute, and a
  change early in the prompt would break provider prompt caching for everything after it.
- [ ] `Current Date:` lines in session_planning / plan_creation drop the duplicated date (keep
  `days since last workout`).
- [ ] Prompt versions bumped per the prompt-module convention; L0 snapshots regenerated; a unit test pins
  the line for a Manila user at a fixed instant (weekday and 24h time correct across the UTC date line,
  e.g. 2026-09-25T20:30Z → `Saturday 2026-09-26 04:30 (Asia/Manila)`).

**Verify:** `npm run test:unit` (snapshots), `npm run check-all`; through the lock `npm run test:scenarios`.


## Review

**2026-09-25 — verdict: blocked** (zones R1, R2, R3, R4; findings relayed verbatim; duplicates merged, zones listed).

### Blocking

1. **R3** | `apps/server/src/infra/ai/graph/tool-executor.ts:258` | AC-TH-2, AC-TH-6 | `isAcceptedHandoff` (used at :258 to empty the carrier and at :304 to return `'handoff'`) checks only the target and `evaluateTransition`, never whether the run has already hopped (`ctx.phasePath`). In a chat → session_planning hop where planning then calls `start_training_session` with `training` in the flag, planning's text is emptied and its subgraph ends, but commit refuses a second hop (commit.node.ts max-1-hop). The run delivers '' (a silent, replyless run, which the executor's own doc comment forbids), the model was told "the next phase answers the user", and chat.routes.ts:123 sends empty content. This breaks AC-TH-2 ("the user receives only the last phase's text") and AC-TH-6 ("one delivered text"). The max-1-hop test hides the defect: tests/integration/scenarios/chat-to-planning-handoff.integration.test.ts:85 scripts no text ("the training hand-off empties it anyway"), and the `it` at :180 never asserts `delivered`.
2. **R2** | `apps/server/tests/integration/scenarios/handoff-failure.integration.test.ts:81` | CONTRIBUTING_AI.md "Principles & Boundaries" — DRY | `releaseCheckpointer` repeats `apps/server/evals/lib/run-scenario.ts:250` (same name, same two-line body, same `as unknown as { checkpointer?: { end? } }` cast). The existing helper should be exported and reused, not rewritten.
3. **R2** | `apps/server/src/infra/ai/tools/start-training-session.tool.ts:97` | DRY | The hand-off tool-result literal 'Transition registered; the next phase answers the user.' is duplicated verbatim at apps/server/src/infra/ai/tools/request-transition.tool.ts:43. Both tools' unit tests pin it (start-training-session.tool.unit.test.ts:436, request-transition.tool.unit.test.ts:151). It is one contract phrase with two sources, so the copies can drift.
4. **R2** | `apps/server/tests/integration/scenarios/planning-set-logging.integration.test.ts:106` | DRY | The inline sessionSets→sessionExercises→workoutSessions join, filtered by userId, is a copy of the `storedSets` helper added in the same diff at apps/server/tests/integration/scenarios/handoff-failure.integration.test.ts:71.
5. **R1 + R4** — durable specs left behind by the code; the owner-approved amendment in Task 6 closes them (not dispatchable to workers):
   - R1 | `conversation.graph.ts:165` | ADR-0013 §4.3 BR-LLM-006, §4.1 topology | BR-LLM-006 says "A transition committed in run N takes effect in run N+1's `route`; the reply of run N is produced by the outgoing phase"; §4.1 fixes the graph as `… → commit → END`.
   - R1 + R4 | `phase-subgraph.factory.ts:43` / `docs/adr/0013-llm-core-target-architecture.md:218` | ADR-0013 §4.1 (subgraph shape) | the third exit `tools → handoff → END` skipping `finalize` is not described.
   - R1 + R4 | `docs/adr/0013-llm-core-target-architecture.md:131` | ADR-0013 §3.2 Run output (AC-CC-3) | "every non-empty AIMessage text of the run" — with a hop only texts after `ctx.hopBoundaryIndex` are delivered, and the carrier's text is emptied.
   - R4 | `docs/adr/0013-llm-core-target-architecture.md:124-128,136-145` | ADR-0013 §3.2 run context | "the collector is the one mutable accumulator" — `RunContext` gained `phasePath`, `hopping`, `hopBoundaryIndex`, `hopTransition`, mutated by `commit`.
   - R4 | `docs/adr/0013-llm-core-target-architecture.md:212-213` | ADR-0013 §4.1 parent graph | topology still `… → commit → END`.
   - R4 | `docs/adr/0013-llm-core-target-architecture.md:220` | ADR-0013 §4.1 commit steps | the looping commit writes no run row; projection is incremental; a commit without its own transition keeps the incoming `compactReason`/`activeSessionId`.
   - R4 | `docs/CONTRIBUTING_AI.md:146` | ADR-0013 §8 run-row semantics | `transition = { toPhase, reason }`, `phaseIn` = the run's phase — now `transition.path`, `phaseIn = phasePath[0]`, merged `promptVersions`. Not in Task 6's list — add it.
   - R4 | `docs/API_SPEC.md:108-110,128-133` | CONTRIBUTING_AI.md:61 | `content` and the Training flow describe one phase per message; with the flag one POST crosses two phases and `content` holds only the last phase's text.

### Advisory (not fixed on this branch; → `docs/BACKLOG.md` via the backlog skill after owner triage)

- R1 | `tool-executor.ts:65` | the transition verdict is computed in two places (executor for routing, commit for committing); ADR-0013 §4.3 says "commit decides". Merged with R2 | `commit.node.ts:117` — the "accepted hand-off" predicate written twice. *Blocking finding 1 is the concrete defect this split produced.*
- R1 | `start-training-session.tool.ts:39`, `request-transition.tool.ts:42` | tools receive graph-routing config to choose their wording — couples domain-adapter tools to topology; the executor could swap the closing instruction instead.
- R1 | `commit.node.ts:81` | commit picked up a second reason to change (hop orchestration); a small collaborator would keep §4.1 duties (1)–(4).
- R1 | `conversation.graph.ts:94` | `afterCommit` reads `config.context as { hopping?: boolean }`, bypassing `ctxOf`/`RunContextType`; run context becomes a mutable node-to-node channel.
- R1 + R2 | `config/transition-handoff-targets.ts:13` | `KNOWN_PHASES` is a hand-synced copy of `ConversationPhase`; nothing fails when a phase is added/renamed.
- R2 | three new scenario files repeat the `TRANSITION_HANDOFF_TARGETS` save/set/restore block and the `start_training_session` upper_a args fixture.
- R2 | `shared/date-utils.ts:51` | new `weekdayFmt` nearly duplicates `weekdayInTz` (:79).
- R2 | `tool-executor.ts:313` | `export const afterTools = buildAfterTools()` has no production call site.
- R2 | `phase-subgraph.factory.ts:30` | the "absent targets = empty set" default is written in five places.
- R2 | `prompts/phases/chat/v3.ts:1` | chat/v3, registration/v2, training/v4 are full copies differing only in `directives` (repo convention).
- R3 | `commit.node.ts:190` | flag-off behaviour change: commit carries `state.compactReason` forward on runs with no transition; with compact's id-less skip the flag now survives across runs; no flag-off test. (Also flagged by the orchestrator at Task 2 acceptance.)
- R3 | `session_planning/v3.ts:67` | STEP 5 / TOOLS still say "call ONLY when user explicitly approves the final plan", contradicting the new "training now" sentence.
- R3 | `commit.node.ts:144` | chat → session_planning → training in one run: the run row keeps only the second request; `transition.path` lacks `training`.
- R3 | `tool-executor.ts:258` | only the carrier AIMessage is emptied; AI text from earlier tool rounds of the hand-off phase stays in `messages`.
- R3 | `planning-set-logging.integration.test.ts:149` (and `chat-to-planning-handoff…:175`) | the no-duplicate check keys on `phase:kind:content`, so it cannot catch a re-projection under the second phase's label.
- R3 | `planning-set-logging.integration.test.ts:155` | AC-TH-4 test name claims "activeSessionId set" but asserts only session status.
- R3 | `config/transition-handoff-targets.ts` | the parser accepts any phase (`chat`, `plan_creation`) as a target; untested hand-offs after `save_workout_plan` / `finish_training`.
- R4 | `docs/BUGS.md:1161,1237` | BUG-022 still Open and points to the deleted `.repro` file — Task 6.
- R4 | `docs/BUGS.md:1663` | BUG-032 still Open — Task 6.
- R4 | ADR-0013 §5.1 (`:286-289`) omits `current-time.v1.ts`; `ARCHITECTURE.md:98,107,405` (reply semantics, tool loop) and `:133,142,149` (directive count, current prompt versions) stale — Task 6.
- R4 | design spec §8 (`:155,160`) says "1–2 hops" and "phase path instead of phaseIn/phaseOut" — mark superseded by D-2.
- R4 | roadmap §6 U5 "not started"; branch plan copy `Status: planned` vs `dev` `in progress` (merge conflict expected) — close-out.
- R4 | `CONTRIBUTING_AI.md:141` "tool-result strings are frozen per tool … `TOOL_OUTCOME_FORMAT_ID` bump" — contradicted by this branch's wording change with the id still `'v1'`.
- Orchestrator | the NOW line (Task 7) sits at the end of the first system message; the domain-context system message follows it, so that block is no longer cache-prefix-stable.

### Live smoke (AC-TH-7) — 2026-09-25 06:59, `glm-5.3-flash`, flag `training,session_planning`: 31 passed / 9 failed

Transcript `evals/reports/smoke-2026-09-25T06-59-24-287Z.md` (worktree). Read by the orchestrator:
- **R2.2 works live:** «привет, хочу потренироваться» → chat hands off, session_planning answers with the analysis in the same reply, no duplicated line.
- **R2.1 works live:** «давай низ, погнали» (planning) → `start_training_session` → training answered in the same run; «сделал 2 подхода по 110×12 на жиме ногами» → two `log_set`, both 110 × 12 stored, no unlogged claim.
- **Negative half:** «вчера на жиме ногами делал 110×12» → nothing logged ✓ (but asked in `training`, not in `session_planning`).
- **Scenario defect (3 failures):** step «давай низ, погнали» is consent, so planning starts at once; the negative and positive steps then run in `training`, not in planning. AC-TH-7's "in planning: сделал 2 подхода → training opens" is therefore **not yet exercised live**. The smoke needs a non-starting planning step before them.
- **New product defect (6 failures), not U5:** «разгибания 55 на 10», «сгибания 50 на 10» — `search_exercises` finds nothing for Russian names although `Leg Extension` / `Leg Curl` are in the catalog; nothing logged. The coach stayed honest («не сохранились»), except «Твой подход 50 × 10 я запомнил и сразу залогирую» (a promise) and the week summary listing the unlogged sets as done. → new BUG, owner to decide scope.
- **Model slips:** «приседал 6 дней назад (пятница)» — 6 days before Friday is Saturday; «Отличный старт недели» on a Friday. The week question was answered correctly this time (last Saturday = 6 days ago, outside this week).

### Re-run 2026-09-25 (after fix commits a738b1f2, 367ceda1) — R2 and R3 only (the zones whose code findings blocked)

- **Blocking 1 (R3): closed** — one predicate `isAcceptedHandoff(…, alreadyHopped)` in `graph/handoff.ts` used by the executor's carrier emptying, `afterTools` and commit's `shouldHop`; proof `chat-to-planning-handoff.integration.test.ts:205` asserts the delivered planning text, `:229` pins 3 model calls.
- **Blocking 2–4 (R2): closed** for the whole class — `releaseCheckpointer` exported from `evals/lib/run-scenario.ts:264`; `HANDOFF_REGISTERED_TEXT` at `graph/handoff.ts:33`; `storedSets` in `tests/integration/scenarios/session-seed.ts:19`.
- **Blocking 5 (R1 + R4, durable docs): open** — Task 6, waiting for the owner's approval of the ADR-0013 / API_SPEC amendment.
- New advisories (R3): `start-training-session.tool.ts:39,95` and `request-transition.tool.ts:41` pick the hand-off wording from static config, not from whether the hand-off is accepted (a blocked second hand-off tells the model "the next phase answers" → possible empty-reply fallback); `start-training-session.tool.ts:33` description still says "ONLY when the user has explicitly approved", contradicting the reconciled v3 STEP 5; `evals/levels/l3.ts:432` catalog-embedding guard runs after the paid model calls and only over `past.catalog`; L3 loads a second embedding model (~80 MB).
- New advisories (R2): the "already hopped" read is still written by three callers in two forms (`tool-executor.ts:237,294`, `commit.node.ts:83/117`); `embed-pending-exercises.ts:74` sequential `embed()` kept "because of Jest" although it no longer runs under Jest — `embedBatch` now has no production caller; `embed-pending-exercises.ts:95` repeats `ExerciseRepository.updateEmbedding` (pre-existing, moved); `l3.ts:67` repeats the NULL-embedding selection; `embeddingService` threaded through three layers.
- Orchestrator re-verification: `npm run test:scenarios` 14 suites / 371 passed + 1 todo.
- **Live smoke run 7 (AC-TH-7): 41 passed / 0 failed** (`evals/reports/smoke-2026-09-25T07-55-22-510Z.md`). In `session_planning`: «вчера на жиме ногами делал 110×12» → nothing logged, stays planning, the plan is adapted; «сделал 2 подхода по 110×12 на жиме ногами» → `start_training_session` + 2× `log_set` in the same reply, both stored — **BUG-022's live case passes**. Russian-named exercises now found and logged. Model slip: the week summary counted «вчера» (unlogged, from chat) as 2×12 and put last Saturday into "this week".

