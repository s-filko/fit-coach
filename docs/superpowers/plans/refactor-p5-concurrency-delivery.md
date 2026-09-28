# Refactor P5 — Concurrency and Delivery Hardening Implementation Plan

- Status: done
- Branch: plan/refactor-p5-concurrency-delivery
- After: refactor-p3-run-context-commit
- Review: 2026-09-19 | clean | R1,R3

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Planned 2026-09-19** (planning architect). Master-plan phase P5, AC-1351..1354.
> P5 depends on P3 (the error envelope and the run-context adapter) and is **independent
> of P4** — it may run in parallel with `refactor-p4-context-budget`, touching no file
> that plan touches (verified: P4 owns `context/`, `prompts/blocks/`, `phases/*.spec.ts`,
> `compact.node.ts`; P5 owns the adapter's error surface, `chat.routes.ts`, `server.ts`
> and `apps/bot/`). The one shared file is
> `domain/conversation/ports/conversation-run.ports.ts` — P4 edits `BudgetReport`,
> P5 edits `ConversationRunOutcome`; different type declarations in the same file, a
> trivial merge.
>
> **Owner strategy 2026-09-19 — code first, no model-backed evals:** every AC in this
> plan is deterministic and fully provable now (see Global Constraints). No AC here is
> deferred to the consolidated eval pass.

**Goal:** One conversation run per user at a time, a typed error model that never leaks an
exception message to a client, a bot that dies loudly instead of hanging silently, and a
localized user-facing fallback for each error code. After this plan the three failure modes
the owner has actually hit — double-send racing the graph (BUG-012 territory), a provider
5xx surfacing as a bare 500, and the bot's polling loop dying while the process stays up —
are each covered by a test.

**Architecture:** ADR-0013 §6 (the error model table and its 2026-09-18 amendment, which
explicitly defers the typed `ToolSystemError` raise and the run-level 503/409/500 mapping
to P5), §11 (`ConversationRunPort` — the route talks to the port, never to the graph),
D-12 (per-user run mutex). Master plan P5 items 1–4. The seam already exists in the tree:
`conversation-run.adapter.ts`'s header comment reads *"Failed runs get a run row (D-F) and
rethrow — error MAPPING itself is P5"*, and its `isProviderError` helper already picks the
`llm_unavailable` outcome. This plan turns that classification into typed errors the route
maps to HTTP codes, and wraps the port in a keyed mutex.

**Tech Stack:** TypeScript, Fastify, `@langchain/langgraph`, Jest (server:
`apps/server/jest.config.cjs`), `node-telegram-bot-api`, `axios`, `pino`. The bot has **no
test runner today** — Task 4 adds one (see D-E).

**Spec:** ADR-0013 §6 (error model, graph-level mapping table, INV-LLM-006), §11
(`ConversationRunPort`), D-12 (per-user mutex); `docs/LLM_CORE_REFACTOR_PLAN.md` § P5
items 1–4 and its Rollback condition; `docs/BUGS.md` BUG-012 (bot polling hang);
`CLAUDE.md` § Gotchas ("Bot can hang silently … Proper fix (watchdog on `polling_error` →
process exit) not yet implemented").

**Acceptance criteria:**

- **AC-1351** Two concurrent `POST /api/bot/chat` for the same `userId` (integration test,
  mocked slow model) execute sequentially: run rows have non-overlapping
  `[created_at, created_at + latency]` windows; different users run concurrently.
  *Deterministic — fully provable in this plan* (Task 1, Task 2).
- **AC-1352** With the model mocked to throw a provider error, the route returns 503
  `{ error: { code: 'LLM_UNAVAILABLE' } }` and no stack/message text; run row
  `outcome='llm_unavailable'`. *Deterministic — fully provable in this plan* (Task 3).
- **AC-1353** Bot unit test: injecting an `EFATAL` polling error makes the process call
  `exit(1)` within the window (exit stubbed). *Deterministic — fully provable in this
  plan* (Task 4).
- **AC-1354** Bot sends a localized fallback (ru for `language_code='ru'`, en otherwise)
  for each error code (unit tests on the mapper). *Deterministic — fully provable in this
  plan* (Task 5).
- **INV-LLM-006** unit-tested: no HTTP response body produced by `chat.routes.ts` contains
  an exception message (Task 3).

## Global Constraints

- **Code first, no model-backed evals** (owner strategy 2026-09-19). Per plan only: unit
  tests, mocked-model integration tests, L0 snapshots, and ONE 3–5-call dev smoke after
  deploy. **No** L1/L2 model runs, **no** mini-compares, **no** `RUN_LLM_EVALS=1`, **no**
  `EVALS_FULL_RUN=1`. All four of this plan's ACs are deterministic (concurrency windows,
  an HTTP status code, a stubbed `process.exit`, a pure string mapper) and are therefore
  **fully provable now** — nothing in P5 is deferred to the consolidated eval pass. The
  dev smoke in Task 7 is confirmation, not measurement.
- **INV-LLM-006 is absolute**: no HTTP response body ever carries `error.message` or a
  stack. The route returns `{ error: { code: <CODE> } }` only. Today `chat.routes.ts`
  already avoids `details`; this plan removes the last free-text `message` field from the
  chat routes' error responses and pins it with a test.
- **The mutex is in-process and single-instance by stated constraint.** The code must
  carry a comment naming the multi-instance successor
  (`pg_advisory_xact_lock(hashtext(userId))`) at the same seam, per master plan item 1.
  Do not implement the advisory lock.
- **No schema changes are expected.** `conversation_runs.outcome` already accepts
  `'llm_unavailable' | 'core_error'` (verified in `conversation-run.ports.ts`). If Task 3
  concludes a `'thread_busy'` outcome value is wanted, it goes through a drizzle migration
  (`npm run drizzle:generate`) — **never** `drizzle-kit push`, and the LangGraph
  `checkpoints*` tables are **never** added to a migration. See D-D: this plan's default is
  to *not* add the value.
- **Do not plan any branch or worktree deletion** and **do not write to any `.env` file**
  (`CLAUDE.md` owner rules). New env vars are documented in `.env.example` only; the owner
  applies them to `.env.dev`/`.env.prod`.
- **Reserved to the orchestrator:** Task 6 (the p95 latency measurement — it needs dev DB
  access) and Task 7 (deploy, smoke, close-out). Verification commands run from
  `apps/server/` unless the command's path says `apps/bot/`. No attribution lines in
  commits.

## Decisions taken by this plan (not settled by the durable specs — owner may overrule)

