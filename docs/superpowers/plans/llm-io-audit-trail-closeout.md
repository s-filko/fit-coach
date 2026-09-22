# LLM I/O Audit Trail — Close-out Remediation Implementation Plan

- Status: done
- Branch: plan/llm-io-audit-trail
- After: llm-io-audit-trail
- Review: 2026-09-22 | clean | R1,R2,R3,R4

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans and superpowers:test-driven-development. One plan task per worker session; stop after the task.

**Why this exists.** `llm-io-audit-trail` is code-complete and its close-out review has run three
times: 23 blocking, then 16, then 15. Roughly half of each later round were defects the previous
round's own fixes had introduced. The branch does not merge until these fifteen are closed. The
findings themselves are recorded in that plan's `## Review` § Round 3 — **read them there, not
from this summary**, and cite them as `round 3, <zone>, <file:line>`.

**Scope rule (owner, 2026-09-22): this plan closes findings. It adds no feature, and it does not
re-open any design decision the three rounds already settled.**

**How each task is verified** differs by group, and that is the point — eleven of the fifteen
cannot be closed by a test:
- Group A changes behaviour → a test that fails first.
- Group B changes code with no behaviour change → `npx tsc --noEmit` plus the four suites.
- Group C is text → the check is re-reading the whole section and grepping inbound references
  (`close-out-review` § What a fix owes). Do not invent a test for it.

**Acceptance criteria**
- **AC-CO-1** — INV-LLM-008's guarantee matches the code: the recorded parameter allow-list
  covers what the SDK actually sends for every model the product can run, and the guard fails
  when it does not.
- **AC-CO-2** — no restated type, duplicated fixture or copied record literal survives from the
  round-2 fixes; each removal is proven by the existing suites.
- **AC-CO-3** — every durable statement this branch touched is true of the code, and every
  reference inside those documents resolves.
- **AC-CO-4** — a fourth close-out review returns `clean`, with the two deploy-gated items
  recorded as deferred rather than blocking.

## Global Constraints

- Reserved to the orchestrator: push, ssh, deploy, merge, `npm run db:*`, `docker compose`,
  `docs/STATE.md`, `docs/BUGS.md`, any `Status:` line. Durable specs (`docs/adr/**`,
  `ARCHITECTURE.md`, `DB_SETUP.md`, `CICD.md`, `CONTRIBUTING_AI.md`,
  `LLM_CORE_REFACTOR_PLAN.md`) are the orchestrator's in Group C.
- No `.env*` file is ever written (`.env.example` only). No model-backed evals.
- The four suites, from `apps/server`: `npm run test:unit`;
  `RUN_DB_TESTS=1 npm run test:integration`; `npm run test:scenarios`; and
  `RUN_DB_TESTS=1 NODE_ENV=test npx jest --testMatch='**/tests/integration/**/*.repro.test.ts'`,
  which must stay at exactly 2 suites / 4 failures — those reds belong to BUG-027 and BUG-030,
  other plans, and going green there means something was broken.
- A native teardown crash (`libc++abi … mutex lock failed`, exit 134) fires on this machine
  **after** Jest reports success. Pre-existing; report it, do not chase it.

---

### Task A: The recorded parameter list matches what the SDK sends (AC-CO-1)

**Files:** `apps/server/src/infra/ai/llm-log-handler.ts`, its unit test.

- [x] **Step 1: test first.** The guard at `llm-log-handler.unit.test.ts` pins one model, so it
  can only see keys LangChain defines for that model. Drive it over more than one — at minimum
  the configured model and a reasoning model (`o`-series or `gpt-5*`), whose
  `invocationParams()` differs. Confirm it fails before the fix.
- [x] **Step 2:** `@langchain/openai` `completions.js:59` sets `max_completion_tokens` instead of
  `max_tokens` when `isReasoningModel(model)` (`utils/misc.js:5`). Record it. Check the same
  file for any other model-conditional parameter while you are there — close the class.
