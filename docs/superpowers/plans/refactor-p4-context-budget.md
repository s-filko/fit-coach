# Refactor P4 — Context Budget and Domain Blocks Implementation Plan

- Status: planned
- Branch: plan/refactor-p4-context-budget
- After: refactor-p4-episode-memory

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Revision 2026-09-18** (orchestrator, after P3 closed): aligned with the shipped P3 code
> and with the revised `refactor-p4-episode-memory` plan (which now owns the greeting-for-all-
> phases change, `PhaseSpec.budget` as data, the single message layout and the eval seeding).
> D-A is redesigned: blocks are pure renderers over the phase's already-loaded data, not a
> second loader. **Re-validate this plan against the tree once the episode-memory plan has
> merged** — its Task 1 measurement and the exact assembler signature are inputs.

**Goal:** The assembler enforces a per-phase token budget in the ADR-0013 §3.4 order — trim history, reduce domain block depth, drop the oldest episode summary — and never touches the phase prompt (INV-LLM-004). Domain data leaves the phase prompt (block 1) and becomes declared, budgeted context blocks (block 3) rendered from `PhaseSpec.contextBlocks`. Checkpoints are pruned by a script (BR-LLM-005). The `budgetReport` gains the budget and what was cut.

**Architecture:** ADR-0013 §3.4 (blocks 1–4, budget table, INV-LLM-004), §4.2 (`contextBlocks`, `budget`), §3.3 (BR-LLM-005 pruning policy), §10 (muscle-centric blocks as D-03 loaders — listed, not built here). Master plan P4 items 3 and 5. Inputs: the episode-memory plan's `assembleContext({ systemPrompt, episodeSummaries, history, current, now, timezone })`, `PhaseSpec.budget` (data), `splitEpisode`, the compaction-by-budget trigger; P2's §3.4 measurement (session_planning ~3.2 k, training ~3.6 k estimated system tokens, n=1/2 — re-measured in Task 1).

**Tech Stack:** TypeScript, `@langchain/core` `trimMessages`, the P2 estimator (`context/token-estimator.ts`), Jest, a `tsx` script under `src/infra/db/scripts/` (next to `cleanup-orphan-checkpoints.ts`).

**Spec:** ADR-0013 §3.3 (BR-LLM-005), §3.4, §4.2; `docs/LLM_CORE_REFACTOR_PLAN.md` § P4 items 3, 5 and Notes (`trimMessages` with `startOn: 'human'`, tool pairs kept together); `docs/PROMPT_EVAL_FRAMEWORK.md` §4.2 (`budgetReport.history ≤ budget.history`, orphan tool-message check).

**Acceptance criteria:** AC-1343 (a synthetic 60-turn training transcript replayed through the graph never exceeds the training history budget — `budgetReport.history ≤ budget.history` on every run — and never sends an orphan `ToolMessage`), AC-1344 re-run (L1 within ±2 pp of the post-episode-memory numbers; L2 not lower by > 0.2 — manual rubric, no L2 runner exists), INV-LLM-004 unit-tested (block 1 never dropped or truncated; resolution order).

## Global Constraints

