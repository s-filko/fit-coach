# Project State

Single orientation point for any working session: what is in progress, what is next,
what is in scope. Read this file first; update it on every status change (event-driven,
not end-of-session). Conventions are defined in `docs/SUPERPOWERS_INTEGRATION.md` § Status layer.

The block between the AUTO markers below is generated from
`docs/superpowers/plans/` + git facts by `node scripts/state.mjs --write` — never hand-edit it.
Everything below the block is hand-written: only facts no generator can derive.

<!-- AUTO:status BEGIN — regen: node scripts/state.mjs --write -->
_Generated 2026-09-19 from docs/superpowers/plans/ + git. Never hand-edit; regen with `node scripts/state.mjs --write`._

**In progress**
- `refactor-p6-facts-and-progress-blocks.md` — Refactor P6 — User Facts (Group 1) Implementation Plan (branch: `plan/refactor-p6-facts-and-progress-blocks`, last commit 2026-09-19)

**Planned**
- `refactor-p4-evals-verify.md` — Refactor P4 — Evals Verify (mini-freeze + compare) Micro-Task
- `refactor-p6-progress-and-drafts.md` — Refactor P6 — Muscle-Centric Progress Blocks and Structured Drafts Implementation Plan

**Done**
- `2026-09-14-lint-glob-fix.md` — Lint Glob Fix Implementation Plan
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
- `review-self-improvement.md` — Review Self-Improvement Implementation Plan

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
4. **Next to dispatch: `refactor-p6-facts-and-progress-blocks`** — its `After:`
   (`refactor-p4-context-budget`) is `done`, so it is unblocked. Then P7 per the master plan
   phase map.
3. **`ports-layout-consistency`** — one rule for port file layout in `ARCHITECTURE.md`,
   the code aligned to it, ESLint keeping it that way. Independent of the P0 chain;
   can run alongside it.
4. **HB-02** (production Docker image) — its own plan, sequenced after HB-01;
   note it must keep `scripts/stamp-baseline.ts` runnable (see the HB-02 note
   in that script's plan).

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
  - Trivially short episodes are trimmed without a summary (threshold to be set in P4).
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
