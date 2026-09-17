# Refactor P3 — PhaseSpec Factory and Shared Agent Node Implementation Plan

- Status: in progress
- Branch: plan/refactor-p3-phase-spec
- After: refactor-p3-tool-executor

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Five hand-written subgraphs become five `PhaseSpec` objects and one `buildPhaseSubgraph(spec)` factory. One shared agent node loads the phase's data, renders its prompt, assembles the context, calls the model, applies the post-tool nudge and the empty-reply retry, and falls back to a catalog message. Adding a phase means adding a spec — the graph builder is not edited (INV-LLM-005). The two remaining per-phase layout deviations scheduled for P3 (`postToolNudge`, `mergeRuns`) disappear.

**Architecture:** ADR-0013 §4.1 (subgraph = `agent → (tools | finalize)`, `finalize` validates the final text and applies the nudge once), §4.2 (`PhaseSpec`), §6 last paragraph (nudge in the shared agent node for all phases; one retry, then the catalog fallback), §3.4 (block order: separate `SystemMessage`s — no run merging). Master plan P3 item 3 (factory half). Owner decisions 2026-09-17: one chat across the app; phases differ only by prompt, tool set and context loaders.

**Tech Stack:** TypeScript, Jest (`--ci`), LangGraph 1.1.5 `StateGraph`/`Annotation`, `@langchain/core` messages, the P2 assembler and prompt registry, the executor and catalog from `refactor-p3-tool-executor`.

**Spec:** `docs/adr/0013-llm-core-target-architecture.md` §3.4, §4.1, §4.2, §6, §11; `docs/LLM_CORE_REFACTOR_PLAN.md` § P3 item 3; `docs/PROMPT_EVAL_FRAMEWORK.md` §4.2.

**Acceptance criteria:** INV-LLM-005 (a unit test adds a sixth spec and the graph gains the node without touching the builder); AC-1334 (L1 within ±2 pp of `v1`; transition datasets ≥ `v1`); the P2 message-assembly snapshots stay the arbiter of what the model receives, with exactly the diff Task 3 enumerates and nothing else.

## Global Constraints

- **Plumbing phase: no prompt wording change.** L0 prompt snapshots untouched. The tool-surface snapshots (`refactor-p3-tool-executor` Task 1) untouched.
- **What the model receives changes in exactly two ADR-sanctioned ways, both enumerated per snapshot in Task 3:** (1) the post-tool nudge now applies to chat and registration too (ADR §6); (2) consecutive system messages are no longer merged (ADR §3.4 lists blocks 1–3 as separate `SystemMessage`s; training already sends three system messages to both providers on dev and prod). Any other snapshot diff is a bug in the factory. The snapshot file is regenerated **once**, in Task 3, and the diff is reviewed line by line by the orchestrator.
- **Layouts are data, not code.** `PhaseLayout` keeps `summaryFrame`, `historyMode`, `toolResultsFrame` (P4 removes them) and loses `postToolNudge`, `mergeRuns`. Nothing in the agent node branches on `spec.name`.
- **`PhaseSpec` is built at the composition root with deps** (`buildPhaseSpecs(deps)`): tools and loaders need repositories; the spec objects are plain data once built.
- **`ConversationGraphDeps` is unchanged** so `evals/lib/build-stub-deps.ts` and `register-infra-services.ts` do not move; `conversation.graph.ts` still owns the parent topology (router/persist/guard/cleanup) — that is `refactor-p3-run-context-commit`.
- **Reserved to the orchestrator:** Task 3 Step 4 (snapshot diff review), Task 5. Verification from `apps/server/`. No attribution lines.

## Decisions taken by this plan (not settled by the durable specs — owner may overrule)