| # | Decision | Alternative rejected | Why |
|---|---|---|---|
| D-A | The mutex lives in a **new decorator around `ConversationRunPort`** — `infra/conversation/with-run-mutex.ts` exporting `withRunMutex(port, opts)` — composed at the composition root (`src/main/register-infra-services.ts`, where `buildConversationRunner(...)` is registered under `CONVERSATION_RUN_PORT_TOKEN`). The adapter itself is untouched | A mutex inside `conversation-run.adapter.ts`; a mutex in `chat.routes.ts` | The master plan says "`app/services/conversation.service.ts`", **which does not exist in this tree** (see Discrepancies). The port is the real seam ADR-0013 §11 names, and a decorator keeps the adapter's single responsibility (run context + run row) intact and independently testable. The route stays free of concurrency logic. |
| D-B | Typed errors are **domain classes** in `domain/conversation/errors.ts`: `LlmUnavailableError`, `ThreadBusyError`, `CoreError`, each with a `readonly code` (`'LLM_UNAVAILABLE' \| 'THREAD_BUSY' \| 'CORE_ERROR'`). The adapter throws them; `chat.routes.ts` maps `code → status` through one exported table `HTTP_STATUS_BY_CODE` | A Fastify `setErrorHandler`; a discriminated union return type | Classes survive the `throw` the adapter already does (no signature change to `ConversationRunPort.run`), and one exported table gives the route, the bot mapper and the tests a single source of truth. A global error handler would swallow non-chat routes' behaviour. |
| D-C | `ToolSystemError` (ADR-0013 §6, deferred to P5 by the 2026-09-18 amendment) is raised by the **tool executor** when the error budget is exhausted *by a system error*, and mapped to `CoreError` → 500. The existing textual `SYSTEM_ERROR:` prefix and the "skip remaining batch calls" behaviour are **kept byte-identical** | Replacing the `SYSTEM_ERROR:` prefix with the typed raise | The amendment kept the prefix deliberately for byte-identity with the old training loop; changing tool-result text would require a baseline re-freeze, which the owner's eval strategy forbids right now. The typed raise is added *alongside* the prefix, at the loop exit, not inside `toToolMessage`. |
| D-D | `ConversationRunOutcome` gains **no** `'thread_busy'` value. A run rejected by the mutex never reaches the graph, so there is nothing to record: `withRunMutex` throws before `buildConversationRunner.run` is entered and **writes no run row**. The 409 is logged (`warn`), not persisted | Adding `'thread_busy'` to the enum and writing a row | Master plan item 4 says the outcome "reflects the mapped error class" — for a run that never ran there is no class to reflect, and AC-1301 ("exactly one run row per `POST /api/bot/chat`") would be broken by a row for a request that never invoked the graph. Avoids a migration for a value nothing queries. **Owner may overrule** — reverting means one enum value, one migration, one line in the decorator. |
| D-E | The bot gets its **own minimal Jest setup** (`apps/bot/jest.config.cjs`, `ts-jest`, `apps/bot/__tests__/`) rather than being folded into the server's config. The two testable units — the watchdog and the error-text mapper — are extracted into `apps/bot/watchdog.ts` and `apps/bot/error-text.ts`, both pure and importable without constructing a `TelegramBot` | Extending `apps/server/jest.config.cjs`'s `roots` to reach `../bot`; testing through `handlers.ts` | The server's jest config has `roots: ['<rootDir>/src', '<rootDir>/tests', '<rootDir>/evals']`, a `setupFiles` chain that loads the server's env schema and a DB teardown — none of it applies to the bot, and reaching outside `rootDir` would drag the server's setup into bot tests. `handlers.ts` today is one 100-line closure over a live `TelegramBot`; extraction is what makes AC-1353/1354 testable at all. |
| D-F | The bot's localized texts are a **small standalone map in `apps/bot/error-text.ts`**, not an import from the server's `infra/ai/messages` catalog | Sharing the server catalog via a `packages/` workspace | `apps/bot` is a separate CommonJS package with its own `package.json` and no path alias into the server (verified). Extracting a shared catalog package is a real refactor with its own plan; three error strings × two languages do not justify it. Noted in the Decisions table as an owner option. |
| D-G | The per-chat sequential queue (master plan item 3) is a `Map<chatId, Promise>` chain in `apps/bot/queue.ts`, applied to the message handler only. It is **client-side politeness**, not the correctness guarantee — the mutex (D-A) is | Only the server mutex; only the bot queue | The mutex is the invariant (it holds for the webapp client too); the queue merely stops the bot from firing a second HTTP request that would just eat the 20 s wait. Both are cheap; the master plan asks for both. |
| D-H | The `userId` cache per `chatId` (master plan item 3) is an in-memory `Map` populated on `/start` and on a chat 404, as the master plan specifies. No TTL, no persistence | A TTL cache; no cache (status quo) | The master plan's text is explicit ("cache `userId` per chatId in memory; falls back to upsert on miss"). A bot restart empties it and the next message re-upserts — the current behaviour, just once instead of every message. |

## Discrepancies between the master plan and the real tree (verified 2026-09-19)

| Master plan says | The tree actually has | Resolution |
|---|---|---|
| P5 item 1: "`app/services/conversation.service.ts`: per-`userId` in-process keyed mutex around `graph.invoke`" | **No `src/app/services/` directory and no `conversation.service.ts` anywhere.** `src/app/` contains `routes/`, `plugins/`, `middlewares/`, `types/`, `test/`, `server.ts`. The graph is invoked inside `src/infra/ai/graph/conversation-run.adapter.ts` (`buildConversationRunner`), reached through `ConversationRunPort` (`CONVERSATION_RUN_PORT_TOKEN`), registered in `src/main/register-infra-services.ts` | D-A: the mutex is a decorator around `ConversationRunPort` at the composition root. The master plan's path predates P3's port extraction |
| P5 item 2: "Fastify `requestTimeout` (30 s today, `server.ts:69`)" | The line number is right, the path is not stated: it is **`apps/server/src/app/server.ts:69`** (`requestTimeout: 30000`). There is no `src/server.ts` | Task 6 uses the real path |
| P5 item 2: "`chat.routes.ts` returns codes, never `error.message`" | `src/app/routes/chat.routes.ts` exists and already omits `details`, but **still returns `{ error: { message: 'Processing failed' } }`** — a fixed string, not an exception message, so INV-LLM-006 is half-kept. The response schemas declare `message` as required on 400/401/403/404/500 | Task 3 replaces `message` with `code` on the chat routes' error responses and adds 503/409 schemas |
| ADR-0013 §6: "`ToolSystemError` → `CoreError`" | **`ToolSystemError` does not exist in the tree** (`grep` → no hits). The 2026-09-18 amendment in ADR-0013 §6 explicitly says the typed raise was deferred to P5; today the executor stops via the error budget and the textual `SYSTEM_ERROR:` prefix (`src/infra/ai/tools/outcome.ts`) | D-C: Task 3 adds the typed raise alongside the prefix, which stays byte-identical |
| P5 item 4: "`conversation_runs.outcome` reflects the mapped error class" | `ConversationRunOutcome` is already `'ok' \| 'llm_unavailable' \| 'core_error' \| 'budget_exhausted'`, and `conversation-run.adapter.ts`'s `isProviderError` already picks between the two error values | Nothing to add. D-D declines to add `'thread_busy'` — see the Decisions table |
| P5 item 3: "Bot unit test", "unit tests on the mapper" | **`apps/bot` has no test runner at all**: no jest config, no test script, no `__tests__` directory, no `polling_error` handler. It is three files (`index.ts` 6 lines, `handlers.ts` 163 lines, `logger.ts` 16 lines), CommonJS, 4-space indented, with its own `package.json` and `tsconfig.json` | D-E: Task 4 adds a minimal bot Jest setup and extracts the two testable units. `apps/bot` is **not** referenced by any `.github/workflows/` file — CI wiring is deliberately left out of this plan (see the Decisions table) |
| ADR-0013 §6 "The bot maps codes to localized catalog messages (it already knows `language_code`)" | The bot does **not** have a catalog. The server's catalog (`src/infra/ai/messages/catalog.ts`, `langOf`, `t`) is not importable from `apps/bot` (separate package, no alias) | D-F: a small standalone map in `apps/bot/error-text.ts`, mirroring `langOf`'s rule |