- **No prompt wording change** in the phase modules' rule/tool/identity sections. Moving domain sections out of block 1 changes the *position* of that text, not its wording: at full depth a block renders **exactly the section text the v1 prompt rendered** (snapshot proof per block, built by rendering v1 and picking the section by id), and the phase prompt v2 is v1 minus those sections (a version bump per phase; both files kept; L0 snapshots for v2). The L1/L2 gate (AC-1344) is the arbiter.
- **Budget numbers are config defaults**: `PhaseSpec.budget` (already data since the episode-memory plan) seeded by Task 1's measurement, overridable per phase and part by optional env `LLM_BUDGET_<PHASE>_<PART>` (same "tunables, not secrets" exception as `EPISODE_*` — D-L of the episode-memory plan). The mechanism is the invariant, not the values.
- **Trimming never splits a tool pair and never starts the kept tail on a non-human message** (`trimMessages` with `strategy: 'last'`, `startOn: 'human'`, `includeSystem: false`, `allowPartial: false`, the estimator as `tokenCounter`). Because the episode-memory plan's compaction already removes whole turns, trimming here is the in-run safety net (a single huge run); the "kept tail starts with a human" property test is reused against the trimmer.
- **Domain block depth reduction is declared per block** (`depths`); the assembler steps depth down before dropping a summary and records what it cut in `budgetReport.cuts`.
- **Pruning script is run by the owner** (cron note in `docs/CICD.md`); no scheduler in the app. It never deletes the latest checkpoint per `(thread_id, checkpoint_ns)`. The `checkpoints*` tables are LangGraph runtime storage, absent from `schema.ts` — the script uses raw SQL and **never** adds them to migrations (HB-01 rule in `CLAUDE.md`).
- **Reserved to the orchestrator:** Task 1, Task 7. Verification from `apps/server/`. No attribution lines. No `RUN_LLM_EVALS=1` runs by the executor; the orchestrator's only model-backed step is the one-dataset n=1 mini-compare in Task 7 (§7a hardened 2026-09-18 — full sweeps are red-button only).

## Decisions taken by this plan (not settled by the durable specs — owner may overrule)

| # | Decision | Alternative rejected | Why |
|---|---|---|---|
| D-A | `ContextBlock<D> = { id: string; version: string; depths?: readonly number[]; render(data: D, ctx: { now: Date; timezone: string \| null; user: User \| null }, depth: number): string \| null }` — a **pure renderer over the phase's loaded data**; `PhaseSpec.loadContext` stays the one loader (one call per run, already parallelised inside); `PhaseSpec.contextBlocks: ContextBlock<D>[]`. Block 3 = one `SystemMessage` of the non-null renders in spec order, joined the way `compose` joins sections. `render` returning `null` = block absent (e.g. no previous session) | Blocks as loaders replacing `loadContext` (the 2026-09-17 draft) | The phase prompt still needs the same data for rules (`hasActivePlan` picks the chat plan rule; training's availability policy reads `session`) — a second loader would load twice or split one dataset across two types. Depth reduction is a re-render of data already in memory. |
| D-B | **One block per moved section**, id `<phase>.<section>` reusing the v1 section ids: chat `context` (depth on recent sessions: 5 → 3 → 1); plan_creation `client_profile`; session_planning `client_profile`, `active_plan`, `recent_history` (depth 5 → 3 sessions), `recovery_timeline` (`date` stays in the prompt — two lines); training `client`, `workout_overview`, `stale_session`, `previous_session`. The identical profile text of plan_creation and session_planning becomes one shared renderer (BACKLOG "small P2 duplications"). Registration moves nothing. Muscle-centric blocks (§10) are **not** built here | Semantic blocks (`profile`, `active_plan`, `recent_sessions`) cutting across sections | Section granularity gives byte-equal snapshot proofs and no re-wording; semantic regrouping is a prompt change and belongs to a wording PR with its own eval run. |
| D-C | `budgetReport` gains `budget: TokenBudget`, `blocks: Array<{ id; tokens; depth }>`, `cuts: Array<'history' \| \`block:${id}\` \| 'summary' \| 'floor'>`; the L1 check `budget-report-present` **keeps its name** (baselines v0–v2 record it) and two checks are added: `budget-within-limits` (`history ≤ budget.history` and `total ≤ sum − outputReserve`) and `no-orphan-tool-message` (needs the model input — a `ModelInputRecorder` callback on `handleChatModelStart` in `evals/lib/run-case.ts`, same pattern as `ToolRecorder`) | Separate report type; renamed check | One report per run, one query surface; P2/P3 fields keep their meaning; baseline compare keeps working. |
| D-D | Over-budget after all three steps (huge single message) → the assembler keeps block 1 and `current`, drops everything else, logs `error` (via the report — the assembler stays pure; the agent node logs), and `cuts` ends with `'floor'` | Throw | INV-LLM-004 forbids touching block 1; refusing the reply for a long user message is worse than a context with no history. |
| D-E | `db:prune-checkpoints` deletes `checkpoints` / `checkpoint_blobs` / `checkpoint_writes` rows older than `--days` (default 14) except the latest per `(thread_id, checkpoint_ns)`; dry-run by default, `--apply` to delete; prints counts per table | Delete inside the app after each run | BR-LLM-005 says nightly job, owner-run; a dry-run default makes the first prod run safe. |

