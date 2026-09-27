# Fact Provenance — the Summariser Stores Only What the User Said (BUG-040) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans and
> test-driven-development. Red tests first, proven red on unchanged production, then the fix.

- Status: in progress
- Branch: plan/fact-provenance

**Goal:** close the code/unguarded half of BUG-040. Today the episode summariser's `fact_operations`
are applied verbatim (`apps/server/src/infra/ai/graph/nodes/compact.node.ts` `applyFactOperation`):
nothing checks that a fact came from the **user**. On 2026-09-27 the coach's own improvised figure
("~70% of the platform mass") became the active user fact `2075cb9f` via an `update` operation.
After this plan a mutating fact operation is applied only when the episode's **user messages**
support it — checked in code, not only asked of the model.

**Owner order (2026-09-27):** "бери 40 … принимай решения и делай все без моего вмешательства …
консервативно", red tests first, merge into `dev` after all tests pass. Every decision is recorded
here as **(D)** for the owner's later review.

## Decisions (D)

- **D1 — guard in code, prompt as a helper.** The fix is a deterministic provenance check between
  the summariser's answer and `userFacts`; a new summariser prompt version (v5) asks for the
  evidence the check needs and states the rule, but the check does not trust the model.
- **D2 — evidence quote.** `FactOperationSchema` gains optional `evidence: string` — a verbatim
  quote (original language, not translated) from one of the episode's **User:** lines that states
  the fact. Optional in the schema on purpose: a missing field must skip that operation, never
  fail the whole summary (the D-E rule of fact-lifecycle — the summary and the other operations
  still apply). The schema stays `EpisodeSummaryV4Schema` (additive field; stored rows stay valid).
- **D3 — which operations are guarded.** `add`, `update`, `retract` require evidence found in the
  user messages. `confirm` is exempt: it only bumps a counter on a fact the user already owns and
  never changes text (D-C of fact-lifecycle).
- **D4 — number provenance.** Every number in an `add`/`update` fact text (`\d+([.,]\d+)?`,
  comma normalised to a dot) must appear as a number in the episode's user messages, or — for
  `update` only — in the text of the known fact being updated. Otherwise the operation is skipped
  whole (for `update` the old fact stays active). This is the owner's red-test wording in BUG-040:
  "a case where only the coach asserts a figure must produce no fact carrying it". Conservative
  trade-off accepted: a number the user wrote as a word ("пять раз") and the summariser wrote as a
  digit is rejected — losing a fact is recoverable (it is restated), storing a false one is not.
- **D5 — matching rule.** Evidence and user text are compared after one normalisation: lower
  case, `ё→е`, all quote characters (`"'«»“”„`) removed, whitespace collapsed, leading/trailing
  punctuation trimmed. The normalised evidence must be non-empty, at least 3 characters, and a
  substring of one normalised user message. No fuzzy matching.
- **D6 — where the check lives.** A pure domain function `checkFactProvenance` in
  `apps/server/src/domain/user/services/fact-provenance.ts` (no I/O, BR-LLM-007 style), unit
  tested on its own; `compact.node.ts` collects the user texts of `removed` (human messages only)
  and calls it before `applyFactOperation`. A rejected operation is logged at `info` with the op,
  the reason and the fact id (never the fact text), and the batch continues.
- **D7 — scope.** Not in this plan (they stay open in BUG-040 as model/unguarded remainder):
  the relevance of `start_training_session.warnings` to the planned exercises, and gym vocabulary
  ("табло"). The fabricated quote and scope misapplication are model-side — eval drafts
  LS-0011/0012 already exist. No model-backed run (economical-work): the guard is deterministic.
- **D8 — executor.** GLM (contract default); tasks are sequential in one worktree (Task 2 edits the
  files Task 1 tests). Sonnet takes over only if GLM stalls twice.

## Acceptance criteria

- **AC-FP-1:** an `add` operation with no evidence, or evidence not found in any user message
  (e.g. quoted from an Assistant line), stores nothing; the rest of the batch still applies.
- **AC-FP-2:** an `update` whose fact text carries a number found in no user message and not in
  the old fact text is skipped — `supersedeFact` is not called, the old fact stays (the BUG-040
  `2075cb9f` case: user asked «где тут рычаг?», coach said «~70% веса платформы»).
- **AC-FP-3:** a `retract` without user evidence is skipped (a coach's "your shoulder is fine now"
  cannot close a constraint).
- **AC-FP-4:** an operation with a verbatim user quote and only user-stated numbers is applied as
  before (no over-filtering); `confirm` is applied without evidence.
- **AC-FP-5:** the summariser prompt `summarizer` v5 is the bound `SUMMARIZER_PROMPT`: it asks for
  `evidence` on add/update/retract and states that the assistant's own statements are never user
  facts.

## Task 1 — Red tests (AC-FP-1..4), proven red on unchanged production

Repo convention (plan `session-2026-09-21-repro`): RED files are `*.repro.test.ts`, excluded from
`test:unit`, run by an explicit `--testMatch`, and **promoted** into the regular unit file when the
fix lands (Task 2). So the red commit passes the pre-commit hook with no bypass (D9).