- [x] **Step 3:** the four suites.

### Task B: Remove what the round-2 fixes duplicated (AC-CO-2)

**Files:** `apps/server/tests/integration/scenarios/personas.ts`,
`apps/server/src/infra/ai/llm-log-handler.ts`,
`apps/server/tests/integration/services/{print-transcript,transcript-order}.integration.test.ts`.

- [x] **Step 1:** `personas.ts` duplicates `evals/scenarios/fl-shared.ts` — import it instead.
  `review-memory-delete.integration.test.ts` already imports across those two trees, so the
  precedent exists. Before deleting, grep both trees for other users of either fixture.
- [x] **Step 2:** `OpenAIMessage` restates `RecordedRequestMessage` — import the recorder's type.
  Then grep the whole repo for any third restatement of that shape.
- [x] **Step 3:** five inline `ConversationRunRecord` literals across two test files; a spread
  base already exists at `transcript-order.integration.test.ts:155`. Use it for all five.
- [x] **Step 4:** `npx tsc --noEmit` plus the four suites. No new test — if the suites pass, the
  behaviour is unchanged, which is the whole claim.

### Task C: Make the durable layer true again (AC-CO-3) — orchestrator, not a worker

**Files:** `docs/adr/0013-llm-core-target-architecture.md`, `docs/ARCHITECTURE.md`,
`docs/DB_SETUP.md`, `docs/CICD.md`, and two source comments in
`apps/server/scripts/print-transcript.ts`.

Eleven items; read them in `llm-io-audit-trail.md` § Round 3. For each: read the section
end-to-end, grep for inbound references to anything renumbered or renamed, fix, re-read.
That procedure is the acceptance criterion — every one of these eleven exists because a
previous edit skipped it.

- [x] **Step 1:** the four ADR/ARCHITECTURE statements that contradict the code or each other.
- [x] **Step 2:** `DB_SETUP.md`'s reattached Purpose block, which carries law P4 retired.
- [x] **Step 3:** `CICD.md`'s shifted step references and the missing crontab line in § 7b.
- [x] **Step 4:** the two `print-transcript.ts` comments, and the eleven "close-out R2 finding N"
  citations across `src/` and `tests/` — now that § Round 2 exists they could resolve, but a
  durable id or the behaviour itself is the better citation.
- [x] **Step 5:** `grep -rn 'AC-AT-' docs/ apps/` returns nothing outside the two plan files —
  ~90 sites, not the handful this line implied. **Owner decision, 2026-09-22: mint the missing
  durable ids and rewrite every citation** (the alternative, keeping plan-scoped ids in code, was
  declined). The orchestrator has amended ADR-0013 §8 with **INV-LLM-009** (the inbound message and
  a failed run's cause survive the failure — AC-AT-1/AC-AT-2) and **INV-LLM-010** (a run's row order
  is recoverable via `run_id` + `seq` — AC-AT-4). The full map a worker applies:
  `AC-AT-1`/`AC-AT-2` → INV-LLM-009, `AC-AT-3` → INV-LLM-008, `AC-AT-4` → INV-LLM-010,
  `AC-AT-6` → BR-LLM-011, and `AC-AT-5` (the `print-transcript` CLI — tooling, no invariant) → a
  statement of what the command does. Two mentions stay and are not defects: `BUGS.md` and
  `REVIEW_FINDINGS.md` name the plan explicitly when they discuss the id itself.

### Task D: Fourth close-out review (AC-CO-4) — orchestrator, never delegated

- [ ] **Step 1:** run `close-out-review`. The two deploy-gated items are recorded as deferred
  per the skill's § Report and route, not raised as blocking.
- [ ] **Step 2:** on `clean` — `Status: done` on both plans, merge, push, deploy to dev.
- [ ] **Step 3:** discharge the deferred pair on dev and record the output in
  `llm-io-audit-trail.md` § Deferred.
