# Review Findings — Reproduction Before Remediation Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans and test-driven-development. The owner explicitly requires the reproduction stage BEFORE fixes; this overrides the usual one-test/one-fix interleaving. Execute only the dispatched task. The coordinator reviews the RED evidence before dispatching remediation.

- Status: done
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

- [x] Add AC-RRP-1: seed a catalog exercise, user and active session; log twice by exact catalog name; assert one session_exercises row, set numbers [1,2], one active exercise. Add a different-name switch case and a by-ID positive control. Key assertion: `expect(details.exercises).toHaveLength(1); expect(details.exercises[0].sets.map(s => s.setNumber)).toEqual([1, 2]);`.
- [x] Add AC-RRP-2: make the session read reject with a sentinel error; assert the invocation rejects or explicitly reports a technical failure WITHOUT committed chat transition; missing/completed controls must retain existing recovery. Do not assert a particular future error class. For the current direct node contract, `await expect(prepare(state, config)).rejects.toThrow('database unavailable')` pins propagation; verify no session-ended success is produced.
- [x] Add AC-RRP-3: `a = startSession(userId,{status:'planning'}); b = startSession(userId,{status:'planning'}); await beginSession(a.id); await expect(beginSession(b.id)).rejects.toThrow();` then assert active row count <= 1. Clean both fixture sessions even when the expectation fails.
- [x] Run `RUN_DB_TESTS=1 NODE_ENV=test npx jest --runInBand --testMatch='**/review-training.repro.test.ts'` and `NODE_ENV=test npx jest --runInBand --testMatch='**/review-prepare.repro.test.ts'` for files actually created. Capture exact RED assertions.
- [x] Run existing `npm run test:unit -- --silent --verbose=false` and `npm run test:scenarios -- --silent --verbose=false`; record output; commit tests/evidence only. Send worker_done and STOP.

### Task 2: Bot identity and stale-user recovery (RED only, after Task 1 review)

**Files:** Create apps/bot/__tests__/review-handlers.repro.test.ts and apps/server/tests/integration/review-user-recovery.repro.test.ts. Read complete handlers.ts, queue.ts, runner, chat route and existing Fastify integration setup.

**Interfaces:** registerBotHandlers with a fake Telegram emitter and mocked axios transport; actual server route + buildConversationRunner with missing IUserService user. Do not mock the route's returned status to 404: that would assume the fix.

- [x] AC-RRP-4: send message A then B from distinct msg.from.id in one group chat; drain handlers. Assert B is rejected before conversation processing OR its chat request uses its own registered user ID, never A's. A separate private-chat case must succeed.
- [x] AC-RRP-5: invoke actual runner through actual /api/bot/chat route for missing user; assert HTTP 404. In the bot fixture, a real-shaped 404 clears the cache and the next message upserts; keep server status mismatch as the RED proof and cache branch as the positive control. Do not auto-retry mutations.
- [x] Run from bot: `npx jest --runInBand --testMatch='**/review-handlers.repro.test.ts'`; from server: `RUN_DB_TESTS=1 NODE_ENV=test npx jest --runInBand --testMatch='**/review-user-recovery.repro.test.ts'`. Record assertion-level RED, then run bot default tests and server unit/scenario suites. Commit tests/evidence only; worker_done and STOP.

### Task 3: Memory deletion evidence (RED only, after Task 2 review)

**Files:** Create apps/server/tests/integration/scenarios/review-memory-delete.repro.test.ts; reuse fact-lifecycle scenario harness, real user-facts repository, real compact step and checkpoint/transcript/summary adapters where available.

**Interfaces:** manage_fact save/delete, IUserFactsService.deleteFact, compact with a scripted structured model. Use a distinct fixture marker in the fact so retained representations can be asserted without semantic guessing.

- [x] AC-RRP-6a (RESCOPED, see the evidence section): save a fact through the real path, populate episode/transcript with its source, explicitly delete it. Confirm user_facts row is absent (positive control); inspect messages/transcript/summary for the marker. Assert erasure from the model-visible memory as the desired guarantee and record the present RED. Do not claim backup/log erasure was tested.
- [x] AC-RRP-6b (RESCOPED): compact older evidence after deletion with a scripted valid `add` operation for that fact; assert it is not recreated. The scripted add proves the storage guard is absent, NOT that a live model always resurrects it. Include an archived/retracted stale-evidence control that stays closed, using existing lifecycle fixture patterns.
- [x] Run (delivered as a green integration test, not a repro — see below); capture RED or classify unconfirmed. Run existing scenarios. Commit tests/evidence only; worker_done and STOP.

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