**Files (test only, new):**
- `apps/server/src/infra/ai/graph/nodes/__tests__/compact.node.fact-provenance.repro.test.ts` —
  reuse the mocked-gateway setup of `compact.node.unit.test.ts` (import shared helpers if they are
  exported; if they are not, copy the minimum and note it — Task 2 promotes the cases into that
  file and drops the copy). `removed` messages with `HumanMessage`/`AIMessage`; the stubbed summary
  carries `factOperations`. Cases:
  - AC-FP-1: `add` with no evidence → `rememberFact` not called; `add` whose evidence is copied
    from the AI message → not called; a following valid op in the same batch still applies.
  - AC-FP-2 (the BUG-040 update): human «почему ты его называешь рычажным», AI «“130 кг” = блины
    полностью + ~70% веса платформы»; `update` of a known fact (text without "70") to a text with
    "~70%", evidence = the human line → `supersedeFact` not called.
  - AC-FP-3: `retract` whose evidence exists only in the AI message → `retractFact` not called.
  - AC-FP-4 (guards against over-filtering, expected green already): `add` with a verbatim user
    quote and a user-stated number → applied; `confirm` without evidence → applied.
- `apps/server/src/infra/ai/graph/__tests__/user-facts-provenance.scenario.repro.test.ts` — one
  scenario in the style of `user-facts.scenario.unit.test.ts`: the summariser's `add` carries a
  figure only the assistant said → the next run's `## User Facts` block has no line with it.

Build op objects with a cast (`as FactOperation`) where `evidence` is not yet in the type — do not
touch `src/` outside `__tests__` in this task.

**Verification:** from `apps/server`:
`npx jest --testMatch='**/__tests__/**/*.repro.test.ts' compact.node.fact-provenance user-facts-provenance`
→ AC-FP-1/2/3 cases and the scenario **fail** because a fact was stored / superseded / retracted
(quote each failing test name + the assertion line in `worker_done`); AC-FP-4 cases pass. Then
`npm run test:unit` → green (the repro files are not in it). Commit `test(red): …`.

## Task 2 — The fix (AC-FP-1..5)

**Files:**
- `apps/server/src/domain/conversation/episode.ts` — `evidence: z.string().optional()` on
  `FactOperationSchema` with a doc comment (D2).
- `apps/server/src/domain/user/services/fact-provenance.ts` (new) + its unit test
  `apps/server/src/domain/user/services/__tests__/fact-provenance.unit.test.ts` — D4, D5, D6.
  Export from the services index only if that index exists and is the local convention.
- `apps/server/src/infra/ai/graph/nodes/compact.node.ts` — collect user texts of `removed`, call
  the check for add/update/retract (for update pass the known fact's text from `knownFacts` by
  id), skip + `log.info` on rejection (D6).
- `apps/server/src/infra/ai/prompts/summarizer/v5.ts` (new, copy of v4 + the provenance rules:
  facts come only from what the user said or confirmed; the assistant's claims, estimates and
  explanations are never user facts; `evidence` = a short verbatim quote from a User line in the
  original language; numbers in a fact only if the user wrote them) and `summarizer/index.ts`
  (`SUMMARIZER_PROMPT` → v5, keep v4 exported). Follow how v3→v4 was bumped (prompt snapshot /
  registry tests, prompt-version stamps) — update those deliberately.
- Promote the Task 1 repro cases into `compact.node.unit.test.ts` and
  `user-facts.scenario.unit.test.ts` (test names keep `AC-FP-*`) and delete both repro files.
- Existing tests whose `add`/`update`/`retract` ops lack evidence: give them a valid evidence
  quote from their own human messages — do not weaken the new cases.

**Verification:** from `apps/server`: `npm run type-check && npm run lint && npm run test:unit`
→ green, including every Task 1 case; then
`/Users/filko/orca/workspaces/fit_coach/db-test-lock.sh npm run test:scenarios` → green (quote
counts). Also `npm run test:integration` through the same lock if the plan's files are covered by
integration tests (`grep -rl 'factOperations\|SUMMARIZER' tests/integration`).

## D9 — the red commit

- **D9 — repro files, no hook bypass.** Red tests live in `*.repro.test.ts` (existing convention),
  so the red commit passes the pre-commit hook. The orchestrator re-runs Task 1's command on the
  red commit before Task 2 starts; Task 2 promotes the cases into
  `compact.node.unit.test.ts` / `user-facts.scenario.unit.test.ts` and deletes the repro files.

## Evidence

- **Red (Task 1, `568efaf7`)** — re-run by the orchestrator on the red commit:
  `npx jest --testMatch='**/__tests__/**/*provenance*.repro.test.ts'` → 5 failed, 2 passed.
  Failing because the operation *was applied*: AC-FP-1 ×2 (`rememberFact` called), AC-FP-2
  (`supersedeFact` called with the "~70%" text), AC-FP-3 (`retractFact` called), scenario (the
  coach-only fact row stored). AC-FP-4 ×2 green (no over-filtering).
- **Green (Task 2, `6d512d2d`)** — worker: `test:unit` 153 suites / 1529 tests, `test:scenarios`
  19 / 392 + 1 todo, `test:integration` 47 / 634 + 1 todo; orchestrator re-run of
  `test:scenarios` under the DB lock: 19 suites, 392 passed + 1 todo. Repro files promoted and
  deleted.
- **D10 (found in Task 2)** — the `review-memory-delete` integration scenario's markers `RRP6-…`
  carried the digit 6, which D4 correctly refused; renamed to digit-free `RRPX-…` so that journey
  keeps testing the stale-evidence guard, not the new one.
- **D11 — docs.** ADR-0009 gains "Amendment 2026-09-27 — provenance" and ADR-0013 §3 a one-paragraph
  pointer (factual record of the shipped rule, flagged for the owner). BUG-040 → *Partially fixed*:
  warnings relevance, vocabulary and the model-side misses stay open (D7).
