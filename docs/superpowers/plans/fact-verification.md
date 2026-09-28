# Fact Verification — a Model Checks Each Compaction Fact Against the User's Words (BUG-040 follow-up) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans and
> test-driven-development. Red tests first, proven red on unchanged production, then the fix.

- Status: done
- Branch: plan/fact-verification
- After: fact-provenance
- Review: 2026-09-28 | clean | R1,R2,R3,R4

**Goal:** replace the string-based provenance check shipped by `fact-provenance` with a
model-based verification (the industry NLI / faithfulness pattern). Owner, 2026-09-28: «код с
недетерминированными строками максимально не надежная вещь … надо проверять через модель как это
делает индустрия, если факт найден. это не происходит постоянно». The string check rejected real
facts dictated with number words («колено болит уже пять дней» → fact "5 days" → dropped) and could
not catch a non-numeric coach claim at all.

After this plan: when the summariser returns at least one `add` / `update` / `retract`, **one**
extra structured model call (the verifier) receives the episode transcript with speaker labels and
the candidate operations, and says per operation whether the **user** stated or explicitly
confirmed it. Only supported operations are applied. No call when there is nothing to verify.

## Decisions (D)

- **D1 — the string check is removed, not kept as a pre-filter.** Owner's call: string matching on
  model output is the unreliable part. `domain/user/services/fact-provenance.ts` and its tests are
  deleted; the D4/D5/D12 number and quote rules of `fact-provenance` are superseded.
- **D2 — one verifier call per compaction, only when needed.** Batch all mutating operations of
  one summary into one call; `confirm`-only or empty `factOperations` → no call (D3 of
  `fact-provenance` kept: `confirm` never changes text).
