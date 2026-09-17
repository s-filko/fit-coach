# Refactor P4 — Episode Memory Implementation Plan

- Status: planned
- Branch: plan/refactor-p4-episode-memory
- After: refactor-p3-run-context-commit

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The checkpointed `messages` channel becomes the one short-term memory: it survives runs, carries tool calls and tool results, and is the only source of dialogue history for every phase (INV-LLM-001/002). Episodes end by rule — inactivity gap, committed phase transition, budget overflow — and a synchronous `compact` step turns the ended episode into one independent structured summary (max 3 kept, oldest first) before the next model call. `conversation_turns` becomes an append-only transcript projection; the rolling asynchronous phase summary and the `history_frame`/`summaryFrame` layouts disappear. Facts (weights, reps, session state) never come from a summary.

**Architecture:** ADR-0013 §3.1–§3.3 (D-01, D-02; BR-LLM-001..004; INV-LLM-001..003), §3.4 blocks 2 and 4 (previous episodes block; history from `messages`), §8 (`conversation_turns` kinds/payload, `conversation_summaries`), §4.1 (`prepare` runs `compact`; `commit` sets the compaction flag). Master plan P4 items 1, 2, 4, 6. Owner decisions 2026-09-17 (`docs/STATE.md` § Blocked): one chat across the app; summaries at compaction, independent, never rolling; trivially short episodes trimmed without a summary; long-term fact extraction is P6 and consumes the summariser's structured output — this plan produces that output and stores it, nothing more. Builds on P3: `commit` raises `PhaseTransitionCommitted` (compaction becomes a handler that sets the flag), `RunContext` carries `now`, `PhaseSpec.layout` is the last place per-phase message layout lives.

**Tech Stack:** TypeScript, LangGraph 1.1.5 (`messagesStateReducer`, `RemoveMessage`, `PostgresSaver.deleteThread`), `LlmGateway.structured` (P1), Drizzle migration (one: `conversation_summaries`), Jest, the eval stack (L1 + L2 judge).

**Spec:** ADR-0013 §3, §4.1, §8, §11; `docs/LLM_CORE_REFACTOR_PLAN.md` § P4 items 1, 2, 4, 6 and rollback; ADR-0010 (summary rationale, "facts only, no style"); `docs/PROMPT_EVAL_FRAMEWORK.md` §4.2 (harness episode seeding), §5 (L2 judge).

