# Project State

Single orientation point for any working session: what is in progress, what is next,
what is in scope. Read this file first; update it on every status change (event-driven,
not end-of-session). Conventions are defined in `docs/SUPERPOWERS_INTEGRATION.md` § Status layer.

The block between the AUTO markers below is generated from
`docs/superpowers/plans/` + git facts by `node scripts/state.mjs --write` — never hand-edit it.
Everything below the block is hand-written: only facts no generator can derive.

<!-- AUTO:status BEGIN — regen: node scripts/state.mjs --write -->
_Generated 2026-10-01 from docs/superpowers/plans/ + git. Never hand-edit; regen with `node scripts/state.mjs --write`._

**In progress**
— none —

**Planned**
- `cold-start.md` — Cold Start — a load for a user with no history (U11) Implementation Plan
- `refactor-p4-evals-verify.md` — Refactor P4 — Evals Verify (mini-freeze + compare) Micro-Task
- `refactor-p6-progress-and-drafts.md` — Refactor P6 — Muscle-Centric Progress Blocks and Structured Drafts Implementation Plan

**Done**
- `2026-09-14-lint-glob-fix.md` — Lint Glob Fix Implementation Plan
- `cache-accounting.md` — Cache Accounting — Cached/Reasoning Tokens per Call and Cache-Miss Attribution Implementation Plan
- `chat-continuity.md` — Chat Continuity — Compaction Keeps the Recent Conversation, the Reply Answers the Latest Message Implementation Plan
- `coach-baseline.md` — Coach Baseline (Roadmap U1) Implementation Plan
- `course-check-and-constraints.md` — Course Check and Constraint Handling Implementation Plan
- `fact-lifecycle.md` — Fact Lifecycle — Storage, Conversational Tools, Summariser Operations Implementation Plan
- `fact-provenance.md` — Fact Provenance — the Summariser Stores Only What the User Said (BUG-040) Implementation Plan
- `fact-verification.md` — Fact Verification — a Model Checks Each Compaction Fact Against the User's Words (BUG-040 follow-up) Implementation Plan
- `llm-io-audit-trail-closeout.md` — LLM I/O Audit Trail — Close-out Remediation Implementation Plan
- `llm-io-audit-trail.md` — LLM I/O Audit Trail — Nothing the User Wrote, the Model Answered, or the API Received Is Lost Implementation Plan
- `load-facts.md` — Load Facts — Per-Exercise Load Metrics as a Facts-Only `LOAD PLAN` Block and `get_load_plan` (Roadmap U9a) Implementation Plan
- `load-plan-fixes.md` — Load Plan Fixes — zero-kg ladder, isometric holds, no-record with a reference (U9b follow-up) Implementation Plan
- `load-plan.md` — Load Plan — Decision Order, Progression Schemes, Recommendation Log, Breaks (Roadmap U9b) Implementation Plan
- `mandatory-plan-review.md` — Mandatory Plan Review Implementation Plan
- `migration-discipline.md` — Migration Discipline (HB-01) Implementation Plan
- `now-line-last.md` — NOW Line Last — Move the Current-Time Line out of Block 1 for Prompt Caching Implementation Plan
- `ports-layout-consistency.md` — Ports Layout Consistency Implementation Plan
- `prompt-caching.md` — Prompt Caching (BUG-051) — Stable Prefix, Two Breakpoints, No Mid-Workout Rewrites Implementation Plan
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
- `reply-latency-and-typing.md` — Reply Latency and Live Typing (BUG-019) Implementation Plan
- `retro-timestamps.md` — Retro Timestamps (BUG-043) — Investigation, Red Tests, Fix Implementation Plan
- `review-regression-proof.md` — Review Findings — Reproduction Before Remediation Implementation Plan
- `review-self-improvement.md` — Review Self-Improvement Implementation Plan
- `session-2026-09-21-repro.md` — Live-Session Findings (BUG-022…BUG-030) — Reproduction Before Remediation Implementation Plan
- `session-investigation-0925.md` — Live Session 2026-09-25 — Investigation and Red Tests Before Remediation Implementation Plan
- `set-kind.md` — Set Kind — Warm-up vs Working Sets, Dumbbell Load Basis, Session Place, Skipped Plan Items (Roadmap U4) Implementation Plan
- `smoke-test.md` — Smoke Test Implementation Plan
- `structured-output-fenced-json.md` — Structured Output — Fenced-JSON Recovery and the User-Facts Scenario Test Implementation Plan
- `structured-output-json-object-mode.md` — Structured Output — Provider Mode `json_object` for the Z.AI Route Implementation Plan
- `training-exercise-history.md` — Training Exercise History (BUG-030, Roadmap R1.3a) Implementation Plan
- `training-history-lookup.md` — Training History Lookup and Plan Name Check Implementation Plan
- `training-journey-scenarios.md` — Training Journey Scenarios — Deterministic over the Real Test DB + Live L3 Implementation Plan
- `transition-handoff.md` — Transition Hand-off (Roadmap U5) Implementation Plan
- `voice-transcription.md` — Voice Transcription — Telegram Voice Messages Answered as Text Implementation Plan

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