- **D3 — what the verifier sees.** The same `renderTranscript(removed)` the summariser saw (User /
  Assistant / tool lines labelled), the candidate operations numbered (op, fact, phaseNote, and for
  `update` the old fact text, for `retract` the reason), plus the summariser's `evidence` quote as a
  hint. Rule it applies: an operation is supported only if the **user** stated it or explicitly
  confirmed it (a «да» to the assistant's direct question about exactly that counts); anything only
  the assistant said, estimated or explained is unsupported; every number/amount in the fact or
  phase note must match what the user said — digits or words, any language, same meaning («пять
  дней» = "5 days", «неделю» = "a week" / "7 days"); a figure the user never gave is unsupported.
- **D4 — schema.** `{ verdicts: [{ index: int, supported: boolean, reason: string }] }`, strict.
  An operation with no verdict, or a duplicate/out-of-range index, counts as unsupported.
- **D5 — fail closed.** Verifier call throws or returns an unparsable answer → every mutating
  operation of that compaction is skipped and logged at `warn`; the summary and `confirm`s still
  apply (the fact-lifecycle D-E rule: a fact failure never changes the compaction result). A lost
  fact is restated later; a false one persists.
- **D6 — model and route.** The verifier is a `structured()` call through the existing
  `llmGateway` with profile `summarizer` (same model and route as the summariser; no new env) and a
  versioned prompt module `infra/ai/prompts/fact-verifier/v1.ts`. It is logged/recorded by the
  gateway like every other call (audit trail). Where it lives: a small `verifyFactOperations`
  function in `infra/ai/graph/nodes/` beside `compact.node.ts` — its own module, which also answers
  the `fact-provenance` R1 advisory about `compact.node.ts` size.
- **D7 — summariser prompt v6.** v5's text says operations are "verified in code … word-for-word";
  that is no longer true. v6 = v5 with the PROVENANCE section restated for model verification
  (still asks for `evidence` as a short user quote, still: facts only from the user; numbers keep
  the user's units). `SUMMARIZER_PROMPT` → v6; v4/v5 stay exported.
- **D8 — logging.** A rejected operation logs op, factId, the verifier's `reason`; never the fact
  text (as before).
- **D9 — live probe.** After the code is merged-ready, 4 verifier calls on the dev route (Z.AI
  `glm-5.3-flash`, `json_object`) from a script: (1) the BUG-040 transcript with the "~70%" update
  → unsupported; (2) «колено болит уже пять дней» → "Knee pain for 5 days" → supported; (3) «колено
  болит неделю» → "Knee pain for about a week" → supported; (4) the coach's non-numeric «это
  рычажный тренажёр» with the user's «где тут рычаг?» → unsupported. Recorded in `COST_LEDGER.md`.
  A wrong verdict blocks the merge and goes back to the prompt.
- **D10 — executor.** GLM, tasks sequential in one worktree; Sonnet takes over if GLM stalls twice.

## Acceptance criteria

- **AC-FV-1:** a number stated in words by the user («пять дней») no longer drops the fact: with the
  verifier answering supported, the `add` "Knee pain for 5 days" is applied.
- **AC-FV-2:** an operation the verifier marks unsupported is skipped (the BUG-040 "~70%" update and
  a non-numeric coach claim); the rest of the batch applies.
- **AC-FV-3:** verifier failure (throw / unparsable) → no mutating operation applied, `confirm`s and
  the summary still applied, compaction result unchanged.
- **AC-FV-4:** no mutating operation → the verifier is not called; a missing / out-of-range verdict
  → that operation unsupported.
- **AC-FV-5:** prompt modules: `fact-verifier` v1 states the D3 rule; `summarizer` v6 bound as
  `SUMMARIZER_PROMPT` and no longer claims word-for-word code verification.
- **AC-FV-6:** live probe (D9) — all four verdicts as expected.

## Task 1 — Red tests (AC-FV-1..4), proven red on unchanged production

New file `apps/server/src/infra/ai/graph/nodes/__tests__/compact.node.fact-verification.repro.test.ts`
(repo convention: `*.repro.test.ts`, run by explicit `--testMatch`, promoted in Task 2). Reuse the
mocked-gateway pattern of `compact.node.unit.test.ts`; the stubbed gateway's `structured` answers
by `schemaName` (the summariser's `episode_summary_v4` → the summary; anything else → the
verifier's verdicts). Cases:
- AC-FV-1: user «колено болит уже пять дней», `add` "Knee pain for 5 days", evidence «колено болит
  уже пять дней», verifier supported → `rememberFact` called. (Red today: the digit check drops it.)
- AC-FV-2: user «А где тут рычаг?», AI «это рычажный тренажёр, рычаг даёт выигрыш в силе», `add`
  "The leg press is a lever machine" with evidence «где тут рычаг», verifier unsupported →
  `rememberFact` not called; a second, supported op in the same batch → applied. (Red today: the
  quote is found and there is no number, so it is stored.)
- AC-FV-3: verifier `structured` rejects → no `rememberFact`/`supersedeFact`/`retractFact`, a
  `confirm` in the batch still calls `confirmFact`, the summary is still inserted. (Red today: the
  ops with valid quotes are applied.)
- AC-FV-4: summary with only a `confirm` → exactly one `structured` call (the summariser). (Green
  today — a guard.) A verdict list missing index 1 → op 1 not applied.

**Verification:** from `apps/server`:
`npx jest --testMatch='**/__tests__/**/*fact-verification*.repro.test.ts'` → AC-FV-1/2/3 fail for
the stated reason (quote names + assertion lines), AC-FV-4 passes; `npm run test:unit` green.
Commit `test(red): fact-verification - …`.

## Task 2 — The verifier (AC-FV-1..5)

- `apps/server/src/infra/ai/prompts/fact-verifier/v1.ts` (+ `index.ts`, registered like other
  modules) and `__tests__/v1.unit.test.ts` — D3 wording.
- The verdict schema (D4) beside the other structured schemas (`domain/conversation/episode.ts` is
  where `FactOperationSchema` lives — put `FactVerdictsSchema` there or in the verifier module,
  whichever the local convention for LLM-output schemas is).
- `apps/server/src/infra/ai/graph/nodes/verify-fact-operations.ts` (+ unit test): builds the
  prompt, calls `llmGateway.structured(FactVerdictsSchema, …, { profile: 'summarizer', schemaName:
  'fact_verdicts_v1', runId, userId })`, maps verdicts to operations (D4), fail closed (D5).
- `compact.node.ts`: replace the `checkFactProvenance` block with one `verifyFactOperations` call
  before the apply loop; skip + log unsupported (D8).
- Delete `apps/server/src/domain/user/services/fact-provenance.ts` and its unit test; move the
  AC-FP cases in `compact.node.unit.test.ts` / `user-facts.scenario.unit.test.ts` onto the verifier
  stub (they keep testing "coach-only figure is not stored", now via the verifier verdict).
- `apps/server/src/infra/ai/prompts/summarizer/v6.ts` + `index.ts` (D7), `v6.unit.test.ts`.
- Promote the Task 1 repro cases into `compact.node.unit.test.ts` (names keep `AC-FV-*`), delete
  the repro file.
- Scripted gateways in scenario/integration/eval tests that stub `structured` for the summariser
  must answer the verifier call too (supported for the ops they expect applied).

**Verification:** from `apps/server`: `npm run type-check && npm run lint && npm run test:unit`
green; `/Users/filko/orca/workspaces/fit_coach/db-test-lock.sh npm run test:scenarios` green;
`/Users/filko/orca/workspaces/fit_coach/db-test-lock.sh npm run test:integration` green.

## Task 3 — Live probe (AC-FV-6) — orchestrator

`apps/server/scripts/probe-fact-verifier.ts` (worker writes it in Task 2's worktree; the orchestrator
runs it — model calls are the orchestrator's): the four D9 cases through the real `verifyFactOperations`
with the local `.env` route (Z.AI, same as dev). Output: per case verdict + reason. Recorded in the
plan and `apps/server/evals/COST_LEDGER.md`.

## Evidence

- **Red (Task 1, `dd5aad8d`)** — orchestrator re-run: 3 failed / 2 passed. AC-FV-1 (`rememberFact`
  0 calls: the digit check dropped "5 days"), AC-FV-2 (2 calls: the lever-machine claim stored),
  AC-FV-3 (1 call: valid-quote op applied with no verifier). AC-FV-4 ×2 green (guards).
- **Green (Task 2, `eb9ac4c9`)** — worker: `test:unit` 155 / 1542, `test:scenarios` 19 / 392 + 1
  todo, `test:integration` 47 / 634 + 1 todo. `fact-provenance.ts` and the repro file deleted.
  Scripted gateways answer the verifier (`scripted-model.ts` gained a `fact_verifier` kind whose
  fallback is all-supported — test scaffolding only).
- **D11 (found at acceptance)** — a third verdict for a duplicated index resurrected it (delete-then-
  set). Red test `AC-FV-4: a THIRD verdict with the same index …` failed (`Received: true`), fixed
  with a voided-index set (`693dbafa`); `test:unit` 155 / 1543.
- **D12 — probe script not type-checked by `npm run type-check`** (tsconfig excludes `scripts/`, as
  for `print-transcript.ts`); the orchestrator kept tsconfig unchanged, the worker type-checked it
  one-off (exit 0).
- **AC-FV-6 live probe** — dev route, `glm-5.3-flash`: **4/4** as expected — the BUG-040 "~70%"
  update unsupported; «колено болит уже пять дней» → "5 days" supported; «колено болит неделю» →
  "about a week" supported; the coach's non-numeric «это рычажный тренажёр» unsupported. 12 calls in
  total (the script was run 3× because its first outputs were buried in recorder error logs: the
  probe's `runId` is not a UUID, so `llm_calls` rejects the row — harmless, local DB only).
  `COST_LEDGER.md` row added.

## Task 5 — Store the user's quote with the fact (owner 2026-09-28: «да добавляй»)

Owner asked whether to keep a quote from the conversation with each fact; answered yes. Purpose:
the coach can show the user's real words when asked "откуда ты это взял" instead of inventing a
quote (BUG-040 item 4), the user sees why a fact exists (`list_facts`), and facts can be re-checked
later after the episode is compacted away.

- **D17 — column.** `user_facts.evidence text NULL`, added in `schema.ts` and a generated migration
  (`npm run drizzle:generate`; HB-01 — never `push`). Existing rows stay NULL. Domain `UserFact`
  gains `evidence: string | null`; `rememberFact` / `supersedeFact` inputs accept an optional
  `evidence`.
- **D18 — which quote.** The verifier returns, per verdict, `userQuote`: the user's own words from
  the transcript that support the operation (original language; empty when unsupported). The
  compaction stores `userQuote` if non-empty, else the summariser's `evidence`. No string matching
  (owner's rule) — both are model output; the verifier's is preferred because it decided the verdict.
  `fact_verdicts_v1` / `fact-verifier` v1 are unreleased — edit in place.
- **D19 — per operation.** `add` → stored on the new row; `update` → on the superseding row (the old
  row keeps its own quote as history); `retract` / `confirm` → no quote written.
- **D20 — live path.** `manage_fact` "save" stores the current user message text as `evidence`
  when the run context exposes it; if it does not, leave NULL and report (do not thread new plumbing
  without asking).
- **D21 — where it shows.** Not in the `## User Facts` block (tokens every turn). `list_facts` prints
  it per fact as `said: «…»` (cut at 200 chars), and its description tells the coach: when asked
  where a fact came from, quote `said` exactly; if there is none, say the source is not recorded —
  never reconstruct a quote.

**Red tests first** (proven red on the current branch, repro convention or plain failing tests
committed together with the fix only after the red run is quoted): compaction `add` passes
`evidence` = the verifier's `userQuote` to `rememberFact`; `update` passes it to `supersedeFact`;
`list_facts` renders `said: «…»`; `manage_fact` save stores the current message (if D20 applies);
a DB-backed integration test round-trips the column.

**Verification:** `npm run type-check && npm run lint && npm run test:unit`;
`db-test-lock.sh npm run db:local:migrate` is NOT to be run by the worker against the dev DB —
the test DB gets migrations via the test setup; `db-test-lock.sh npm run test:scenarios` and
`db-test-lock.sh npm run test:integration` green.
- **D13–D16 (review follow-ups, `0ad92f62`)** — a `retract` now reaches the verifier with the text
  of the fact it closes (red first: `AC-FV-2 (D13)` failed on `832eddad` sources, re-checked by the
  orchestrator); the skip log carries op, fact id and verdict status only (the verifier's free-text
  reason can hold the user's words); v6 says only add/update/retract are re-checked;
  `clearStructuredScripts()` return type and the v5 test header fixed.
- **Task 5 (`d9f0f686`)** — `user_facts.evidence` (migration `0019_glamorous_argent.sql`:
  `ALTER TABLE "user_facts" ADD COLUMN "evidence" text;`), verifier `userQuote` (optional, empty
  default), stored per D18/D19, shown by `list_facts` per D21. Red re-checked by the orchestrator on
  the pre-fix sources (`c5e1840d`, ts-jest diagnostics off so the new fixtures compile): 10 failed —
  compaction add/fallback/update quote, verdict `userQuote` ×2, `list_facts` ×3, v1 prompt, schema
  column. Green: `test:unit` 155 / 1556 (worker); orchestrator re-run `test:integration` 47 / 636 +
  1 todo, `test:scenarios` 19 / 392 + 1 todo. **D20 did not apply:** the tool run context carries
  no current user message, so `manage_fact` writes NULL (no plumbing added) → `BACKLOG.md`.
  The required `UserFact.evidence` added `evidence: null` to fixtures in 24 test files and updated 5
  tool-surface snapshots (list_facts description) — mechanical.

## Review

One combined reviewer over all four zones (economical-work), 2026-09-28, diff up to `832eddad`.
**Verdict: clean — no blocking findings.** Checked correct: fail-closed path (summary and `confirm`
still apply), verdict index mapping incl. duplicates, `runId`/`userId` on the verifier call, AC-FV
test names. Advisories and disposition:
- R1 — ADR-0009 amendment rewritten in place → `BACKLOG.md`. `verify-fact-operations.ts` placement
  → `BACKLOG.md`.
- R2 — unused `enqueueFactVerdicts` / all-supported fallback → `BACKLOG.md` (+ meta blind spot);
  `clearStructuredScripts` type → **fixed** (D16); `knownFactLine` ×3 → existing BACKLOG entry
  widened; role mapping ×3 → `BACKLOG.md`.
- R3 — `retract` without the fact text → **fixed** (D13); episode-only scope and reply-path latency
  → stated in ADR-0009; free-text reason in the log → **fixed** (D14); v6 "every operation" →
  **fixed** (D15).
- R4 — `ARCHITECTURE.md` v4/v5 → **fixed**; v5 test header → **fixed** (D16); STATE → updated at
  merge; `knownFactLine` backlog entry → **fixed**.
- meta — reply-path latency rule candidate and scripted-fallback blind spot → `REVIEW_FINDINGS.md`.
Task 5 landed after the review (owner request mid-plan); its red/green evidence is above, and it is
covered by the orchestrator's own reading of the diff and the full suite re-run.