| # | Decision | Alternative rejected | Why |
|---|---|---|---|
| D-A | `PhaseSpec.loadContext(input) → { ok: true, data } \| { ok: false, reply: MessageKey }` returns the phase's render data (what today's `agentNode` loads before `render`), including `lastMessageTime` (chat loads it, the others return `null`) | ADR §4.2's `contextBlocks: ContextBlockLoader[]` now | Block loaders render into block 3 of the assembler — that is P4's assembler (budgets, domain blocks). Until then the phase prompt renders domain data inside block 1, so the loader returns the render context. `lastMessageTime` is per phase because every phase's directive list includes `greeting.v1`, which renders only when it is set; loading it for all phases would add a greeting section to four prompts (a wording change). Marked transitional in the JSDoc; P4 replaces it with `contextBlocks` and state's `lastUserMessageAt`. |
| D-B | The `ok: false` branch of `loadContext` carries training's two guards ("no active session", "session not found") as catalog keys; the agent node replies with `t(reply, lang)` and no model call | Keep the guards in a training-specific pre-node | Guards are phase data availability, which is what the loader knows; the reply is a catalog message like any other (BR-LLM-009). |
| D-C | The agent node loads the **fresh user** for every phase (`userService.getUser`) and passes it to `render` | Chat keeps rendering `state.user` from the router | Four phases already reload the user before each model call (so `save_profile_fields`/`update_profile` results show in the next prompt); chat's stale copy is the odd one out. The message-assembly harness stubs return the same user either way, so no snapshot moves; live behaviour: after `update_profile`, chat's second model call sees the update. |
| D-D | Empty reply after the retry → `AIMessage(t('empty_reply', lang))` | Return the empty message (today: `responseMessage: ''`, no run row written, empty bot reply) | ADR §6 "one retry, then the catalog fallback". New user-facing text in `en`/`ru` for the owner to review. |
| D-E | The agent node does **not** catch exceptions; training's `try/catch` → "Произошла непредвиденная ошибка" is removed | Extend the catch-all to every phase | Today four phases propagate (route → 500 "Processing failed"); training swallows. ADR §6 maps provider errors to 503 in P5 and `refactor-p3-run-context-commit` records failed runs — both need the exception to surface. Until P5 a training provider error becomes a 500 like every other phase's; the bot shows its generic error either way. |
| D-F | `finalize` uses `textOf` from `llm.gateway.ts` for the final text | Keep the inline content-block flattening | BACKLOG "Consolidate the LLM text/mapping helpers when P2/P3 rewrite the subgraphs" — one home. |
| D-G | `modelProfile` is on the spec (`'default'` for all five) and the agent node calls `getModel(spec.modelProfile)` | Omit until a phase needs a profile | `getModel(profile)` exists since P1 (AC-1314); the field costs one line and is what ADR §4.2 lists. Values stay `'default'` — a profile change is config, not this plan. |

---

### Task 1: `PhaseSpec` type and the five specs