### Task 1 evidence (worker: Claude Sonnet 5 / `claude-sonnet-5`, 2026-09-21)

Baseline SHA: 3f4430b4 (branch HEAD before work: 75588b42). Tests commit: be103c32. Production diff: empty (`git diff 75588b42..HEAD -- apps/server/src` shows only the new `__tests__/review-prepare.repro.test.ts`).

| Command (from `apps/server`) | Exit | Result |
|---|---|---|
| `RUN_DB_TESTS=1 NODE_ENV=test npx jest --runInBand --testMatch='**/review-training.repro.test.ts'` | 1 | 5 tests: 2 controls pass, 3 RED (below) |
| `NODE_ENV=test npx jest --runInBand --testMatch='**/review-prepare.repro.test.ts'` | 1 | 5 tests: 3 controls pass, 2 RED (below) |
| `npm run test:unit -- --silent --verbose=false` | 0 | 118 suites, 1112 tests, 59 snapshots passed |
| `npm run test:scenarios -- --silent --verbose=false` | 134 | 5 suites, 306 passed + 1 todo. All tests pass; the process then aborts at exit with `libc++abi: terminating due to uncaught exception of type std::__1::system_error: mutex lock failed` (reproduced on a 2nd run; the repro files are not in this suite's testMatch, so the cause is outside the repro assertions; baseline comparison has not yet been performed) |

A first run of each repro file failed on test-side setup (TS2551 wrong property name `exerciseName` → `exercise.name`; `goto` is returned as an array, not a string). Those were fixture bugs, fixed before any RED was recorded; the RED below is the behavioral output of the final files.

**AC-RRP-1 — CONFIRMED (real DB), `review-training.repro.test.ts`**
- Positive control (by exerciseId, two sets) PASS: 1 session exercise, set numbers [1,2].
- `two sets with the same exerciseName yield ONE session exercise...` RED: `expect(details.exercises).toHaveLength(1)` — Received length 2; two `session_exercises` rows for Barbell Bench Press (orderIndex 0 and 1), each with one set, `setNumber: 1`, both `status: in_progress`.
- `switching to another exercise by name completes the previous one...` RED: `expect(bench.status).toBe('completed')` — Received `in_progress` (name path never runs the auto-complete switch logic; the earlier `length 2` assertion passed).

**AC-RRP-3 — CONFIRMED (real DB), `review-training.repro.test.ts`**
- Positive control (single begin) PASS.
- `the second begin of two planning sessions is refused...` RED: expected `{secondBegin:'refused', inProgress:1}`, received `{secondBegin:'accepted', inProgress:2}` — both planning sessions of one user are `in_progress`.

**AC-RRP-2 — CONFIRMED (real `buildPrepareNode`, stubbed collaborators), `review-prepare.repro.test.ts`**
- Controls PASS: session `null` → `goto commit`, `session_ended`; `completed` → same; `in_progress` → `goto route`, no transition.
- `the failure propagates instead of being swallowed` RED: `rejects.toThrow('database unavailable')` — "Received promise resolved instead of rejected", resolved to `goto: ['commit']`, `pendingTransition: {reason:'session_ended', toPhase:'chat'}` and the reply "Your training session has been completed. Ready for a new workout?".
- `never produces a committed session_ended transition...` RED: outcome `{rejected:false, goto:'commit', pendingTransition:{reason:'session_ended',toPhase:'chat'}}` — an infrastructure failure is committed as a domain fact. Scope note: node-level with a stubbed training service read; graph-level (MemorySaver) run not added.

**AC-RRP-7** for Task 1: all three findings reproduce with behavioral assertion failures; none unconfirmed/retracted. **AC-RRP-8** for Task 1: unit suite green, scenario assertions pass but process exits 134 (verification limitation above); production diff empty.

### Coordinator checkpoint — Task 1

Reviewed both test files and confirmed no production diff. Independently reran both explicit repro files: exit 1, five intended failing assertions and five passing controls. Worker reports model claude-sonnet-5. Existing scenario command exit 134 remains a verification limitation until a clean independent run; no claim that this is harmless.

### Task 2 evidence (worker: Claude Sonnet 5 / `claude-sonnet-5`, 2026-09-21)

Base HEAD before work: c1cd8e03. Tests commit: 7bb9d11c. Files: `apps/bot/__tests__/review-handlers.repro.test.ts`, `apps/server/tests/integration/review-user-recovery.repro.test.ts`. No production file changed (`git diff c1cd8e03..HEAD --stat` lists only the two new test files and this plan).

| Command | Exit | Result |
|---|---|---|
| `cd apps/bot && npx jest --runInBand --testMatch='**/review-handlers.repro.test.ts'` | 1 | 4 tests: 3 controls pass, 1 RED |
| `cd apps/server && RUN_DB_TESTS=1 NODE_ENV=test npx jest --runInBand --testMatch='**/review-user-recovery.repro.test.ts'` | 134 | 2 tests: 1 control pass, 1 RED; jest reports `Tests: 1 failed, 1 passed`, then the process aborts at exit with the same `libc++abi: mutex lock failed` teardown noise as Task 1 (so the exit code is 134, not 1) |
| `cd apps/bot && npx jest` (default suite) | 0 | 4 suites, 22 tests passed |
| `cd apps/server && npm run test:unit -- --silent --verbose=false` | 0 | 118 suites, 1112 tests, 59 snapshots passed |
| `cd apps/server && npm run test:scenarios -- --silent --verbose=false` | 134 | 5 suites, 306 passed + 1 todo; same known teardown abort |

Also: `npm run type-check` (server) exit 0, `npx tsc --noEmit` (bot) exit 0, eslint 0 errors on the new server file (a first max-len error was fixed before commit). Mocking: bot test replaces only `axios.create` (real `AxiosError`/`isAxiosError`), the logger, and the fake bot's `sendMessage`/`sendChatAction`; the real `registerBotHandlers` is driven through a fake `EventEmitter` and per-test `jest.isolateModules` (handlers.ts keeps its cache at module level). Server test does NOT override `CONVERSATION_RUN_PORT_TOKEN`: the real `buildConversationRunner` (behind `withRunMutex`) and real route answer; only the model beneath the gateway is scripted (`installScriptedModel`).

**AC-RRP-4 — CONFIRMED, `review-handlers.repro.test.ts`**
- RED `never sends sender B's message under sender A's internal userId`: group chat -100, sender 111 then sender 222; `expect(bCalls.map(c => c.userId)).not.toContain(aCall.userId)` fails — Expected not `"internal-111-1"`, Received `["internal-111-1"]`. The bot cached the first sender's id under `chatId` and sent B's message as A. Either rejecting B or using `internal-222-*` would pass; no policy chosen.
- Controls PASS: a private chat registers once and every chat request carries its own id; two private chats keep two identities (`internal-111-1`, `internal-222-2`).

**AC-RRP-5 — CONFIRMED (server status), bot recovery branch is a control**
- RED `a userId that does not exist -> HTTP 404` (real route + real runner, random UUID): `expect(res.statusCode).toBe(404)` — Expected 404, Received 500 (runner throws a plain `Error('User ... not found')`, the route maps it to 500 `CORE_ERROR`).
- Control PASS (server): an existing user through the same route + runner + auth returns 200 with content.
- Control PASS (bot): a real-shaped `AxiosError` 404 on `/api/bot/chat` -> exactly one chat attempt for that message (no auto-retry), one error text sent, and the NEXT message re-upserts the user (`userUpserts == ['111','111']`) and sends under the new id `internal-111-2`. So the bot contract is intact; the only defect is that the server never produces the 404.

**AC-RRP-7** for Task 2: both findings reproduce with behavioral assertion failures; none unconfirmed. **AC-RRP-8** for Task 2: bot default 22/22, server unit 1112/1112, scenario assertions pass (exit 134 limitation as in Task 1); production diff empty.


### Task 3 evidence — RESCOPED by the owner (coordinator, 2026-09-21)

Task 3 was written to ask whether a deleted fact is truly erased everywhere. Between the review and
this task the owner decided the opposite **on purpose** (2026-09-21, recorded in ADR-0009): nothing is
ever erased. `delete` archives the row with reason `user_deleted`, the user is told it was deleted, and
the guarantee is not erasure from storage but that the fact never surfaces again. A real erasure (a
legal demand, someone else's data) is a separate, unbuilt capability. Writing "prove the row is gone"
would therefore have tested a rule that no longer exists, so the coordinator rescoped the task before
dispatch to prove the guarantee **as it now stands** — and to pin, in a test name, what it does not
cover.

Delivered as `apps/server/tests/integration/scenarios/review-memory-delete.integration.test.ts`
(commit `1f0e49ba`, 19 tests, in the default scenario suite): a **green proof, not RED evidence** —
all three guarantees hold and no production file was touched. Real graph, real repositories, real
`fitcoach_test`, only the model scripted; distinctive markers instead of semantic guessing.

| Proven | Result |
|---|---|
| A deleted fact never reaches the model: absent from `getForPrompt`, from the `## User Facts` block and from `getConstraints` (so it cannot block an exercise) | holds |
| Absent from `list_facts` in BOTH modes, including `includeArchived: true` — while a `user_closed` fact in the same listing still shows with its reason (positive control) | holds |
| A later compaction of OLDER evidence with a scripted `add` of that same fact does not bring it back | holds |
| The row and its text REMAIN in `user_facts`, and the conversation turns that mention it are untouched — asserted as the documented present behaviour | pinned as the limit |

Worker's own correctness note, kept because it is the kind of caveat that usually goes unstated: the
deleting message is the only user turn of the compacted episode, so the evidence clock is not newer
than the deletion. Had a later user turn been in that episode, the AC-FL-3 guard would rightly have
allowed the re-creation — the test proves the guard, not a blanket "deleted facts can never return".

### Coordinator close-out (2026-09-21)

- Review: 2026-09-21 | clean | one combined agent over the whole branch diff (R1–R4 in one pass).
  **Zero blocking findings in all four zones.** It independently confirmed the migration pre-check
  RAISEs without touching data and cannot false-positive (the index is scoped to `in_progress`), that
  the bot's notice Set is bounded and its check-then-add is synchronous so no double-send is possible,
  that the promoted tests assert observable behaviour rather than implementation, and that no caller
  relied on the `prepare` swallow that was removed.
- Two advisories were closed in `8ef08ff3` rather than deferred, both being the "a rule written twice"
  and "a raw driver error reaching the user" classes this project removed elsewhere the same day: one
  shared `assertNoActiveSession` guard with the message living once in a domain error class, and the
  unique-violation translated into that same domain error. **The worker deliberately deviated from the
  coordinator's instruction on the second one and was right to:** it put the translation in the
  repository rather than in `beginSession`, because the service is domain and must not know Postgres
  SQLSTATEs, and because the repository also covers `startSession`'s own create-then-update race and
  the lifecycle handler's direct `repo.update`, which bypass the service entirely. It also found that
  drizzle 0.44 wraps driver errors, so a naive `err.code` check would have looked like a working guard
  without being one — matching is by SQLSTATE and index name, never message text.
- Independently re-run by the coordinator on the final tree: `npm run test:unit` 1151, `npm run
  test:integration` 523 (522 + 1 todo), `npm run test:scenarios` 339 (338 + 1 todo), L0 96/96,
  type-check clean, `apps/bot` 35/35. No `*.repro.test.ts` remains anywhere — every reproduction was
  promoted into a default suite, which was the plan's own rule.
- Durable specs updated by the coordinator, not by a worker: `ARCHITECTURE.md`'s error-code table and
  `API_SPEC.md`'s `/api/bot/chat` responses gained `404 USER_NOT_FOUND`, and the endpoint's documented
  bodies were corrected from the pre-P5 `{ message }` shape to the `{ code }` shape the server has
  actually been returning.
- **Not done, deliberately:** the "Improvements from the review" list (HB-03 timeout, request
  idempotency, history N+1, bot CI, timeout spec drift) is untouched. Those are sequenced work, not
  reproduced defects, and mixing them into a remediation branch is what the plan's own staging rule
  forbids.
