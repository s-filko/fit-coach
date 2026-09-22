# LLM I/O Audit Trail — Nothing the User Wrote, the Model Answered, or the API Received Is Lost Implementation Plan

- Status: planned
- Branch: plan/llm-io-audit-trail

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans and superpowers:test-driven-development. One plan task per worker session; stop after the task.

**Goal (owner, 2026-09-21):** "мне нужны все транскрипты, важно не потерять что писал пользователь,
это те исходники что дают нам аналитику, что отвечала ллм, и еще важно что мы отправляли в точности
по апи чтобы получить такой ответ." Three artefacts must survive every run, successful or not: the
user's message, the model's answer, and the exact request that produced that answer.

**Why now.** The 2026-09-21 dev training session could only be reconstructed by reading LangGraph
checkpoints by hand, and one finding (BUG-022) was first written up wrong because the DB transcript
disagreed with what the model actually saw. Four runs that day left no trace of the user's message at
all.

**Findings this plan builds on (verified 2026-09-21 against the dev DB and the code):**
- `conversation_turns` rows are written by the commit node **at the end** of a run. A failing run
  writes nothing: runs `0658de91`, `d90293ff`, `ac02bc38` hold zero turn rows, and the messages behind
  them ("начинаю с пробежки на беговой дорожке", "закончил 2км за 13:45", "ноги 110кгх12 первый
  подход") exist only in `checkpoint_blobs` (channel `__start__`, thread = user id).
- `conversation-run.adapter.ts:123-157` records a failed-run row but stores no error class or message;
  `conversation_runs` has no column for it. `outcome='core_error'` is all that is left.
- The exact API payload is already assembled — `llm-log-handler.ts:84-105` builds `replayPayload`
  (`model`, OpenAI-shaped `messages`, `temperature`, `tools`) and logs the answer — but only when
  `LOG_LEVEL` is `debug`/`trace`. Dev runs `info`, so nothing is captured.
- Container logs are the only sink and they are ephemeral: no log volume is mounted in
  `deploy/docker-compose.yml`, so the 2026-09-21 09:25 deploy erased the evidence of that morning.
- All rows of a run share one `created_at` (single INSERT, `DEFAULT now()`), so turn order is already
  unrecoverable — BUG-029.
- Volume to budget for: 20–60 k input tokens per run ≈ 100–250 KB of JSON; one training session
  ≈ 20 runs ≈ 2–5 MB; the system prompt (3 495 tokens in the training phase) repeats in every call.

**Red tests already on `dev` (from `session-2026-09-21-repro`, merged 2026-09-22).** Two of that
plan's six failing tests belong to this plan and *are* its Step 1 — do not write a second test for a
defect one of them already catches (owner rule: no duplication).

| Plan task | Red test | Repro AC | Bug |
|---|---|---|---|
| Task 1 | `tests/integration/scenarios/failed-run-transcript.repro.test.ts` | AC-LSR-6 | BUG-022 (loss half) |
| Task 3 | `tests/integration/services/transcript-order.repro.test.ts` | AC-LSR-5 | BUG-029 |

Both live outside the default suites by design; run them with
`RUN_DB_TESTS=1 NODE_ENV=test npx jest --testMatch='**/tests/integration/**/*.repro.test.ts'`.
When the fix turns one green, **rename it** to `<name>.integration.test.ts` in the same directory so
it joins `npm run test:integration`, and drop the `REPRODUCTION (RED)` header sentence about being
promoted. This paragraph is the single statement of the rename rule; Tasks 1 and 3 point here.

**Acceptance criteria:**
- **AC-AT-1** — the inbound user message is persisted **before** the graph runs; a run that throws at
  any point still leaves that message in `conversation_turns`, exactly once (no duplicate when the
  commit node later writes the rest of the run).
- **AC-AT-2** — a non-`ok` run carries its cause: `conversation_runs` stores the error class and a
  truncated message, and they are set for every failure path that reaches the adapter's catch.
- **AC-AT-3** — every model invocation is stored, independent of `LOG_LEVEL`: one `llm_calls` row per
  call with `run_id`, call index, model, the request payload actually sent (messages, tools,
  parameters), the response (text, tool calls, `finish_reason`, usage), latency and error. The system
  prompt is stored once per distinct content hash and referenced, not duplicated per call.
- **AC-AT-4** — turn order is recoverable: a per-run monotonic `seq` on `conversation_turns`, written
  by `toTurnRows` and used wherever turns are read (closes BUG-029).
- **AC-AT-5** — one command prints everything about a run or a session — user message, model answers,
  tool calls and results, and the request payloads — in the order it happened.
- **AC-AT-6** — retention is configured, not accidental: full payloads are kept for a configurable
  window, after which the payload is dropped and the row keeps its metadata; the container's logs
  survive a deploy (a mounted volume), so debug output is no longer lost with the container.

## Global Constraints

- No model-backed evals (`RUN_LLM_EVALS` / `EVALS_FULL_RUN` never set); mocked models only.
- Never write any `.env*` file — `.env.example` only.
- Schema changes go through migrations (HB-01): `npm run drizzle:generate`, never `drizzle-kit push`.
  The `checkpoints*` tables are LangGraph runtime storage — never add them to `schema.ts`.
- Reserved to the orchestrator: push, ssh, deploy, merge, `npm run db:*`, `docker compose`, durable
  specs (`docs/adr/**`, `docs/domain/**`, `ARCHITECTURE.md`, `API_SPEC.md`, `LLM_CORE_REFACTOR_PLAN.md`),
  `docs/STATE.md`, `docs/BUGS.md`, any `Status:`.
- This plan changes **observability only**. Prompt and coaching defects found the same day
  (BUG-022…BUG-028, BUG-030) are out of scope and are fixed separately, in small strokes.

---

### Task 1: The user's message survives a failed run (AC-AT-1)

**Files:** `apps/server/src/infra/ai/graph/conversation-run.adapter.ts`,
`apps/server/src/infra/conversation/drizzle-transcript.service.ts`,
`apps/server/src/domain/conversation/ports/*`, their tests.

- [x] **Step 1: the red test already exists** — `failed-run-transcript.repro.test.ts` (§ Red tests
  already on `dev`) proves the loss: a run whose model call throws leaves no `human` row. **Extend it,
  do not duplicate it**, with the *exactly-once* half of AC-AT-1 — assert the **count** of matching
  `human` rows is 1 (it asserts `toContain` today), for both the successful and the failed run, so a
  commit node that re-writes the message fails the test.
- [x] **Step 2**: persist the inbound message before `graph.invoke`, and stop the commit node from
  re-writing it (the run id makes the row identifiable).
- [x] **Step 3**: verify — `cd apps/server && npm run test:unit` and
  `RUN_DB_TESTS=1 npm run test:integration`.

**Recorded at Task 1 review (orchestrator, 2026-09-22).** The pre-persisted `human` row is stamped
with the phase read from the checkpoint *before* `invoke`, while `commit` stamps the rest of the run
with `state.phase` *after* `prepare` may have changed it. So a run that changes phase now produces a
transcript row set that is no longer phase-homogeneous — the user's message carries the phase it was
received in, the answer the phase it was answered in. That is the truthful reading and it is kept, but
it is a change no reader expected before: do not assume all rows of a `run_id` share one `phase`.
Two checks that did **not** hold up and cost nothing to re-verify: `episodeId` never reaches the
database (`conversation_turns` has no such column, `toTurnRows` drops it), so the pre-persist passing
`episodeId: runId` is inert; and the `/compact` path does not pre-persist, because `compactOnly` is
set only in the adapter's separate `compact()` method, so ADR-0013's "no transcript rows" contract for
manual compaction still holds. The dedup read does not breach INV-LLM-001 (ADR-0013 §104 forbids
reading `conversation_turns` *to build a prompt*) and leaves the port's surface read-free.

### Task 2: A failed run says why (AC-AT-2)

**Files:** migration for `conversation_runs` (`error_class`, `error_message`),
`apps/server/src/infra/db/schema.ts`, `conversation-run.adapter.ts`, `conversation-run.ports.ts`, tests.

- [x] **Step 1: Tests first** — a throwing graph records the error class and a truncated message on the
  run row; an `ok` run leaves both null.
- [x] **Step 2**: generate the migration (`npm run drizzle:generate`), extend the record type, fill it
  in the catch block.
- [x] **Step 3**: verify — `npm run test:unit`, `RUN_DB_TESTS=1 npm run test:integration`.

**Recorded at Task 2 review (orchestrator, 2026-09-22).** Two things the task correctly left alone,
written down so the close-out does not rediscover them as gaps:
- **A failed manual compaction still leaves no trace in `conversation_runs`.** The adapter's
  `compact()` has its own catch that logs and rethrows without calling `recordRun`, so it is not a
  non-`ok` run row missing a cause — it is no row at all. AC-AT-2 is satisfied as written (the one
  path that records a failed run now records why), but the goal of this plan is not, for that path.
  Worth a decision at close-out: either `compact()` records its own failed run, or the plan states
  that manual compaction is deliberately outside the run log.
- **`error_message` puts raw provider text in a durable table**, which is what AC-AT-2 asks for, and
  is the deliberate opposite of INV-LLM-006, which keeps exception text out of HTTP bodies. The
  difference is intended (internal record vs. user-facing response). What was not checked is whether
  a provider error can carry an echo of the request; if it can, 500 characters of a failed call's
  payload land in `conversation_runs`. One look before this plan closes.

### Task 3: Turn order is recoverable (AC-AT-4, closes BUG-029)

**Files:** migration for `conversation_turns` (`seq`), `schema.ts`,
`drizzle-transcript.service.ts` (`toTurnRows`), `apps/server/evals/lib/export-query.ts`, tests.

- [x] **Step 1: the red test already exists** — `transcript-order.repro.test.ts` (§ Red tests already
  on `dev`) proves the order is unrecoverable through the real reader `fetchRunsSince`, which *is* the
  eval export's query, after the rows are physically reordered. **Extend it, do not duplicate it**,
  with the one assertion `seq` newly makes possible: `toTurnRows` numbers its rows `1..n` in message
  order.
- [x] **Step 2**: add the column and the ordering.
- [x] **Step 3**: verify — `npm run test:unit`, `RUN_DB_TESTS=1 npm run test:integration`.

**Recorded at Task 3 review (orchestrator, 2026-09-22).** The task shipped with `fetchRunsSince`
ordering by `(seq, created_at)`. That query spans every run since the cutoff and carries
`limit * 4`, so sorting by `seq` first sliced the result across runs by sequence position, and a
`NULL` seq sorts last in Postgres ASC — every pre-migration row, i.e. the 2026-09-21 session this
export exists to recover, behind every new row and first to be cut. Fixed to `(created_at, seq)` in
`a7e2ab5c`, with a multi-run test including a `NULL`-seq run, proven red on the shipped ordering
first. **The lesson for the rest of this plan:** the promoted single-run test passes under both
orderings, so a test that examines one run cannot check a query that spans many. Where a reader is
global, test it globally, and with a truncating limit.
Left alone deliberately: the BUG-016 fallback query (turns whose `run_id` is `NULL`, window-joined by
timestamp) still orders by `created_at` only. Every row that reaches it predates `run_id` threading
and therefore has no `seq` either, so adding one would be inert — noted so the close-out does not
read it as an oversight.

### Task 4: Every API exchange is stored (AC-AT-3)

**Files:** migration for `llm_calls` (+ a prompt-blob table keyed by content hash),
`schema.ts`, `apps/server/src/infra/ai/llm-log-handler.ts` (or a sibling recorder that shares the
payload construction), the run-context wiring that carries `runId`, tests.

- [x] **Step 1: Tests first** — one row per model call with the payload actually sent (messages, tools,
  temperature, reasoning effort) and the response (text, tool calls, `finish_reason`, usage); two calls
  in one run get indexes 1 and 2 and the same `run_id`; an identical system prompt across calls is
  stored once and referenced; a failing call still records the request and the error.
- [x] **Step 2**: implement the recorder. Writing must not fail the run: a recorder error is logged and
  swallowed.
- [x] **Step 3**: verify — `npm run test:unit`, `RUN_DB_TESTS=1 npm run test:integration`.

### Task 5: Retention and durable logs (AC-AT-6)

**Files:** config (`LLM_CALLS_RETENTION_DAYS` or equivalent), a prune path, `.env.example`,
`deploy/docker-compose.yml` (log volume for server and bot), `docs/LOGGING_GUIDE.md`.

- [ ] **Step 1: Tests first** — the prune drops payloads older than the window and keeps the rows'
  metadata; the window is configuration with a documented default.
- [ ] **Step 2**: implement; mount the log volume; document both in `LOGGING_GUIDE.md`.
- [ ] **Step 3**: verify — `npm run test:unit`; the compose change is applied by the orchestrator at deploy.

### Task 6: One command prints the whole exchange (AC-AT-5)

**Files:** a script under `apps/server/scripts/` (or an `npm run` entry), `docs/LOGGING_GUIDE.md`, tests.

- [ ] **Step 1: Tests first** — given a run id (or a session id, or a user + time window) the output
  interleaves user messages, model answers, tool calls and results in `seq` order, and can include the
  request payloads on a flag.
- [ ] **Step 2**: implement, document the invocation.
- [ ] **Step 3**: verify — `npm run test:unit`; a manual run against dev by the orchestrator.

---

## Follow-up (not part of this plan)

With Task 4 in place, eval drafts can be built from real requests instead of reconstructed from
turns — the 2026-09-21 session is the first candidate set (`npm run evals:export -- --since 2026-09-21`,
then expectations added by hand). Tracked in `docs/BACKLOG.md`.
