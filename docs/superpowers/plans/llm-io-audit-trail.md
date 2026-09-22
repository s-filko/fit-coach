# LLM I/O Audit Trail — Nothing the User Wrote, the Model Answered, or the API Received Is Lost Implementation Plan

- Status: done
- Branch: plan/llm-io-audit-trail
- Review: 2026-09-22 | clean | R1,R2,R3,R4

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
- Container logs are the only sink and they are ephemeral. **Corrected 2026-09-22, at Task 5:** the
  reason is not a missing volume. Every service already runs the `json-file` driver (10m × 3), which
  writes to `/var/lib/docker/containers/<container-id>/*.log` — a path keyed to the container's own
  id that no per-service `volumes:` entry can relocate. The 2026-09-21 09:25 deploy erased that
  morning because recreating a container gives it a new id and dockerd deletes the old one's log
  directory with it. Mounting a volume would therefore have changed nothing; the app writes to stdout
  only (`logger.ts` is a bare `pino()`, `pino-pretty` in development). Found by the worker, verified
  against the compose file and the logger by the orchestrator.
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

**Recorded at Task 4 review (orchestrator, 2026-09-22). Two rounds, and the second one matters
beyond this plan.**
- *Round 1 — the seam was untested.* The task shipped with the handler proven against an injected
  recorder and the recorder proven when called directly, but nothing exercising the chain that has to
  work in production: real model call → LangChain callback → handler → recorder → row. The scenario
  harness cannot cover it — `scripted-model.ts` mocks `model.factory` with a plain object carrying an
  `invoke` method, not a `BaseChatModel`, so it emits no callbacks at all. Closed with
  `llm-invocation-wiring.integration.test.ts` driving `FakeListChatModel` (a real `BaseChatModel` from
  `@langchain/core/utils/testing`, no network) through the real gateway and asserting the written row.
- *Round 2 — **@langchain/core does not await callback handlers by default**, and the first fix made
  the test tolerate that instead of fixing it.* `callbacks/base.js:62` sets
  `awaitHandlers = getEnvironmentVariable("LANGCHAIN_CALLBACKS_BACKGROUND") === "false"`, the variable
  is set nowhere in this repo, and nothing in `src/` calls `awaitAllCallbacks`. So the `llm_calls`
  insert was fire-and-forget: it could land after the reply and after the `conversation_runs` row, or
  never — `deploy.sh` stops the containers and whatever sat in that queue was gone, silently. AC-AT-3
  read "every model invocation is stored"; the shipped behaviour was "probably stored shortly
  afterwards". Fixed at the source in `85d0942f` — `LLMLogHandler` sets `this.awaitHandlers = true`
  (the per-handler override, deliberately not the env var, which would bind every future handler), and
  the test's `awaitAllCallbacks()` drain was removed, because a drained test stays green when the fix
  is reverted. Proven in both directions, by the worker and independently by the orchestrator:
  override in place → the row exists the moment `gateway.chat()` resolves; override removed → the same
  test fails with the row missing.
  **Do not revert `awaitHandlers = true` for latency.** The cost is one insert on a call that takes
  tens of seconds, the recorder swallows its own errors so it cannot fail a reply, and the thing being
  bought is that a record of an API call is never lost to a restart. This belongs in a durable spec at
  close-out, not only here.

### Task 5: Retention and durable logs (AC-AT-6)

**Files:** config (`LLM_CALLS_RETENTION_DAYS`), a prune path, `.env.example`, `deploy/deploy.sh`
(log capture before the recreate — **not** `deploy/docker-compose.yml`, see the corrected finding above),
`docs/LOGGING_GUIDE.md`.

- [x] **Step 1: Tests first** — the prune drops payloads older than the window and keeps the rows'
  metadata; the window is configuration with a documented default.
- [x] **Step 2**: implement; mount the log volume; document both in `LOGGING_GUIDE.md`.
- [x] **Step 3**: verify — `npm run test:unit`; the compose change is applied by the orchestrator at deploy.

**Recorded at Task 5 review (orchestrator, 2026-09-22). Three rounds; the theme is silent failure.**
- *The premise was wrong* — corrected above: no `volumes:` entry can make `json-file` durable, so the
  fix moved to a capture in `deploy.sh` before the recreate. Found by the worker.
