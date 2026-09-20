# Project State

Single orientation point for any working session: what is in progress, what is next,
what is in scope. Read this file first; update it on every status change (event-driven,
not end-of-session). Conventions are defined in `docs/SUPERPOWERS_INTEGRATION.md` § Status layer.

The block between the AUTO markers below is generated from
`docs/superpowers/plans/` + git facts by `node scripts/state.mjs --write` — never hand-edit it.
Everything below the block is hand-written: only facts no generator can derive.

<!-- AUTO:status BEGIN — regen: node scripts/state.mjs --write -->
_Generated 2026-09-20 from docs/superpowers/plans/ + git. Never hand-edit; regen with `node scripts/state.mjs --write`._

**In progress**
— none —

**Planned**
- `refactor-p4-evals-verify.md` — Refactor P4 — Evals Verify (mini-freeze + compare) Micro-Task
- `refactor-p6-progress-and-drafts.md` — Refactor P6 — Muscle-Centric Progress Blocks and Structured Drafts Implementation Plan
- `reply-latency-and-typing.md` — Reply Latency and Live Typing (BUG-019) Implementation Plan

**Done**
- `2026-09-14-lint-glob-fix.md` — Lint Glob Fix Implementation Plan
- `chat-continuity.md` — Chat Continuity — Compaction Keeps the Recent Conversation, the Reply Answers the Latest Message Implementation Plan
- `mandatory-plan-review.md` — Mandatory Plan Review Implementation Plan
- `migration-discipline.md` — Migration Discipline (HB-01) Implementation Plan
- `ports-layout-consistency.md` — Ports Layout Consistency Implementation Plan
- `refactor-p0-dead-code.md` — Refactor P0 — Dead Code Removal Implementation Plan
- `refactor-p0-eval-baseline.md` — Refactor P0 — Remaining Datasets and v0 Baseline Implementation Plan
- `refactor-p0-eval-harness-seeding.md` — Refactor P0 — Harness Episode Seeding and v0 Re-freeze Implementation Plan
- `refactor-p0-eval-harness.md` — Refactor P0 — Eval Harness (L0) Implementation Plan
- `refactor-p0-eval-l1-chat-training.md` — Refactor P0 — L1 Runner and Chat/Training Datasets Implementation Plan
- `refactor-p0-run-log.md` — Refactor P0 — Run Log Implementation Plan
- `refactor-p0-transcript-export.md` — Refactor P0 — Transcript Export Implementation Plan
- `refactor-p1-legacy-llm-retirement.md` — Refactor P1 — Legacy LLM Path Retirement Implementation Plan
- `refactor-p2-context-assembler.md` — Refactor P2 — Context Assembler Implementation Plan
- `refactor-p2-prompt-modules.md` — Refactor P2 — Prompt Modules Implementation Plan
- `refactor-p3-phase-spec.md` — Refactor P3 — PhaseSpec Factory and Shared Agent Node Implementation Plan
- `refactor-p3-run-context-commit.md` — Refactor P3 — Run Context, Commit Node and Conversation Run Port Implementation Plan
- `refactor-p3-tool-executor.md` — Refactor P3 — Shared Tool Executor Implementation Plan
- `refactor-p4-context-budget.md` — Refactor P4 — Context Budget and Domain Blocks Implementation Plan
- `refactor-p4-episode-memory.md` — Refactor P4 — Episode Memory Implementation Plan
- `refactor-p5-concurrency-delivery.md` — Refactor P5 — Concurrency and Delivery Hardening Implementation Plan
- `refactor-p6-facts-and-progress-blocks.md` — Refactor P6 — User Facts (Group 1) Implementation Plan
- `review-self-improvement.md` — Review Self-Improvement Implementation Plan
- `structured-output-fenced-json.md` — Structured Output — Fenced-JSON Recovery and the User-Facts Scenario Test Implementation Plan
- `structured-output-json-object-mode.md` — Structured Output — Provider Mode `json_object` for the Z.AI Route Implementation Plan
- `training-journey-scenarios.md` — Training Journey Scenarios — Deterministic over the Real Test DB + Live L3 Implementation Plan

**Close-out debt (merged but plan not done)**
— none —
<!-- AUTO:status END -->

## Scope now

