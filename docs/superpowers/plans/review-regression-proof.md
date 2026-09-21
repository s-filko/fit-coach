# Review Findings — Reproduction Before Remediation Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans and test-driven-development. The owner explicitly requires the reproduction stage BEFORE fixes; this overrides the usual one-test/one-fix interleaving. Execute only the dispatched task. The coordinator reviews the RED evidence before dispatching remediation.

- Status: planned
- Branch: plan/review-regression-proof

**Goal:** Turn the six findings from the 2026-09-21 review into reproducible behavioral evidence, then remediate confirmed defects in separately reviewed steps.

**Architecture:** Keep production untouched during Tasks 1–3. Exercise real public services, bot handlers, graph and repositories; stub external Telegram/model I/O, not the behavior under test. Keep intentionally RED probes explicitly runnable and outside default green suites until each corresponding fix promotes it to a normal regression test.

**Tech Stack:** TypeScript, Jest, Fastify inject, LangGraph MemorySaver, Drizzle/PostgreSQL, Orca supervised Claude Sonnet.

**Spec:** docs/domain/training.spec.md (INV-TRAINING-002, BR-TRAINING-007/010), docs/adr/0011-training-tool-execution-hardening.md, docs/adr/0013-llm-core-target-architecture.md (error isolation and conversation ownership), docs/superpowers/plans/fact-lifecycle.md (AC-FL-3/8), docs/LLM_CORE_REFACTOR_PLAN.md (AC-1351/1352). Reproduction acceptance IDs AC-RRP-1..8 below are local evidence criteria, not new runtime law.

## Global Constraints

- Owner instruction: first produce genuinely failing tests on unchanged production, then coordinator review, then fixes. No skip, test.failing, inverted assertions, or fabricated failures.
- No live LLM, Telegram, dev/prod data, deployments, pushes or merges. Real DB tests use only the existing local fitcoach_test database. One worker owns that database at a time; use existing fixture cleanup, never truncate unrelated data.
- Worker may edit test files and this plan's task checkboxes/evidence only. No durable specs, STATE.md, dependencies, production code, scripts, migrations, other tasks, other workers, git push, ssh, docker compose, npm run db:* or branch/worktree deletion. Escalate instead.
- Coordinator owns plan, decisions, status transitions, review and eventual delivery. Sonnet is selected explicitly by the owner; no silent provider/model switch.
- RED files use *.repro.test.ts, run via explicit --testMatch commands below. They are deliberately outside default suites, not skipped or disguised as passing. They must become regular *.unit.test.ts or *.integration.test.ts when fixed. Keep a durable evidence table of exact commands, exit codes, assertion failures and baseline SHA.
- Unexpected compilation, fixture, DB connection or authentication failures are NOT reproduction. Report and repair test setup, without editing production. A passing alleged regression must be reported as unconfirmed; never weaken the test to manufacture RED.
- Baseline reviewed: 3f4430b4. Recheck HEAD and claims before implementing tests.

## Acceptance / coverage

| ID | Finding and observable evidence | Classification |
|---|---|---|
| AC-RRP-1 | Two logSetWithContext calls with the same exerciseName yield ONE session exercise and set numbers [1,2]; a switch completes the old exercise | Confirmed by prior service probe; reproduce over real DB |
| AC-RRP-2 | A getSessionDetails rejection must not produce a successful session_ended transition/reply; an actual missing/completed session still does | Infrastructure failure must not become domain fact |
| AC-RRP-3 | Create two planning sessions and begin both for one user: second start must be refused and at most one in_progress row remains | INV-TRAINING-002; sequential case first, no race required |
| AC-RRP-4 | Two senders in the same group must never use each other's internal userId; private chat normal flow remains valid | Group support is unverified; test isolation, not a chosen group policy |
| AC-RRP-5 | Missing user through the REAL runner and chat route returns 404 so the bot's existing recovery contract is reachable; next message re-upserts | Already disclosed P5 debt, not a newly discovered regression |
| AC-RRP-6 | Save then delete: show exactly which representations still contain the fact; scripted compaction of old evidence cannot silently recreate it | Separate retention proof from model-conditional resurrection; no live-model probability claim |
| AC-RRP-7 | Every test has RED output caused by the stated behavior, or a precise unconfirmed/retracted finding | Review accuracy gate |
| AC-RRP-8 | Existing unit/scenario suites remain green and production diff is empty | Test-only delivery gate |