**Coach roadmap (owner brainstorm 2026-09-23/24) — accepted by the owner 2026-09-24; next: plan U1 `coach-baseline`.** Entry point:
`docs/superpowers/specs/2026-09-24-coach-roadmap.md` § 0 "Start here" — self-contained, for a fresh
session. It orders two design specs (session-planning redesign, load advisor) into small steps, each
red-first and live-checked on dev, grouped into units U1–U14; first unit `coach-baseline`. It absorbs
item 3 below for BUG-030 and BUG-022 (roadmap R1.3a and R2.1); BUG-023/024/025/027 stay as listed.

**Dispatch first — the 2026-09-21 live-session review (owner, 2026-09-21).** A real training session
on dev (`fa293e20`, model `google/gemini-3.8-flash`) produced nine bugs, **BUG-022…BUG-030**, with
evidence in `BUGS.md`. Order of work set by the owner:

1. **`session-2026-09-21-repro` — DONE (merged and pushed 2026-09-22); its six red tests are listed in § Handoff.** Reproduction before remediation. No fix
   starts until a test catches the defect on unchanged production. Coverage was checked before the
   plan was written — `durationSeconds` is untested, and `tool-policy.unit.test.ts:67-76` currently
   *pins* the ordering defect behind BUG-027. The plan also states which findings (BUG-022/024/026/028)
   no deterministic test can catch; those become eval-case drafts, with no model run.
2. **`llm-io-audit-trail` — DONE (merged, deployed to dev 2026-09-22; only the live `--payloads` check remains, see § Handoff).** Observability: the user's message, the model's answer and the exact API
   request must survive every run. Four runs on 2026-09-21 left no trace of what the user wrote, and
   BUG-022 was first written up wrong because the DB transcript and the context the model saw disagree.
3. Prompt defects in **small strokes, one BUG per change**, each verified against an eval set rather
   than by impression (`BACKLOG.md` § Ideas — eval cases from real sessions). Heaviest first:
   BUG-030 (the "previous session" is picked by exact `session_key` and dated nowhere — a seven-month-old
   workout was quoted as last time), BUG-022 (session planning confirms sets it cannot log),
   BUG-024, BUG-023.
4. Code defects independent of the model: BUG-027 (deletion runs unconfirmed because tool priorities
   put `log_set` before `delete_last_sets`), BUG-025, BUG-029 (folded into the audit-trail plan).

**Model choice is deliberately open.** Dev moved to `google/gemini-3.8-flash` via OpenRouter; the
owner's rule is that a cheaper model *reveals* defects rather than creating them, so none of the above
waits for that decision. `.env.dev` now runs `LLM_REASONING_EFFORT=low` (2026-09-21): `off` never
disabled reasoning, it only omitted the parameter — see `CLAUDE.md` § LLM for the probe numbers.

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

## Handoff (load-plan-fixes done, 2026-10-01) — merged into dev, pushed; owner's workout is the live check