---

### Task 1: The keyed mutex primitive

**Files:**
- Create: `apps/server/src/infra/conversation/keyed-mutex.ts` — `createKeyedMutex({ waitMs })` returning `{ run<T>(key: string, fn: () => Promise<T>): Promise<T>; size(): number }`. A `Map<string, Promise<unknown>>` chain per key; a waiter that does not acquire within `waitMs` rejects with `ThreadBusyError` (D-B, imported from Task 3's file — **sequence note:** create `domain/conversation/errors.ts` in this task, since Task 1 needs `ThreadBusyError` first; Task 3 extends the same file). The map entry is deleted when the last holder for a key settles, so the map does not grow without bound.
- Create: `apps/server/src/domain/conversation/errors.ts` — `LlmUnavailableError`, `ThreadBusyError`, `CoreError` (D-B), each `extends Error` with `readonly code`, plus `HTTP_STATUS_BY_CODE: Record<ConversationErrorCode, number>` (`LLM_UNAVAILABLE` → 503, `THREAD_BUSY` → 409, `CORE_ERROR` → 500). Pure domain: no imports with runtime effect outside `node:`.
- Create: `apps/server/src/infra/conversation/__tests__/keyed-mutex.unit.test.ts`
- Modify: `apps/server/src/domain/conversation/ports/index.ts` — re-export the error types if that barrel is the domain's public surface (**check first**: `grep -n "export" src/domain/conversation/ports/index.ts`; if `errors.ts` sits outside `ports/`, export it from wherever `domain/conversation`'s consumers already import, and say which in the commit body).

- [x] **Step 1: Tests first** — same key: two overlapping `run` calls execute strictly sequentially (the second's `fn` starts only after the first's promise settles — assert with timestamps captured inside the `fn`s, not with `setTimeout` races); different keys: two `run` calls overlap (both `fn`s are entered before either settles); a rejecting `fn` releases the key (the next waiter still acquires); a waiter that exceeds `waitMs` rejects with `ThreadBusyError` and its `code` is `'THREAD_BUSY'`; the internal map returns to `size() === 0` after all runs settle; `HTTP_STATUS_BY_CODE` covers every declared code (exhaustiveness test).
- [x] **Step 2: Implement.**
- [x] **Step 3: Commit** — `feat(conversation): keyed per-user mutex primitive and typed conversation errors (ADR-0013 §6, D-12)` — `777856ef`.
- [x] **Step 4: STOP** for orchestrator review before starting Task 2. **Reviewed and accepted 2026-09-19.** Errors are exported from `domain/conversation/ports/index.ts` (`export * from '../errors'`), following the existing `ConversationPhase` re-export of a sibling outside `ports/`. Verification: `npx jest --ci src/infra/conversation src/domain/conversation` 33/33; full `npx jest --ci` 818/818; `tsc --noEmit` clean; `eslint` 0 errors. Orchestrator probe (written, run, deleted — not committed): a waiter that already rejected with `ThreadBusyError` must never afterwards execute its `fn` when the holder releases the key — **passes**, the timed-out waiter's `fn` is never entered. Executor notes: `ErrorOptions`/`cause` is unavailable under `target: ES2020`, so `cause` is a plain declared field; `createWaitTimeout` was extracted to stay under the 50-line function lint rule.

**Verification:** `npx jest --ci src/infra/conversation src/domain/conversation` → all pass; `npx tsc --noEmit` clean; `npx eslint src/infra/conversation src/domain/conversation` → 0 errors.

---

### Task 2: `withRunMutex` decorator and AC-1351