**Files:**
- Create: `apps/server/src/infra/ai/graph/phase-spec.ts`
- Create: `apps/server/src/infra/ai/graph/phases/{registration,chat,plan-creation,session-planning,training}.spec.ts`, `phases/index.ts`, `phases/__tests__/phase-specs.unit.test.ts`
- Modify: `apps/server/src/infra/ai/prompts/index.ts` (`PhaseLayout` loses `postToolNudge`, `mergeRuns`; `blocksForLayout` adds `POST_TOOL_NUDGE_V1` for every phase — the registry test's pinned `promptVersions` gains `block.post-tool-nudge: v1` for registration and chat: an explicit, reviewed change)

**Interfaces:**

```typescript
// phase-spec.ts
export interface LoadInput { userId: string; user: User; activeSessionId: string | null }
export type LoadResult<D> = { ok: true; data: D } | { ok: false; reply: MessageKey };
export interface PhaseSpec<D = unknown> {
  name: ConversationPhase;
  prompt: PhasePromptEntry<PromptContextFor<D>>;   // PHASE_PROMPTS[name].entry
  layout: PhaseLayout;                             // PHASE_PROMPTS[name].layout — transitional (P4)
  tools: StructuredToolInterface[];                // phase tools + buildSharedTools(deps)
  toolPolicy: ToolPolicy;
  loadContext: (input: LoadInput, deps) => Promise<LoadResult<D>>;   // D-A; deps captured at build time
  modelProfile: string;                            // 'default'
}
export type AvailabilityInput<D> = { data: D };    // what toolPolicy.availability receives (training reads session)

// phases/index.ts
export function buildPhaseSpecs(deps: ConversationGraphDeps): PhaseSpec[];   // five, in ConversationPhase order
```

Loader contents (moved verbatim from each `agentNode`'s `Promise.all`, minus history/summary/user which the agent node loads for all): registration → `{ lastMessageTime: null }`; chat → `{ hasActivePlan, recentSessions, lastMessageTime }`; plan_creation → `{ lastMessageTime: null }`; session_planning → `{ context: contextBuilder.buildContext(userId), lastMessageTime: null }`; training → `{ session, previousSession, lastMessageTime: null }` with the two guards (`!activeSessionId` → `training_no_active_session`; `!session` → `training_session_not_found`) — both keys added to the catalog with today's English strings verbatim (`'No active training session found. Please start a session first.'`, `'Training session not found. It may have already been completed.'`) plus Russian translations (D-F of the executor plan).

- [x] **Step 1: Tests first** — for each spec: `name`, `tools.map(t => t.name)` equals today's list (including `save_timezone`), `layout` is `PHASE_PROMPTS[name].layout`, `toolPolicy` equals the executor plan's per-phase policy, `loadContext` with stub deps returns the fields listed above; training's two guard branches.
- [x] **Step 2: Implement.** The `ToolPolicy` literals move from the subgraphs into the specs (the subgraphs import them from the spec for one commit; Task 3 deletes the subgraphs).
- [x] **Step 3: Commit** — `feat(ai): PhaseSpec type and the five phase specs (ADR-0013 §4.2)`

**Verification:** `npx jest --ci src/infra/ai/graph/phases src/infra/ai/prompts`; `npm run type-check`.

---

### Task 2: The shared agent and finalize nodes

**Files:**
- Create: `apps/server/src/infra/ai/graph/nodes/agent.node.ts`, `nodes/finalize.node.ts`, `nodes/__tests__/agent.node.unit.test.ts`, `nodes/__tests__/finalize.node.unit.test.ts`
- Modify: `apps/server/src/infra/ai/context/assemble-context.ts` (`assembleContext(input, layout)` — the layout comes from the spec, the registry lookup by phase goes; `mergeMessageRuns` import removed)
- Modify: `apps/server/src/infra/ai/messages/*` (keys `empty_reply`, `training_no_active_session`, `training_session_not_found`)
- Delete (in Task 3): `invoke-with-retry.ts`

Agent node (`buildAgentNode(spec, deps)`), in order:
1. `const [history, previousSummary, user] = await Promise.all([contextService.getMessagesForPrompt(userId, spec.name), spec.layout.summaryFrame ? contextService.getLatestSummary(userId) : null, userService.getUser(userId)])`; `user ?? state.user`.
2. `const loaded = await spec.loadContext({ userId, user, activeSessionId }, deps)`; `!loaded.ok` → `{ messages: [new AIMessage(t(loaded.reply, langOf(user?.languageCode)))] }` (no model call).
3. `systemPrompt = compose(spec.prompt.current.render({ now: new Date(), timezone: user?.timezone ?? null, client: 'telegram', user, ...loaded.data }))`.
4. `available = spec.toolPolicy.availability?.({ data: loaded.data }) ?? null`; `model = getModel(spec.modelProfile).bindTools(available ? spec.tools.filter(t => available.includes(t.name)) : spec.tools)`; the training `debug` line about restricted tools moves here.
5. `assembleContext({ phase, systemPrompt, previousSummary, history, userMessage, inFlight: state.messages ?? [] }, spec.layout)`; `attachBudgetReport(config.metadata?.runId, budgetReport)`.
6. Nudge + retry, moved verbatim from `invokeWithRetry` (same `endsWithToolMessage` test — training's tool-results block is last, so training still gets no nudge on the first call; same placement before the last `ToolMessage`; same `warn` line on retry).
7. Still empty after the retry → `new AIMessage(t('empty_reply', lang))` (D-D).
8. Return `{ messages: [response] }`.

Finalize node: `{ responseMessage: textOf(lastAIMessage), user: (await userService.getUser(userId).catch(() => null)) ?? state.user }` — today's `extractNode` minus the map consumption (already gone). `refactor-p3-run-context-commit` deletes both fields.

- [x] **Step 1: Tests first** (mock `getModel`, stub deps; the recording-model pattern from `evals/snapshots/__tests__/message-assembly.unit.test.ts`): loader refusal → catalog reply, no model call; availability filter reaches `bindTools`; nudge inserted before the last tool message when the array ends with a `ToolMessage`, not when it ends with a system block; empty reply → one retry with the nudge → still empty → `empty_reply` text in the user's language; `attachBudgetReport` called with `metadata.runId`; fresh user passed to `render`.
- [x] **Step 2: Implement.** `assembleContext` signature change: update its unit tests (`src/infra/ai/context/__tests__`) and remove the `mergeRuns` branch; `budgetReport.messages` is now counted on the unmerged array (JSDoc updated).
- [x] **Step 3: Commit** — `feat(ai): shared agent and finalize nodes; nudge and empty-reply fallback for every phase (ADR-0013 §6)`

**Verification:** `npx jest --ci src/infra/ai/graph/nodes src/infra/ai/context src/infra/ai/messages`; `grep -n "mergeMessageRuns" apps/server/src` → empty.

---

### Task 3: `buildPhaseSubgraph`, the graph builds from specs, the subgraph files go

**Files:**
- Create: `apps/server/src/infra/ai/graph/phase-subgraph.factory.ts`, `__tests__/phase-subgraph.factory.unit.test.ts`
- Modify: `apps/server/src/infra/ai/graph/conversation.graph.ts` (`for (const spec of buildPhaseSpecs(deps)) graph.addNode(spec.name, buildPhaseSubgraph(spec, deps)).addEdge(spec.name, 'persist')`; `routerEnds` derived from the specs + `'persist'`)
- Modify: `apps/server/evals/snapshots/__tests__/message-assembly.unit.test.ts` (builds `buildPhaseSubgraph(spec, deps)` per phase instead of `buildXSubgraph`), `evals/fixtures/assembly-scenarios.ts` if imports move
- Delete: the five `subgraphs/*.subgraph.ts` and `subgraphs/__tests__/*` (their behavioural tests are covered by the factory test + agent/finalize/executor tests — list in the commit body which `it`s map where), `invoke-with-retry.ts` + test

Factory: `StateGraph(PhaseSubgraphState)` where `PhaseSubgraphState` = today's common subgraph annotation (messages, userId, user, userMessage, responseMessage, requestedTransition, activeSessionId — one annotation for all five; `refactor-p3-run-context-commit` replaces it with the parent state); nodes `agent`, `tools` (executor), `finalize`; edges `START → agent`, `agent → toolsCondition → (tools | finalize)`, `tools → afterTools → (agent | finalize)`, `finalize → END`.

- [x] **Step 1: Factory test first** — a spec with a fake tool and a mocked model that calls the tool once: the compiled subgraph runs `agent → tools → agent → finalize`, output carries `responseMessage` and the tool's `update`. **INV-LLM-005 test** in `conversation.graph.unit.test.ts`: mock `buildPhaseSpecs` to return the five plus a sixth spec `{ name: 'zzz_test' }` (cast) and assert `graph.getGraph().nodes` has `zzz_test` with an edge to `persist` — no builder change.
- [x] **Step 2: Implement; re-point the message-assembly harness; regenerate its snapshot once** (`npx jest evals/snapshots/__tests__/message-assembly.unit.test.ts` without `--ci`, then `--ci`).
- [x] **Step 3: Enumerate the snapshot diff** in this plan under **Snapshot diff (Task 3)** — expected, and only:
  - `chat / post-tool`, `registration / post-tool`: one new `system` entry (`POST_TOOL_NUDGE_V1` text) inserted immediately before the last `tool` entry.
  - `chat / with-summary`, `plan_creation / with-summary`, `session_planning / with-summary`: the single merged `system` entry becomes two `system` entries (phase prompt; `CONTEXT FROM PREVIOUS CONVERSATION:` frame), contents concatenated equal the old merged content.
  - Every other snapshot (`plain` ×5, `training` ×3, `registration / with-summary`, `plan_creation`/`session_planning` `plain`/`post-tool`): byte-identical. If `git diff` shows anything else — stop; the factory is wrong.
- [x] **Step 4 (orchestrator): review the `.snap` diff** against Step 3 before the executor continues.
- [x] **Step 5: Delete the subgraph files and `invoke-with-retry.ts`; full unit run; `npm run evals -- --level L0`.**
- [x] **Step 6: Commit** — `refactor(ai): buildPhaseSubgraph(spec) replaces the five subgraphs; graph builds from PhaseSpecs (INV-LLM-005)`

**Verification:** `ls apps/server/src/infra/ai/graph/subgraphs` → no such directory; `npx jest --ci evals/snapshots` green with the regenerated file; the INV-LLM-005 `it` passes; `npm run check-all && npm run test:unit`.

---

### Task 4: Docs and rails in code

- [x] **Step 1:** `PhaseLayout` JSDoc: the P3 flags are gone; the remaining three name P4 as their removal. `phase-spec.ts` JSDoc: `loadContext` is transitional (D-A). `CONTRIBUTING_AI.md` pointer table is Task 5's (orchestrator) — do not edit docs here.
- [x] **Step 2:** `no-inline-prompts` grep list still covers `src/infra/ai/graph/**` (the new `nodes/` and `phases/` are under it) — assert by adding a temporary literal in `phases/chat.spec.ts`, paste the lint error, remove it.
- [x] **Step 3: Commit** — `docs(ai): JSDoc for the transitional PhaseSpec fields; rails bite proof`

**Verification:** pasted bite; `npm run lint`.

---

### Task 5: L1 compare, dev deploy, docs reconcile, close-out (orchestrator)

- [ ] **Step 1: AC-1334** — `RUN_LLM_EVALS=1 npm run evals -- --level L1 --phase all --samples 3 --baseline compare --baseline-version v1`; evidence JSON at `docs/superpowers/plans/evidence/refactor-p3-phase-spec-l1-compare.json`; per-dataset table pasted here. Chat/registration now carry the nudge — watch `registration/no-premature-complete` and `chat/no-set-logging` in particular; a regression > 2 pp after one re-run is the rollback trigger (revert the nudge unification only, keep the factory).
- [ ] **Step 2: Deploy to dev** and smoke all five phases (registration on a fresh user; chat → session_planning → training on the owner's dev user); one run per phase must show `budget_report` and `model` on its row (the P2 query).
- [ ] **Step 3: Docs reconcile** (factual bucket): `docs/ARCHITECTURE.md` tree (`phase-subgraph.factory.ts`, `phases/`, `nodes/agent.node.ts`, `nodes/finalize.node.ts`; `subgraphs/` and `invoke-with-retry.ts` gone); `docs/CONTRIBUTING_AI.md` ("adding a phase = a `PhaseSpec` + prompt module + tools + a matrix row"); `docs/BACKLOG.md` ticks: "Consolidate the LLM text/mapping helpers" (`textOf` half), the P2 advisories on `postToolNudge` dead weight and the `history_frame` double ternary if touched. ADR-0013 §4.2 `contextBlocks` vs D-A and §4.1 `finalize` wording → **escalate** as amendment text for the owner.
- [ ] **Step 4: Close-out** — `close-out-review`, checkboxes closed with results (snapshot diff list, INV-LLM-005 test name, L1 table, dev evidence), `- Status: done`, `node scripts/state.mjs --write`, commit, merge, worktree removed; STATE Next → `refactor-p3-run-context-commit`.

**Verification:** evidence pasted; `node scripts/state.mjs --check` → OK. INV-LLM-005, AC-1334 (this plan's slice).

## Follow-up (not part of this plan)

- `refactor-p3-run-context-commit`: subgraph state = parent state; `finalize` stops returning `responseMessage`/`user`; `userId`, `runId`, `user` from run context; `attachBudgetReport` → the run's metrics collector.
- P4: `loadContext` → `contextBlocks`, `PhaseSpec.budget`, `lastUserMessageAt` from state, the three remaining layout flags removed.

## Snapshot diff (Task 3)

Observed in `evals/snapshots/__tests__/__snapshots__/message-assembly.unit.test.ts.snap` after the
single regeneration (Task 3 Step 2, `jest -u` once, then `--ci` green: 16/16 tests, 43/43 snapshots
across `evals/snapshots`). Exactly five snapshots changed; every other key is byte-identical.

1. `chat / post-tool` and `registration / post-tool` — one new `system` entry inserted immediately
   before the last `tool` entry, with the `POST_TOOL_NUDGE_V1` text
   ("IMPORTANT: All tool calls are complete. You MUST now write a natural text response to the user.
   Do NOT call any more tools."). Diff hunks: `@@ -180` (chat) and `@@ -831` (registration).
2. `chat / with-summary`, `plan_creation / with-summary`, `session_planning / with-summary` — the
   single merged `system` entry becomes two `system` entries (phase prompt; `CONTEXT FROM PREVIOUS
   CONVERSATION:` frame). `mergeMessageRuns` joined the two with `"\n"`, so old content equals
   entry 1 + `"\n"` + entry 2 byte-for-byte. Diff hunks: `@@ -257` (chat), `@@ -635` (plan_creation),
   `@@ -1391` (session_planning).

Byte-identical (unchanged): `plain` × 5, `training` × 3, `registration / with-summary`,
`plan_creation / post-tool`, `session_planning / post-tool`. This matches the plan's Global
Constraints list exactly — no other diffs observed.

Harness note: `evals/snapshots/__tests__/message-assembly.unit.test.ts` now builds
`buildPhaseSubgraph(spec, deps)` per phase from `buildPhaseSpecs(deps)` (header comment updated to
record the one regeneration); no fixture changes were needed.