**Acceptance criteria:** AC-1341 (second run of an episode sees the first run's tool calls and results — integration test with `MemorySaver` and a mocked model), AC-1342 (`EPISODE_GAP` mocked to 0 → the second run's input has exactly one episode-summary block and none of the first run's messages; one `conversation_summaries` row), AC-1345 (`conversation_turns` rows with `kind IN ('tool_call','tool_result')` grow on dev after a plan-creation smoke), AC-1346 (`grep -rn "getMessagesForPrompt\|getLatestSummary\|__context_reset__" apps/server/src` → empty), AC-1344 (L1: `plan_creation/id-reuse` ≥ +15 pp on `no_redundant_search` vs the P3 baseline `v2`; all other datasets within ±2 pp; L2 judge mean not lower by > 0.2 on any phase). AC-1343 (history budget) is `refactor-p4-context-budget`.

## Global Constraints

- **Behaviour-changing phase, gated by evals.** Prompt *wording* still does not change here (the summary frame text and the `## Previous episodes` block are new block modules with their own ids/versions, not edits to phase prompts). L0 snapshots of phase prompts stay green; the message-assembly snapshots are regenerated **once** (Task 6) with an enumerated diff — every phase now gets the same shape.
- **Rollback unit = this plan** (master plan P4 rollback): a single revert commit restores P3, which still reads history from `conversation_turns`. Nothing in this plan may make P3's code path unrecoverable — the `conversation_turns` writes continue (they are the transcript), so a revert loses no data.
- **One migration**: `conversation_summaries` (`id, user_id, episode_id, phase_at_end, structured jsonb, rendered text, created_at`) plus the enum value `summary` already exists on `conversation_turn_kind`; no other schema change. `npm run drizzle:generate` produces exactly one file, reviewed in the PR.
- **Compaction is synchronous and inside the run** (`prepare`), never fire-and-forget; on summariser failure it degrades to trimming without a summary and logs `warn` (BR-LLM-004). The legacy `phase-summary.node.ts`, `insertPhaseSummary`, `getLatestSummary`, `getLastUserMessageTime`, `insertContextReset`, `CONTEXT_RESET_MARKER` are deleted.
- **A turn is never split**: compaction removes whole turns — human message through the final AI message, tool pairs intact (`AIMessage(tool_calls)` + its `ToolMessage`s). The unit test for "cut in the middle of a tool pair" is written first (master plan P4 note).
- **Summaries carry no facts the prompt may act on**: the summariser prompt keeps ADR-0010's "facts only, no style" instruction *and* the block that renders summaries says they are context, not data — numbers come from tools (INV-LLM-003; owner rule). The L2 judge rubric TR-4 (no acting on past messages) is the regression guard for training.
- **Reserved to the orchestrator:** Task 1 (freeze `v2` baseline on P3 code), Task 8. Verification from `apps/server/`. No attribution lines.

## Decisions taken by this plan (not settled by the durable specs — owner may overrule)

| # | Decision | Alternative rejected | Why |
|---|---|---|---|
| D-A | Compaction triggers live in state: `commit` writes `compactReason: 'phase_boundary'` when it commits a transition (as a `PhaseTransitionCommitted` handler — the owner's "compaction consumes the event"); `prepare` computes the inactivity and budget triggers from `lastUserMessageAt`/`messages` and runs `compact` once per run at most | Compact inside `commit` at transition time | ADR §3.3: `compact` runs in `prepare` before the first model call; running it at commit would summarise while the user waits for a reply that is already produced, and P5's timeout budget is per reply. |
| D-B | Short-episode threshold: an ended episode with fewer than `EPISODE_MIN_TURNS = 2` human turns **or** fewer than `EPISODE_MIN_TOKENS = 300` estimated tokens is dropped without a summary (owner decision; values are config defaults, overridable) | Always summarise | A one-line "ok" exchange summarised costs a model call and produces noise the next prompt carries for three episodes. |
| D-C | `EpisodeSummary` schema (structured, `LlmGateway.structured`, profile `summarizer`): `{ topics: string[]; decisions: string[]; userState: string[]; trainingFeedback: string[]; openItems: string[] }` exactly as ADR §3.3; rendered to text by a versioned block `EPISODE_SUMMARIES_V1` (`## Previous episodes`, oldest first, one paragraph per episode with `phase_at_end` and a relative date from `ctx.now`) | Free-text summary (today) | Deterministic rendering is evaluable and P6 reads `userState` for fact extraction without re-parsing prose. |
| D-D | Budget trigger in this plan = estimated tokens of `messages` > the phase's history budget from ADR §3.4's table (`PhaseSpec.budget.history`, added here as data only); enforcement inside the assembler (trimming) is the next plan | Wait for the budget plan | Without an overflow trigger an episode can grow unbounded between transitions; the trigger is one comparison. |
| D-E | Live-thread migration on first run after deploy (master item 6): `prepare` finds `messages.length === 0 && episodeSummaries.length === 0` and a `role = 'summary'` row in `conversation_turns` → imports its text as one `EpisodeSummary` with `topics: [text]` and empty other arrays, `phase_at_end` from the row; the legacy row stays (transcript) | Start every user fresh | Users keep the context they have today; the import is idempotent by the guard. |
| D-F | `clear-context` route = `checkpointer.deleteThread(userId)` + one `system_note` turn (`kind: 'system_note'`, content from the catalog key `context_cleared`) | Keep raw SQL on the three checkpoint tables | ADR §3.3; `PostgresSaver.deleteThread` exists in the installed version (verify in Task 2; fall back to the three deletes behind the port if not). |
| D-G | `TranscriptPort` (append-only: `appendRunMessages(userId, runId, phase, episodeId, messages)`, `appendSystemNote`) and `SummaryPort` (`insert`, `latestForImport`) replace `IConversationContextService`; `InMemoryConversationContextService` is deleted after the route integration test moves to stubs of the new ports | Extend the old service | The old port's read side (`getMessagesForPrompt`) is exactly what INV-LLM-001 forbids; a port whose only reads are for import/analytics cannot be misused as a prompt source. |
| D-H | `budgetReport.history` counts the `messages` channel minus this run's messages; `summary` counts the episode-summaries block; `user`/`inFlight` as in P3 | Merge history and in-flight | Keeps P2/P3's report fields comparable across the migration; the next plan asserts `history ≤ budget.history`. |

---

### Task 1: Freeze the `v2` baseline on P3 code (orchestrator)

- [ ] **Step 1:** On `dev` after `refactor-p3-run-context-commit` merged: `RUN_LLM_EVALS=1 npm run evals -- --level L1 --phase all --samples 3 --baseline write --baseline-version v2`; if the L2 runner exists, also `--level L2` (judge profile per OQ-3) — otherwise record that AC-1344's judge half is measured manually in Task 8.
- [ ] **Step 2:** Commit `evals/baselines/v2/` + README row — `test(evals): freeze v2 baseline (post-P3 code)`.

**Verification:** files present. AC-1344 reference.

---

### Task 2: Migration, ports, domain types

**Files:**
- Create: `apps/server/src/domain/conversation/episode.ts` (`EpisodeSummary`, `EpisodeSummarySchema` (zod), `CompactReason = 'inactivity' | 'phase_boundary' | 'budget'`), `ports/transcript.ports.ts`, `ports/summary.ports.ts`; tests
- Modify: `apps/server/src/infra/db/schema.ts` (`conversationSummaries` table), generate `drizzle/0003_conversation_summaries.sql`
- Create: `apps/server/src/infra/conversation/drizzle-transcript.service.ts`, `drizzle-summary.service.ts` (+ tests against the test DB as the existing Drizzle services are tested)
- Modify: `apps/server/src/config` — `EPISODE_GAP_HOURS` (default 3, OQ-2), `EPISODE_MIN_TURNS` (2), `EPISODE_MIN_TOKENS` (300), `LLM_PROFILE_SUMMARIZER_*` documented in `.env.example`

- [ ] **Step 1:** Zod schema tests (round-trip, empty arrays allowed); port method shapes; migration applies on a scratch DB (`npm run db:local:migrate` on the local compose DB — executor may run it locally; durable envs migrate via `deploy.sh`).
- [ ] **Step 2:** Verify `PostgresSaver.prototype.deleteThread` exists (`node -e` one-liner); record the result under D-F.
- [ ] **Step 3: Commit** — `feat(conversation): episode summary types, transcript and summary ports, conversation_summaries migration (ADR-0013 §3.3, §8)`

**Verification:** `npx jest --ci src/domain/conversation src/infra/conversation`; `git status apps/server/drizzle` shows exactly one new migration + meta.

---

### Task 3: State grows; `commit` stops clearing; transcript projection

**Files:**
- Modify: `apps/server/src/infra/ai/graph/state.ts` (`episodeSummaries: EpisodeSummary[]` (last-write, ≤3), `episodeId: string` (uuid, new per episode), `episodeStartedAt: string`, `lastUserMessageAt: string | null`, `compactReason: CompactReason | null`)
- Modify: `nodes/commit.node.ts` — no `RemoveMessage`; `lastUserMessageAt = ctx.now`; `transcript.appendRunMessages(...)` with this run's messages mapped to kinds (`human`, `ai` with `payload.tool_calls`, `tool_call`?, `tool_result` with `payload.{tool_call_id, status}`) — one row per message, `run_id`, `thread_episode_id`; the P3 `appendTurn(human, ai)` call is replaced (BR-CONV-007 semantics kept: failure logged `error`, reply not failed); the transition handler list gains `compactionFlagHandler` → returns `{ compactReason: 'phase_boundary' }` (merged like `activeSessionId`)
- Modify: `RunMetricsCollector.finalText` removed — the adapter reads the last `AIMessage` from the graph output (`messages` no longer cleared)
- Modify: `nodes/agent.node.ts` — history = `state.messages` up to (excluding) this run's first `HumanMessage`; in-flight = from it on; `assembleContext` gets `history` as `BaseMessage[]` (no `ChatMsg` mapping — the P2 BACKLOG `toLangChain` twin goes); `summaryFrame`/`historyMode`/`toolResultsFrame` still honoured this task (removed in Task 6)

- [ ] **Step 1: Tests first** — AC-1341 integration test (`MemorySaver`, mocked model that calls a tool on run 1 and plain-replies on run 2): run 2's model input contains run 1's `AIMessage(tool_calls)` and `ToolMessage`; `commit` writes one transcript row per message with the right `kind`; `lastUserMessageAt` set; `compactReason` set only on a committed transition.
- [ ] **Step 2: Implement.** Identify "this run's messages" by `RunContext.runId` stamped into each message's `additional_kwargs.runId` by the executor/agent node (or by position after the last `HumanMessage`, whichever is simpler — pick one and test it).
- [ ] **Step 3: Commit** — `feat(ai): messages channel persists across runs; commit projects the run into conversation_turns (INV-LLM-001/002, AC-1341)`

**Verification:** `npx jest --ci src/infra/ai/graph`; the AC-1341 `it` name carries `AC-1341`.

---

### Task 4: `compact` — triggers, turn-safe cut, summariser, summaries block

**Files:**
- Create: `apps/server/src/infra/ai/graph/nodes/compact.ts` (pure planning: `planCompaction(state, ctx, budget) → { reason, removeIds: string[], keep: BaseMessage[] } | null`) and `compact.node.ts` (I/O: summariser call, `SummaryPort.insert`, `RemoveMessage`s); tests
- Modify: `nodes/prepare.node.ts` — call `compact` before the phase sync; D-E import
- Modify: `apps/server/src/infra/ai/prompts/summarizer/v1.ts` → `v2.ts` (structured schema instructions; `previousSummary` input removed — summaries are independent) with `SUMMARIZER_PROMPT.current = v2`; L0 snapshot for v2
- Create: `apps/server/src/infra/ai/prompts/blocks/episode-summaries.v1.ts` (`EPISODE_SUMMARIES_V1`), registered in `STANDALONE_PROMPTS`
- Modify: `apps/server/src/infra/ai/context/assemble-context.ts` — block 2 renders `episodeSummaries` via `EPISODE_SUMMARIES_V1` when non-empty (replaces `SUMMARY_FRAME_V1`, which is deleted with `historyFrame` in Task 6)

Rules: BR-LLM-001 `now - lastUserMessageAt ≥ EPISODE_GAP` and `messages` non-empty; BR-LLM-002 `compactReason === 'phase_boundary'`; BR-LLM-003 `estimateTokens(messages) > spec.budget.history` — for inactivity/phase boundary the whole episode is compacted; for budget, oldest whole turns until under budget (D-D). Cut planning is pure and unit-tested first (tool pair never split; `startOn: 'human'` invariant on the kept tail). Short episodes (D-B) → remove without summariser. Summariser: `gateway.structured(EpisodeSummarySchema, messages, { profile: 'summarizer', runId })` over the removed messages rendered as a transcript (tool results included, truncated per message at 500 chars); failure → `warn`, no summary (BR-LLM-004). New episode: `episodeId = randomUUID()`, `episodeStartedAt = ctx.now`, `compactReason = null`, `episodeSummaries = [...prev, new].slice(-3)`; mirror to `conversation_summaries`.

- [ ] **Step 1: Tests first** — `planCompaction`: the three triggers, no trigger, turn-safe cut (mid-tool-pair case first), short-episode drop; `compact.node`: AC-1342 integration (gap mocked to 0: run 2 input has one summaries block, none of run 1's messages; one `conversation_summaries` row), summariser failure path, max-3 retention (oldest dropped), D-E import once.
- [ ] **Step 2: Implement; L0 snapshot for summarizer v2 and `EPISODE_SUMMARIES_V1`.**
- [ ] **Step 3: Commit** — `feat(ai): synchronous episode compaction with independent structured summaries (BR-LLM-001..004, AC-1342)`

**Verification:** `npx jest --ci src/infra/ai/graph src/infra/ai/prompts src/infra/ai/context`; `npm run evals -- --level L0`.

---

### Task 5: Delete the legacy path; `clear-context`; DI; evals harness

**Files:**
- Delete: `nodes/phase-summary.node.ts`, `handlers/legacy-phase-summary.handler.ts`, `infra/conversation/conversation-context.service.ts` (in-memory), `drizzle-conversation-context.service.ts`, `domain/conversation/ports/conversation-context.ports.ts` (after `ConversationPhase` moved to `phases.ts` in P3); tests
- Modify: `app/routes/chat.routes.ts` (`clear-context` per D-F through a `ConversationRunPort.clearContext(userId)` method — the adapter owns the checkpointer), `main/register-infra-services.ts`, `bootstrap.ts`, `fastify.d.ts`, route integration tests
- Modify: `evals/lib/build-stub-deps.ts` — episode seeding through the checkpointer: the case's `state.messages` (`human`/`ai`/`tool_call`/`tool_result` now all expressible) are written with `graph.updateState` into `messages` before the run (PROMPT_EVAL_FRAMEWORK §4.2 "seeded through the stub context service" → update the doc line in Task 8); `run-case.ts` accordingly

- [ ] **Step 1:** AC-1346 grep as a unit test (`evals/levels/__tests__/legacy-memory-removed.unit.test.ts`).
- [ ] **Step 2:** Implement; `npm run check-all && npm run test:unit`; integration tests green.
- [ ] **Step 3: Commit** — `refactor(conversation): legacy rolling summary and context service removed; clear-context via deleteThread (AC-1346)`

**Verification:** the grep test; `npx jest --ci tests/integration`.

---

### Task 6: One layout for every phase

**Files:**
- Modify: `infra/ai/prompts/index.ts` (`PhaseLayout` deleted; `blocksForLayout` → a fixed block list: `EPISODE_SUMMARIES_V1`, `POST_TOOL_NUDGE_V1`), `phase-spec.ts` (`layout` removed), `assemble-context.ts` (fixed order: system prompt → summaries block (if any) → `messages`; the training `history_frame` and `tool-results` blocks go: ADR §3.4 last paragraph — the anti-"act on past messages" protection is the TR-4 judge criterion), `context/tool-results.ts` deleted, `blocks/{history-frame,summary-frame,tool-results}.v1.ts` deleted (keep in git history for baselines that reference their ids — check `evals/baselines/*/` `promptVersions`; if referenced, keep the files but unregister them)
- Regenerate the message-assembly snapshots once; enumerated diff: every phase → `[system, (summaries), ...messages]`; training loses its two frames; `with-summary` scenarios show the `## Previous episodes` block for all five phases (registration included — one chat).

- [ ] **Step 1:** Update the assembler tests to the single shape; regenerate; paste the diff list here; orchestrator reviews.
- [ ] **Step 2: Commit** — `refactor(ai): one message layout for all phases; training history frame and tool-results block removed (owner rule: one chat)`

**Verification:** `grep -rn "historyMode\|summaryFrame\|toolResultsFrame\|PhaseLayout" apps/server/src` → empty; snapshots green.

---

### Task 7: Docs in code, JSDoc, backlog notes

- [ ] JSDoc on `state.ts` channels (which BR sets each), `compact.ts` (the three rules), `EPISODE_SUMMARIES_V1` (context, not data). Rails still cover the new files (bite proof pasted).
- [ ] **Commit** — `docs(ai): episode memory JSDoc and rails proof`

---

### Task 8: Evals (AC-1344), dev deploy, migration of live threads, docs, close-out (orchestrator)

- [ ] **Step 1: AC-1344** — L1 compare vs `v2` (evidence JSON `…/evidence/refactor-p4-episode-memory-l1-compare.json`); `plan_creation/id-reuse` `no_redundant_search` must improve ≥ +15 pp; others within ±2 pp. L2 judge mean per phase vs `v2` (or the manual rubric run if L2 is not automated yet) — not lower by > 0.2. Rollback condition per the master plan.
- [ ] **Step 2: Deploy to dev** (migration runs in `deploy.sh`); smoke: an existing dev user's first message imports the legacy summary once (D-E — check `episodeSummaries` in the checkpoint), a plan-creation flow (AC-1345 query), a training session, then a forced gap (`EPISODE_GAP_HOURS=0` on dev for one run, or wait) → one `conversation_summaries` row. Paste:

```sql
SELECT kind, count(*) FROM conversation_turns WHERE created_at > now() - interval '2 hours' GROUP BY 1;   -- tool_call/tool_result > 0 (AC-1345)
SELECT user_id, phase_at_end, jsonb_array_length(structured->'topics') FROM conversation_summaries ORDER BY created_at DESC LIMIT 5;
```

- [ ] **Step 3: Docs reconcile** (factual): `ARCHITECTURE.md` tree; `CONTRIBUTING_AI.md` (memory tiers, how to seed an episode in evals); `PROMPT_EVAL_FRAMEWORK.md` §4.2 seeding sentence; `MANUAL_TEST_PLAN.md` gains a "context after a gap" scenario; `BACKLOG.md` ticks (`toFrameRow` twin, `toLangChain` twin, `history_frame` ternary). ADR-0013 amendments to **escalate**: §3.3 (short-episode threshold, compaction flag via the transition handler, summariser v2 without `previousSummary`), §3.2 (`episodeId`, `compactReason` channels), D-14/§10 (`remember_fact` dropped — owner decision), `clear-context` path.
- [ ] **Step 4: Close-out** — `close-out-review`, `- Status: done`, `node scripts/state.mjs --write`, merge; STATE Next → `refactor-p4-context-budget`.

**Verification:** evidence pasted; `node scripts/state.mjs --check` → OK. AC-1341/1342/1344/1345/1346.

## Follow-up (not part of this plan)

- `refactor-p4-context-budget`: INV-LLM-004 enforcement (trim history, reduce domain block depth, drop oldest summary), `PhaseSpec.contextBlocks` + `budget`, AC-1343, checkpoint pruning script (BR-LLM-005).
- P6: fact extraction from `EpisodeSummary.userState` at compaction (idempotent upsert with confirmation counter; `user_facts` table), `## User Facts` block.
- P5: the summariser call counts toward the reply latency budget — measure p95 with compaction on dev before setting `requestTimeout`.