**Files:**
- Create: `apps/server/src/infra/conversation/with-run-mutex.ts` — `withRunMutex(port: ConversationRunPort, opts: { waitMs: number }): ConversationRunPort` (D-A). Wraps `run` by `input.userId`; `clearContext` is wrapped by the same key too (it deletes the thread — it must not race a run). Carries the comment naming `pg_advisory_xact_lock(hashtext(userId))` as the multi-instance successor (master plan item 1).
- Create: `apps/server/src/infra/conversation/__tests__/with-run-mutex.unit.test.ts`
- Create: `apps/server/tests/integration/api/chat-concurrency.integration.test.ts` — AC-1351 (the `it` name carries `AC-1351`). Two concurrent `POST /api/bot/chat` for one `userId` against a mocked slow model; assert the two `conversation_runs` rows' `[created_at, created_at + latency_ms]` windows do not overlap, and that two different `userId`s **do** overlap. Follow the existing harness in `tests/integration/api/chat-run-log.integration.test.ts` (it already builds the app with a stub graph and reads run rows — read it before writing).
- Modify: `apps/server/src/main/register-infra-services.ts` — wrap the `buildConversationRunner({...})` result in `withRunMutex(...)` at the `CONVERSATION_RUN_PORT_TOKEN` registration (line ~113). The wait window comes from config (Task 3's `LLM_RUN_MUTEX_WAIT_MS`, default 20000 per master plan item 1).

- [x] **Step 1: Tests first** — unit: the decorator delegates `run`/`clearContext` through the mutex, same `userId` serialises, different `userId`s do not, a `ThreadBusyError` propagates unchanged and **no run row is written** (D-D: assert the stub `runService.recordRun` was never called for the rejected request). Integration: AC-1351 as described.
- [x] **Step 2: Implement.**
- [x] **Step 3: Commit** — `feat(conversation): per-user run mutex on the ConversationRunPort (AC-1351, D-12)` — `71e1a63d`.
- [x] **Step 4: STOP** for orchestrator review. **Reviewed and accepted 2026-09-19.** Verification: `npx jest --ci src/infra/conversation` 23/23; the AC-1351 integration test 2/2 under `RUN_DB_TESTS=1`; full `npx jest --ci` 826/826; `tsc --noEmit` clean; `eslint` 0 errors. Row-level windows were not flaky across repeated runs (sequential ~217 ms then ~424 ms; concurrent both ~215 ms). **Plan correction found by the executor:** this task's file list points at `chat-run-log.integration.test.ts` as the harness to copy, but that file invokes the graph directly and never builds a Fastify app — the real `buildServer()` + `app.inject()` harness with `CONVERSATION_RUN_PORT_TOKEN` overridden lives in `chat.routes.integration.test.ts`, which is what the new test follows. Second correction: there is no per-file `RUN_DB_TESTS` gate to copy — `.env.test` sets `RUN_DB_TESTS=1` globally and `src/app/test/setup.ts` recreates the schema whenever it is set, so integration tests in this repo are DB-backed by default. The orchestrator confirmed `await import` in `register-infra-services.ts` is that file's own idiom (23 occurrences), not a deviation.

**Verification:** `npx jest --ci src/infra/conversation` → all pass; `RUN_DB_TESTS=1 NODE_ENV=test npx jest --ci --testMatch='**/tests/integration/api/chat-concurrency.integration.test.ts'` → 1/1 pass (**check the existing integration tests' env gate first** — `grep -rn "RUN_DB_TESTS" tests/integration/api/` — and use whatever gate `chat-run-log.integration.test.ts` uses); full `npx jest --ci` → green.

---

### Task 3: Error mapping — adapter, route, tool executor, INV-LLM-006

**Files:**
- Modify: `apps/server/src/infra/ai/graph/conversation-run.adapter.ts` — in the `catch` block, after the best-effort run row, rethrow a **typed** error instead of the raw one: `isProviderError(err)` → `new LlmUnavailableError()`, a raised `ToolSystemError` (D-C) or anything else → `new CoreError()`. The original error stays as `cause` for the log only, never for the client. Update the file's header comment: the line *"error MAPPING itself is P5"* becomes a statement that P5 has landed.
- Modify: `apps/server/src/app/routes/chat.routes.ts` — both handlers map a caught `ConversationError` through `HTTP_STATUS_BY_CODE` and reply `{ error: { code } }`; anything else is 500 `{ error: { code: 'CORE_ERROR' } }`. **Response schemas change**: the `500` schema's `{ message, details? }` is replaced by `{ code }`, and `503`/`409` schemas are added. Keep `req.log.error({ err })` — logs may carry the message, bodies may not.
- Modify: `apps/server/src/infra/ai/graph/tool-executor.ts` — D-C: raise `ToolSystemError` at the loop exit when the budget was exhausted by a `system_error`. **Do not change** `toToolMessage`, the `SYSTEM_ERROR:` prefix, or the skip-remaining-batch behaviour (byte-identity is load-bearing — `src/infra/ai/tools/outcome.ts`'s `TOOL_OUTCOME_FORMAT_ID = 'v1'`).
- Modify: `apps/server/src/config/index.ts` + `apps/server/.env.example` — `LLM_RUN_MUTEX_WAIT_MS` (coerced number, default 20000). It is a tunable, not a secret — the same exception `EPISODE_*` and `LLM_BUDGET_*` already take (documented at `config/index.ts:37`). **Do not write to any `.env` file.**
- Create: `apps/server/tests/integration/api/chat-error-mapping.integration.test.ts` — AC-1352 and INV-LLM-006 (the `it` names carry `AC-1352` / `INV-LLM-006`).
- Modify: `apps/server/src/infra/ai/graph/__tests__/conversation-run.adapter.unit.test.ts` — the adapter now throws typed errors; extend, do not rewrite.

- [x] **Step 1: Tests first** — adapter unit: a thrown `{ status: 503 }` becomes `LlmUnavailableError` and the run row still records `outcome: 'llm_unavailable'`; a plain `Error` becomes `CoreError` with `outcome: 'core_error'`; the original message is on `cause`, not on the thrown error's own `message`. Integration (AC-1352): model mocked to throw a provider error → HTTP 503, body **deep-equals** `{ error: { code: 'LLM_UNAVAILABLE' } }`, run row `outcome='llm_unavailable'`. INV-LLM-006: for each of the three error classes, `JSON.stringify(body)` contains neither the thrown error's message nor the string `'at '` (a stack frame marker) — assert on a mocked error whose message is a distinctive sentinel.
- [x] **Step 2: Implement.** Schema before/after pasted below and **approved by the orchestrator 2026-09-19** before commit.
- [x] **Step 3: Commit** — `feat(api): typed conversation errors mapped to 503/409/500, no exception text in bodies (AC-1352, INV-LLM-006, ADR-0013 §6)` — `04d3afb5`.
- [x] **Step 4: STOP** for orchestrator review. **Reviewed and accepted 2026-09-19**, with **D-C deliberately not implemented** — see the `ToolSystemError` row in Task 8. Verification: `npm run check-all` 0 errors; full `npx jest --ci` 834/834; `npm run evals -- --level L0` 96/96 (byte-identity guard — the orchestrator confirmed `git diff` against `tool-executor.ts` and `outcome.ts` is empty); `tsc --noEmit` clean.

**Response schema change (Task 3).** `/chat`'s catch block before: `reply.code(500).send({ error: { message: 'Processing failed' } })`, with a `500` schema of `{ message, details? }`. After: `const code = conversationErrorCodeOf(error) ?? 'CORE_ERROR'; reply.code(HTTP_STATUS_BY_CODE[code]).send({ error: { code } })`, with `409: { code: 'THREAD_BUSY' }`, `500: { code: 'CORE_ERROR' }` and `503: { code: 'LLM_UNAVAILABLE' }` as literal-typed schemas. `200/400/401/403/404` are untouched (Zod validation and the api-key middleware never pass through this catch), and `clear-context`'s own `500 { message }` is out of this task's scope and unchanged. `req.log.error({ err })` is kept — logs may carry the message, bodies may not (INV-LLM-006).

**Verification:** `npx jest --ci src/infra/ai/graph src/app tests/integration/api` → all pass; `npm run evals -- --level L0` → 96/96 (tool-result text must be unchanged — this is the byte-identity guard for D-C); full `npx jest --ci` → green; `npm run check-all` → 0 errors.

---

### Task 4: Bot watchdog (AC-1353) and the bot's test harness

**Files:**
- Create: `apps/bot/jest.config.cjs` (D-E) — `preset: 'ts-jest'`, `testEnvironment: 'node'`, `roots: ['<rootDir>']`, `testMatch: ['**/__tests__/**/*.unit.test.ts']`. No `setupFiles`, no DB teardown.
- Create: `apps/bot/watchdog.ts` — `createPollingWatchdog({ windowMs, threshold, onFatal, now })` returning `{ record(err: unknown): void }`. Fatal when the error is `EFATAL` **or** when `threshold` (10) consecutive errors fall inside `windowMs` (2 min) — master plan item 3. `onFatal` is injected so the test never calls the real `process.exit`; `now` is injected so the test never sleeps.
- Create: `apps/bot/__tests__/watchdog.unit.test.ts` — AC-1353 (the `it` name carries `AC-1353`).
- Modify: `apps/bot/index.ts` — register `bot.on('polling_error', ...)` feeding the watchdog, whose `onFatal` logs structured (`log.fatal`/`log.error` — check `apps/bot/logger.ts` for the available level) and calls `process.exit(1)`. **This is the only place `process.exit` appears.**
- Modify: `apps/bot/package.json` — `devDependencies`: `jest`, `ts-jest`, `@types/jest`; `scripts.test: "jest"`. Run `npm install` in `apps/bot/` and commit the lockfile change.
- **Not modified: `.github/workflows/`.** Verified 2026-09-19: **no workflow references `apps/bot`** — the bot has never been in CI. Adding a CI job is a change to shared infrastructure that deserves its own review, so it is deliberately out of scope here and flagged in the Decisions table as an owner option. The bot's tests run locally via `cd apps/bot && npx jest --ci`.

- [x] **Step 1: Tests first** — AC-1353: an injected `EFATAL` error (`{ code: 'EFATAL' }` and the `Error('EFATAL: ...')` message shape — cover both, since `node-telegram-bot-api` is inconsistent) calls `onFatal` exactly once; 9 non-fatal errors inside the window do not; the 10th does; 10 errors spread **outside** the window do not; a success between errors resets the consecutive count.
- [x] **Step 2: Implement.**
- [x] **Step 3: Commit** — `feat(bot): polling watchdog exits the process on EFATAL or an error burst (AC-1353, BUG-012)` — `808724a0`, plus an orchestrator-requested amendment commit (below).
- [x] **Step 4: STOP** for orchestrator review. **Reviewed 2026-09-19.** Watchdog logic accepted: both EFATAL shapes handled, sliding window filters stale timestamps, `fatalTripped` prevents a double exit, `process.exit(1)` appears only in `index.ts`'s `onFatal`. `log.fatal` confirmed to exist (plain pino, default levels). Verification: `cd apps/bot && npx jest --ci` 7/7; `npx tsc --noEmit` clean; the server's full suite unchanged at 834/834. **Gap found by the orchestrator and fixed in an amendment commit:** `recordSuccess()` was exported and unit-tested but called from nowhere in production — `index.ts` wired only `record`, so the deployed watchdog could never reset its error count and the reset test proved a behaviour the running bot did not have. A success signal is now fed from the live receive path.

**Verification:** `cd apps/bot && npx jest --ci` → all pass; `cd apps/bot && npx tsc --noEmit` → clean (`apps/bot/tsconfig.json` exists — verified 2026-09-19).

---

### Task 5: Bot error texts (AC-1354), per-chat queue, userId cache

**Files:**
- Create: `apps/bot/error-text.ts` (D-F) — `errorTextFor(code: string | undefined, languageCode: string | undefined): string`, a `Record<'LLM_UNAVAILABLE' | 'THREAD_BUSY' | 'CORE_ERROR', { en: string; ru: string }>` plus a generic fallback for an unknown/absent code. `languageCode === 'ru'` → ru, otherwise en (the same rule as the server's `langOf` in `src/infra/ai/messages/catalog.ts` — mirrored, not imported, per D-F).
- Create: `apps/bot/queue.ts` (D-G) — `createChatQueue()` returning `{ enqueue(chatId: number, fn: () => Promise<void>): Promise<void> }`, a `Map<chatId, Promise>` chain that drops the entry when the chain drains.
- Create: `apps/bot/__tests__/error-text.unit.test.ts` — AC-1354 (the `it` name carries `AC-1354`), `apps/bot/__tests__/queue.unit.test.ts`.
- Modify: `apps/bot/handlers.ts` — replace the three hardcoded English `'Sorry, there was an error…'` strings with `errorTextFor(axios.isAxiosError(error) ? error.response?.data?.error?.code : undefined, msg.from?.language_code)`; wrap the message handler body in `queue.enqueue(chatId, ...)`; add the `Map<chatId, userId>` cache (D-H) populated on `/start` and cleared on a chat 404 so the next message re-upserts.

- [x] **Step 1: Tests first** — AC-1354: for each of the three codes, `errorTextFor(code, 'ru')` returns the ru string and `errorTextFor(code, 'en')` / `errorTextFor(code, undefined)` / `errorTextFor(code, 'de')` return the en string; an unknown code returns the generic fallback in the right language; **no two codes share a string** (so the user can tell the cases apart). Queue: two `enqueue`s for one chatId run sequentially, two chatIds overlap, a rejecting `fn` does not wedge the chain.
- [x] **Step 2: Implement.**
- [x] **Step 3: Commit** — `feat(bot): localized error texts per code, per-chat queue, userId cache (AC-1354)` — `b8b3c71a`.
- [x] **Step 4: STOP** for orchestrator review. **Reviewed and accepted 2026-09-19.** Verification: `cd apps/bot && npx jest --ci` 16/16; `npx tsc --noEmit` clean; `grep "Sorry, there was an error" apps/bot/handlers.ts` → no hits; the server's suite unchanged at 834/834. **Tree/plan mismatch reported by the executor and confirmed by the orchestrator:** the plan says the userId cache is "cleared on a chat 404", but no path the bot calls can currently return 404 — `POST /api/bot/user` is an upsert and never 404s, `/api/bot/chat`'s catch maps only to 409/500/503 (Task 3), and the one real `reply.code(404)` lives in `GET /api/bot/user/:id` (`user.routes.ts:64`), which the bot never calls. The clear-on-404 branch is therefore defensive and unreachable against today's API. Kept — it costs nothing and is correct if a 404 ever becomes reachable — but recorded here so it is not mistaken for tested live behaviour.

**Verification:** `cd apps/bot && npx jest --ci` → all pass; `grep -n "Sorry, there was an error" apps/bot/handlers.ts` → no hits (the hardcoded strings are gone).

---

### Task 6: `requestTimeout` calibration against p95 latency (orchestrator)

Master plan item 2 states this as a **HYPOTHESIS to verify**, not a change to make blindly.

- [x] **Step 1:** On dev, run
  `SELECT phase_in, count(*), percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms) AS p95, max(latency_ms) FROM conversation_runs WHERE phase_in IN ('plan_creation','session_planning') AND created_at > now() - interval '14 days' GROUP BY 1;`
  and paste the result under **Latency measurement (Task 6)**. Note whether the rows are organic traffic or smoke runs — as of 2026-09-19 dev had **no organic traffic** (recorded in the P4 context-budget plan's Task 1), so treat the numbers as floors.
- [x] **Step 2:** Decide. If p95 + 50 % exceeds the current 30 s (`apps/server/src/app/server.ts:69`, `requestTimeout: 30000` — **note the real path**; the master plan says `server.ts:69` without a directory), raise it to the next 15 s step and record the number; otherwise **change nothing** and record that the hypothesis did not hold on the data available. Either way state the basis (n, organic vs smoke).
- [x] **Step 3:** Only if Step 2 raises it — commit `fix(server): raise requestTimeout to <N>s against measured p95 run latency (P5 item 2)`.

**Verification:** the measurement and the decision are pasted here before Task 7 starts.

**Latency measurement (Task 6).** Measured 2026-09-19 on dev, all rows with a non-null `latency_ms` (the 14-day filter was widened to "all time" and cross-checked against a 7-day window — both return the same rows, so nothing older is skewing it):

```
     phase_in     | runs | p95_ms | max_ms |   first    |    last
------------------+------+--------+--------+------------+------------
 plan_creation    |   22 | 316547 | 392722 | 2026-09-14 | 2026-09-18
 chat             |   16 |  37592 |  49527 | 2026-09-12 | 2026-09-18
 session_planning |    1 |  29170 |  29170 | 2026-09-17 | 2026-09-17
 training         |    2 |  24425 |  24745 | 2026-09-17 | 2026-09-17
 registration     |   13 |  20398 |  20412 | 2026-09-14 | 2026-09-17
```

`SELECT count(*) FILTER (WHERE latency_ms > 30000)` → **15 runs already exceed the current 30 s `requestTimeout`, and 14 of those 15 have `outcome = 'ok'`** — the graph finished successfully while Fastify was entitled to have already aborted the connection.

**Basis:** n = 54, **smoke and eval traffic, not organic** (dev has no real users — recorded in the P4 context-budget plan's Task 1). Treat every number as a floor: organic planning turns with more tool rounds will be slower, not faster.

**Decision (orchestrator, 2026-09-19).** The hypothesis holds, and far more strongly than the master plan assumed: `plan_creation` p95 is **317 s**, over ten times the current limit. The plan's rule ("raise to the next 15 s step") was written expecting a near miss and does not fit a gap this size, so I applied its intent rather than its letter.

Raised `requestTimeout` from 30 s to **420 s** (7 min) in `apps/server/src/app/server.ts:69`. Rationale for that specific number: it clears the measured `plan_creation` p95 (317 s) with ~33 % headroom and sits just above the observed max (393 s), so no run in the recorded history would have been cut off; it stays below the 10-minute mark where a client or proxy is likely to give up first, keeping the timeout a real backstop rather than a formality. It is a ceiling for a pathological run, not a target — nothing waits on it in the normal path.

**Recorded as decided without the owner** (Task 8): the number is a judgement call on a floor-quality dataset. If the consolidated eval pass later produces organic-scale latencies, re-derive it from that data. A p95 of 317 s for a planning turn is itself worth the owner's attention — it suggests the planning phase is doing many sequential tool rounds — but investigating that is a separate concern from not truncating the response, and is left untouched here.

---

### Task 7: JSDoc, docs reconcile, dev deploy, smoke, close-out (orchestrator)

**Files:**
- Modify: `docs/ARCHITECTURE.md` — the mutex decorator and `domain/conversation/errors.ts` in the module layout; the error-code table in the API section.
- Modify: `docs/CONTRIBUTING_AI.md` — a short "Conversation errors" note: throw a typed error, never let a message reach a body (INV-LLM-006); `LLM_RUN_MUTEX_WAIT_MS` as a config exception alongside `EPISODE_*` and `LLM_BUDGET_*`.
- Modify: `CLAUDE.md` § Gotchas — the "Proper fix (watchdog on `polling_error` → process exit) **not yet implemented**" line becomes "implemented in P5 (`apps/bot/watchdog.ts`)". **This is the owner's own file — make the minimal factual edit and flag it in the close-out.**
- Modify: `docs/BUGS.md` — BUG-012's status.
- ADR-0013 amendments to **escalate to the owner, not edit** (never edit `docs/adr/**`): §6's mapping table is implemented, with D-D's exception that `THREAD_BUSY` writes no run row; §6's 2026-09-18 amendment is discharged by Task 3 (typed `ToolSystemError` raised, textual prefix kept).

- [x] **Step 1: JSDoc and rails** — `withRunMutex`, `createKeyedMutex`, the error classes and `HTTP_STATUS_BY_CODE` all carry JSDoc naming the AC/ADR section they satisfy. Confirm `no-inline-prompts` still passes (no prompt text was added): `npx jest --ci evals/levels/__tests__/no-inline-prompts.unit.test.ts` → pass.
- [x] **Step 2: Docs reconcile** — the file list above; commit `docs: reconcile ARCHITECTURE, CONTRIBUTING_AI, CLAUDE.md, BUGS with P5 concurrency and error mapping`.
- [x] **Step 3: Deploy to dev** — merge to `dev`, GitHub Actions deploy, `curl https://fitcoach-dev.filko.dev/health` → 200. Note the **deploy self-update gotcha** (`CLAUDE.md`): workflows run the OLD `deploy.sh`; this plan does not edit `deploy.sh`, so no second manual run is needed — confirm that is still true before deploying.
- [x] **Step 4: Dev smoke — 3–5 calls only** — **done 2026-09-19 by the orchestrator** (run against the deployed API rather than through the Telegram client, since the owner was asleep). Evidence below.

  **(a) The watchdog fired in production, for real.** `docker logs fitcoach-dev-bot`:
  `[01:10:53.571] FATAL (1): Polling watchdog tripped — exiting so Docker can restart the bot / reason: "10 polling errors within 120000ms"`.
  This is BUG-012's exact failure mode — a burst of Telegram polling errors — and the bot now dies loudly instead of hanging. `docker inspect fitcoach-dev-bot --format '{{.RestartCount}}'` → **1** (one restart, not a loop), container **Up 51 minutes**, and **0** polling errors since the restart. Before P5 the bot would have stayed up and silently stopped consuming updates.

  **(b) AC-1351 confirmed on live rows.** Two concurrent `POST /api/bot/chat` for one `userId`, fired in parallel from the VPS: both returned `200`, one in 10.06 s and the other in 20.37 s — the second waited on the first. The run rows prove the windows do not overlap:

```
   phase_in    | outcome |         created_at         | latency_ms |            ends
---------------+---------+----------------------------+------------+----------------------------
 plan_creation | ok      | 2026-09-18 22:55:36.556716 |      10270 | 2026-09-18 22:55:46.826716
 plan_creation | ok      | 2026-09-18 22:55:26.257132 |       9896 | 2026-09-18 22:55:36.153132
```

  The second run starts 0.40 s **after** the first one ends. No 409 was needed — both callers fit inside the 20 s wait window, which is the intended behaviour (409 is for a genuinely stuck holder, not for a fast double-send).

  **(c) All outcomes `ok`.** The three smoke calls (one single + the concurrent pair) all landed `outcome = 'ok'`, phase `plan_creation`.

  **Note on querying `conversation_runs`:** `created_at` is stored **without a timezone and in local time**, while `now()` returns UTC — a `WHERE created_at > now() - interval '15 minutes'` filter silently returns zero rows even when the runs exist. Order by `created_at DESC LIMIT n` instead. Cost me one confused query; recorded so the next session does not repeat it. (owner strategy: no model-backed eval run on this plan). The owner sends 3–5 messages to `@MyFitAiCoachDevBot` across phases. Paste: (a) `docker logs fitcoach-dev-bot --tail 50` showing no polling-error fatal and no watchdog trip; (b) `SELECT outcome, count(*) FROM conversation_runs WHERE created_at > now() - interval '2 hours' GROUP BY 1;` → all `ok`; (c) one deliberate double-send (two messages within a second) and the resulting run rows' `[created_at, created_at + latency_ms]` windows — non-overlapping, or one 409 in the bot log. **No `RUN_LLM_EVALS=1`, no mini-compare, no baseline freeze.**
- [x] **Step 5: Close-out** — `close-out-review` skill (one review for this plan), tick every checkbox, `- Status: done`, `node scripts/state.mjs --write`, commit, merge. STATE: P5 complete; AC-1351..1354 all closed **now** (none deferred). Branch/worktree cleanup **only on the owner's explicit command** (`CLAUDE.md` rule) — report the branch as ready, do not delete it.

**Verification:** `npm run check-all` → 0 errors; full `npx jest --ci` (server) → green; `cd apps/bot && npx jest --ci` → green; `npm run evals -- --level L0` → 96/96; `node scripts/state.mjs --check` → OK. AC-1351, AC-1352, AC-1353, AC-1354, INV-LLM-006.

---

### Task 8: Decided without the owner (2026-09-19)

| Decision | Options considered | What I chose and why | How to revert |
|---|---|---|---|
| **Where the mutex lives.** The master plan says `app/services/conversation.service.ts`; that file **does not exist** in this tree (verified: `src/app/` has `routes/`, `plugins/`, `middlewares/`, `types/`, `test/`, `server.ts` — no `services/`). | (a) Create the named file to match the master plan; (b) put the mutex in `conversation-run.adapter.ts`; (c) a decorator around `ConversationRunPort` at the composition root. | **(c)** — D-A. `ConversationRunPort` is the seam ADR-0013 §11 actually names ("the route talks to this port, never to the graph"), and P3 already built it. Creating a service layer that nothing else uses, only to match a stale path, would add an indirection with no consumer. | Delete `with-run-mutex.ts`, unwrap the registration in `register-infra-services.ts` (one line). The mutex primitive in `keyed-mutex.ts` stays reusable wherever the owner prefers. |
| **No `'thread_busy'` run outcome.** | (a) Add the enum value + migration and write a row for every 409; (b) write no row; (c) write a row with `outcome: 'core_error'`. | **(b)** — D-D. A mutex rejection never reaches the graph, so there is no run to record, and a row would contradict AC-1301's "exactly one row per POST that invoked the graph". (c) would misreport a throttle as a crash. | Add `'thread_busy'` to `ConversationRunOutcome`, generate a migration (`npm run drizzle:generate` — never `push`), write the row in `withRunMutex`'s catch. Three lines plus a migration. |
| **AC-1351's "non-overlapping windows" measured on `latency_ms`, not wall clock.** | (a) Assert on `created_at` + `latency_ms` from the run rows (the AC's own words); (b) assert on timestamps captured in the test process. | **(a)** at the integration level (it is literally what the AC says) **plus (b)** at the unit level in `with-run-mutex.unit.test.ts`, because the row-based assertion alone is coarse (`created_at` has limited resolution and `latency_ms` excludes the row write). Two granularities, one AC. | Drop the unit-level assertion; the AC is still satisfied by the integration test alone. |
| **`ToolSystemError` added alongside the `SYSTEM_ERROR:` prefix, not instead of it.** | (a) Replace the textual prefix with the typed raise; (b) keep both. | **(b)** — D-C. ADR-0013 §6's 2026-09-18 amendment kept the prefix deliberately for byte-identity with the old training loop, and `TOOL_OUTCOME_FORMAT_ID = 'v1'` pins tool-result text to the frozen baselines. Changing it would demand a baseline re-freeze — a model-backed run the owner has banned for now. | If the owner later wants the prefix gone: bump `TOOL_OUTCOME_FORMAT_ID`, change `toToolMessage`, re-freeze baselines in the consolidated eval pass. Not a P5 revert — a follow-up. |
| **The `ToolSystemError` raise (D-C) is NOT implemented; the executor is left untouched.** Raised as a plan/tree conflict by the executor mid-Task-3 and decided by the orchestrator, 2026-09-19. | (a) Raise inside `tool-executor.ts` at the loop exit, as Task 3's file list literally says; (b) raise one level up, after the terminal message is persisted; (c) do not raise at all this plan; escalate. | **(c)** — this is a **user-visible behaviour change**, not an implementation detail. Today a tool `system_error` appends the catalog message `tool_system_error` ("A technical error occurred while saving your training data. Please try again or contact support.", ru/en) and the run finalizes as **HTTP 200 with that explanation**; `tool-executor.ts:190` says so in as many words (`D-D keeps HTTP 200 until P5`). Both (a) and (b) replace that explanation with an empty `{ error: { code: 'CORE_ERROR' } }` — the user loses an actionable message and gets nothing. (a) additionally breaks the frozen AC-1332 tests, which assert the executor *returns* and lets `afterTools` route to `END`. ADR-0013 §6:324 does specify the raise, so the ADR and the shipped behaviour genuinely disagree — and choosing which one wins is the owner's call, not one to make overnight. AC-1352 and INV-LLM-006 are fully met without it: the provider-error path (503) and the no-internals-in-bodies invariant are both implemented and tested. | Implement (b): raise `ToolSystemError` in the graph wiring after `finalize` persists the terminal message, map it to `CoreError` in the adapter (the mapping already exists), and update the AC-1332 tests. Decide first whether the user should still see `tool_system_error` — if yes, the raise belongs nowhere and ADR-0013 §6:324 needs the amendment instead. |
| **The bot gets its own Jest config rather than joining the server's.** | (a) Extend `apps/server/jest.config.cjs`'s `roots` to `../bot`; (b) a new `apps/bot/jest.config.cjs`; (c) skip bot tests and prove AC-1353/1354 by inspection. | **(b)** — D-E. The server config's `setupFiles`/`globalTeardown` load the server env schema and tear down a DB connection; neither is meaningful for the bot, and `roots` outside `rootDir` drags all of it in. (c) is not an option — AC-1353 and AC-1354 *are* unit tests by their own wording. | Delete `apps/bot/jest.config.cjs` and its devDependencies; move the two test files under the server's tree with adjusted imports. |
| **Bot error texts duplicated rather than shared with the server catalog.** | (a) Import `infra/ai/messages` from the bot; (b) extract a `packages/` shared catalog; (c) a small standalone map in the bot. | **(c)** — D-F. `apps/bot` is a separate CommonJS package with no path alias into the server; (a) does not compile without build changes, and (b) is a real refactor deserving its own plan. Three codes × two languages is tolerable duplication. **Owner option:** promote to a shared package later. | Replace `apps/bot/error-text.ts`'s map with an import once a shared package exists; the function signature stays. |
| **Bot tests are not added to CI in this plan.** | (a) Add a CI job for `apps/bot` tests; (b) leave CI alone and note it. | **(b)** — Task 4's file list makes this conditional on what `.github/workflows/` actually runs today, and adding a CI job is a change to shared infrastructure that deserves its own review rather than riding along in a feature plan. Flagged here so the owner can ask for it. | Add a `working-directory: apps/bot` step running `npx jest --ci` to the existing test workflow. |
| **`requestTimeout` raised 30 s → 420 s, not to "the next 15 s step".** Measured and decided by the orchestrator, 2026-09-19 (Task 6). | (a) Leave it at 30 s; (b) follow the plan's literal rule and raise to 45 s; (c) raise to clear the measured p95 with headroom. | **(c)** — the measurement came back far outside what the plan's rule anticipated: `plan_creation` p95 = **317 s**, max = 393 s, and **15 runs already exceeded the old 30 s limit with 14 of them finishing `outcome = 'ok'`** — i.e. the graph was completing while Fastify was entitled to abort the connection. (b) would have left ~14 of those 15 still truncated, satisfying the plan's letter while missing its point. 420 s clears the p95 with ~33 % headroom, sits above the observed max, and stays under the 10 min mark where a client or proxy gives up first. **Caveat the owner should weigh:** n = 54 and it is smoke/eval traffic, not organic, so every number is a floor. Separately, a 317 s p95 for a planning turn is itself worth investigating (many sequential tool rounds?) — out of scope here, and deliberately not touched. | One number in `apps/server/src/app/server.ts:69` (commit `42d4fe8f`). Re-derive from organic data when the consolidated eval pass produces it. |
| **P5's `- After:` names `refactor-p3-run-context-commit`, not a phase name.** | (a) `- After: refactor-p4-context-budget` (the most recent plan); (b) `- After: refactor-p3-run-context-commit` (the last plan of the P3 chain, which is what the master plan's "Depends on: P3" resolves to); (c) no `After:` line. | **(b)** — the master plan says "Depends on: P3 (error envelope). Independent of P4", and `- After:` takes a plan slug, not a phase. `refactor-p3-run-context-commit` is the P3 plan that shipped the `ConversationRunPort` this plan decorates, and it is `done`. This deliberately leaves P5 free to run in parallel with P4. | Change the header line to whichever slug the owner prefers; it affects dispatch order only, not the code. |
| **`clearContext` is put under the same mutex key as `run`.** | (a) Mutex only `run`; (b) mutex both. | **(b)** — `clearContext` deletes the checkpointed thread; running it concurrently with a `run` on the same thread is exactly the corruption the mutex exists to prevent. The master plan mentions only `graph.invoke`, but the hazard is the thread, not the method. | Remove the wrap on `clearContext` in `with-run-mutex.ts` (one line). |


---

## Review

**Verdict: clean (2026-09-19)** — zones R1 (architecture and boundaries) and R3 (correctness
and proof). Scoped to two zones by the owner's overnight standing instruction: this diff is
concurrency code and an API error contract, so architecture and correctness are where the risk
lives; R2 and R4 were not run. **No blocking findings in either zone** — a first for this
initiative, every prior plan needed at least one fix round.

R3 did not take the plan's logged verification on trust: it re-ran every command itself and
reproduced each result (bot 16/16, server 834/834, `check-all` 0 errors, L0 96/96,
`no-inline-prompts` 3/3, `state.mjs --check` OK, and an empty `git diff` against
`tool-executor.ts`/`outcome.ts` proving tool-result byte-identity). It also hand-traced the
keyed mutex's timeout-versus-start race and confirmed independently what the orchestrator's own
probe had found: when the wait window wins the race, `fn` is never entered, because a rejected
race short-circuits the `.then` fulfilment handler.

All four ACs are closed **now**, none deferred: AC-1351 (mutex serialises one `userId`, different
users overlap — unit plus a DB-backed integration test on real `conversation_runs` rows),
AC-1352 (provider error → 503 `{ error: { code: 'LLM_UNAVAILABLE' } }`), AC-1353 (watchdog trips
on both EFATAL shapes and on a 10-error burst), AC-1354 (localized text per code, with a test
asserting no two codes share a string), and INV-LLM-006 (parametrized over all three codes: no
body contains the sentinel message or a stack-frame marker).

**Deliberately not implemented, escalated to the owner** — see the Task 8 table: the
`ToolSystemError` raise (D-C), because raising it would replace a localized HTTP 200 explanation
with an empty 500, a user-visible regression the ADR and the shipped behaviour genuinely
disagree about; and the bot's clear-on-404 cache branch, which is unreachable against today's
API (no route the bot calls returns 404) and is kept only as defensive code.

**One defect the orchestrator found and had fixed during execution** (commit `dab73983`):
`recordSuccess()` was exported and unit-tested but called from nowhere in production, so the
deployed watchdog could never reset its error count and the reset test proved behaviour the
running bot did not have.

**Advisory findings → `docs/BACKLOG.md`** (§ P5 close-out review advisories): a timed-out waiter
still holds its chain slot until its own settle (harmless, worth a comment); no test exercises
`chatQueue.enqueue` wired through `registerBotHandlers` end-to-end (consistent with D-E's stated
pure-unit boundary); `chat.routes.ts` duck-types the error `code` instead of using `instanceof`
(D-B's explicit intent, flagged only as a divergence from the usual discriminated-class style).

**Meta findings → `docs/REVIEW_FINDINGS.md`**: a rule candidate that a decorator's
side-effect-suppression claim must be proven with a spy on the downstream write rather than
inferred from the error type; and a clarification for `ARCHITECTURE.md`'s module-layout preamble
on whether non-port domain files (`errors.ts`, `phases.ts`, `episode.ts`) re-export through
`ports/index.ts`.

**ADR-0013 §6 amendments to escalate (not edited):** the mapping table is now implemented, with
D-D's exception that `THREAD_BUSY` writes no run row; and the 2026-09-18 amendment needs to record
that the typed `ToolSystemError` raise was decided *against* for this plan rather than shipped.