---

### Task 1: Re-measure §3.4 on dev with episode memory on (orchestrator)

- [ ] **Step 1:** After `refactor-p4-episode-memory` has run on dev for at least a day: `SELECT phase_in, count(*), percentile_cont(0.5) WITHIN GROUP (ORDER BY (budget_report->>'system')::int) AS p50_system, max((budget_report->>'system')::int), percentile_cont(0.95) WITHIN GROUP (ORDER BY (budget_report->>'history')::int) AS p95_history, max((budget_report->>'summary')::int) FROM conversation_runs WHERE budget_report IS NOT NULL AND created_at > now() - interval '7 days' GROUP BY 1;` — paste here.
- [ ] **Step 2:** Set the `PhaseSpec.budget` values (table below) — start from ADR §3.4 and adjust `system` to p50 + 30 %, `history` to max(ADR, p95) rounded up to 0.5 k; `domain` from the block sizes after Task 2 (re-check once Task 2 lands). Record the chosen table under **Budget defaults (Task 1)**.

**Verification:** the table exists before Task 3 starts.

**Budget defaults (Task 1):** _(pasted by the orchestrator)_

---

### Task 2: Context blocks and the phase prompts without domain sections

**Files:**
- Create: `apps/server/src/infra/ai/context/blocks/` — `types.ts` (`ContextBlock`), one file per D-B block (`chat-context.v1.ts`, `client-profile.v1.ts` (shared), `session-planning-{active-plan,recent-history,recovery-timeline}.v1.ts`, `training-{client,workout-overview,stale-session,previous-session}.v1.ts`), `index.ts` (`renderBlocks(blocks, data, ctx, depthOf) → Array<{ id; text; tokens; depth }>`), `__tests__/*.unit.test.ts` — per block: `render(data, ctx, maxDepth)` equals `sectionText(V1.render(v1ctx), '<section id>')` character for character on the L0 fixtures; depth variants snapshot-pinned. **Note:** the render helpers (`buildWorkoutOverview`, `buildHistorySection`, …) move from `prompts/phases/*/v1*.ts` into the block files; the v1 prompt files import them back from there so v1 keeps rendering identically (L0 snapshots for v1 unchanged).
- Modify: `apps/server/src/infra/ai/prompts/phases/*/v2.ts` (v1 minus the moved sections; `requiredSections` updated; `current = v2`; the render context type loses nothing — rules still read `hasActivePlan` / `session`); L0 fixture contexts and snapshots for v2.
- Modify: `phase-spec.ts` (`contextBlocks`), `phases/*.spec.ts`, `nodes/agent.node.ts` (renders blocks from `loaded.data` at full depth and hands `blocks` to the assembler), `assemble-context.ts` (block 3 after the episode-summaries block; report `blocks`).
- Modify: `evals/snapshots/__tests__/message-assembly.unit.test.ts` — regenerate **once** with the enumerated diff: block 3 appears after the summaries block; block 1 shrinks by exactly the moved sections; nothing else moves.

- [ ] **Step 1: Tests first** — block-equals-section proofs; v2 prompt snapshots contain no profile/plan/session data; the agent node passes the rendered blocks.
- [ ] **Step 2: Implement.** Paste the snapshot diff list under **Snapshot diff (Task 2)**; STOP for orchestrator review before committing.
- [ ] **Step 3: Commit** — `feat(ai): domain context blocks (block 3) with declared depths; phase prompts v2 without domain sections (ADR-0013 §3.4)`

