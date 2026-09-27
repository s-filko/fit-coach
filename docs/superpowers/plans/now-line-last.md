# NOW Line Last — Move the Current-Time Line out of Block 1 for Prompt Caching Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans and
> test-driven-development. Red tests first, then the fix.

- Status: planned
- Branch: plan/now-line-last
- After: cache-accounting

**Goal:** the `NOW` line (`CURRENT_TIME_V1`, BUG-032) is the last section of block 1 — the static
phase prompt — and changes every minute, so nothing after it (facts, directive, summaries, domain
blocks, the whole episode history, ≈ 15k of ≈ 19k input tokens per run) is ever served from the
provider's prompt cache. Owner 2026-09-27: "давай NOW перенесем вниз чтоб хоть немного это
работало". Spec: `docs/superpowers/specs/2026-09-26-training-history-context-design.md` § 4
(target order ends with "current session, `NOW`, anything relative to today"). This plan moves
only `NOW`; relative dates in summaries/blocks and the rest of the target order are out of scope.

## Verified facts (2026-09-27)

- `prompts/directives/current-time.v1.ts` renders `NOW (user's local time): <weekday> <date> <time> (<tz>)`
  (or the unknown-timezone variant) from `ctx.now`/`ctx.timezone`; section id `directive.current-time`.
- It reaches block 1 only through `DEFAULT_DIRECTIVES_V2` / `DIRECTIVES_WITHOUT_IDENTITY_V2`
  (`prompts/directives/index.ts:62-70`), used by the live phases registration v2, chat v3,
  session_planning v3, plan_creation v3, training v4–v7.
- `context/assemble-context.ts:166-177` builds: block 1 → facts → directive → summaries → domain →
  history → gap note (`input.gapNote`, AC-CC-2, placed right before `current`) → `current`
  (`[HumanMessage, ...inFlight]`). A mid-conversation SystemMessage already works on the Z.AI
  route (the gap note).
- `cache-attribution.ts` labels system messages by index/header; a NOW message after history would
  fall back to `system[i]`.

## Decisions (D)

- **D1 — placement.** `NOW` becomes its own SystemMessage immediately before `current`'s
  HumanMessage, after the gap note when there is one: `… history → [gap note] → NOW → current`.
  Within a run's tool loop the prefix up to and including `NOW` stays identical (inFlight appends
  after the human message) → `warm`; across runs the prefix is shared up to the previous run's
  position of `NOW`, i.e. everything before the latest turn.
- **D2 — one renderer.** The line keeps its exact text and is still rendered by `CURRENT_TIME_V1`
  (no second formatter); the assembler (or `agent.node.ts`, whichever already owns `gapNote` — follow
  the gap-note wiring) renders it from the same `now`/`timezone` it already receives. It is not
  budgeted (fixed ~20 tokens, counted in `budgetReport.messages`, same as the gap note) and
  survives the D-D floor (it rides with `current`).
- **D3 — directive lists.** Drop `CURRENT_TIME_V1` from `DEFAULT_DIRECTIVES_V2` and
  `DIRECTIVES_WITHOUT_IDENTITY_V2` in place, following the BUG-036 precedent (V2 changed in place,
  no phase-file change) — `llm_calls.request` stores the exact request, so reproducibility does not
  rest on the version label. **If** a frozen snapshot/baseline (AC-1321, `evals/baselines/v0`)
  depends on V2 rendering `NOW`, stop and `ask` instead: then a V3 list + phase version bumps is the
  alternative. Non-frozen snapshots (`evals/snapshots/__tests__/__snapshots__/*`) are updated
  deliberately.
- **D4 — attribution label.** `cache-attribution.ts` labels the NOW message `system:now` (via an
  exported prefix constant from `current-time.v1.ts`, like the other headers), wherever it sits.
- **D5 — prompts.** No phase prompt text refers to the NOW line's position (grep confirmed only
  code comments); comments that say "last of the directives" / "last system section" are updated.
- **D6 — executor:** one GLM worker (localized change).

## Acceptance criteria

| AC | Criterion | Verification |
|---|---|---|
| AC-NL-1 | Every live phase's assembled messages: block 1 no longer contains `NOW (`; exactly one SystemMessage starting with `NOW (` sits directly before the current HumanMessage (after the gap note when present), also at the D-D floor | unit (assemble-context / agent node) + updated message-assembly snapshot |
| AC-NL-2 | Two assemblies for the same user one minute apart with identical history: block 1..domain + history are byte-identical; only the NOW message differs | unit |
| AC-NL-3 | `attributeCache`: a changed NOW message → `prefix_changed:system:now`; a tool-loop second call (inFlight appended) → `warm` | unit + one recorder integration case |
| AC-NL-4 | The rendered NOW text is unchanged (both timezone variants) | existing `current-time.v1.unit.test.ts` |

