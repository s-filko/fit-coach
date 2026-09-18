# Refactor P4 — Context Budget and Domain Blocks Implementation Plan

- Status: in progress
- Branch: plan/refactor-p4-context-budget
- After: refactor-p4-episode-memory

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Revision 2026-09-18** (orchestrator, after P3 closed): aligned with the shipped P3 code
> and with the revised `refactor-p4-episode-memory` plan (which now owns the greeting-for-all-
> phases change, `PhaseSpec.budget` as data, the single message layout and the eval seeding).
> D-A is redesigned: blocks are pure renderers over the phase's already-loaded data, not a
> second loader.
>
> **Revision 2026-09-19** (orchestrator, after P4 episode memory merged at `b5dc2e1d`):
> re-validated against the tree — `assembleContext({ systemPrompt, episodeSummaries, history,
> current, now, timezone })`, `PhaseSpec.budget`, the D-B section ids, `compact.node.ts`'s
> `budgetFor` trigger and `sectionText` in `prompts/compose.ts` all exist as named. Task 1's
> measurement is pasted (smoke-only data — dev has no organic traffic). Three P4 close-out
> advisories that touch `compact.node.ts` are folded into Task 4. **Owner strategy
> 2026-09-19:** budget goes into the code skeleton; per plan only mocked tests, L0 and one
> dev smoke — no model-backed eval run on this plan. AC-1344's re-run moves to the
> consolidated eval pass (after P6, recommended). Executor today: a Sonnet subagent, not
> the GLM `claude -p` path.

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
- **Reserved to the orchestrator:** Task 1, Task 7. Verification from `apps/server/`. No attribution lines. **No model-backed run on this plan at all** (owner strategy 2026-09-19): the executor runs no `RUN_LLM_EVALS=1` command; the orchestrator's only live-model step is the 3–5-call dev smoke in Task 7. AC-1344's re-run is recorded as pending the consolidated eval pass.

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

- [x] **Step 1:** After `refactor-p4-episode-memory` has run on dev for at least a day: `SELECT phase_in, count(*), percentile_cont(0.5) WITHIN GROUP (ORDER BY (budget_report->>'system')::int) AS p50_system, max((budget_report->>'system')::int), percentile_cont(0.95) WITHIN GROUP (ORDER BY (budget_report->>'history')::int) AS p95_history, max((budget_report->>'summary')::int) FROM conversation_runs WHERE budget_report IS NOT NULL AND created_at > now() - interval '7 days' GROUP BY 1;` — paste here.
- [x] **Step 2:** Set the `PhaseSpec.budget` values (table below) — start from ADR §3.4 and adjust `system` to p50 + 30 %, `history` to max(ADR, p95) rounded up to 0.5 k; `domain` from the block sizes after Task 2 (re-check once Task 2 lands). Record the chosen table under **Budget defaults (Task 1)**.

**Verification:** the table exists before Task 3 starts.

**Measurement (Task 1 Step 1, 2026-09-19, dev, 7 days, estimator `chars4x1.15`):** dev has
no organic traffic — every row is a smoke run (n = 1…16 per phase); these are floors, not means.

| phase_in | n | p50 system | max system | p95 history | max history | max summary |
|---|---:|---:|---:|---:|---:|---:|
| registration | 7 | 977 | 1029 | 390 | 391 | 0 |
| chat | 5 | 1330 | 1435 | 3655 | 3688 | 388 |
| plan_creation | 16 | 1413 | 1445 | 2178 | 2479 | 388 |
| session_planning | 1 | 3218 | 3218 | 5139 | 5139 | 351 |
| training | 2 | 3625 | 3643 | 4973 | 4981 | 331 |

**Budget defaults (Task 1 Step 2, owner decision 2026-09-19):** the ADR §3.4 table stands
unchanged as the defaults already in `phases/*.spec.ts`. Rationale: p50 + 30 % is *below*
the ADR `system` value for every phase, and max(ADR, p95) rounded up equals the ADR
`history` value for every phase; lowering `system` on n ≤ 16 floors would only produce
spurious `warn` logs (system over budget is reported, never cut). `domain` is re-checked
by the executor against the block sizes after Task 2 (pasted under **Snapshot diff**);
if any phase's full-depth blocks exceed `domain`, raise that phase's `domain` to the
measured size rounded up to 0.5 k and note it there — do not lower the others.