`docs/superpowers/plans/load-plan-fixes.md` is `Status: done`, review clean (Opus zones, runs 1–6). Scope grew with the
owner in-session: items 1–3 (0 kg ladder, isometric holds, numbers on no-record rows) and the extension 4–11 —
working weight from the newest session + indirect estimate, literature-based growth (NSCA 2-for-2, one-session growth,
APRE / RIR-based RPE), reps in reserve + plain-language effort question, `next step:` on every row, volume line, step
from history, an independent Opus golden table (60/60) and generated invariants. Durable: BR-TRAINING-036 amended,
BR-TRAINING-040..045 new (all owner-approved 2026-10-01). Local GLM replay after the merge (`glm-5.3-flash`, test DB,
flags on): upper 52 calls / lower 50 calls, 0 errors; no 0 kg; planks isometric; effort question asked in plain words;
Reverse Pec Deck after 169 d → 28 / 23 (restart ≥ rebuild). Model-revealed leftovers in BACKLOG (duplicate sets on
clarifications, RPE-vs-reps correction).
**Owed:** dev deploy verification (health, zero-LLM `print-load-plan` over the owner's history, no model calls);
owner-gated dev data correction for old plank sets (plan (D) O-1); next plan `cold-start` (U11, stub in place);
cleanup of the `load-plan-fixes` worktree/branch and the old U9b ones (list below).

## Handoff (load-plan-fixes, 2026-10-01) — next orchestrator: fix three replay defects before the owner's workout

**Owner order 2026-10-01 («да в новой сессии»):** execute `docs/superpowers/plans/load-plan-fixes.md` (items 1–3:
0 kg on the return ladder + wrong working weight; isometric holds via `log_set`; a number on no-record rows that have
a reference) in a fresh plan worktree, one Sonnet worker, red tests from the replay data, one combined review, merge,
dev deploy (no model calls on dev), then re-run the two-workout replay locally on GLM (runner and data in
`data/replay-2026-10-01/`, gitignored). Also route the plan's out-of-scope list (one BUGS entry, BACKLOG lines).
The owner is present (not an autonomy order), but approval prompts are still to be avoided: text mentioning
deletion commands goes through Write/Edit only (the owner-gate hook greps the whole Bash command).
The previous orchestrator's leftover cleanup (U9b worktrees/branches) is still listed below for the owner.

## Handoff (U9b load-plan, 2026-10-01) — merged, deployed to dev, flags on; owner review + live workout pending

**Done under the owner's autonomy order (2026-10-01):** U9b `load-plan` (`docs/superpowers/plans/load-plan.md`,
`Status: done`, review clean after run 2) merged into `dev` (`241d2a1f` + Fix-CI `bce87394`) and deployed (run
36775788188 green; the first deploy run 36774724735 failed in CI — a unit test connected to Postgres, fixed, see plan).
**Dev verified without model calls:** health 200; migration 0023 applied (`load_recommendations` exists, 0 rows);
`.env.dev` backed up to `.env.dev.bak.20260930_205818`, then `LOAD_PLAN_SUGGESTION` / `LOAD_PLAN_BREAKS` /
`LOAD_PLAN_PLANNER_REBIND=true`, server recreated (`printenv` shows all three); zero-LLM report over the owner's
history: 21 exercises — Stage C scheme 5, Stage A insufficient data 7, gap/return ladder 4, below range 1 (rest
non-strength); `llm_calls` 254→254, `user_facts` 20→20. No OpenRouter credits spent; no model-backed run at all.

**For the owner to review** — every decision is a `(D)` bullet in the plan § Execution decisions:
- A1–A6 (executors, parallel t1/t3, nullable decision columns, `advised` on `log_set`, flags default off, Task 5
  split); A7 (review routing under autonomy); **A8 — review N1 demoted:** scheme/decision `reason` prose stays in
  the domain per design §4.1 (backlog item filed); T1–T5b, T3-1..5, Fix-* worker choices (notably T1(c) confirmation
  read from `e1rmTrend.flatRun`; T4(c) `break` expiry approximated by the 14-day `short` cap; T4(d) the "asked"
  marker is a `break reason=unknown` fact; Fix-9 break windows strictly between workouts; Fix-S the more
  conservative Stage A row wins).
- **Durable edits made under autonomy, flagged:** ADR-0009 amendment 2026-10-01 (approved text, verbatim); design
  Principle 6 (approved text) + §7/§3.4 follow-ups; **not pre-approved, factual:** ADR-0013 time-gap note sentence,
  `docs/domain/training.spec.md` BR-TRAINING-036..039, `CONTRIBUTING_AI.md` categories/flags lines.
- **Findings:** (1) zero-LLM report: a machine exercise on the restart ladder prints `conservative: 0 kg` (5 kg
  minus a 5 kg step) — backlog; under O1 the coach may override. (2) One unidentified integration-test failure in
  one local run, not reproduced in three reruns. (3) GLM worker blocked by a Claude Code notice modal and by a
  transient DNS failure for `api.z.ai` — both now in `docs/ORCHESTRATION.md` § Failure handling.