- *Retention would have preserved the wrong half.* The prune nulled `llm_calls.request` but left
  `prompt_blobs` untouched forever, on the premise that a blob is one row per prompt version. False
  here: `assemble-context.ts:167-175` sends up to six system messages and the recorder hashes every
  one, so besides the static prompt each call mints blobs for the client profile, the previous-episodes
  block and the domain block. Counted in the repo's own frozen snapshots: 2–3 system messages per
  assembly, only the first reusable. The bulky, ever-changing context was therefore moving out of the
  pruned column into a table kept forever. Closed by `llm_calls.prompt_hashes` (written at record time,
  never nulled) plus a blob prune that nulls content no live row references — same rule as calls: keep
  the metadata row, drop the payload.
- *Two SQL defects that fail silently*, both proven on the test DB before being sent back. `NOT IN`
  over `unnest(prompt_hashes)` guarded the NULL array but not a NULL element, and one NULL makes the
  predicate NULL for every hash — the prune would have reported zero forever, with no error. And the
  dry run, which is the CLI default, evaluated blob liveness against rows statement 1 had not yet
  nulled: it printed `0 blobs` where apply nulled 1, i.e. it told the operator it would not touch what
  it then touched. Both closed with `NOT EXISTS` and a shared window predicate, each with a test proven
  red first.
**Still owed at deploy:** `deploy.sh` changed, and per `CLAUDE.md` the first deploy after that runs the
PREVIOUS version, so the log capture must be validated by a second manual run on dev before it is
trusted.

### Task 6: One command prints the whole exchange (AC-AT-5)

**Files:** a script under `apps/server/scripts/` (or an `npm run` entry), `docs/LOGGING_GUIDE.md`, tests.

- [x] **Step 1: Tests first** — given a run id (or a session id, or a user + time window) the output
  interleaves user messages, model answers, tool calls and results in `seq` order, and can include the
  request payloads on a flag.
- [x] **Step 2**: implement, document the invocation.
- [x] **Step 3**: verify — `npm run test:unit`; a manual run against dev by the orchestrator.

---

## Follow-up (not part of this plan)

With Task 4 in place, eval drafts can be built from real requests instead of reconstructed from
turns — the 2026-09-21 session is the first candidate set (`npm run evals:export -- --since 2026-09-21`,
then expectations added by hand). Tracked in `docs/BACKLOG.md`.

---

## Review

### Round 1 — 2026-09-22