### Task 1: Training persistence and failure semantics (RED only)

**Files:** Create apps/server/tests/integration/scenarios/review-training.repro.test.ts; reuse tests/integration/scenarios harness and fixture conventions. If prepare requires a smaller boundary test, create src/infra/ai/graph/__tests__/review-prepare.repro.test.ts. Read full TrainingService, prepare.node, session routes and repositories first.

**Interfaces:** Exercise TrainingService.logSetWithContext/startSession/beginSession and buildPrepareNode or the real MemorySaver graph. Use real DB for row invariants. Mock only the model and a rejected repository read for fault injection.

- [ ] Add AC-RRP-1: seed a catalog exercise, user and active session; log twice by exact catalog name; assert one session_exercises row, set numbers [1,2], one active exercise. Add a different-name switch case and a by-ID positive control. Key assertion: `expect(details.exercises).toHaveLength(1); expect(details.exercises[0].sets.map(s => s.setNumber)).toEqual([1, 2]);`.
- [ ] Add AC-RRP-2: make the session read reject with a sentinel error; assert the invocation rejects or explicitly reports a technical failure WITHOUT committed chat transition; missing/completed controls must retain existing recovery. Do not assert a particular future error class. For the current direct node contract, `await expect(prepare(state, config)).rejects.toThrow('database unavailable')` pins propagation; verify no session-ended success is produced.
- [ ] Add AC-RRP-3: `a = startSession(userId,{status:'planning'}); b = startSession(userId,{status:'planning'}); await beginSession(a.id); await expect(beginSession(b.id)).rejects.toThrow();` then assert active row count <= 1. Clean both fixture sessions even when the expectation fails.
- [ ] Run `RUN_DB_TESTS=1 NODE_ENV=test npx jest --runInBand --testMatch='**/review-training.repro.test.ts'` and `NODE_ENV=test npx jest --runInBand --testMatch='**/review-prepare.repro.test.ts'` for files actually created. Capture exact RED assertions.
- [ ] Run existing `npm run test:unit -- --silent --verbose=false` and `npm run test:scenarios -- --silent --verbose=false`; record output; commit tests/evidence only. Send worker_done and STOP.

### Task 2: Bot identity and stale-user recovery (RED only, after Task 1 review)

**Files:** Create apps/bot/__tests__/review-handlers.repro.test.ts and apps/server/tests/integration/review-user-recovery.repro.test.ts. Read complete handlers.ts, queue.ts, runner, chat route and existing Fastify integration setup.

**Interfaces:** registerBotHandlers with a fake Telegram emitter and mocked axios transport; actual server route + buildConversationRunner with missing IUserService user. Do not mock the route's returned status to 404: that would assume the fix.

- [ ] AC-RRP-4: send message A then B from distinct msg.from.id in one group chat; drain handlers. Assert B is rejected before conversation processing OR its chat request uses its own registered user ID, never A's. A separate private-chat case must succeed.
- [ ] AC-RRP-5: invoke actual runner through actual /api/bot/chat route for missing user; assert HTTP 404. In the bot fixture, a real-shaped 404 clears the cache and the next message upserts; keep server status mismatch as the RED proof and cache branch as the positive control. Do not auto-retry mutations.
- [ ] Run from bot: `npx jest --runInBand --testMatch='**/review-handlers.repro.test.ts'`; from server: `RUN_DB_TESTS=1 NODE_ENV=test npx jest --runInBand --testMatch='**/review-user-recovery.repro.test.ts'`. Record assertion-level RED, then run bot default tests and server unit/scenario suites. Commit tests/evidence only; worker_done and STOP.

### Task 3: Memory deletion evidence (RED only, after Task 2 review)

**Files:** Create apps/server/tests/integration/scenarios/review-memory-delete.repro.test.ts; reuse fact-lifecycle scenario harness, real user-facts repository, real compact step and checkpoint/transcript/summary adapters where available.

**Interfaces:** manage_fact save/delete, IUserFactsService.deleteFact, compact with a scripted structured model. Use a distinct fixture marker in the fact so retained representations can be asserted without semantic guessing.

