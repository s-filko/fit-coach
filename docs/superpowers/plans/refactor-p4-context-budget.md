# Refactor P4 — Context Budget and Domain Blocks Implementation Plan

- Status: planned
- Branch: plan/refactor-p4-context-budget
- After: refactor-p4-episode-memory

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The assembler enforces a per-phase token budget in the ADR-0013 §3.4 order — trim history, reduce domain block depth, drop the oldest episode summary — and never touches the phase prompt (INV-LLM-004). Domain data leaves the phase prompt's block 1 and becomes declared, budgeted context blocks (block 3) loaded from `PhaseSpec.contextBlocks`. Checkpoints are pruned by a script (BR-LLM-005). The `budgetReport` gains the budget and what was cut.

**Architecture:** ADR-0013 §3.4 (blocks 1–4, budget table, INV-LLM-004), §4.2 (`contextBlocks`, `budget`), §3.3 (BR-LLM-005 pruning policy), §10 (muscle-centric blocks as D-03 loaders — listed, not built here). Master plan P4 items 3 and 5. Inputs: P2's §3.4 measurement (session_planning ~3.2k, training ~3.6k estimated system tokens, n=1/2 — re-measured in Task 1), P3's `loadContext`, the episode-memory plan's `budget.history` trigger.

**Tech Stack:** TypeScript, `@langchain/core` `trimMessages`, the P2 estimator, Jest, a `tsx` script under `src/infra/db/scripts/`.

**Spec:** ADR-0013 §3.3 (BR-LLM-005), §3.4, §4.2; `docs/LLM_CORE_REFACTOR_PLAN.md` § P4 items 3, 5 and Notes (`trimMessages` with `startOn: 'human'`, tool pairs kept together); `docs/PROMPT_EVAL_FRAMEWORK.md` §4.2 (`budgetReport.history ≤ budget.history`, orphan tool-message check).

**Acceptance criteria:** AC-1343 (a synthetic 60-turn training transcript replayed through the graph never exceeds the training history budget — `budgetReport.history ≤ budget.history` on every run — and never sends an orphan `ToolMessage`), AC-1344 re-run (L1 within ±2 pp of `v2`; L2 not lower by > 0.2), INV-LLM-004 unit-tested (block 1 never dropped or truncated; resolution order).

## Global Constraints

- **No prompt wording change** in the phase modules' rule/tool/identity sections. Moving domain data (profile, plan, recent sessions, session state, previous session, planning context) from block 1 into block 3 changes the *position* of that text, not its wording: each block module's v1 renders the exact text the phase prompt rendered for that data, and the phase prompt v-next drops that section (a version bump per phase, snapshots for both). The L1/L2 gate (AC-1344) is the arbiter.
- **Budget numbers are config defaults from ADR §3.4's table, seeded by Task 1's measurement**; the mechanism is the invariant, not the values. Values live in `PhaseSpec.budget` as data with a documented env override per phase (`LLM_BUDGET_<PHASE>_<PART>`), so tuning is not a code change.
- **Trimming never splits a tool pair and never starts the kept tail on a non-human message** (`trimMessages` with `strategy: 'last'`, `startOn: 'human'`, `includeSystem: false`, `allowPartial: false`; the estimator is the token counter). The "cut in the middle of a tool pair" test from the episode-memory plan is reused against the trimmer.
- **Domain block depth reduction is declared per block** (`depths: [5, 3, 1]` for recent sessions, etc.); the assembler steps depth down before dropping a summary and logs what it cut in `budgetReport.cuts`.
- **Pruning script is run by the owner** (cron note in `deploy/` docs); no scheduler in the app. It never deletes the latest checkpoint per `(thread_id, checkpoint_ns)`.
- **Reserved to the orchestrator:** Task 1, Task 7. Verification from `apps/server/`. No attribution lines.

## Decisions taken by this plan (not settled by the durable specs — owner may overrule)