- **Live check (owner's next workout, dev, all flags on):** «какой вес на жим?» → candidate + conservative with
  reasons; `load_recommendations` gets a row after the first working set; a new session plan shows sets × reps only;
  «хочу прогрессию по повторам» → after compaction the block says "chosen by user <date>". Any part can be switched
  off in `.env.dev` + `docker compose … up -d server` (no redeploy). BUG-051 AC-PC-8 still closes on the same workout.

**Ready-to-run cleanup (owner-gated deletions; plan merged, pushed, worktrees clean):**
```bash
orca worktree rm --worktree id:88b171fc-bda9-4c6c-b6f3-82b7fb04ae88::/Users/filko/orca/workspaces/fit_coach/load-plan-t3
orca worktree rm --worktree id:88b171fc-bda9-4c6c-b6f3-82b7fb04ae88::/Users/filko/orca/workspaces/fit_coach/load-plan-t1
git branch -D task/load-plan-t3 plan/load-plan
git push origin --delete plan/load-plan
```
Orca run `run_b7745615cfb5`: all workers released (none reclaimable).

## Handoff (prompt-caching, 2026-09-30) — BUG-051 merged and deployed to dev; owner's workout is the check

Plan `prompt-caching` is `done` (review clean on run 3; runs 1–2 blocked on 13 + 4, all closed), merged `826f3375`,
deployed by Deploy Dev. `.env.dev`: `LLM_PROMPT_CACHE=anthropic`, `LLM_PROMPT_CACHE_TTL=5m`,
`LLM_CACHE_TTL_SECONDS=300` (backup `.env.dev.bak.20260930_134302`). Owner-approved ADR-0013 amendments 2026-09-30
(§3.3, §3.4, INV-LLM-004, §4.2, §8). Dev smoke on throwaway user `smoke_prompt_cache` (`19594085…`): calls 2–3 read
~95 % of input from cache; it exposed a false `unplanned:history[i]:assistant` (breakpoint parts vs plain string in
attribution) — post-merge fix dispatched on the same branch.
**Next (owner):** one normal workout on dev; then `npm run cache-report -- 60af022f-… <from> <to>` vs $3.63, every
`unplanned:*` explained, `LLM_CONTEXT_HARD_CAP_TOKENS` recalibrated (AC-PC-8). Advisories:
`BACKLOG.md` § prompt-caching close-out review advisories. After that: U9b `load-plan` gates (below).

## Handoff (load-facts, 2026-09-29) — U9a merged and deployed to dev; owner's number check pending

Plan `load-facts` (roadmap U9a) is `done`: review run 1 blocked on 2 (R3: verification evidence not
recorded; AC ids missing in test names), both fixed on the branch, R3 re-run clean; merged into
`dev` (`9dc8a4a9`), deployed by the Deploy Dev Action (run `36520135377`): no migration (journal 21
rows), containers healthy, health 200. What ships: a facts-only `=== LOAD PLAN ===` block in training
(block 3, after RECENT WORKOUTS) — per today's exercise the like-for-like reference (dated, fatigue
context), today's pre-fatigue, working weight (8 wk, K = 5), e1RM trend (Epley, ≤ 10 reps, ±2.5 %),
last-exposure quality, gaps in days, constraints, equipment step; **no weight is recommended by
code**. Tool `get_load_plan` (same producer) for off-plan exercises; prompt training **v9** (rule 1,
TOOLS, RULE 11); `scripts/print-load-plan.ts` (zero-LLM report).

**Zero-LLM check over the dev DB:** 20 exercises of the owner (`60af022f`), `llm_calls` 183 → 183.
The owner's numbers are tabled in the plan § "Zero-LLM check on dev" (e.g. 45° Leg Press working
weight 135 kg, Bench 60 kg with e1RM 80.0 rising +14.3 %, Lat Pulldown 50 kg, Cable Pushdown 32 kg).
Journal fill: `target_reps` 70/147 rows (no range → working weight "no rep range" for the rest),
RPE 211/446 sets, `set_kind` 0/446.

**For the owner to review:**
- **Decisions D1–D22 in the plan.** Pre-decided (yours): D1 gap in days, no tier; D2 LOAD PLAN and
  EXERCISE HISTORY coexist, the LOAD PLAN reference line prints "sets as in EXERCISE HISTORY"
  when it is the same row. Orchestrator: D3 one producer shared by block/tool/script; D4 pure
  domain metrics; **D5 block placed in block 3, not after NOW** (deviation from design §3.4 —
  WORKOUT OVERVIEW already breaks block-3 caching during training; the tail slot is for U9b);
  D6 like-for-like reference (place case-folded, reps within range ± 2); D7 legacy NULL sets
  < 60 % of the top load = estimated warm-ups; D8 rep range from today's plan, else the
  reference's `target_reps`; D9 exact metric definitions; D10 class applicability; D11 loader
  (60 recent workouts + all-time count, no migration); D12 tool; D13 prompt v9; D14 report
  script; D15 executors (Sonnet T1/T3, GLM T2); D16 no durable-spec edit; D17/D20 red commits
  impossible under the pre-commit hook (accepted); D18 Task 1 interface choices; D19 GLM
  billing-notice stall dismissed; **D21 additive lines in `ARCHITECTURE.md` file map and
  `MANUAL_TEST_PLAN.md` tool list** (durable doc, factual only); D22 `chat-concurrency`
  integration test flaked once (passed 2/2 alone) — backlog.
- **R4.0 sourced threshold table** (plan § "R4.0 — sourced thresholds") — your one review before
  U9b turns it into parameters; items marked *verify* need the paper checked.