- [ ] AC-RRP-6a: save a fact through the real path, populate episode/transcript with its source, explicitly delete it. Confirm user_facts row is absent (positive control); inspect messages/transcript/summary for the marker. Assert erasure from the model-visible memory as the desired guarantee and record the present RED. Do not claim backup/log erasure was tested.
- [ ] AC-RRP-6b: compact older evidence after deletion with a scripted valid `add` operation for that fact; assert it is not recreated. The scripted add proves the storage guard is absent, NOT that a live model always resurrects it. Include an archived/retracted stale-evidence control that stays closed, using existing lifecycle fixture patterns.
- [ ] Run `RUN_DB_TESTS=1 NODE_ENV=test npx jest --runInBand --testMatch='**/review-memory-delete.repro.test.ts'`; capture RED or classify unconfirmed. Run existing scenarios. Commit tests/evidence only; worker_done and STOP.

## Remediation sequence after evidence acceptance

The following is the concrete follow-on plan. It does not authorize a worker to mix fixes into Tasks 1–3. Coordinator dispatches separately after reviewing RED evidence and settling the named decisions.

1. **Training writes:** resolve exerciseName to catalog ID, then reuse the same ensureCurrentExercise path used by exerciseId (including switch/skipActivityUpdate behavior). Enforce one active session in beginSession and with a partial unique DB index; migration must first detect existing duplicates and fail descriptively rather than deleting user history. Promote AC-RRP-1/3 tests to default integration suite; test a concurrent begin against the real DB as well. Existing INV-TRAINING-002 governs the behavior.
2. **Failure isolation:** remove catch-to-null in prepare; let existing typed error handling report infrastructure failure without phase mutation. Promote AC-RRP-2 and verify both failure and actual-ended controls.
3. **Bot boundaries:** default proposed product choice is private-chat-only (no API calls for groups); if groups are required, key identity by sender and handle response privacy explicitly. Add typed missing-user 404 at runner/route boundary and preserve next-message cache recovery; update API/error docs openly before production edits. Promote AC-RRP-4/5.
4. **Memory deletion:** decide the scope using Task 3 evidence before implementation. Clearing a user_facts row cannot promise full erasure; a hash tombstone only blocks exact re-extraction and does not remove raw memory. Proposed default is to clear affected live conversational memory and summaries plus remove/redact corresponding retained transcript representations, with explicit treatment of backups/logs. This is an architecture/product decision: prepare a durable ADR amendment before dispatch, never let a worker invent a retention policy or claim semantic erasure from string matching.
5. **Verification:** all promoted tests GREEN, existing server and bot suites, real DB scenarios, check-all, migration fresh/upgrade checks if changed, independent coordinator four-zone close-out review. Merge/deploy remain separate delivery actions, not part of the initial proof stage.

## Improvements from the review (sequenced, not confused with reproduced bugs)

- **HB-03 timeout:** after bot identity/recovery, choose configurable timeout from the server's 420 s budget, queue cancellation semantics and user feedback. Test a never-resolving transport with fake timers and verify a subsequent message can proceed; do not auto-retry state-changing requests. A short timeout alone risks duplicate user retries.
- **Request idempotency:** own design/task after timeout contract; stable Telegram update/message identity + persisted result, same key/same payload returns prior result, concurrent duplicates execute once, same key/different payload rejects, crash after side effect tested. Mutex alone is not sufficient; do not bolt on an in-memory cache and claim durability.
- **History N+1:** batch session details by session IDs, preserve ordering/null/empty behavior; compare payloads and instrument query count with 1 vs 5 vs 50 sessions before/after. No optimization based only on estimated latency.
- **Bot CI:** add bot dependency install + tests/build as a job after regression promotion; keep real-DB training scenarios owner-run per existing policy (do not silently reverse that policy).
- **Timeout spec drift:** reconcile domain training spec to the already approved LLM-mediated stale-session behavior; do not restore unconditional two-hour closure. Separate factual cleanup from any proposed new behavior.

## Evidence / review ledger

Baseline: 3f4430b4. Previous review: 1112 server unit tests, 22 bot tests, 59 snapshots; check-all exited 0 with 810 lint warnings. These are historical context, not this plan's fresh verification.

Workers append per task: baseline SHA, files, exact commands, exit code, relevant assertion, positive controls, ordinary-suite result and commit SHA. Coordinator records acceptance separately. No clean review or done status until the corresponding work is actually accepted.