| # | Decision | Alternative rejected | Why |
|---|---|---|---|
| D-A | `ContextBlock<D> = { id; version; depths?: readonly number[]; load(input, deps) → Promise<D>; render(data, depth) → { id, text } }`; `PhaseSpec.contextBlocks: ContextBlock[]` replaces P3's `loadContext`; blocks load in parallel | Keep `loadContext` and render domain data inside the prompt | ADR §4.2/§3.4: blocks are the unit the budget reasons about; a monolithic prompt cannot be reduced without truncating block 1 (forbidden). |
| D-B | Blocks in this plan (v1 = today's text, moved): `profile` (all phases), `active_plan` (chat, session_planning), `recent_sessions` (chat: depths 5→3→1), `planning_context` (session_planning: the `SessionPlanningContextBuilder` output, depths 5→3 sessions), `session_state` (training), `previous_session` (training). Muscle-centric blocks (§10) are **not** built here | Build `muscleRecovery`/`currentExerciseHistory` now | They are new data, not a move — P6 capability work; the block interface here is what they plug into. |
| D-C | `budgetReport` gains `budget: TokenBudget`, `blocks: Array<{ id, tokens, depth }>`, `cuts: Array<'history' \| \`block:${id}\` \| 'summary'>`; the L1 check `budget-report-present` becomes `budget-within-limits` (`history ≤ budget.history`, `total ≤ sum − outputReserve`) plus `no-orphan-tool-message` | Separate report type | One report per run, one query surface; P2's fields keep their meaning. |
| D-D | Over-budget after all three steps (huge single message) → the assembler keeps block 1 and the current run's messages, drops everything else, logs `error`, and the report says `cuts` ends with `'floor'` | Throw | INV-LLM-004 forbids touching block 1; refusing the reply for a long user message is worse than a context with no history. |
| D-E | Pruning: `db:prune-checkpoints` deletes `checkpoints`/`checkpoint_blobs`/`checkpoint_writes` rows older than `--days` (default 14) except the latest per `(thread_id, checkpoint_ns)`; dry-run by default, `--apply` to delete; prints counts | Delete inside the app after each run | BR-LLM-005 says nightly job, owner-run; a dry-run default makes the first prod run safe. |

---

### Task 1: Re-measure §3.4 on dev with episode memory on (orchestrator)

- [ ] **Step 1:** After `refactor-p4-episode-memory` has run on dev for at least a day: `SELECT phase_in, count(*), percentile_cont(0.5) WITHIN GROUP (ORDER BY (budget_report->>'system')::int) AS p50_system, max((budget_report->>'system')::int), percentile_cont(0.95) WITHIN GROUP (ORDER BY (budget_report->>'history')::int) AS p95_history FROM conversation_runs WHERE budget_report IS NOT NULL GROUP BY 1;` — paste here.
- [ ] **Step 2:** Set the initial `PhaseSpec.budget` values in this plan (table below) — start from ADR §3.4 and adjust `system` to p50 + 30 %, `history` to max(ADR, p95) rounded up to 0.5k. Record the chosen table under **Budget defaults (Task 1)**.

**Verification:** the table exists before Task 3 starts.

---

### Task 2: Context blocks and the phase prompts without domain data

**Files:**
- Create: `apps/server/src/infra/ai/context/blocks/{profile,active-plan,recent-sessions,planning-context,session-state,previous-session}.v1.ts`, `blocks/index.ts`, `blocks/__tests__/*.unit.test.ts` (snapshot per block per fixture: text equals the section the phase prompt v1 rendered for that data)
- Modify: `apps/server/src/infra/ai/prompts/phases/*/v2.ts` (new versions without the moved sections; `requiredSections` updated; `current = v2`), L0 snapshots for v2 (v1 files stay while `v0`–`v2` baselines reference them)
- Modify: `phase-spec.ts` (`contextBlocks`, `budget`; `loadContext` removed), `phases/*.spec.ts`, `nodes/agent.node.ts` (loads blocks in parallel; render ctx keeps `now`, `timezone`, `client`, `user`, `lastMessageTime` → after the episode-memory plan `lastMessageTime` comes from `state.lastUserMessageAt` for every phase — the greeting directive now applies to all phases: one chat; list it as a diff)
- Modify: `assemble-context.ts` — block 3 assembly (`SystemMessage` with the rendered blocks joined by blank lines, in spec order), report `blocks`

- [ ] **Step 1: Tests first** — each block's snapshot vs the v1 prompt section (build the expectation by rendering the v1 phase prompt and slicing the section by its header — the moved text must match character for character); prompt v2 snapshots contain no profile/plan/session data; agent node passes the loaded block data.
- [ ] **Step 2: Implement.** Message-assembly snapshots regenerated once with the enumerated diff: block 3 appears after the summaries block; block 1 shrinks; the greeting directive lines for non-chat phases when `lastUserMessageAt` is set (fixtures: keep `FIXED_NOW` and a `lastUserMessageAt` fixture so the snapshot is stable).
- [ ] **Step 3: Commit** — `feat(ai): domain context blocks (block 3) with declared depths; phase prompts v2 without domain data (ADR-0013 §3.4)`

**Verification:** `npx jest --ci src/infra/ai evals/snapshots`; `npm run evals -- --level L0`.

---

### Task 3: Budget enforcement in the assembler

**Files:**
- Create: `apps/server/src/infra/ai/context/budget.ts` (`TokenBudget { system; longTerm; domain; history; outputReserve }`, `resolveBudget(input) → { messages, report }` — pure), tests
- Modify: `assemble-context.ts` (calls `resolveBudget`; the trimmer via `trimMessages` with the estimator as `tokenCounter`), `phases/*.spec.ts` (`budget` from Task 1's table with env overrides), `domain/conversation/ports/conversation-run.ports.ts` (`BudgetReport` fields per D-C)

Resolution order (INV-LLM-004): (a) trim history to `budget.history`; (b) if `total` still > `sum − outputReserve`, step each block down its `depths` (largest block first) until within; (c) drop episode summaries oldest first; (d) D-D floor. `system` over its budget is **reported**, never cut (log `warn` — a prompt that outgrew its budget is a wording/config finding).

- [ ] **Step 1: Tests first** — INV-LLM-004 order with a synthetic over-budget input (`it` names carry `INV-LLM-004`); tool pair never split; `startOn: 'human'` on the kept tail; no orphan `ToolMessage` in the output for 50 random cut points (property-style loop); block 1 identical in and out; the floor case; report `cuts`.
- [ ] **Step 2: Implement.**
- [ ] **Step 3: Commit** — `feat(ai): per-phase token budget enforced in the assembler — trim history, reduce block depth, drop oldest summary (INV-LLM-004)`

**Verification:** `npx jest --ci src/infra/ai/context`; `grep -n "new Date()\|Date.now()" apps/server/src/infra/ai/context` → empty (pure).

---

### Task 4: AC-1343 replay test and the L1 checks

**Files:**
- Create: `apps/server/evals/fixtures/long-training-transcript.ts` (60 turns: human → `log_set` tool call → tool result → ai, realistic lengths), `evals/levels/__tests__/budget-replay.unit.test.ts`
- Modify: `evals/levels/l1.ts` (`budget-within-limits`, `no-orphan-tool-message` — the latter needs the model input: record it via the P2 recording-model pattern or a callback on `handleChatModelStart`), `run-case.ts` (collect the last model input's message types)

- [ ] **Step 1:** Replay: seed the 60-turn transcript into `messages` with `updateState`, run 10 consecutive mocked-model runs (each appends a set), assert `budgetReport.history ≤ budget.history` and no orphan tool message on every run, and that compaction by budget (BR-LLM-003) fired at least once (`conversation_summaries` stub received a row) — the `it` name carries `AC-1343`.
- [ ] **Step 2: Commit** — `test(evals): AC-1343 long-transcript replay; L1 budget and orphan-tool checks`

**Verification:** `npx jest --ci evals`.

---

### Task 5: Checkpoint pruning script (BR-LLM-005)

**Files:**
- Create: `apps/server/src/infra/db/scripts/prune-checkpoints.ts`, `__tests__/prune-checkpoints.unit.test.ts` (SQL builder pure + one integration run on the test DB), `package.json` script `db:prune-checkpoints`
- Modify: `deploy/README.md` (or the deploy docs file that exists) — cron line `0 4 * * * cd /srv/docker/fitcoach && docker exec fitcoach-prod-server npm run db:prune-checkpoints -- --apply` (owner installs it; not done by the plan)

- [ ] **Step 1:** Tests: dry-run prints counts and deletes nothing; `--apply` deletes only rows older than `--days` and never the latest per `(thread_id, checkpoint_ns)`; `checkpoint_writes` rows of deleted checkpoints go with them.
- [ ] **Step 2: Commit** — `feat(db): prune-checkpoints script with dry-run default (BR-LLM-005)`

**Verification:** `npx jest --ci src/infra/db/scripts`; `npm run db:prune-checkpoints` locally prints a dry-run summary.

---

### Task 6: JSDoc, rails, backlog notes in code

- [ ] `PhaseSpec.budget`/`contextBlocks` JSDoc; `BudgetReport` JSDoc updated (P2's "no budget field" sentence removed); rails cover `context/blocks/**` (bite proof pasted).
- [ ] **Commit** — `docs(ai): budget and context-block JSDoc; rails proof`

---

### Task 7: Evals, dev deploy, pruning dry-run on dev, docs, close-out (orchestrator)

- [ ] **Step 1: AC-1344 re-run** vs `v2` (evidence JSON `…/evidence/refactor-p4-context-budget-l1-compare.json`); L2 per phase. Rollback per the master plan (tune budgets once, then revert as a unit if two phases fail).
- [ ] **Step 2: Deploy to dev**; smoke all phases; `SELECT phase_in, max((budget_report->>'history')::int), (budget_report->'budget'->>'history') FROM conversation_runs WHERE created_at > now() - interval '2 hours' GROUP BY 1, 3;` — history never above budget; `SELECT budget_report->'cuts' … WHERE jsonb_array_length(budget_report->'cuts') > 0` — inspect what was cut. `npm run db:prune-checkpoints` dry-run on dev — paste counts; `--apply` on dev only after the owner sees the counts.
- [ ] **Step 3: Docs reconcile** (factual): `ARCHITECTURE.md`, `CONTRIBUTING_AI.md` (adding a context block; tuning a budget via env), `PROMPT_EVAL_FRAMEWORK.md` §4.2 (the two checks are implemented), `deploy/` cron note, `BACKLOG.md` ticks (`budget-report-present` false positive → replaced). ADR-0013 amendments to **escalate**: §3.4 budget table replaced by Task 1's measured defaults; §4.2 `contextBlocks` shape; the greeting directive on all phases; D-D floor rule.
- [ ] **Step 4: Close-out** — `close-out-review`, `- Status: done`, `node scripts/state.mjs --write`, merge; STATE: **P4 complete**; Next → P5 (if not already run in parallel) and P6.

**Verification:** evidence pasted; `node scripts/state.mjs --check` → OK. AC-1343, AC-1344, INV-LLM-004, BR-LLM-005.

## Follow-up (not part of this plan)

- P6: `muscleRecovery` (session_planning) and `currentExerciseHistory` (training) as `ContextBlock`s; `## User Facts` block 2 half; fact extraction at compaction.
- P5: `requestTimeout` calibrated against p95 latency including compaction; per-user mutex.
- P7: `LLM_BUDGET_*` overrides documented in the ops runbook; nightly evals report the `cuts` distribution.