## Task 1 — Move NOW, label it, update snapshots (AC-NL-1..4)

Files: `prompts/directives/index.ts`, `prompts/directives/current-time.v1.ts` (export the prefix
constant), `context/assemble-context.ts` and/or `graph/nodes/agent.node.ts` (next to `gapNote`),
`cache-attribution.ts` (label), their tests, `evals/snapshots/__tests__/__snapshots__/*` (deliberate
update), comments in phase files that describe the old placement.

Verification (from `apps/server/`): `npm run check-all`; `npm run test:unit`;
`/Users/filko/orca/workspaces/fit_coach/db-test-lock.sh npm run test:integration`;
`/Users/filko/orca/workspaces/fit_coach/db-test-lock.sh npm run test:scenarios`;
repo root `node scripts/state.mjs --check`.

## Live check (dev, after deploy, zero extra LLM calls)

On the owner's next real messages: `llm_calls.cache_expected` for agent calls shows
`prefix_changed:history[…]` / `system:now` / `warm` instead of `prefix_changed:system:prompt`, and
`cache_read_tokens / input_tokens` rises from the pre-change baseline (query in `docs/DB_SETUP.md`).

## Not in scope

- Relative dates ("3 days ago") in summaries and domain blocks — a daily prefix break.
- Reordering the other blocks (spec § 4 target order), the history block.
- Course-check / compaction / summariser prompts.

## Review

2026-09-27, one combined reviewer (R1–R4). Verdict: **blocked**.

**Blocking**
- R1 | `prompts/index.ts:39-44` with `directives/index.ts:71` | ADR-0013 D-09 / BR-LLM-008 — the NOW
  line is still sent on every call, but it left the phase's `directives`, so `promptVersionsOf` no
  longer stamps `directive.current-time: v1`; `conversation_runs.prompt_versions` silently loses the
  key (the gap note `TIME_GAP_V1` is likewise unstamped — precedent, not a justification). — *fixed in
  ee6052a9*: `block.current_time` stamped on every run (key renamed from `directive.current-time` — the
  module moved to `blocks/`), `block.time_gap` on runs that sent the note.
- R3 | plan Task 1 Verification | SUPERPOWERS_INTEGRATION rule 2 — no recorded integration/scenario
  run for the branch. — *closed*: orchestrator re-ran at f09fab8e — `test:integration` 47 suites /
  633 passed + 1 todo, `test:scenarios` 19 / 392 passed + 1 todo.
- R4 | `docs/DB_SETUP.md:215-217` | rule 7 — the `prefix_changed:<label>` list lacks `system:now`. — *fixed in ee6052a9*.
- R4 | `docs/adr/0013-llm-core-target-architecture.md:190-196` (§3.4 "Output order is fixed") | rules
  1, 7 — the fixed order has no NOW message and still puts it in block 1's directives;
  `docs/ARCHITECTURE.md:128` carries the same stale order (already lacking facts and the gap note).
  Durable spec — escalated to the owner; owner approved (2026-09-27) — *fixed*: ADR-0013 §3.4
  amendment 2026-09-27, `ARCHITECTURE.md` order line, spec § 4 finding dated.

**Advisory**
- R1 | `directives/current-time.v1.ts:22` — no longer a directive; a standalone message like the gap
  note (which lives in `blocks/`).
- R2 | `agent.node.ts:154-160` vs `:162-169` — the render-context literal is built twice.
- R2 | `current-time.v1.ts:20` vs `:28-29` — `CURRENT_TIME_PREFIX` is not used by the templates; only a
  test keeps them in sync.
- R3 | `agent.node.unit.test.ts:382-400` — AC-NL-2 test has no history/domain block, so "history
  byte-identical" is not exercised.
- R3 | `agent.node.unit.test.ts:372-380` — timezone test is vacuous (passes from block 1's timezone
  directive; one variant only).
- R4 | stale "appends CURRENT_TIME_V1" comments: `phases/registration/v2.ts:39`, `phases/chat/v3.ts:7`,
  `phases/training/v4.ts:7`, `plan_creation/index.ts:16`, `session_planning/index.ts:17` (D5 promised).
- R4 | `docs/BUGS.md:1693-1694` — BUG-032 fix text "Rendered as the LAST system section".
- R4 | spec § 4 `2026-09-26-training-history-context-design.md:72` — the "(today)" finding is outdated for NOW.

**Advisory disposition:** all fixed in ee6052a9 (module moved to `blocks/`, one render context,
`CURRENT_TIME_PREFIX` used by the templates, AC-NL-2 test with history + domain block, non-vacuous
timezone test, comments, BUG-032 dated note); spec § 4 finding dated by the orchestrator.

**Meta** — filed in `docs/REVIEW_FINDINGS.md`: rule candidate (every model-facing module reaching the
request is stamped in `promptVersions`); blind spot (no zone diffs recorded run metadata before/after
a prompt-structure move).