**Verdict: BLOCKED.** Four zones ran in parallel on `b87c9a11...74e3b6dd`
(46 files, ~12.7k insertions). No `- Review:` header line is written: its absence is what
"not passed" looks like. **23 blocking, 28 advisory, 11 meta.** Every blocking finding was
checked by the orchestrator for the two things severity requires — a `file:line` and a rule
that actually says what is claimed. None were demoted. One near-miss worth recording: the
orchestrator first read `SUPERPOWERS_INTEGRATION.md` rule 7 by its title ("Review precedes
close-out") and was about to demote eight R4 findings as mis-cited; the rule's full text says
"All four zones block, documentation included: a durable spec that has drifted from the code
actively misleads the next agent", so the citations stand.

**Nothing here is fixed on this branch by the reviewer.** The owner decides what happens next.

### Blocking — R1, architectural integrity (1)

1. `apps/server/src/infra/ai/llm-log-handler.ts:217` — **ADR-0013 §8** (line 377) draws this
   boundary in words: "the module boundary keeps the LLM callback `debug`-only while feeding
   the run-metrics accumulator". `handleLLMEnd`/`handleLLMError` are now durable writers into
   `llm_calls`/`prompt_blobs`, and `awaitHandlers = true` (`:148`) puts that write on the
   synchronous reply path — the precise property the boundary existed to prevent. §8's durable
   model still enumerates only `conversation_runs`/`conversation_turns`; two new tables sit
   outside it. **The code is not wrong — the ADR is out of date.** Resolution is an owner-level
   ADR-0013 §8 amendment, not a code change; `docs/adr/**` is owner-reserved.

### Blocking — R2, duplication (5)

2. `conversation-run.adapter.ts:93` — DRY. Task 1 extracted `readPhase`, but the identical
   `getState` cast + try/catch + `'chat'` default remains inline at `:249-258` in the same file.
3. `prune-llm-calls.cli.ts:25` — DRY. Near-verbatim copy of `prune-checkpoints.cli.ts:16`;
   only the labels, the default source and the dry-run count expression differ.
4. `llm-log-handler.ts:106` — DRY. A second `classifyError` beside
   `conversation-run.adapter.ts:61`; both new on this branch, both under `src/infra/ai/`, and the
   JSDoc concedes the copy while justifying it as "across layers", which they are not.
5. `llm-call-recorder.ts:47` — DRY. A second `ERROR_MESSAGE_MAX_CHARS = 500` and truncation
   beside `conversation-run.adapter.ts:58,64-65`: one policy in two places, free to diverge.
6. `transcript-reader.ts:102` — DRY. The 12-field run-row projection is copy-pasted at `:139`;
   `loadTurnsAndCalls` was factored out one screen above for exactly this reason.

### Blocking — R3, correctness and proof (5)

7. `drizzle-summary.service.ts:37-47` — **AC-AT-4**. `toSummaryTurnRow` writes a
   `conversation_turns` row with a `run_id` and **no `seq`**, and `compact.node.ts:260` calls it
   inside an ordinary auto-compaction run. That run mixes seq'd and NULL-seq rows under one
   `run_id`, so "per-run monotonic seq used wherever turns are read" does not hold, and
   `transcript-formatter.ts:196` prints "rows predate AC-AT-4" about a row written today.
   `schema.ts:104-107` claims the only seq-less cases are pre-migration rows and system notes.
8. `llm-log-handler.ts:87-98` — **AC-AT-3**. The stored request keeps only `model`, `messages`,
   `temperature`, `reasoning_effort`, cherry-picked from `invocation_params`. `max_tokens` is
   sent on every call (`model.factory.ts:31`) and never recorded; likewise `response_format`,
   `top_p`, `stop`, `tool_choice`. Two profiles differing only in `maxTokens` store byte-identical
   requests. Against the goal line — "что мы отправляли в точности по апи" — this is the plan's
   own headline promise, unmet. Uncaught because the one real-model test drives
   `FakeListChatModel`, whose `invocationParams()` is empty.
9. `transcript-reader.ts:123-134` — **AC-AT-5**. `fetchRunsForUserWindow`, which backs both
   `--session` and `--user`, enumerates from `conversation_runs` only. A run whose turns and
   calls exist but whose run row was never written is invisible through every selector except
   `--run` — and that is exactly the run AC-AT-1 exists to preserve (`commit.node.ts:99-131`
   swallows a `recordRun` failure; a process killed mid-run reaches neither path).
10. `deploy/deploy.sh:61-83` — **SUPERPOWERS rule 2** ("A task without a verification path is
    not done"). The AC-AT-6 log capture has no test, no shellcheck gate and no recorded run;
    Task 5's stated command is `npm run test:unit`, which does not touch `deploy.sh`.
11. `docs/superpowers/plans/llm-io-audit-trail.md:252` — **SUPERPOWERS rule 2**. Task 6 states
    "a manual run against dev by the orchestrator" and no evidence exists. The CLI wrapper
    `scripts/print-transcript.ts` is the only AC-AT-5 code with no automated coverage, so that
    manual run is the whole of its proof.

### Blocking — R4, documentation currency (12)

All twelve are documentation-only; none implies a code change. Rule 7 makes drift blocking.

12. `docs/ARCHITECTURE.md:371` — "the `commit` node writes one row per message" is false; the
    adapter pre-persists the human row and commit dedupes it. Two writers, one named.
13. `docs/ARCHITECTURE.md:375` — the storage enumeration lacks `seq`, lacks
    `error_class`/`error_message`, and omits `llm_calls`/`prompt_blobs` entirely.
14. `docs/ARCHITECTURE.md:87` — the module tree still labels `llm-log-handler.ts` "debug logging
    only" and omits every new module this branch added.
15. `docs/LLM_CORE_REFACTOR_PLAN.md:41` — "`LLMLogHandler` stays `debug`-only" — the second
    durable place stating retired behaviour.
16. `docs/adr/0013-llm-core-target-architecture.md:102` — §3.1's memory-tier table names `commit`
    as the sole transcript writer and has no row for the API-exchange tier this branch created.
17. `docs/CONTRIBUTING_AI.md:184` — "called by the graph's `commit`/`compact` steps — never from
    a route": the adapter now calls `appendRunMessages` outside the graph.
18. `docs/DB_SETUP.md:137,162,95` — the documented DDL has no `seq`, no `error_*`, and no entry
    for the two new tables. A DDL block that diverges from `schema.ts` is read as law.
19. `docs/CICD.md:122` — the 14-step deploy flow has nothing between "6. Backup database" and
    "7. Read VERSION file", where the log capture now lives.
20. `docs/BUGS.md:1456` — **BUG-029 still reads `Status: Open`** though `seq`, the
    `(created_at, seq)` ordering and the regression test it demands all shipped.
21. `docs/LOGGING_GUIDE.md:328` — **SUPERPOWERS rule 1**: the whole audit trail has no durable
    ID. No `BR-*` for retention (checkpoint pruning has `BR-LLM-005`), no `INV-*` for "every
    invocation recorded regardless of `LOG_LEVEL`", no ADR for `awaitHandlers = true`. The guide
    cites plan-scoped `AC-AT-*` eight times, so a durable doc depends on IDs that die at close-out.
22. `docs/LOGGING_GUIDE.md:333` — process history inside a durable guide ("The plan that started
    this work assumed… that premise was wrong"; "A first version of this guide claimed…"): a
    retired claim kept beside its replacement, which `DOCUMENTATION_GUIDE.md:16-19` forbids.
23. `docs/LOGGING_GUIDE.md:452` — the heading `### Which database it reads (review, 2026-09-22)`
    stamps a review event into a durable doc's table of contents (Status layer rule 4). The same
    marker appears in shipped source at `scripts/print-transcript.ts:12`.

### Advisory (28) — not fixed on this branch

Merged across zones; the missing-index finding was raised independently by R1 and R3 and is
recorded once. Headline items: `llm_calls`, `prompt_blobs` and `conversation_turns` carry no
`run_id` index while the recorder runs `SELECT max(call_index) … WHERE run_id = $1` on every
call, now synchronously (R1+R3); `pending` in the log handler has no TTL, so an invocation that
never ends leaks its 100–250 KB payload for the process lifetime (R3); the `max(seq)` read and
insert are not transactional (R3); the commit-node dedup drops *every* human row and is correct
only because `splitEpisode` guarantees one (R3); `llm-call-recorder.integration.test.ts:90`
builds the payload in the test and then asserts it, so it cannot fail for the reason it names
(R3); `--run --payloads` parses `--payloads` as the run id (R3); the eval export still omits
`seq` from its projection, so a consumer that re-sorts is back to the BUG-029 tie (R3);
`argValue` is a fourth hand-rolled copy (R2); `CICD.md` still presents `drizzle-kit push` as
live in ten places, pre-existing but directly contradicted by this branch's five migrations (R4);
the "Forbidden data categories" table forbids logging what `llm_calls` now stores durably, with
no PII statement covering it (R4).

### Meta (11) — filed in `docs/REVIEW_FINDINGS.md`, not acted on here

### Round 2 — 2026-09-22

**Verdict: BLOCKED — 16 blocking.** Eight were defects round 1's own fixes introduced; eight
were the orchestrator's documentation reconciliation. All are closed; recorded here because a
fix can only be checked against what the finding actually said.

R2 (4, all DRY): `transcript-formatter.ts:14` restated the recorder's request/response types and
had already diverged — `print-transcript --payloads` printed none of the five params the round-1
fix had just taught the recorder to store; `drizzle-summary.service.ts:67` copied the `MAX(seq)`
read; `db-target.ts:38` reinvented the pg cause-chain walk at one level where
`workout-session.repository.ts:24` walks five; `run-error-cause.integration.test.ts:22` copied a
20-line persona.
R3 (2): both deploy-gated and restated, see § Deferred below.
R4 (10): `ARCHITECTURE.md:371,375,87`; `LLM_CORE_REFACTOR_PLAN.md:41`; `adr/0013:102`;
`CONTRIBUTING_AI.md:184`; `DB_SETUP.md:137,162,95`; `CICD.md:122`; `BUGS.md:1456` (BUG-029 still
Open after its fix shipped); `LOGGING_GUIDE.md:328` (the whole feature had no durable id),
`:333` (retired claims kept beside their replacement), `:452` (a review stamp in a heading).
R1 (1): `llm-log-handler.ts:217` — ADR-0013 §8 confined the LLM callback to `debug`; the code
makes it a durable writer. Resolved by the owner-approved §8 amendment, not by a code change.

### Round 3 — 2026-09-22

**Verdict: BLOCKED — 15 blocking, none yet closed.** They are carried into their own plan,
`llm-io-audit-trail-closeout.md`; this branch does not merge until that plan closes them.
Again roughly half were introduced by the previous round's fixes, which is what prompted the
`close-out-review` skill to gain a remediation section (`abc39d9c`).

**Behaviour (1).** `llm-log-handler.ts:76` — INV-LLM-008 claims a build-enforced guard, but
`@langchain/openai` `completions.js:59` sends `max_completion_tokens` for reasoning models
(`o\d*`, `gpt-5*`) and `EXTRA_INVOCATION_PARAM_FIELDS` maps only `max_tokens`; the guard is
pinned to `gpt-4o-mini` so it stays green. Unreachable on today's model, but the invariant
promises more than the code delivers.

**Code, proven by the existing suites (3).** `personas.ts:8` duplicates
`evals/scenarios/fl-shared.ts:13` — round 2's shared fixture reinvented an existing one;
`llm-log-handler.ts:42` `OpenAIMessage` restates `RecordedRequestMessage`, the same defect
round 2 fixed one file over, in the producer; `print-transcript.integration.test.ts:81,112,161,188`
plus `transcript-order.integration.test.ts:71` carry five inline `ConversationRunRecord` literals
where `:155` already defines a spread base.

**Text, closed by re-reading the section and grepping inbound references (11).**
`adr/0013:397` names `persist.node.ts`, deleted in P3 — the line lives at `commit.node.ts:130`;
`adr/0013:102` still enumerates two transcript writers where `ARCHITECTURE.md:376` says three;
`adr/0013:383` asserts the superseded wording is "kept nowhere but git" and quotes it ten lines
below; `ARCHITECTURE.md:376` over-claims that every writer numbers `seq` and carries `run_id`
(`appendSystemNote` does neither); `ARCHITECTURE.md:165` omits `seq.ts`; `CICD.md:147` cites
deploy step numbers the round-2 insertion shifted; `CICD.md:350` documents the second cron
without the crontab line § 7a gives; `DB_SETUP.md:160` reattached a Purpose block containing law
P4 retired (phase isolation, sliding window); `print-transcript.ts:12` carries a review stamp —
an unfixed round-1 finding; `print-transcript.ts:10` cites the plan's superseded 100–250 KB
estimate against BR-LLM-011's measured ~150 KB; and eleven comments across `src/` and `tests/`
cite "close-out R2 finding N", which resolved to nothing until this section existed.

### Round 4 — 2026-09-22

**Verdict: BLOCKED — 2 blocking, 2 advisory.** All four zones ran on the branch as the
close-out plan left it (Tasks A, B and C closed round 3's fifteen). **R1 returned nothing**,
including on the ADR-0013 §8 amendment: it checked that edit against `SUPERPOWERS_INTEGRATION.md`
rule 3 and found the owner's decision recorded in the close-out plan, so the edit satisfies the
rule rather than violating it. **R3 returned no blocking finding** and re-ran all four suites
itself with matching counts. The two blocking findings are both the same shape as findings the
previous round closed — one file over, in a directory the closure's own check did not look at.

**Blocking (2).**
1. R2 — `llm-call-recorder.integration.test.ts:66` (also `:77`, `:112`, and
   `llm-invocation-wiring.integration.test.ts:70`) restate `RecordedRequestMessage` inline as
   `as { messages: Array<{ role: string; content?: string }> }`, though both files already import
   from `@infra/ai/llm-call-recorder`. DRY (`CONTRIBUTING_AI.md` § Principles & Boundaries). This
   is round 3's `OpenAIMessage` finding, which Task B fixed in the producer and not in the tests
   that read what it produces.
2. R4 — `deploy/deploy.sh:61` still reads `# --- Capture container logs (AC-AT-6) ... ---`, the
   last plan-scoped citation in the repo. Task C Step 5's own verification command was
   `grep -rn 'AC-AT-' docs/ apps/`, and `deploy/` is neither: the check was narrower than the
   claim it was meant to prove. Confirmed by a repo-root grep, which returns this one line.
   `AC-AT-6` → `BR-LLM-011`.

**Advisory (2), neither new to this branch.** R2: `print-transcript.ts:41` is a fourth
hand-rolled `indexOf` flag parser — the existing `BACKLOG.md` "Evals tooling duplication trio"
entry should be widened rather than a new one opened. R3: Task 2's flagged owner decision —
whether `compact()` records its own failed run, or manual compaction is stated to be outside the
run log — was never made and is written down nowhere; `conversation-run.adapter.ts:228` still
only logs and rethrows. The loss is the run-level cause only: the model call itself is still in
`llm_calls`, which has no FK to `conversation_runs`.

**Both blocking findings are closed** (orchestrator, at the owner's instruction, 2026-09-22),
and the re-run of the two zones that raised them found one more defect in the fix itself.

- R2 is closed and **re-ran clean**: `RecordLlmCallRequest` is imported at all four sites, no
  `as { messages: Array<…> }` restatement survives anywhere in `apps/server`, and the fix commit
  introduced nothing.
- R4's first fix was wrong and **its re-run caught it**. Swapping `AC-AT-6` for `BR-LLM-011` in
  `deploy/deploy.sh:61` was mechanical: `AC-AT-6` covered two unrelated mechanisms — the
  `llm_calls`/`prompt_blobs` payload retention, which is what BR-LLM-011 actually governs, and
  capturing container logs before a deploy recreates the containers, which no durable rule covers
  at all. The comment now states the behaviour and points at the two `LOGGING_GUIDE.md` sections
  that hold its rationale and contract, which is what the close-out plan's own Step 4 prescribes
  when no durable id exists. That no rule exists for the deploy-time half is filed as a meta
  finding, not invented here.

Verified after both fixes: `tsc --noEmit` clean, lint 0 errors, unit 126/1203, integration 33/555
(+1 todo), scenarios 9/343 (+1 todo), repro 2 suites / 4 failures unchanged, `bash -n
deploy/deploy.sh` clean, and `grep -rn 'AC-AT-'` **from the repository root** returns nothing
outside the two plan files, `BUGS.md` and `REVIEW_FINDINGS.md`.

**Advisories** stay unfixed on this branch, per the zone contract; the BACKLOG entries are the
owner's call.

**Meta (5)** — filed in `docs/REVIEW_FINDINGS.md`, not acted on here. The fourth is the
re-run's: `AC-AT-6` bundled two mechanisms, so retiring it collapsed them onto one id, and the
deploy-time half still has no durable rule.

### Deferred — evidence exists only after merge

Both are the orchestrator's, both were raised as blocking in rounds 1–3 and cannot be closed on
the branch. Per `close-out-review` § Report and route they are recorded here instead.

- **AC-AT-6, the `deploy.sh` log capture.** `deploy/deploy.sh:61-83` has no test and no
  shellcheck gate. Owed: `ssh filko.dev "cd /srv/docker/fitcoach && ./deploy/deploy.sh dev"`
  **twice** — per `CLAUDE.md` the first deploy after a `deploy.sh` change runs the previous
  version — then confirm `logs/dev/*.log` exists and holds the pre-recreate output.
- **AC-AT-5, the `print-transcript` CLI wrapper.** Its flag dispatch, `--env-file` override and
  teardown are covered by no test. Owed: `docker exec -it fitcoach-dev-server npm run
  print-transcript -- --run <id> --payloads` on dev, against a real run.

