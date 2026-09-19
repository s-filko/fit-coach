# Structured Output — Fenced-JSON Recovery and the User-Facts Scenario Test Implementation Plan

- Status: in progress
- Branch: plan/structured-output-fenced-json
- After: refactor-p6-facts-and-progress-blocks

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans and superpowers:test-driven-development. One plan task per worker session; stop after the task.

**Goal:** Make `LlmGateway.structured()` survive a model that answers a structured call with
JSON inside a Markdown code fence instead of a parseable structured response (BUG-017), so
episode summaries — and with them P6's user facts — are actually produced on the dev route; and
pin the whole user-facts scenario end to end with a mocked model.

**Why now (evidence, dev smoke 2026-09-19, after `refactor-p6-facts-and-progress-blocks`
merged):** the first smoke call closed a stale episode; the summariser (v3, GLM via Z.AI)
answered twice with `` ```json … ``` `` content, the gateway's `withStructuredOutput` parse threw
`SyntaxError: Unexpected token '`', "```json` both times (first call + the one retry), and
`compact` trimmed the episode without a summary (BR-LLM-004, as designed). Result: no summary,
no facts — `user_facts` 0 rows, `conversation_summaries` 0 rows for the smoke user. The two
summariser attempts took 621 s of a 650 s run. The retry cannot help: it repeats the identical
call and gets the identical format. The code path is `apps/server/src/infra/ai/llm.gateway.ts`
`structured()` (the `isSchemaFailure` comment already records the same `SyntaxError` seen live
on 2026-09-18).

**Architecture:** the fix stays inside the gateway (infra), invisible to callers: when the
structured parse fails, the gateway first tries to recover the payload from the **raw model
message it already has** (strip a Markdown code fence / take the JSON object from the text),
validates it with the **same Zod schema**, and returns it — no second model call. Only when
recovery fails does the existing "retry once" run. Callers (`compact.node.ts`, any other
`structured()` user) do not change.

**Spec:** ADR-0013 §3.3 (compaction, summary is structured output), BR-LLM-004 (summariser
failure is non-fatal), `docs/superpowers/plans/refactor-p6-facts-and-progress-blocks.md`
(AC-1361 — the facts path this unblocks), `docs/BUGS.md` BUG-017.

**Acceptance criteria:**
- **BUG-017 fixed** — a structured call whose model answer is fenced (or prose-wrapped) JSON that
  satisfies the schema returns the parsed value with **one** model call; a schema-invalid answer
  still gets exactly one retry and then throws as today; non-format errors propagate unchanged.
- **AC-1361 (deterministic half), end to end** — one mocked-model scenario test proves the chain:
  constraint stated in an episode → compaction → summariser answers in a code fence → fact
  upserted → the next run's assembled input carries `## User Facts` with the fact → a
  conflicting exercise is rejected by the tool with `user_error` quoting the fact and nothing is
  persisted, while a safe exercise goes through.

## Global Constraints

- **No model-backed evals**: no `RUN_LLM_EVALS=1`, no `EVALS_FULL_RUN=1`. Mocked models only.
- The frozen tool output format (`TOOL_OUTCOME_FORMAT_ID = 'v1'`) and every L0 snapshot stay
  byte-identical: `npm run evals -- --level L0` → 96/96.
- Recovery never invents data: the recovered object must pass the same Zod schema; text that
  does not contain one parseable JSON value that passes is a failure, not a partial result.
- **Reserved to the orchestrator:** `git push`, ssh, deploy, `npm run db:*`, `docker compose`,
  merge, branch/worktree deletion, durable specs (`docs/adr/**`, `docs/domain/**`,
  `docs/features/**`, `API_SPEC.md`, `ARCHITECTURE.md`, `LLM_CORE_REFACTOR_PLAN.md`),
  `docs/STATE.md`, any `Status:` line, `.env` files. Verification from `apps/server/`.

---