- **Numbers to verify against your memory** (live check 4): the plan's zero-LLM table, especially
  the e1RM trends computed over all history (Chest-Supported Row Wide "falling −42.9 %", Lateral
  Raise "falling −50 %") next to 8-week working weights.
- **Live check on dev** (≤ 4 messages, expected replies in the plan § Live check).
- Advisories: `BACKLOG.md` § "load-facts close-out review advisories (2026-09-29)" (the repeated
  equipment fact on every entry is the one with prompt-size effect); meta in `REVIEW_FINDINGS.md`.

**Cleanup done 2026-09-30 (owner present):** worker terminal closed, worktrees `load-facts-t1` / `-t2`
removed, branches `plan/load-facts` (local + remote) and `task/load-facts-t2` deleted. The set-kind
cleanup listed below is still pending (its orchestrator session is the owner's).

**Next: U9b `load-plan` — plan written, not dispatched** (`docs/superpowers/plans/load-plan.md`,
`Status: planned`). Before dispatch it needs four owner gates, listed in the plan § "Before
dispatch": the R4.0 threshold review, the ADR-0009 amendment (`progression_scheme`, `break`), the
`load_recommendations` table shape, and the proposed three-merge split (9b-1 schemes + decision
order + log; 9b-2 breaks; 9b-3 planner/prompt rebinding).

## Handoff (U9a order, 2026-09-29) — next orchestrator runs U9a load-facts autonomously to the dev deploy

Owner order 2026-09-29 (autonomy, relay to a fresh orchestrator; the set-kind orchestrator stays
open for the owner's live check and possible rework — it does not touch U9a). **Scope:** write plan
`docs/superpowers/plans/load-facts.md` from design `2026-09-28-load-recommendation-architecture-design.md`
§3.1–3.4 and §9 (U9a): R4.0 sources, the §3.2 metrics, a facts-only `LOAD PLAN` block (no weight
recommendation), `get_load_plan`, `formatSetData` reuse; dispatch via `delegate-implementation`
(Sonnet hard / GLM simple, numbered task worktrees, DB tests via `db-test-lock.sh`); review each task;
`close-out-review`; `Status: done`; merge into `dev`; push; dev deploy (the push triggers the Deploy
Dev Action); verify the migration if any and health 200; zero-LLM check over the dev DB, printing
the owner's real metric numbers in the handoff; STATE handoff with every (D). Then, if budget
remains, write the U9b plan but do **not** execute it.
**Pre-decided (record as D):** (1) gap is printed in days, **no tier** in U9a — the sourced
threshold table (design §11 item 4) goes into the plan for the owner's one review and enters code
in U9b; (2) `LOAD PLAN` and `EXERCISE HISTORY` coexist in U9a, the duplicated `reference:` line
removed from one of them; replacement decided in U9b.
**Never during the run (approval prompts stall it — owner, twice):** no worktree/branch deletion,
no writes outside the repo (memory included), no prod, no model-backed runs. List cleanup as
ready-to-run commands in the final report. Stop at the U9a dev deploy + report.

## Handoff (set-kind, 2026-09-29) — U4 merged and deployed to dev; owner's live check pending

Plan `set-kind` (roadmap U4) is `done`, review clean on run 2 (run 1 blocked on 6, all fixed on the
branch), merged into `dev` (`e4618d99`), deployed to dev by the Deploy Dev Action (`1048e73e`):
migration `0020` applied (21 journal rows), health 200, containers up. Zero-LLM check over the dev DB:
`set_kind` enum `{warmup,working}`, all 446 legacy sets `NULL`, all 31 sessions `place` NULL — no
backfill, as D2/D6 say. What ships: every set carries a kind and only working sets count toward
targets (`(w/u)` in listings); dumbbell sets are per hand unless the user says total; a workout
records its place (`start_training_session.place`, `set_session_place`, ask line when recent
workouts had ≥ 2 places); finishing reconciles untouched plan items to `skipped` and zero-set
exercises end `skipped` (BUG-042), shown as `skipped <date>` in exercise history. Prompt training v8.

**For the owner to review:**
- Decisions D12–D16 in the plan (orchestrator): D12 merged without your confirmation of the BR
  text; D13 per-hand only for `dumbbell` (catalog has no kettlebell); D14 `pending` zero-set rows
  also end `skipped`; D15 worker incidents; D16 review fixes on the branch.
- **Durable-spec ids to mint:** proposed **BR-TRAINING-027..029** (the plan's 014..016 collide with
  `FEAT-0010`, which uses up to -026) — text in the plan § "Proposed durable-spec text";
  `training.spec.md` untouched.
- **Live check on dev** (≤ 5 messages, expected replies in the plan § Live check).
- Advisories filed: `BACKLOG.md` § "set-kind close-out review advisories (2026-09-29)" (place
  normalisation "дома"/"Дома" is the one with user-visible effect); meta in `REVIEW_FINDINGS.md`.

**Outside the plan — prod (owner order 2026-09-28):** "deploy current dev to prod with the dev DB".
A subagent backed up prod (`/srv/docker/fitcoach/backups/prod_predeploy_20260928_150809.dump`),
merged dev into `main` as `7dfd8269` (main was not an ancestor of dev) and pushed; Deploy Prod run
`36441650964` started; the auto-mode classifier then blocked further prod steps. Remaining: the
owner runs the prepared script (second `deploy.sh prod` + dev DB dump restored into prod + checks) —
its path is in the orchestrator's final report. Prod is therefore no longer "frozen/behind" once
that runs; the `prod-is-frozen` memory needs updating.

**Cleanup pending (deferred to the end of the run, owner 2026-09-29):** worktree `set-kind-t1` +
branch `plan/set-kind` (local and remote); worker tabs of Task 1 (Sonnet) and Task 2 (GLM) were
`retained / user_takeover` on release — close them. `set-kind-t2` was already removed.

## Handoff (fact-verification, 2026-09-28) — model verifier replaces the string check; quote stored

Owner decision 2026-09-28: string checks on model output are unreliable — verify with a model, as
the industry does, only when a fact is found. Plan `fact-verification` is `done`, reviewed clean,
merged into `dev`. When the summariser returns `add`/`update`/`retract`, one more structured call
(`fact-verifier` v1, profile `summarizer`) says per operation whether the **user** stated or
confirmed it (numbers by meaning: «пять дней» = "5 days"); unsupported → skipped, verifier failure →
all skipped (fail closed). The string check of `fact-provenance` is removed. The user's supporting
words are stored in `user_facts.evidence` (migration `0019`) and shown by `list_facts` as
`said: «…»`. Live probe on the dev route 4/4. **For the owner to review:** D1–D21 in the plan; the
extra ≈2.5 s model call on the reply path when a fact operation exists (ADR-0009 amendment
2026-09-27/28); `manage_fact` stores no quote yet (D20, backlog).

## Handoff (load advisor design, 2026-09-28) — Stage 4 pulled ahead, plan `set-kind` written, nothing dispatched

Owner brainstorm 2026-09-28 on the load recommendation ("при переходе к упражнению тренер рекомендует
вес … не от балды"). Outcome: `docs/superpowers/specs/2026-09-28-load-recommendation-architecture-design.md`
(v2.1) — layer 1 in code at request time (facts, decision order, `LOAD PLAN` block + `get_load_plan`
tool), progression schemes as a code registry with the user's choice as a fact, breaks as an event
with a reason and a return ladder, layer 2 as a session-start reasoning call announced to the user.
Reviewed by an independent Opus reviewer the same day; dispositions and full text in
`…-architecture-review.md`. The owner answered the four open questions one at a time (design §11).
Roadmap re-ordered: **U4 → U9a → U9b → U11 → U13 → U6 → U12**, then U3 → U2 → U7 → U8 → U14
(roadmap §4 priority line, §5 gates, §6 status). Plan `docs/superpowers/plans/set-kind.md` (U4,
`Status: planned`): set kind, dumbbell per-hand basis, session place, BUG-042 skipped rows; two
serial tasks, red first. **Next:** owner reads the plan (D1–D11; D11 proposes three BR-TRAINING ids
the owner mints), then dispatch via `delegate-implementation`. Uncommitted at hand-off: the two
2026-09-28 specs, the plan, roadmap and load-advisor spec edits (§15), this STATE block.

## Handoff (fact-provenance, 2026-09-27) — BUG-040 code half fixed, merged into dev (string check superseded 2026-09-28 by `fact-verification`)

Owner autonomy order 2026-09-27 ("бери 40 … без моего вмешательства … консервативно"). Plan
`fact-provenance` is `done`, reviewed clean (one combined reviewer), merged into `dev`. Compaction
fact operations `add`/`update`/`retract` are applied only with a verbatim user `evidence` quote and
only user-stated numbers in the fact text and phase note (`domain/user/services/fact-provenance.ts`,
summariser v5); `confirm` exempt. Red first: 5 + 3 tests failing on unchanged code, then green.
**For the owner to review:** D1–D15 in the plan, incl. the ADR-0009 amendment 2026-09-27 and the
ADR-0013 §3 pointer (rule-meaning change made under the autonomy order), D4's conservative number
rule (a number the user wrote as a word is rejected). BUG-040 stays *Partially fixed*: a non-numeric
coach claim with an unrelated user quote can still pass; warnings relevance and «табло» vocabulary
are open. Five advisories in `BACKLOG.md` § fact-provenance.

## Handoff (training-history-lookup, 2026-09-26) — lookup tool + plan name check, deployed to dev

Continuation of the BUG-030 autonomy order ("продолжай сам до конца"). Plan `training-history-lookup`
is `done`, reviewed clean, merged into `dev` and deployed: training gains the read-only
`get_exercise_history` tool (last ≤ 5 real performances of any exercise, dated) with prompt
`training` v7, and `start_training_session` / `save_workout_plan` reject a plan entry whose name does
not match its id's catalog name (containment rule, D16) and store catalog names otherwise. **For the
owner to review:** D1–D16 in the plan. New backlog finding: no similarity threshold in name →
exercise resolution (D13).

## Handoff (training-exercise-history, 2026-09-26) — BUG-030 fixed, deployed to dev

Owner order 2026-09-26: fix BUG-030 end to end without questions. Plan `training-exercise-history`
(roadmap R1.3a) is `done`, reviewed clean and merged into `dev`. The training phase no longer picks one
"previous session" by exact `session_key`: `training.exercise_history` shows each of today's exercises
(planned or started) with its last real performance and its date, and `training.recent_workouts` shows
the real workouts of the last 7 days with overlaps on today's muscles; prompt `training` v6 makes the
coach state the age of quoted numbers and never deny work it simply cannot see. **For the owner to
review:** decisions D1–D18 in the plan (taken under the autonomy order), incl. D16 — a factual ADR-0013
§10 cell update. Roadmap U3 is now R1.3b only. Not covered: an exercise that is neither in today's
session nor in the last 7 days (would need a history lookup tool).

## Handoff (session-investigation-0925 + transition-handoff, 2026-09-26) — deployed to dev, owner's live check pending

Both plans are `done`, reviewed clean and merged into `dev` (`28db24ba`), deployed by CI: migration `0017`
(`session_sets.rpe numeric(3,1)`) applied, `TRANSITION_HANDOFF_TARGETS=training,session_planning` set in
`.env.dev` (backup `.env.dev.bak.*`) and the server recreated, the owner's profile `language_code = 'ru'` (owner
request 2026-09-25), bot restarted to drop its cached language. The first CI run failed: U5's static
`@infra/db/drizzle` import in `evals/levels/l3.ts` ran `SELECT 1` inside L3 unit tests (no DB in CI) — fixed by a
lazy import (`28db24ba`). **Next:** the owner's live Telegram training session; BUG-022/032/034..038 close on it.
Cleanup done 2026-09-26 on the owner's word ("заканчивай все"): worktrees `session-investigation-0925` and `transition-handoff` removed, the U5 `COST_LEDGER.md` rows (smoke runs 6–7) committed.

## Handoff (orchestrator shift, 2026-09-25 — fifth relay)

No live Orca runs, workers or plan worktrees (all released/removed 2026-09-25). Open owner decisions
1, 2, 3, 5 of the 2026-09-24 triage below are still unasked — ask them one at a time when the unit
they affect comes up, not before U5.


**Roadmap U1 `coach-baseline` is complete (2026-09-25)** — merged, deployed to dev, live check passed via
the smoke test (plan § Review). Review `2026-09-25 | clean`; advisories in `BACKLOG.md`. The repro
glob shows **6** failing suites (BUG-023/025/027/030 + BUG-022 and hidden-load reds). Open for the
owner: `BR-TRAINING-*` for the "real workout" rule (rule candidate in `REVIEW_FINDINGS.md`).

**Plan `smoke-test` is `done` and merged into `dev` (2026-09-25).** `npm run smoke` (from `apps/server`;
run it through `/Users/filko/orca/workspaces/fit_coach/db-test-lock.sh` when worktrees test in parallel)
plays one workout on the live model over the local `fitcoach_test` and writes a per-step transcript to
`evals/reports/`. The smoke is deliberately mutable (spec D3): a new bug is added to it, pinned by a
permanent red test, fixed, and confirmed by the next run; the orchestrator reads the replies (no judge).
Local `apps/server/.env` gained `LLM_STRUCTURED_OUTPUT_MODE=json_object` (Z.AI route). Three runs
recorded in `COST_LEDGER.md`; run 1 reproduced BUG-022 live.
**Roadmap U5 `transition-handoff`** (fixes BUG-022): gate **passed 2026-09-25** — loop accepted by
the owner with four foreseen problems folded into the plan; R2.0 probe go on both providers (2 calls,
`COST_LEDGER.md`). Plan written (`Status: planned`). **Next:** dispatch it (`delegate-implementation`).

**Backlog triage done with the owner 2026-09-24** (recommendations; only roadmap acceptance is
decided). Open owner decisions, to be asked one at a time, recommendation first:
1. Close `refactor-p6-progress-and-drafts` as superseded — its muscle blocks are U3, its structured
   drafts overlap U7 `propose_session` (recommended: close).
2. Bundle BUG-027 + BUG-025 (code defects, no model) into one small plan outside the roadmap.
3. Fold BUG-023 (isometric holds stored as reps) into U4 `set-kind` and pull U4 forward.
4. ~~Fix the native abort (exit 134) early~~ — **decided 2026-09-24:** Task 1 of `coach-baseline`.
5. Backlog cleanup: drop the "User-fact lifecycle" idea (delivered by `fact-lifecycle` +
   `course-check-and-constraints`) and the "Production Docker image hardening" idea (duplicate of
   HB-02); route close-out advisories — doc drift to P7, code ones to the plan that next touches
   the file.
Sequencing agreed as recommendation: prompt bugs (BUG-024/028/026/013/006) wait until after
roadmap Stage 3 (R3.4 rewrites `session_planning`); consolidated eval pass (AC-1344/1361/1364) and
P7 after U7; HB-02..HB-07 as one hygiene batch (HB-03 timeouts first; all verified still open in
code 2026-09-24; HB-06's `created_at` half is done by BUG-029).

## Handoff (orchestrator shift, 2026-09-22 — third relay)

**`llm-io-audit-trail` and `llm-io-audit-trail-closeout` are both `done` and merged into `dev`**
(merge commit on `dev`; branch and worktree removed, no live workers — cleanup done 2026-09-23).
Review header on both plans:
`2026-09-22 | clean | R1,R2,R3,R4`. All four suites green at merge (unit 126/1203,
integration 33/555, scenarios 9/343); the repro glob stays at 2 suites / 4 failures and must —
those reds are BUG-027 and BUG-030, other plans.

**One verification is still owed on dev** (plan `## Deferred`): the `deploy.sh` log capture is
discharged (`bbba5ffa`), and so is `print-transcript` itself against a real run — only
`--payloads` is unproven, because `llm_calls` on dev was empty until the recorder deployed. One
live dev run, then `print-transcript --run <id> --payloads` against it, closes it.

**What the close-out cost, and why it is worth writing down.** Four review rounds plus three
re-runs: 23 blocking, 16, 15, then 2, then 1. Every round after the first was dominated by
defects the previous round's own fixes had introduced, including two of mine as orchestrator —
a citation swapped onto a rule that governs a different mechanism, and a verification grep
(`docs/ apps/`) narrower than the claim it proved, which left the last plan-scoped id in
`deploy/`. Both were caught by a re-run of the zone that had raised the original finding, not by
the fix's author. The lesson is filed as rules in `docs/REVIEW_FINDINGS.md` (grep from the repo
root; an id covering two mechanisms needs two targets), and the practice that worked is: after a
fix, re-run the zone that found it, with the fix commit named as the highest-risk object.

**Durable ids minted 2026-09-22 with the owner's approval** (ADR-0013 §8): **INV-LLM-009** (the
inbound message and a failed run's cause survive a run that never reaches `commit`) and
**INV-LLM-010** (`run_id` + monotonic `seq` from the one policy in `infra/conversation/seq.ts`;
a writer that cannot number writes `run_id` NULL). They replaced the plan-scoped `AC-AT-*` ids
in ~130 code citations. `AC-AT-*` now appears nowhere outside the two plan files, `BUGS.md` and
`REVIEW_FINDINGS.md` — check it from the repository root, not from `docs/ apps/`.

**Open, not blocking:**
- Pre-P4 law still stands in docs this branch did not touch: the retired "sliding window, 20
  turns" model is stated in `API_SPEC.md:140`, `CONVERSATION_CONTEXT_ARCHITECTURE.md:126`,
  `FEAT-0003`, `FEAT-0006:252` and `FEAT-0009:11`. `docs/domain/conversation.spec.md` says the
  P7 rewrite owns this; nobody has decided whether it waits that long. Not raised to the owner
  as a backlog entry yet.
- Two advisories from round 4, unfixed by the zone contract: `print-transcript.ts:41` is a
  fourth hand-rolled flag parser (widen `BACKLOG.md`'s "Evals tooling duplication trio" entry
  rather than opening a new one). Task 2's flagged owner decision is **made (2026-09-23)**:
  manual compaction is outside the run log, stated in ADR-0013 §8 as the scope of INV-LLM-009;
  no code change.
- Carried from earlier shifts: AC-FL-3's live half — a closed fact not resurrected by compacting
  an OLDER episode — is pinned by a scenario test but never reproduced live; worth one check
  when a plan next touches compaction.

- **Test DB:** `fitcoach_test` (local container `fitcoach-db`). Never run tests in two worktrees
  against it at once; workers never touch a DB by hand.

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