---

### Task 2: Context blocks and the phase prompts without domain sections

**Files:**
- Create: `apps/server/src/infra/ai/context/blocks/` — `types.ts` (`ContextBlock`), one file per D-B block (`chat-context.v1.ts`, `client-profile.v1.ts` (shared), `session-planning-{active-plan,recent-history,recovery-timeline}.v1.ts`, `training-{client,workout-overview,stale-session,previous-session}.v1.ts`), `index.ts` (`renderBlocks(blocks, data, ctx, depthOf) → Array<{ id; text; tokens; depth }>`), `__tests__/*.unit.test.ts` — per block: `render(data, ctx, maxDepth)` equals `sectionText(V1.render(v1ctx), '<section id>')` character for character on the L0 fixtures; depth variants snapshot-pinned. **Note:** the render helpers (`buildWorkoutOverview`, `buildHistorySection`, …) move from `prompts/phases/*/v1*.ts` into the block files; the v1 prompt files import them back from there so v1 keeps rendering identically (L0 snapshots for v1 unchanged).
- Modify: `apps/server/src/infra/ai/prompts/phases/*/v2.ts` (v1 minus the moved sections; `requiredSections` updated; `current = v2`; the render context type loses nothing — rules still read `hasActivePlan` / `session`); L0 fixture contexts and snapshots for v2.
- Modify: `phase-spec.ts` (`contextBlocks`), `phases/*.spec.ts`, `nodes/agent.node.ts` (renders blocks from `loaded.data` at full depth and hands `blocks` to the assembler), `assemble-context.ts` (block 3 after the episode-summaries block; report `blocks`).
- Modify: `evals/snapshots/__tests__/message-assembly.unit.test.ts` — regenerate **once** with the enumerated diff: block 3 appears after the summaries block; block 1 shrinks by exactly the moved sections; nothing else moves.

- [x] **Step 1: Tests first** — block-equals-section proofs; v2 prompt snapshots contain no profile/plan/session data; the agent node passes the rendered blocks.
- [x] **Step 2: Implement.** Paste the snapshot diff list under **Snapshot diff (Task 2)**; STOP for orchestrator review before committing.
- [x] **Step 3: Commit** — `feat(ai): domain context blocks (block 3) with declared depths; phase prompts v2 without domain sections (ADR-0013 §3.4)` — committed by the orchestrator 2026-09-19 after reviewing the diff above; message-assembly snapshots regenerated once in that commit (12 cases, exactly the enumerated diff).

**Verification:** `npx jest --ci src/infra/ai evals/snapshots` → 424 tests, 412 pass, 12 fail (all in `message-assembly.unit.test.ts`, the expected pre-regeneration diff below — enumerated, not yet applied); `npm run evals -- --level L0` → 96/96 pass; `npx tsc --noEmit` clean; `npx eslint src/infra/ai/context src/infra/ai/prompts src/infra/ai/graph` → 0 errors (241 pre-existing-style warnings, none new to the touched files beyond the pre-existing complexity/magic-number baseline already present in untouched sibling files).

**Tree-vs-plan deviation found and corrected (reported, not silently improvised):** the plan's file list says `Create: apps/server/src/infra/ai/context/blocks/`. That path conflicts with an already-enforced boundary: `eslint.config.js`'s `no-restricted-syntax` override and `evals/levels/__tests__/no-inline-prompts.unit.test.ts` (BR-LLM-009) both scan `src/infra/ai/context/**` for inline prompt-text literals (`=== HEADER ===`, `new SystemMessage('...')`) and fail the build if any are found — the domain blocks are exactly such literals. `docs/STATE.md` (P2 close-out note) additionally records `prompts/blocks/` as the owner-accepted ADR-0013 §5.1 layout extension for blocks, and the two existing blocks (`episode-summaries.v1.ts`, `post-tool-nudge.v1.ts`) already live there, not under `context/`. I built the new blocks at `context/blocks/` per the plan's literal path first, hit the `no-inline-prompts` test failure (11 new violations, all my new block files), confirmed the conflict against the enforced rule and the STATE.md precedent, then relocated the whole `blocks/` subtree (types, all 7 new block files, the merged `index.ts`, and their `__tests__`) to `apps/server/src/infra/ai/prompts/blocks/` alongside the two existing blocks. No design decision changed — same `ContextBlock<D>` shape, same block ids, same `renderBlocks`/`fullDepth` API — only the directory. `PhaseSpec.contextBlocks`'s type import and every `phases/*.spec.ts` import now point at `@infra/ai/prompts/blocks`. `no-inline-prompts` and the full suite are green after the move (see Verification above).