### Task 1: Gateway recovers fenced JSON before retrying (BUG-017)

**Files:**
- Modify: `apps/server/src/infra/ai/llm.gateway.ts` — `structured()`.
- Create (if a helper is warranted): a small pure function next to the gateway, e.g.
  `extractJsonPayload(text: string): unknown | undefined` — code fence (` ```json ` or bare
  ` ``` `) first, else the outermost `{…}` / `[…]` in the text; `undefined` when nothing parses.
- Modify: `apps/server/src/infra/ai/__tests__/llm.gateway.unit.test.ts` (+ a unit test file for
  the helper if one is created).

- [x] **Step 1: Tests first.** (a) model answer is `` ```json\n{…valid…}\n``` `` → returns the
  parsed object, model invoked **once**, one `warn` log naming the recovery and the profile;
  (b) the same without a language tag, and JSON surrounded by prose; (c) fenced JSON that
  **fails** the schema → one retry, then the error propagates (today's contract); (d) a normal
  structured answer → unchanged path, no warn; (e) a non-format error (network/auth) →
  propagates immediately, no retry, no recovery attempt. Use whatever mechanism the existing
  gateway tests use to stub the model (read them first); `withStructuredOutput(…, { includeRaw:
  true })` is the expected way to keep the raw message — verify its failure shape in the
  installed `@langchain/*` version rather than assuming it.
- [x] **Step 2: Implement.** Keep `isSchemaFailure` semantics for the retry decision.
- [x] **Step 3: Commit** — `fix(ai): structured() recovers fenced JSON from the raw model answer before retrying (BUG-017)`
- [x] **Step 4: STOP** for orchestrator review. **Reviewed and accepted 2026-09-19** (commit `057b4240`, GLM worker via Orca; orchestrator re-ran `npx jest --ci src/infra/ai` 404/404 and L0 96/96). **What the worker found, which changed the design:** in the installed `@langchain/openai` 1.2.9 every `json_schema` response format is routed to the OpenAI SDK's `chat.completions.parse()`, which throws `SyntaxError` on a fenced answer *before* any message exists — `includeRaw` cannot recover it — and LangChain's `AsyncCaller` then retried that `SyntaxError` 6 more times per gateway attempt (the real cause of the smoke's 621 s). The orchestrator rejected the worker's first proposal (switch to `functionCalling` — a wire change on both routes, forced `tool_choice` unverified on Z.AI) in favour of keeping the request unchanged and parsing in the gateway. **Accepted trade-off:** the unchanged request reaches the plain `create()` path by passing `response_format.type` as a `String` object (serialises to exactly `"json_schema"`, fails LangChain's `===` routing check). This leans on a library internal; it is pinned by two provider-level tests — the request body is byte-identical to `withStructuredOutput`'s own, and a fenced answer costs exactly one provider call — so a library upgrade that changes the routing fails CI instead of silently regressing. Parsing moved out of the retried call, so format errors no longer trigger the internal 7× retry; network/5xx retries are untouched.

**Verification:** `npx jest --ci src/infra/ai` → all pass; `npm run evals -- --level L0` →
96/96; `npm run format:check`, `npm run type-check` → clean.

---

### Task 2: The user-facts scenario, end to end with a mocked model (AC-1361)

**Files:**
- Create: one scenario test next to the existing graph-level scenario test
  `apps/server/src/infra/ai/graph/__tests__/episode-memory.integration.unit.test.ts` (read it
  first and reuse its harness — graph, stubbed ports, scripted model). Name it for what it
  proves, e.g. `user-facts.scenario.unit.test.ts`.
- Modify only test helpers/fixtures that scenario needs; no production code (if production code
  turns out to be wrong, STOP and report — that is a finding, not part of this task).

- [x] **Step 1: Write the scenario** as one `describe` with ordered steps sharing state:
  1. Episode 1: the user states a lower-back injury in chat (scripted model replies in text).
  2. A compaction trigger (use whichever the harness supports — phase transition via the
     compaction flag, or the inactivity gap with a controlled clock): the summariser is served
     through the **real** `OpenAiLlmGateway.structured()` path with the model stub returning the
     summary **inside a ```json fence**, including
     `facts: [{ category: 'physical_constraint', fact: '…lower back…', muscleGroup: 'lower_back' }]`.
     Assert: an episode summary is stored and the fact reaches `userFacts.upsertMany` (an
     in-memory `IUserFactsService` stand-in with the real port's semantics — idempotent key,
     `getConstraints` = `physical_constraint` with non-null `muscleGroup`).
  3. Next run (session_planning or plan_creation): assert the assembled model input contains
     `## User Facts` and the fact text, placed before `## Previous episodes`.
  4. The scripted model calls `start_training_session` (or `save_workout_plan`) with an exercise
     whose **primary** muscles include `lower_back` → the tool result is `user_error` quoting the
     fact and the session/plan repository was **not** written; then with an exercise that has
     `lower_back` only as a **secondary** muscle → the call succeeds.
  5. Re-state the same fact in a later compaction → still one fact, `confirmations` = 2.
- [x] **Step 2:** make it pass without touching production code (Task 1 must already be in).
- [x] **Step 3: Commit** — `test(ai): user-facts scenario end to end — fenced summary to fact to block to tool rejection (AC-1361)`
- [x] **Step 4: STOP** for orchestrator review. **Reviewed and accepted 2026-09-19** (commit `57178d62`, GLM worker via Orca). `user-facts.scenario.unit.test.ts` runs the real graph with the model mocked beneath the real `OpenAiLlmGateway`, so step 2 goes through the fenced-JSON recovery (one provider call); steps 1–5 each carry their own assertion (block before `## Previous episodes`; primary-muscle deadlift rejected and not persisted, secondary-muscle squat accepted; restated fact → one row, `confirmations` = 2). No production code touched. Note for the review: the in-memory stand-in restates `computeFactKey` rather than importing it (the repository module pulls in the Drizzle pool) — resolved in the close-out fix `1ce72b8d`. **Verification (orchestrator, re-run 2026-09-19 on `1ce72b8d`, after the close-out fix), from `apps/server/`:** `npx jest --ci src/infra/ai/graph` → `Test Suites: 16 passed, 16 total` / `Tests: 149 passed, 149 total`; `npm run test:unit` → `Test Suites: 98 passed, 98 total` / `Tests: 775 passed, 775 total` / `Snapshots: 56 passed, 56 total`; `npm run evals -- --level L0` → `L0: 96/96 checks passed, 0 failed`; `npm run format:check` → `All matched files use Prettier code style!`; `npm run type-check` → 0 errors. (At acceptance only the scenario file itself had been run — `Tests: 1 passed, 1 total`; L0 was first confirmed here.)

**Verification:** `npx jest --ci src/infra/ai/graph` → all pass; full `npm run test:unit` →
green; `npm run evals -- --level L0` → 96/96; `npm run format:check`, `npm run type-check` →
clean.

---

### Task 3: Close-out, deploy, dev smoke (orchestrator)

- [ ] **Step 1:** `docs/BUGS.md` BUG-017 → Fixed with the commit and test names.
- [ ] **Step 2:** `close-out-review`; `- Status: done`; `node scripts/state.mjs --write`; merge
  to `dev`, push, deploy, health 200, `state.mjs --check` → OK.
- [ ] **Step 3: Dev smoke — 3 calls, the P6 facts scenario on the live model** (smoke user,
  called on the server directly, not through the NPM proxy, whose 90 s timeout returns 504):
  state a constraint → force a compaction (phase transition) → one more turn. Paste:
  `conversation_summaries` row, `SELECT category, fact, muscle_group, confirmations FROM
  user_facts`, the run's `budget_report->'longTerm'` > 0, and the summariser's gateway log line
  (recovered or clean).