**Verification:** `npx jest --ci src/infra/ai evals/snapshots`; `npm run evals -- --level L0`.

**Snapshot diff (Task 2):** _(pasted by the executor)_

---

### Task 3: Budget enforcement in the assembler

**Files:**
- Create: `apps/server/src/infra/ai/context/budget.ts` — `resolveBudget({ systemTokens, summaries, blocks, history, current, budget, estimate }) → { history; blockDepths; summaries; cuts }` — pure; `trimHistory(history, maxTokens, estimate)` wraps `trimMessages` (`strategy: 'last'`, `startOn: 'human'`, `includeSystem: false`, `allowPartial: false`, `tokenCounter` = the estimator over `messageText`).
- Modify: `assemble-context.ts` (calls `resolveBudget`, re-renders blocks at the chosen depth), `config/index.ts` + `.env.example` (`LLM_BUDGET_<PHASE>_<PART>` optional overrides, applied where the specs are built), `phases/*.spec.ts` (Task 1's table), `domain/conversation/ports/conversation-run.ports.ts` (`BudgetReport` fields per D-C), the agent node (logs `warn` when `system > budget.system`, `error` on `'floor'`).

Resolution order (INV-LLM-004): (a) trim history to `budget.history`; (b) if `total` still > `sum − outputReserve`, step each block down its `depths` (largest block first) until within; (c) drop episode summaries oldest first; (d) D-D floor. `system` over its budget is **reported**, never cut.

- [ ] **Step 1: Tests first** — INV-LLM-004 order on a synthetic over-budget input (`it` names carry `INV-LLM-004`); tool pair never split; kept tail starts on a human message; no orphan `ToolMessage` for 50 random cut points (property-style loop); block 1 identical in and out; the floor case; report `cuts`.
- [ ] **Step 2: Implement.**
- [ ] **Step 3: Commit** — `feat(ai): per-phase token budget enforced in the assembler — trim history, reduce block depth, drop oldest summary (INV-LLM-004)`

**Verification:** `npx jest --ci src/infra/ai/context`; `grep -n "new Date()\|Date.now()\|loadConfig" apps/server/src/infra/ai/context` → empty (pure).

---

### Task 4: AC-1343 replay test and the L1 checks

**Files:**
- Create: `apps/server/evals/fixtures/long-training-transcript.ts` (60 turns: human → `log_set` tool call → tool result → ai, realistic lengths, built with the seed helper from the episode-memory plan), `evals/levels/__tests__/budget-replay.unit.test.ts`
- Modify: `evals/levels/l1.ts` (`budget-within-limits`, `no-orphan-tool-message`), `evals/lib/run-case.ts` (`ModelInputRecorder` — last model input's message types and tool-call/tool-message pairing), `evals/lib/reporter.ts` if the check list is enumerated there.

- [ ] **Step 1:** Replay: seed the 60-turn transcript into `messages` with `updateState`, run 10 consecutive mocked-model runs (each appends a set), assert `budgetReport.history ≤ budget.history` and no orphan tool message on every run, and that compaction by budget (BR-LLM-003) fired at least once (the stub `summaries.insert` received a row) — the `it` name carries `AC-1343`.
- [ ] **Step 2: Commit** — `test(evals): AC-1343 long-transcript replay; L1 budget and orphan-tool checks`

**Verification:** `npx jest --ci evals`.

---

### Task 5: Checkpoint pruning script (BR-LLM-005)

**Files:**
- Create: `apps/server/src/infra/db/scripts/prune-checkpoints.ts` (raw SQL through the existing `pg` pool helper used by `cleanup-orphan-checkpoints.ts`; `buildPruneStatements({ days, apply })` pure and exported), `__tests__/prune-checkpoints.unit.test.ts` (SQL builder), one integration run in `tests/integration/` behind `RUN_DB_TESTS=1` (seed three checkpoints for one thread, prune with `--days 0 --apply`, the latest survives, its writes survive, older blobs/writes go); `package.json` script `db:prune-checkpoints`.
- Modify: `docs/CICD.md` — a "Checkpoint pruning (BR-LLM-005)" note with the cron line `0 4 * * * cd /srv/docker/fitcoach && docker exec fitcoach-prod-server npm run db:prune-checkpoints -- --apply` (owner installs it; the plan does not).

- [ ] **Step 1:** Tests: dry-run prints counts and deletes nothing; `--apply` deletes only rows older than `--days` and never the latest per `(thread_id, checkpoint_ns)`; `checkpoint_writes` of deleted checkpoints go with them.
- [ ] **Step 2: Commit** — `feat(db): prune-checkpoints script with dry-run default (BR-LLM-005)`

**Verification:** `npx jest --ci src/infra/db/scripts`; `npm run db:prune-checkpoints` locally prints a dry-run summary.

---

### Task 6: JSDoc, rails, backlog notes in code

- [ ] `PhaseSpec.budget`/`contextBlocks` JSDoc; `BudgetReport` JSDoc updated; rails cover `context/blocks/**` (bite proof pasted).
- [ ] **Commit** — `docs(ai): budget and context-block JSDoc; rails proof`
- [ ] **STOP** — `DELEGATE STATUS: done, task: plan`.

---

### Task 7: Evals, dev deploy, pruning dry-run on dev, docs, close-out (orchestrator)

- [ ] **Step 1: AC-1344, minimal half** — one dataset, n=1: `RUN_LLM_EVALS=1 npm run evals -- --level L1 --phase training --dataset <the training dataset with the most tool rounds> --samples 1 --baseline compare --baseline-version v2` — **≤ 10 calls** (the training phase is where trimming bites; state the exact count before running). Evidence JSON `…/evidence/refactor-p4-context-budget-l1-compare.json`. The full sweep is a separate owner-launched red-button item (§7a, 2026-09-18), not a close-out condition. Rollback per the master plan only once the owner runs the sweep; before that, the dev smoke and `budget-within-limits` on live rows are the gate.
- [ ] **Step 2: Deploy to dev**; smoke all phases; `SELECT phase_in, max((budget_report->>'history')::int), (budget_report->'budget'->>'history') FROM conversation_runs WHERE created_at > now() - interval '2 hours' GROUP BY 1, 3;` — history never above budget; `SELECT budget_report->'cuts' FROM conversation_runs WHERE jsonb_array_length(budget_report->'cuts') > 0 AND created_at > now() - interval '2 hours';` — inspect what was cut. `npm run db:prune-checkpoints` dry-run on dev — paste counts; `--apply` on dev only after the owner sees the counts.
- [ ] **Step 3: Docs reconcile** (factual): `ARCHITECTURE.md`, `CONTRIBUTING_AI.md` (adding a context block; tuning a budget via env), `PROMPT_EVAL_FRAMEWORK.md` §4.2 (the two checks are implemented), `CICD.md` cron note, `BACKLOG.md` ticks (`budget-report-present` false positive → guarded; small P2 duplications — profile block). ADR-0013 amendments to **escalate**: §3.4 budget table replaced by Task 1's measured defaults; §4.2 `contextBlocks` shape (renderers over loaded data); D-D floor rule.
- [ ] **Step 4: Close-out** — `close-out-review`, `- Status: done`, `node scripts/state.mjs --write`, merge; STATE: **P4 complete**; Next → P5 (if not already run in parallel) and P6.

**Verification:** evidence pasted; `node scripts/state.mjs --check` → OK. AC-1343, AC-1344, INV-LLM-004, BR-LLM-005.

## Follow-up (not part of this plan)

- P6: `muscleRecovery` (session_planning) and `currentExerciseHistory` (training) as `ContextBlock`s; `## User Facts` block 2 half; fact extraction at compaction.
- P5: `requestTimeout` calibrated against p95 latency including compaction; per-user mutex.
- P7: `LLM_BUDGET_*` overrides documented in the ops runbook; nightly evals report the `cuts` distribution.