**Snapshot diff (Task 2):**

`evals/snapshots/__tests__/message-assembly.unit.test.ts` was **not regenerated** (per instruction — Task 2 stops here for review; the message-assembly snapshots are regenerated exactly once, after this diff is reviewed). Running the suite today shows exactly the diff below, confirmed by inspecting the full failure output (`chat / plain` shown verbatim; the other 11 failing cases are the same pattern per phase/scenario):

- **registration / plain, with-summary, post-tool (3 cases): PASS, byte-identical.** Registration has no D-B domain sections (its prompt has no profile/plan/session data) — `contextBlocks: []` — so its snapshot is untouched, confirming the harness only reacts to real content moves.
- **chat, plan_creation, session_planning, training × plain/with-summary/post-tool (12 cases): FAIL as expected**, all with the same shape of diff:
  - Block 1 (the phase `SystemMessage`) shrinks by **exactly** the moved section(s)' text — no wording change, no other text touched. Example (`chat / plain`): the `context` section text (`CLIENT NAME: ...` through `No recent sessions.`) is removed from the start of message[0]'s content; message[0] now starts directly with `RULES:` (v2's first section). The removed and reinserted text is character-for-character identical — verified separately by the block-equals-section unit tests (`src/infra/ai/prompts/blocks/__tests__/*.unit.test.ts`, 32 tests, all passing) that assert `block.render(...) === sectionText(V1.render(v1ctx), '<section id>')`.
  - A **new SystemMessage is inserted** immediately after where the summaries block (`## Previous episodes`) would sit (present in `with-summary` scenarios, absent otherwise) and before `history`/`current` — containing exactly the text that was removed from block 1. For chat this is the `chat.context` block; for plan_creation, `plan_creation.client_profile`; for session_planning, `session_planning.client_profile` + `session_planning.active_plan` + `session_planning.recent_history` + `session_planning.recovery_timeline` (joined with the same `\n\n` `SECTION_SEPARATOR` `compose()` uses); for training, `training.client` + `training.workout_overview` (+ `training.stale_session` / `training.previous_session` when the fixture's session state triggers those gates — the L0 fixtures used by this harness don't, so those two are absent here, consistent with v1's own gates).
  - **Message count** increases by exactly 1 in every failing case (one new domain-block SystemMessage). No history, current, or tool messages move, split, or change content — `expect(messages.slice(...)).toEqual(historyFixture())`-style assertions in `assemble-context.unit.test.ts` (12/12 passing) cover this structurally; the message-assembly diff output confirms it visually (only the two system-message blocks differ; every message after them is byte-identical, same order).
  - Nothing else moves: no reordering of history/current, no change to the post-tool nudge placement, no change to tool-call/tool-message pairing.

**Measured full-depth domain block sizes vs `domain` budget (Task 1 Step 2 re-check, estimator `chars4x1.15`, L0 fixtures — trivial `exercises: []` fixtures, so these are floors on top of Task 1's dev-smoke floors, not production sizes):**

| phase | domain budget | empty-profile | complete-profile | active-session |
|---|---:|---:|---:|---:|
| chat | 2000 | 61 | 84 | 84 |
| plan_creation | 2000 | 32 | 40 | 40 |
| session_planning | 6000 | 124 | 132 | 139 |
| training | 6000 | 75 | 79 | 79 |

All measured sizes are far under budget (< 3% of `domain` in the worst case) — no phase's `domain` needs raising per Task 1 Step 2's instruction ("if any phase's full-depth blocks exceed `domain`, raise ... — do not lower the others"). The fixtures are minimal (no exercises, no recent sessions), so this is a sanity floor, not the real ceiling; the Task 1 dev-smoke numbers (session_planning max ~5139 history / plan sizes not separately broken out pre-Task-2) remain the operative real-traffic signal.

---

### Task 3: Budget enforcement in the assembler

**Files:**
- Create: `apps/server/src/infra/ai/context/budget.ts` — `resolveBudget({ systemTokens, summaries, blocks, history, current, budget, estimate }) → { history; blockDepths; summaries; cuts }` — pure; `trimHistory(history, maxTokens, estimate)` wraps `trimMessages` (`strategy: 'last'`, `startOn: 'human'`, `includeSystem: false`, `allowPartial: false`, `tokenCounter` = `estimateMessages` from `context/token-estimator.ts`, i.e. the estimator over `messageTokenText` — the one message-token basis, R2 close-out rule).
- Modify: `assemble-context.ts` (calls `resolveBudget`, re-renders blocks at the chosen depth), `config/index.ts` + `.env.example` (`LLM_BUDGET_<PHASE>_<PART>` optional overrides, applied where the specs are built), `phases/*.spec.ts` (Task 1's table), `domain/conversation/ports/conversation-run.ports.ts` (`BudgetReport` fields per D-C), the agent node (logs `warn` when `system > budget.system`, `error` on `'floor'`).

**Re-render design (orchestrator direction, 2026-09-19):** `assembleContext`'s `blocks` input changes shape from `AssembledBlock[]` (pre-rendered text) to the raw pair the agent node already has — `spec.contextBlocks` (the `ContextBlock<D>[]`, unchanged D-A shape) plus `loaded.data` and the block-render `ctx` (`{ now, timezone, user }`) — so `resolveBudget` can step a block down its `depths` and call `block.render(data, ctx, smallerDepth)` directly, the same pure call the agent node already makes at full depth. No callback indirection: the block objects are already the reusable pure function: `ContextBlock.render`. Consequence: `assembleContext` becomes `async` (it now renders at full depth as its own first step, then `resolveBudget`'s `trimHistory` awaits `trimMessages`, an async LangChain helper) — its one call site (`agent.node.ts`) already runs inside an `async` function, so this is a one-line `await` ripple, not an architectural change. `resolveBudget` itself stays synchronous/pure except for `trimHistory`, which is the one exception the plan already names (`trimMessages` is inherently async).

Resolution order (INV-LLM-004): (a) trim history to `budget.history`; (b) if `total` still > `sum − outputReserve`, step each block down its `depths` (largest block first) until within; (c) drop episode summaries oldest first; (d) D-D floor. `system` over its budget is **reported**, never cut.

- [x] **Step 1: Tests first** — INV-LLM-004 order on a synthetic over-budget input (`it` names carry `INV-LLM-004`); tool pair never split; kept tail starts on a human message; no orphan `ToolMessage` for 50 random cut points (property-style loop); block 1 identical in and out; the floor case; report `cuts`.
- [x] **Step 2: Implement.**
- [x] **Step 3: Commit** — `feat(ai): per-phase token budget enforced in the assembler — trim history, reduce block depth, drop oldest summary (INV-LLM-004)`

**Verification:** `npx jest --ci src/infra/ai/context` → all pass (11 `budget.unit.test.ts` + 15 `assemble-context.unit.test.ts`); full suite `npx jest --ci` → 782/782; `npm run evals -- --level L0` → 96/96; `grep -n "new Date()\|Date.now()\|loadConfig" apps/server/src/infra/ai/context` → only the docstring mention of the grep itself, no real hits (pure); `npm run check-all` (lint + format:check + type-check) → 0 errors.

---

### Task 4: AC-1343 replay test, the L1 checks, and the compaction-node advisories

**Files:**
- Create: `apps/server/evals/fixtures/long-training-transcript.ts` (60 turns: human → `log_set` tool call → tool result → ai, realistic lengths, built with `evals/lib/seed-messages.ts`), `evals/levels/__tests__/budget-replay.unit.test.ts`
- Modify: `evals/levels/l1.ts` (`budget-within-limits`, `no-orphan-tool-message`), `evals/lib/run-case.ts` (`ModelInputRecorder` — last model input's message types and tool-call/tool-message pairing, same `BaseCallbackHandler` pattern as `ToolRecorder`), `evals/lib/reporter.ts` if the check list is enumerated there.
- Modify: `src/infra/ai/graph/nodes/compact.node.ts` + its unit test — three P4 close-out advisories (BACKLOG § P4 close-out review advisories, 2026-09-18), folded here because the replay test exercises exactly this node:
  (a) `new RemoveMessage({ id: m.id ?? '' })` silently no-ops for an id-less message, so the budget trigger refires every run and a summary can repeat per episode — fail loud: `log.error` + skip the removal set (never remove with `''`), and a unit test where one history message has no id;
  (b) the D-E legacy-import branch returns without consuming a pending `state.compactReason` — it must return `compactReason: null` too; unit test: transition-plus-first-message leaves no flag behind;
  (c) `LegacySummary` is re-declared inline — import the named type from `summary.ports.ts`.
  Tick the three BACKLOG entries in the same commit.

- [x] **Step 0:** Compaction-node advisories (a)–(c), tests first; commit — `fix(ai): compact node fails loud on id-less messages, consumes compactReason on legacy import, imports LegacySummary (P4 close-out advisories)`
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

- [ ] **Step 1: AC-1344 — deferred, no run here** (owner strategy 2026-09-19): no model-backed eval on this plan. Record in the close-out that AC-1344's re-run (L1 ±2 pp, L2 manual rubric) is pending the consolidated eval pass on the prod model via OpenRouter (off the Z.AI quota), together with the P4 episode-memory compare. Gate for this plan = unit/integration/L0 + the dev smoke + `budget-within-limits` on live rows.
- [ ] **Step 2: Deploy to dev**; smoke all phases; `SELECT phase_in, max((budget_report->>'history')::int), (budget_report->'budget'->>'history') FROM conversation_runs WHERE created_at > now() - interval '2 hours' GROUP BY 1, 3;` — history never above budget; `SELECT budget_report->'cuts' FROM conversation_runs WHERE jsonb_array_length(budget_report->'cuts') > 0 AND created_at > now() - interval '2 hours';` — inspect what was cut. `npm run db:prune-checkpoints` dry-run on dev — paste counts; `--apply` on dev only after the owner sees the counts.
- [ ] **Step 3: Docs reconcile** (factual): `ARCHITECTURE.md`, `CONTRIBUTING_AI.md` (adding a context block; tuning a budget via env), `PROMPT_EVAL_FRAMEWORK.md` §4.2 (the two checks are implemented), `CICD.md` cron note, `BACKLOG.md` ticks (`budget-report-present` false positive → guarded; small P2 duplications — profile block). ADR-0013 amendments to **escalate**: §3.4 budget table replaced by Task 1's measured defaults; §4.2 `contextBlocks` shape (renderers over loaded data); D-D floor rule.
- [ ] **Step 4: Close-out** — `close-out-review` (one review for the plan; P4 episode memory had its own), `- Status: done`, `node scripts/state.mjs --write`, merge; STATE: **P4 complete**, AC-1344 pending the consolidated pass; Next → P5 (if not already run in parallel) and P6. Branch/worktree cleanup only on the owner's explicit command (CLAUDE.md rule).

**Verification:** evidence pasted; `node scripts/state.mjs --check` → OK. AC-1343, AC-1344, INV-LLM-004, BR-LLM-005.

## Follow-up (not part of this plan)

- P6: `muscleRecovery` (session_planning) and `currentExerciseHistory` (training) as `ContextBlock`s; `## User Facts` block 2 half; fact extraction at compaction.
- P5: `requestTimeout` calibrated against p95 latency including compaction; per-user mutex.
- P7: `LLM_BUDGET_*` overrides documented in the ops runbook; nightly evals report the `cuts` distribution.