- **LLM core refactor** — the governing initiative. Master plan: `LLM_CORE_REFACTOR_PLAN.md`
  (phases P0–P7, acceptance criteria `AC-13xx`), target architecture `docs/adr/0013-llm-core-target-architecture.md`,
  quality gate `PROMPT_EVAL_FRAMEWORK.md`. **P0 is complete (2026-09-15)**: all six plans
  merged; the `v0` baseline is frozen at `evals/baselines/v0/` (seeded-harness re-freeze,
  direct-Z.AI route). **P1 is complete (2026-09-16)**: legacy LLM path retired, merged via PR #14,
  deployed to dev. **P2 is complete in full (2026-09-17)**: prompt modules (items 1, 2, 4, 5)
  and the context assembler (item 3, PR #16, deployed to dev, AC-1323 met on live runs).
- **Architecture/hygiene backlog** — `PLAN-architecture-refactor-backlog.md` (`HB-##` items).
- **Global backlog** — `BACKLOG.md`: permanent parking lot of unplanned ideas/findings/
  wishes; top entries are candidates for *Next* below (intake via the `backlog` skill).
- **Bugs** — `BUGS.md` (`BUG-###` entries with their own Status fields).

## Next (dispatch order)

1. **Refactor P2 complete in full (2026-09-17)** — all five items merged:
   `refactor-p2-prompt-modules` (items 1, 2, 4, 5; AC-1321/1322/1324) and
   `refactor-p2-context-assembler` (item 3, AC-1323, merged via PR #16, deployed to dev).
   One `assembleContext` + per-phase `PhaseLayout` on the registry; `budgetReport` on every
   agent-backed run row and in the run log line; byte identity proven by 15 frozen
   message-assembly snapshots; AC-1322 held (3 apparent text-check regressions were sample
   noise — not reproduced on re-run). §3.4 first measurement on dev: session_planning
   system ~3.2 k / training ~3.6 k estimated tokens (n=1/2 — floors, not means; re-measure
   before P4 locks budgets). PC-0007/SP-0005 (BUG-014/015) still fail in both v0 and v1 —
   wording work per PROMPT_EVAL_FRAMEWORK §8, not refactor scope (BUG-014 observed live in
   the smoke: the model narrates a saved plan without calling `save_workout_plan`).
   **P3 is complete (2026-09-18)**: the three chained plans (`refactor-p3-tool-executor`,
   `refactor-p3-phase-spec`, `refactor-p3-run-context-commit`) closed as one phase with a
   clean four-zone review, deployed to dev at `bbab7b07`, plus the `fix/p3-tails` follow-up
   (executor schema-rejection hint, nullable `model` column — migration `0003`). AC-1334's
   L1 half was waived by the owner (quota); byte-identity snapshots + the dev smoke stand in.
   Verified again 2026-09-18 on `6ea80646`: `check-all` clean, 491 unit tests green,
   `state.mjs --check` OK.
2. **Refactor P4 (episode memory) is complete (2026-09-18)**: `refactor-p4-episode-memory`
   merged to dev (`159a4a80` at deploy; review fixes through `138e6752`), deployed to dev,
   migration `0004` applied, dev smoke green (legacy import once, AC-1345 live evidence,
   forced-gap compaction → one `conversation_summaries` row). Close-out review: first pass
   blocked (R2 token-basis duplication ×1, R4 stale law docs ×2), fixed architecturally —
   the message-token basis now lives once in `token-estimator.ts`; re-run clean
   (`- Review: 2026-09-18 | clean`). AC-1341/1342/1345/1346 closed; **AC-1344 pending**
   `refactor-p4-evals-verify` (compare run, budget-gated). One follow-up found in the smoke
   and fixed post-merge: the structured-output retry gate now also catches `SyntaxError`.
   Advisories: `BACKLOG.md` § P4 close-out review advisories (11 entries).
   **P4 is complete in full (2026-09-19)**: `refactor-p4-context-budget` closed —
   `Status: done`, review `2026-09-19 | clean | R1,R2,R3,R4`, merged to `dev` and deployed.
   Task 1 measured from smoke rows (dev has no organic traffic) and the ADR §3.4 defaults
   kept; three `compact.node.ts` advisories folded into its Task 4. Executor: Sonnet
   subagents from the orchestrating session (Z.AI weekly quota 63 % consumed by 2026-09-19 —
   GLM executor paused until the window resets). The close-out took three review passes and
   seven blocking fixes, all DRY/correctness, none behavioural: one shared prefixed-env
   parser (`config/prefixed-env.ts`); `prune-checkpoints` blob retention scoped to every
   retained checkpoint, not only the latest (BR-LLM-005 — the bug would have made a
   younger-than-cutoff checkpoint unloadable); the four phase `v1.ts` files repointed to
   `prompts/blocks/` (the plan's Task 2 import-back step, previously done only for
   `training/v1.ts`); and one canonical `RenderableBlock<D>` in `blocks/types.ts` with
   `ContextBlock<D>` extending it. Dev smoke: 3 × `/api/bot/chat`, all 200,
   `budgetReport.history` 1610 ≤ `budget.history` 12000, no `cuts`. **AC-1344 remains
   pending** the consolidated eval pass. Advisories: `BACKLOG.md` § P4 context-budget
   close-out review advisories (6 entries); rule candidates in `REVIEW_FINDINGS.md`.
   **P5 and P6 are planned (2026-09-19)**: `refactor-p5-concurrency-delivery`
   (AC-1351..1354 — per-user run mutex on `ConversationRunPort`, typed error mapping, bot
   watchdog and localized fallbacks; all four ACs deterministic, nothing deferred) and
   `refactor-p6-facts-and-progress-blocks` (AC-1361..1364 — `user_facts` extracted at
   compaction with `remember_fact` dropped per the owner's 2026-09-17 decision,
   muscle-centric progress blocks, structured drafts; deterministic halves now, model-backed
   halves deferred). Each carries a "Decided without the owner (2026-09-19)" table for
   review — P5 has 10 entries, P6 has 13.
   **Owner strategy 2026-09-19 — code first, one consolidated eval pass:** per plan only
   mocked tests, L0 and one 3–5-call dev smoke; no mini-runs, working-checks or per-plan
   `evals-verify` micro-tasks. All model-backed evals (AC-1344 compare for episode memory
   and context budget, L2 rubric) run once, on the prod model through OpenRouter (off the
   Z.AI quota), after a milestone the owner picks (recommended: after P6), then fixes are
   planned from the results and the suite is re-run. `refactor-p4-evals-verify` stays
   planned only as the record of what that pass must include.
3. **P5 is complete (2026-09-19)**: `refactor-p5-concurrency-delivery` closed —
   `Status: done`, review `2026-09-19 | clean | R1,R3` with **no blocking findings in either
   zone**, merged to `dev` and deployed. All four ACs closed now, none deferred: AC-1351
   (per-`userId` run mutex on `ConversationRunPort` via `withRunMutex`; DB-backed integration
   test on real run rows), AC-1352 + INV-LLM-006 (typed errors → 503/409/500, bodies carry
   `code` only, no exception text or stack), AC-1353 (bot polling watchdog — **BUG-012 fixed**),
   AC-1354 (localized error text per code, no two codes sharing a string). `requestTimeout`
   raised 30 s → 420 s against measured dev latency: `plan_creation` p95 = 317 s, and 15 runs
   had already exceeded the old limit with 14 of them finishing `ok`. `apps/bot` gained its
   first test harness (16 tests). **Two things deliberately not implemented and escalated to
   the owner:** the `ToolSystemError` raise (ADR-0013 §6:324 says raise → HTTP 500, but the
   shipped code answers HTTP 200 with the localized `tool_system_error` message; raising would
   be a user-visible regression, so the ADR and the code genuinely disagree and the owner
   decides), and the bot's clear-on-404 cache branch (unreachable — no route the bot calls
   returns 404). ADR-0013 §6 amendments to escalate are listed in the plan's `## Review`.
4. **P6 Group 1 (user facts) is complete (2026-09-19)**: `refactor-p6-facts-and-progress-blocks`
   closed — `Status: done`, review `2026-09-19 | clean | R1,R2,R3,R4` (first pass blocked on
   one DRY finding — the fact-conflict check duplicated in both tools — fixed by one shared
   guard, R2 re-run clean), merged to `dev` and deployed with migration `0005` (`user_facts`).
   Facts are extracted only at compaction (summariser v3 `facts`, idempotent upsert with a
   confirmation counter; `remember_fact` stays dropped), rendered as `## User Facts` at block 2
   on the `longTerm` budget, and a `physical_constraint` fact now **binds**:
   `save_workout_plan` / `start_training_session` reject an exercise whose primary muscles hit
   it. AC-1361 deterministic half closed; its pass rate and AC-1364 deferred to the
   consolidated eval pass. First plan executed through Orca workers (GLM, one worker session
   per task). **By owner decision the plan was split at the Group 1 boundary (D-A):** Groups 2–3
   (muscle-centric progress blocks, structured drafts; AC-1362/1363) are now
   `refactor-p6-progress-and-drafts` (`Status: planned`, `After:` the facts plan).
   **Escalated to the owner:** ADR-0009 / ADR-0013 amendments listed in the facts plan's
   Task G1 (D-14 dropped, block 2, INV-LLM-004 cut order gains a facts step). Advisories:
   `BACKLOG.md` § P6 facts (Group 1) close-out review advisories.
5. **BUG-017 fixed (2026-09-19)**: `structured-output-fenced-json` closed — review
   `2026-09-19 | clean | R1,R2,R3,R4` (first pass blocked on a stale ADR-0013 §7 sentence,
   duplicated test fixtures and an unrecorded verification; all closed, re-run clean). The P6
   dev smoke found that the summariser (GLM via Z.AI) answers structured calls with fenced JSON,
   which the SDK-side parse threw on before any message existed — so no episode summary and no
   user fact was ever produced on dev, and LangChain retried each failure 6 more times (621 s of
   one 650 s run). `structured()` now sends the identical `json_schema` request and parses the
   answer itself (JSON → code fence → JSON in prose, same Zod schema, one retry). ADR-0013 §7
   amended with the owner's approval. A mocked-model scenario test now pins the whole user-facts
   chain (fenced summary → fact → `## User Facts` block → tool rejection → confirmation counter).
   Advisories: `BACKLOG.md` § structured-output-fenced-json close-out review advisories. Also
   observed in that smoke: the public NPM proxy cuts `/api/bot/chat` at 90 s (504) while the
   server allows 420 s — the bot is unaffected (it calls the server directly).
6. **Structured output on the Z.AI route (2026-09-19)**: `structured-output-json-object-mode`
   closed — review `2026-09-19 | clean | R1,R2,R3,R4` (first pass blocked on two test-fixture
   duplications, fixed, R2 re-run clean). The BUG-017 smoke showed GLM on Z.AI ignores
   `json_schema` altogether (the Z.AI API accepts only `text`/`json_object`); `structured()` now
   takes its request mode from `LLM_STRUCTURED_OUTPUT_MODE` — `json_schema` (default, prod) or
   `json_object` + the JSON Schema in a trailing system message (dev; probed 4/4 schema-valid with
   the real summariser prompt). ADR-0013 §7 and AC-1311 amended with the owner's approval.
   Set on dev by the owner; **dev smoke 2026-09-19 green** — one episode summary and four user
   facts (incl. `physical_constraint`/`lower_back`), summariser 14 s with no retry, `longTerm` = 99
   on the next run. **BUG-017 fixed.** Prod is untouched (default `json_schema`).
7. **Next to dispatch: `refactor-p6-progress-and-drafts`** — unblocked once the facts plan is
   merged. Then P7 per the master plan phase map and the consolidated eval pass.
3. **`ports-layout-consistency`** — one rule for port file layout in `ARCHITECTURE.md`,
   the code aligned to it, ESLint keeping it that way. Independent of the P0 chain;
   can run alongside it.
4. **HB-02** (production Docker image) — its own plan, sequenced after HB-01;
   note it must keep `scripts/stamp-baseline.ts` runnable (see the HB-02 note
   in that script's plan).

## Handoff (orchestrator relay, 2026-09-20)

The orchestrator relays to a fresh session at clean boundaries (owner rule 2026-09-20; memory
`orchestrator-session-relay`, `economical-work`). Where work stands:

- **`training-journey-scenarios` — done, merged to `dev` (2026-09-20)**: review clean (one combined
  agent), pre-merge `npm run test:scenarios` 221/221. Owner decided no CI job — the rule is in
  `docs/ORCHESTRATION.md` § Scenario self-check. Worktree
  `/Users/filko/orca/workspaces/fit_coach/training-journey-scenarios` and branch
  `plan/training-journey-scenarios` are **ready to clean up** (owner-gated; run `run_f05123509d74`
  has two retained idle worker terminals).
- **`chat-continuity` (BUG-018) — done, merged to `dev` (2026-09-20)**: compaction keeps the last
  `EPISODE_KEEP_TURNS` (6) turns and never drops unsummarised messages, time-gap note before the new
  message after a pause, the reply carries every assistant text of the run. Review clean after one fix
  (budget cut now always summarised). **Next:** deploy to dev (health 200), then the owner's own Telegram
  "привет" after a pause (AC-CC-5) closes BUG-018. Worktree `/Users/filko/orca/workspaces/fit_coach/chat-continuity`
  and branch `plan/chat-continuity` ready to clean up (owner-gated); run `run_b49c61f61663` keeps one
  idle worker terminal.
- **Test DB:** `fitcoach_test` (local container `fitcoach-db`); `.env.test` no longer sets
  `RUN_DB_TESTS` (backup `apps/server/.env.test.bak-20260920`, owner may ask to delete). Never
  run tests in two worktrees against it at once; workers never touch a DB by hand.
- **Owner-only:** live L3 (`DB_NAME=fitcoach_test RUN_LLM_EVALS=1 npm run evals -- --level L3`),
  closing Orca sessions, deleting branches/worktrees.

## Blocked / waiting on owner

- **Red-button eval runs (owner-launched only, separate budget; not blocking any plan):**
  (a) full `v2` baseline on post-P3 code — 62 cases × n=3 ≈ 186 calls — must run on the
  `refactor-p4-episode-memory` Task 1 commit (before Task 3 lands) if it is ever to exist;
  (b) full AC-1344 sweep after P4 episode memory merges (same size). The runner refuses
  both without `EVALS_FULL_RUN=1` (guard lands in that plan's Task 1). Until (b) runs,
  AC-1344's "±2 pp on other datasets" stays unmeasured and is recorded as such. Every
  model-backed run (mini or red-button) is metered: requests, tokens, quota before/after,
  delta and % of the weekly limit go into `apps/server/evals/COST_LEDGER.md` (mechanism =
  that plan's Task 1; whether Z.AI exposes a quota endpoint is a spike there — unverified).
- OQ-3 (judge profile) has a recommended default
  (Gemini 3 Flash PAYG) that P0's eval harness will assume until ruled otherwise.
- Three P1/P2 questions were **decided by the owner on 2026-09-13** and need no further
  input: summariser→`structured` deferred to P4; `prompts/blocks/` accepted as an
  ADR-0013 §5.1 layout extension; the `PlanningView` auto-recommend call is removed as
  part of P1 (the mini-app stays frozen otherwise).
- **Memory model decisions by the owner, 2026-09-17** (to be folded into ADR-0013 at P4/P6
  planning; the ADR text is not yet amended):
  - One chat across the app; phases differ only by prompt, tool set (phase tools + shared
    tools) and context loaders. No per-phase message layouts survive P4.
  - Episode summaries are produced at compaction (phase transition, inactivity gap, budget
    overflow); summaries are independent per episode, not rolling; facts (weights, reps,
    session state) never come from a summary, only from domain tables.
  - **Long-term user facts are extracted only at summarisation**, from the summariser's
    structured output, via an idempotent upsert with a confirmation counter. Until an
    episode is compacted the fact lives in the `messages` channel and needs no table.
    Consequence: the P6 `remember_fact` tool (ADR-0013 D-14) is dropped; `user_facts` stays.
  - Phase transition is a typed in-process event raised by `commit` (compaction, session
    activation/close, run log consume it); a per-user run mutex (D-12) guards double-sends.
  - Trivially short episodes are trimmed without a summary (threshold to be set in P4). *(Superseded 2026-09-20 by the ADR-0013 §3.3 amendment, BUG-018: a too-short part is kept, never dropped; the budget cut is always summarised.)*
- ADR-0002 divergence **resolved 2026-09-13** by owner call: ADR-0002's Decision section
  is historical context; the live interface-layout rule is `ARCHITECTURE.md`
  § Interface Organization Principles. Both files now say so.

## Notes

- Owner rule: refactor phase execution uses Superpowers plans
  (`docs/superpowers/plans/`) with `Status:` header lines tracked here.
- Task identity = plan slug; hard dependencies via `- After: <slug>` header lines;
  dispatch rules and lifecycle: `SUPERPOWERS_INTEGRATION.md` § Task lifecycle & sequencing.
- Statuses live only in plan headers and this file — durable specs
  (`LLM_CORE_REFACTOR_PLAN.md` etc.) stay forward-looking and never carry progress markers.
