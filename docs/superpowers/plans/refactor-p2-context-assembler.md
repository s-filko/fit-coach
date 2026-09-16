# Refactor P2 — Context Assembler Implementation Plan

- Status: in progress
- Branch: plan/refactor-p2-context-assembler
- After: refactor-p2-prompt-modules

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One function builds the message array every phase sends to the model, in exactly today's order per phase, and reports how many estimated tokens each part of that array costs. The report lands on every recorded run (`conversation_runs.budget_report`) and in the run's info log line. Nothing the model sees changes by a single byte.

**Architecture:** ADR-0013 §3.4 (D-03) describes the target assembler: `assembleContext(...) → { messages, budgetReport }` in `infra/ai/context/`, fixed block order, per-phase budget, trimming. This plan builds the **reporting half** of it, as master plan P2 item 3 prescribes: the assembler reports, it does not trim. Per-phase *layout* (does the phase inject the previous summary; is history interleaved or a system block; is there a tool-results block; is the post-tool nudge applied; are message runs merged) moves from five hand-written `agentNode`s into one declarative `PhaseLayout` on the prompt registry, replacing the transitional `blocks` arrays P2 left there. The five `agentNode`s keep loading their data and rendering their system prompt as today, then hand everything to the assembler. The token estimator moves from `evals/lib/` into `src/infra/ai/context/` so the app and the eval stack share one implementation (master plan P2 item 3: "single implementation, unit-tested"). The `budgetReport` travels to the persist node through the existing P0 run-metrics accumulator (keyed by `runId`, drained at persist) — the same temporary home the tokens and model name use until P3's `commit` node and run context replace it.

**Why an arbiter comes first:** the five subgraphs differ in small ways that are easy to flatten by accident — registration never loads the summary, training frames history as one system block and appends a tool-results block, four phases run `mergeMessageRuns` and training does not, three phases use `invokeWithRetry` and two call the model directly. Task 1 captures what the model *actually receives* from each subgraph today, through a recording model, before any assembly code exists. Those snapshots are the AC for the wiring: they are never regenerated in this plan.

**Tech Stack:** TypeScript, Jest snapshots (`--ci`), `@langchain/core` messages, the existing `evals/` tree (stub world, fixtures), ESLint `no-restricted-syntax`, Drizzle (column already exists — no migration).

**Spec:** `docs/adr/0013-llm-core-target-architecture.md` §3.4 (D-03, INV-LLM-004), §8 (run row), §11 (layout). Master plan: `docs/LLM_CORE_REFACTOR_PLAN.md` § P2 scope item 3 and Notes (measure the session-planning system prompt size). Eval spec: `docs/PROMPT_EVAL_FRAMEWORK.md` §4.2 ("Collect: … `budgetReport`").

**Acceptance criteria:** AC-1323 (`budgetReport` logged for 100% of runs; `SELECT phase_in, avg((budget_report->>'total')::int) FROM conversation_runs GROUP BY 1` returns numbers for all phases after a manual smoke test on dev). Regression guard from the phase: AC-1322 re-run (L1 pass rates within ±2 pp of the `v0` baseline, n=3) — the phase's rollback condition names it. Plus the byte-identity arbiter of this plan: the Task 1 message-assembly snapshots stay green through Task 5.

## Global Constraints

- **Zero behaviour change.** The message array each phase sends to the model is byte-identical to today's, including message types, order, merge behaviour and the post-tool nudge placement. Task 1's snapshots are captured from the **old** subgraphs and are never regenerated in this plan; Jest runs with `--ci`. A failing snapshot is a bug in the wiring, never a reason to update the snapshot.
- **No trimming, no budgets, no reordering.** The assembler counts and reports. ADR-0013 §3.4's budget table and INV-LLM-004's over-budget resolution are P4. A `budget` field does not exist in this plan's report.
- **The assembler is pure** (same discipline as BR-LLM-007 for prompts): no I/O, no `new Date()`, no `Date.now()`, no config reads, no logging. The subgraph loads data and renders the system prompt as today; the assembler receives strings and messages and returns messages and numbers. `grep -rn "new Date()\|Date.now()" apps/server/src/infra/ai/context` → empty.
- **`domain/**` gets a type, not a dependency.** `BudgetReport` is declared next to `ConversationRunRecord` in `domain/conversation/ports/conversation-run.ports.ts` (the port carries it). No `@langchain/*` import enters `domain/` (ESLint boundary).
- **No schema change.** `conversation_runs.budget_report jsonb` exists since migration `0002_conversation_runs.sql`; this plan maps it, nothing more. `drizzle-kit generate` must produce no new migration (verify: `git status apps/server/drizzle` clean after the plan).
- **`runId` reaches the assembler call site via `config.metadata.runId`** — the same channel the LLM callback handler uses (`llm-log-handler.ts`); `configurable` is stripped before callbacks and is not used for this. Reading from `metadata` keeps one channel.
- **Runs that never reach a phase agent have no report.** The router short-circuits two cases straight to `persist` with a canned reply (`router.node.ts`: session ended; training without a session). Those runs record `budget_report = NULL` and `model = 'unknown'` — there was no assembly and no model call. AC-1323's "100% of runs" is read as 100% of runs that invoked a phase agent; the verification query in Task 8 checks exactly that (`budget_report IS NULL AND model <> 'unknown'` → 0 rows).
- **The post-tool nudge is not part of the report.** `invokeWithRetry` inserts `POST_TOOL_NUDGE_V1` after assembly; it stays there (P3 moves it into the shared agent node). Its ~40 tokens are outside `budgetReport`; the report's `messages` count is taken before the nudge. Documented in the `BudgetReport` JSDoc so nobody "fixes" the discrepancy.
- Verification commands run from `apps/server/`. Commit messages carry no attribution lines.

## Decisions taken by this plan (not settled by the durable specs — owner may overrule)

| # | Decision | Alternative rejected | Why |
|---|---|---|---|
| D-A | `budgetReport` reaches `persist` via the run-metrics accumulator (`attachBudgetReport(runId, report)`; drained with tokens/model) | A `budgetReport` channel on `ConversationState` + every subgraph state | D-04 is moving data *out* of durable state; a checkpointed report would also leak into the next run's short-circuit persist. The accumulator is already the sanctioned temporary home (P0) and P3 replaces both at once. |
| D-B | Multi-call runs (tool loops assemble 2–3 times) record the **last** assembly's report plus `assemblies: n` | Max-of-calls; sum-of-calls | The last assembly is the largest context of the run (in-flight grows monotonically); `assemblies` lets a query separate single-call from loop runs. Sum would double-count the system prompt. |
| D-C | The assembler takes the **rendered** system prompt string, not the phase module | Assembler renders the module itself from a `PhaseSpec` | `PhaseSpec` (data loaders, per-phase render context) is P3. Rendering stays in the subgraph where the data is; the assembler owns *order and accounting*. This is what item 3 asks for ("calls the assembler instead of hand-building messages"). |
| D-D | `PhaseLayout` on the registry replaces the `blocks` arrays; the block list for `promptVersions` is derived from the layout | Keep `blocks` and add `layout` beside it | P2 review advisory (BACKLOG, "Registry `blocks` arrays must not survive AC-1323"): two sources of truth for what a phase injects. The existing registry test pins the derived `promptVersions`, so the derivation is verified byte-for-byte. **`PhaseLayout` is transitional.** Owner rule (2026-09-17, `STATE.md` memory-model decisions): one chat across the app; phases differ only by prompt, tools and context loaders. Every layout flag is a deviation from that rule with a scheduled removal: `postToolNudge` and `mergeRuns` → P3 (shared agent node); `historyMode`, `summaryFrame`, `toolResultsFrame` → P4 (messages channel, episode summaries). The JSDoc on `PhaseLayout` must say this. |
| D-E | `buildToolResultsInjection` moves from `training.subgraph.ts` to `infra/ai/context/tool-results.ts` | Leave it in the subgraph and pass the rendered string in | The tool-results block is a *position* in the array (after in-flight), i.e. the assembler's business. The helper keeps importing the error prefixes from `graph/tools/training.tools.ts`; P3's `ToolOutcome` removes that import. |

---

### Task 1: Freeze what the model receives — recording-model harness and pre-wiring snapshots

Nothing is refactored until the snapshot suite exists against the **old** subgraphs. The harness mocks `getModel` with a recorder that returns a plain `AIMessage` (no tool calls, so every subgraph runs `agent → extract → END` once) and stores the exact `BaseMessage[]` it was invoked with. Fake timers pin `new Date()` inside the old `agentNode`s to `FIXED_NOW`.

**Files:**
- Create: `apps/server/evals/fixtures/assembly-scenarios.ts`
- Create: `apps/server/evals/snapshots/__tests__/message-assembly.unit.test.ts`
- Create: `apps/server/evals/snapshots/__tests__/__snapshots__/message-assembly.unit.test.ts.snap` (generated once, then frozen)

**Interfaces:**
- Produces:

```typescript
// evals/fixtures/assembly-scenarios.ts
export const IN_FLIGHT_POST_TOOL: BaseMessage[];   // AIMessage(tool_calls: [save_timezone, log_set]) + ToolMessage(ok) + ToolMessage(status:'error', LLM_ERROR-prefixed)
export type AssemblyScenario = 'plain' | 'with-summary' | 'post-tool';
export const ASSEMBLY_SCENARIOS: readonly AssemblyScenario[];
export function serializeForSnapshot(messages: BaseMessage[]): Array<{ type: string; content: unknown; tool_calls?: unknown; tool_call_id?: string; status?: string }>;
```

- [x] **Step 1: Write the scenario fixtures**

`IN_FLIGHT_POST_TOOL` uses hand-written content (BR-EVAL-003). The error `ToolMessage` content starts with `LLM_ERROR_PREFIX` from `@infra/ai/graph/tools/training.tools` so training's `buildToolResultsInjection` exercises its `ok: false` branch — exactly one error, so training's `LLM_ERROR_RETRY_BUDGET` (1) is **not** exceeded and the model is still invoked. `serializeForSnapshot` maps each message to `{ type: m._getType(), content: m.content }` plus `tool_calls` (AI messages with calls), `tool_call_id` and `status` (tool messages) — enough to make any reorder, merge or content drift visible.

- [x] **Step 2: Write the harness test**

`message-assembly.unit.test.ts`:

```typescript
/**
 * Pre-wiring truth for refactor-p2-context-assembler. Captured from the OLD
 * subgraph agentNodes before infra/ai/context existed; never regenerated in
 * that plan. What the model receives is the arbiter of "no behaviour change".
 */
import { AIMessage, type BaseMessage } from '@langchain/core/messages';

jest.mock('@infra/ai/model.factory', () => {
  const recorded: BaseMessage[][] = [];
  const model = {
    bindTools: () => model,
    invoke: async (messages: BaseMessage[]) => {
      recorded.push(messages);
      return new AIMessage({ content: 'ok', tool_calls: [] });
    },
  };
  return { getModel: () => model, __recorded: recorded };
});
```

For each phase build the subgraph with `buildStubDeps(fixture, FIXTURE_HISTORY-as-messages)` mapped to the subgraph's dep names exactly as `conversation.graph.ts` does (`workoutPlanRepo` vs `workoutPlanRepository`, etc.). Fixtures: registration → `EMPTY_PROFILE`; chat, plan_creation, session_planning → `COMPLETE_PROFILE`; training → `ACTIVE_SESSION` (input `activeSessionId: 'session-1'`). Scenario overrides:
- `with-summary`: `contextService.getLatestSummary` resolves `FIXTURE_SUMMARY`.
- `post-tool`: subgraph input `messages: IN_FLIGHT_POST_TOOL`.

Invoke each subgraph with `{ userId, userMessage: 'Привет, что сегодня?', user, ...scenario input }` and config `{ configurable: { thread_id, userId }, metadata: { runId: 'run-snap', userId }, recursionLimit: 10 }`. Assert exactly one recorded invocation per scenario, then `expect(serializeForSnapshot(recorded[0])).toMatchSnapshot()`. Test names: `` `${phase} / ${scenario}` ``. `beforeAll: jest.useFakeTimers({ now: FIXED_NOW })`, `afterAll: useRealTimers`. Import `FIXED_NOW`, `FIXTURE_HISTORY`, `FIXTURE_SUMMARY` from `../../fixtures/prompt-contexts`. `buildStubDeps` takes history as `{ role, text }` — adapt `FIXTURE_HISTORY` (`{ role, content }`) inline.

Expected: 15 snapshots (5 phases × 3 scenarios). Registration's `with-summary` snapshot must equal its `plain` snapshot (registration ignores the summary) — assert that explicitly in one extra `it`, it is the cheapest proof the harness sees real differences.

- [x] **Step 3: Generate and freeze**

Run `npx jest evals/snapshots/__tests__/message-assembly.unit.test.ts` once **without** `--ci` to write the `.snap`, then `npx jest --ci evals/snapshots` to prove it is stable. Open the `.snap` and eyeball: training's `post-tool` snapshot ends with a `system` message starting `=== TOOL EXECUTION RESULTS ===` preceded by a `system` nudge (`IMPORTANT: All tool calls are complete`) inserted **before the last tool message** (that is `invokeWithRetry`'s placement); chat's `with-summary` has two consecutive system messages merged into one by `mergeMessageRuns` (one `system` entry whose content contains both the prompt and `CONTEXT FROM PREVIOUS CONVERSATION:`); training's `with-summary` has them **unmerged** (two `system` entries). If any of these three is not what the snapshot shows, the harness is wrong — fix the harness, not the expectation.

> **Task 1 result (2026-09-17):** 15 snapshots written, `--ci` stable (39 tests / 38 snapshots in `evals/snapshots` green). Eyeball checks: chat `with-summary` merged (one `system` containing prompt + `CONTEXT FROM PREVIOUS CONVERSATION:`) ✓; training `with-summary` unmerged (prompt / summary frame / history frame as three separate `system` entries) ✓; training `post-tool` — **no nudge, and this is today's real behaviour**, not a harness bug: training appends the tool-results `SystemMessage` *after* the in-flight messages, so `invokeWithRetry`'s `endsWithToolMessage` (last message of the array) sees a system message and skips the nudge. The nudge-before-last-tool placement is observable in the plan_creation / session_planning `post-tool` snapshots (`system > human > ai > tool > system > tool`). Task 5 must reproduce exactly this.

- [x] **Step 4: Commit**

`test(evals): freeze per-phase message assembly before the context assembler (15 snapshots)`

**Verification:** `npx jest --ci evals/snapshots` → 15 new snapshots + 23 existing, all passing; `git show --stat HEAD` lists the `.snap` file. AC: this plan's byte-identity arbiter.

---

### Task 2: One token estimator, in `src`

**Files:**
- Create: `apps/server/src/infra/ai/context/token-estimator.ts` (moved from `evals/lib/token-estimator.ts`, verbatim formula)
- Create: `apps/server/src/infra/ai/context/__tests__/token-estimator.unit.test.ts` (moved from `evals/lib/__tests__/`)
- Delete: `apps/server/evals/lib/token-estimator.ts`, `apps/server/evals/lib/__tests__/token-estimator.unit.test.ts`
- Modify: every importer under `evals/` (`grep -rn "token-estimator" evals src` — at least `evals/levels/l0.ts`) → `@infra/ai/context/token-estimator`

**Interfaces:**
- Produces (unchanged signature, new home):

```typescript
export const TOKEN_ESTIMATOR_ID = 'chars4x1.15';   // stamped into every BudgetReport
export function estimateTokens(text: string): number;
```

- [x] **Step 1: Move the file and its test; add `TOKEN_ESTIMATOR_ID`**

Update the header comment: it is now the single implementation the assembler and the eval stack share (drop "from P2 … keep the two in step" — there is one). Add one test: `TOKEN_ESTIMATOR_ID` equals `'chars4x1.15'` (a report row must say which formula produced it; changing the formula means changing the id).

- [x] **Step 2: Repoint importers and delete the old copy**

`grep -rn "lib/token-estimator" evals src` → empty after the change.

- [x] **Step 3: Commit**

`refactor(ai): move the token estimator into src/infra/ai/context (single implementation)`

> **Task 2 result (2026-09-17):** estimator + test moved verbatim to `src/infra/ai/context/`, header rewritten (one implementation, no "keep the two in step"), `TOKEN_ESTIMATOR_ID = 'chars4x1.15'` added with its own test. `l0.ts` repointed to `@infra/ai/context/token-estimator`; old files deleted; `grep -rn "lib/token-estimator" evals src` → empty. Verification: `npm run type-check` clean; `npx jest --ci evals src/infra/ai/context` → 13 suites / 103 tests green; `npx jest --ci evals/snapshots` → 39 tests / 38 snapshots green; `npm run evals -- --level L0` → 120/120 before and after the move.

**Verification:** `npm run type-check`; `npx jest --ci evals src/infra/ai/context`; `npm run evals -- --level L0` still reports the same check count as before the move (L0 uses the estimator for `within-token-budget`). AC: master plan P2 item 3 ("single implementation, unit-tested").

---

### Task 3: The report's shape and its way home — domain type, run record, run-metrics, persist

**Files:**
- Modify: `apps/server/src/domain/conversation/ports/conversation-run.ports.ts` (add `BudgetReport`; `ConversationRunRecord.budgetReport`)
- Modify: `apps/server/src/domain/conversation/ports/index.ts` (export the type, if the barrel is explicit)
- Modify: `apps/server/src/infra/conversation/drizzle-conversation-run.service.ts` (map `budgetReport`)
- Modify: `apps/server/src/infra/ai/run-metrics.ts` (`attachBudgetReport`, `RunMetrics.budgetReport`, `RunMetrics.assemblies`)
- Modify: `apps/server/src/infra/ai/graph/nodes/persist.node.ts` (record + log)
- Modify: `apps/server/evals/lib/build-stub-deps.ts` — no change needed (`recordRun` stores the whole record)
- Tests: `apps/server/src/infra/ai/__tests__/run-metrics.unit.test.ts`, `apps/server/src/infra/ai/graph/nodes/__tests__/persist.node.unit.test.ts`, `apps/server/src/infra/conversation/__tests__/…run.service…` (extend whichever exists; if none tests the Drizzle mapping, add the assertion to the schema test `infra/db/__tests__/conversation-runs.schema.unit.test.ts` that `budgetReport` is a mapped column — it already lists it)

**Interfaces:**
- Produces:

```typescript
// domain/conversation/ports/conversation-run.ports.ts
/**
 * Estimated-token accounting of one context assembly (ADR-0013 §3.4, reporting half).
 * Numbers are estimator output (see `estimator`), not provider counts — compare with
 * `tokensIn` to calibrate. The post-tool nudge is inserted after assembly and is not
 * counted. P2 reports only; budgets and trimming arrive in P4.
 */
export interface BudgetReport {
  estimator: string;        // TOKEN_ESTIMATOR_ID
  system: number;           // block 1: the rendered phase prompt (domain data is inside it until P3)
  summary: number;          // previous-summary frame, 0 when absent or not in the phase layout
  history: number;          // interleaved turns, or the history_frame block (training)
  user: number;             // the current human message
  inFlight: number;         // this run's AI tool-call messages and tool results
  toolResults: number;      // training's tool-results block, 0 elsewhere
  total: number;            // sum of the six above
  messages: number;         // messages in the array handed to the model (after mergeMessageRuns, before the nudge)
  historyTurns: number;     // history messages loaded from the transcript
  assemblies?: number;      // filled at persist: how many assemblies this run made (tool loops)
}

export interface ConversationRunRecord {
  // …existing fields…
  budgetReport: BudgetReport | null;
}

// infra/ai/run-metrics.ts
export function attachBudgetReport(runId: string, report: BudgetReport): void;   // last one wins; increments assemblies
export interface RunMetrics { …; budgetReport: BudgetReport | null; assemblies: number }
```

- [x] **Step 1: Failing tests first**

`run-metrics.unit.test.ts`: (a) `attachBudgetReport` on an unknown runId opens the run (same as `startLlmCall` does) so evals — which never call `startRun` — still get a report; (b) two attaches → drain returns the second report with `assemblies: 2`; (c) drain without attach → `budgetReport: null, assemblies: 0`; (d) empty runId is a no-op.
`persist.node.unit.test.ts`: after `attachBudgetReport('run-1', report)`, `recordRun` receives `budgetReport` equal to the report **with `assemblies` set** (persist merges `metrics.assemblies` into the report it records); without an attach, `budgetReport: null`. The existing "records exactly one run row" test keeps passing.

- [x] **Step 2: Implement**

`persist.node.ts` records `budgetReport: metrics.budgetReport ? { ...metrics.budgetReport, assemblies: metrics.assemblies } : null` and adds `budgetReport` to the `'Conversation run recorded'` info line (numbers only — nothing from LOGGING_GUIDE's forbidden list). `drizzle-conversation-run.service.ts` maps `budgetReport: record.budgetReport`.

- [x] **Step 3: Commit**

`feat(runs): budgetReport on ConversationRunRecord, run-metrics and the persist node (AC-1323 plumbing)`

> **Task 3 result (2026-09-17):** `BudgetReport` declared next to `ConversationRunRecord` in the ports file (barrel is `export *`, no change needed); `ConversationRunRecord.budgetReport: BudgetReport | null` is required, so the two test-side record literals gained the field (`conversation-run.service.unit.test.ts` also asserts the drizzle mapping and a `null` pass-through; `build-stub-deps.unit.test.ts` got `budgetReport: null`). New tests: 4 in `run-metrics.unit.test.ts` (open-on-unknown-runId, last-attach-wins + `assemblies: 2`, drain-without-attach, empty-runId no-op) and 2 in `persist.node.unit.test.ts` (report recorded with `assemblies` merged in on a dedicated `runId` so no state leaks across tests; `null` without an attach). TDD confirmed: suites failed before the implementation. Verification: the plan's jest command → 7 suites / 43 tests green; `npm run type-check` clean; `npm run lint` → 0 errors (403 pre-existing warnings); `npx jest --ci evals/snapshots` → 39 tests / 38 snapshots green; `git status apps/server/drizzle` clean (no new migration). Full pre-commit hook suite: 56 suites / 418 tests green. The Drizzle-mapping assertion went to the existing `conversation-run.service.unit.test.ts` (the schema test already listed `budgetReport` as a column, as the plan expected).

**Verification:** `npx jest --ci src/infra/ai/__tests__/run-metrics.unit.test.ts src/infra/ai/graph/nodes src/infra/db`; `npm run type-check`; `npm run lint`. AC-1323 (the storage and log half).

---

### Task 4: The assembler and the phase layouts

**Files:**
- Create: `apps/server/src/infra/ai/context/assemble-context.ts`
- Create: `apps/server/src/infra/ai/context/tool-results.ts` (moved `buildToolResultsInjection`, renamed `renderToolResults`)
- Create: `apps/server/src/infra/ai/context/__tests__/assemble-context.unit.test.ts`
- Modify: `apps/server/src/infra/ai/prompts/index.ts` (`PhaseLayout` replaces `blocks`; `blocksForLayout`)
- Modify: `apps/server/src/infra/ai/prompts/__tests__/registry.unit.test.ts` (pin the layouts; the `promptVersionsForPhase` assertions stay **unchanged** — they are the arbiter of D-D)
- Modify: `apps/server/src/infra/ai/graph/subgraphs/training.subgraph.ts` (remove the moved helper only — wiring is Task 5), any importer of `buildToolResultsInjection` (`grep -rn buildToolResultsInjection src evals`)

**Interfaces:**
- Produces:

```typescript
// prompts/index.ts
export interface PhaseLayout {
  summaryFrame: boolean;                          // registration: false, others: true
  historyMode: 'interleaved' | 'history_frame';   // training: 'history_frame'
  toolResultsFrame: boolean;                      // training only
  postToolNudge: boolean;                         // false for chat/registration (model.invoke), true where invokeWithRetry is used
  mergeRuns: boolean;                             // training: false, others: true
}
export interface PhaseRegistryEntry { entry: PhasePromptEntry<unknown>; layout: PhaseLayout }
export function blocksForLayout(layout: PhaseLayout): readonly PromptModule<unknown>[];   // summary_frame, history_frame, tool_results, post_tool_nudge — in this order, matching today's `blocks` arrays exactly
export function promptVersionsForPhase(phase: ConversationPhase): Record<string, string>; // unchanged output

// context/assemble-context.ts
export interface AssembleInput {
  phase: ConversationPhase;
  systemPrompt: string;                 // compose(PHASE.current.render(ctx)) — rendered by the caller
  previousSummary?: string | null;      // ignored when layout.summaryFrame is false
  history: ChatMsg[];                   // contextService.getMessagesForPrompt(...)
  userMessage: string;
  inFlight: BaseMessage[];              // state.messages ?? []
}
export interface AssembledContext { messages: BaseMessage[]; budgetReport: BudgetReport }
export function assembleContext(input: AssembleInput): AssembledContext;   // pure
```

- [x] **Step 1: Failing tests first — one per layout rule**

`assemble-context.unit.test.ts` (describe names carry `ADR-0013 §3.4 / AC-1323`):
1. `chat, no summary, empty history` → `[system, human]`; report `summary: 0`, `historyTurns: 0`, `messages: 2`.
2. `chat, with summary` → two system messages merged into **one** (`mergeRuns`), content = prompt + `\n` + summary frame (whatever `mergeMessageRuns` produces — assert by calling `mergeMessageRuns` on the expected pair, do not hand-write the join); report `summary > 0`.
3. `registration, with summary` → summary ignored (`summary: 0`, no frame text in any message).
4. `training, with history` → history is **one** `SystemMessage` starting `=== CONVERSATION HISTORY`; not merged with the prompt (`mergeRuns: false` → two system messages).
5. `training, post-tool in-flight` (`IN_FLIGHT_POST_TOOL` from Task 1's fixtures) → array ends with the tool-results system block; `toolResults > 0`, `inFlight > 0`.
6. `chat, post-tool in-flight` → **no** tool-results block; in-flight messages appended after the human message.
7. `total` equals the sum of the six parts for every case above (one loop).
8. `estimator` is `TOKEN_ESTIMATOR_ID`; `messages` counts the returned array's length.
9. Purity: the same input twice gives deep-equal output; the function does not touch `Date` (`jest.spyOn(global, 'Date')` not called — or simply the grep rail in Task 6).

- [x] **Step 2: Implement the assembler**

Order is fixed and identical to today's five `agentNode`s:

```typescript
const layout = PHASE_PROMPTS[input.phase].layout;
const system = [new SystemMessage(input.systemPrompt)];
const summary = layout.summaryFrame && input.previousSummary
  ? [new SystemMessage(renderBlock(SUMMARY_FRAME_V1, { previousSummary: input.previousSummary }))] : [];
const history = layout.historyMode === 'interleaved'
  ? input.history.map(m => (m.role === 'user' ? new HumanMessage(m.content) : new AIMessage(m.content)))
  : [new SystemMessage(renderBlock(HISTORY_FRAME_V1, { history: input.history.map(toFrameRow) }))];   // rendered even when empty — "No prior conversation." is today's text
const user = [new HumanMessage(input.userMessage)];
const inFlight = [...input.inFlight];
const toolMessages = inFlight.filter((m): m is ToolMessage => m instanceof ToolMessage);
const toolResults = layout.toolResultsFrame && toolMessages.length > 0
  ? [new SystemMessage(renderToolResults(toolMessages))] : [];
const ordered = [...system, ...summary, ...history, ...user, ...inFlight, ...toolResults];
const messages = layout.mergeRuns ? mergeMessageRuns(ordered) : ordered;
```

Report: `estimateTokens` over each part's text **before** merging (`messageText(m)` = string content as is, array content `JSON.stringify`ed, plus `JSON.stringify(tool_calls)` for AI messages that carry calls); `messages: messages.length`; `historyTurns: input.history.length`. `toFrameRow` is the role-narrowing lambda from today's `training.subgraph.ts:378` — it now has exactly one home here (the same lambda in `phase-summary.node.ts:34` is the summariser's own input mapping and stays; the BACKLOG duplication note is closed for the assembly side only — say so in the close-out).

- [x] **Step 3: Move `buildToolResultsInjection` → `context/tool-results.ts` as `renderToolResults`**

Same body; imports `LLM_ERROR_PREFIX`/`SYSTEM_ERROR_PREFIX` from `@infra/ai/graph/tools/training.tools` and `TOOL_RESULTS_V1`/`renderBlock` from the prompts tree. Remove it from `training.subgraph.ts`; repoint any importer. `grep -rn buildToolResultsInjection src evals` → empty.

- [x] **Step 4: Registry — `layout` replaces `blocks`**

```typescript
export const PHASE_PROMPTS: Record<ConversationPhase, PhaseRegistryEntry> = {
  registration:     { entry: …, layout: { summaryFrame: false, historyMode: 'interleaved',   toolResultsFrame: false, postToolNudge: false, mergeRuns: true  } },
  chat:             { entry: …, layout: { summaryFrame: true,  historyMode: 'interleaved',   toolResultsFrame: false, postToolNudge: false, mergeRuns: true  } },
  plan_creation:    { entry: …, layout: { summaryFrame: true,  historyMode: 'interleaved',   toolResultsFrame: false, postToolNudge: true,  mergeRuns: true  } },
  session_planning: { entry: …, layout: { summaryFrame: true,  historyMode: 'interleaved',   toolResultsFrame: false, postToolNudge: true,  mergeRuns: true  } },
  training:         { entry: …, layout: { summaryFrame: true,  historyMode: 'history_frame', toolResultsFrame: true,  postToolNudge: true,  mergeRuns: false } },
};
```

`blocksForLayout` returns, in order: `SUMMARY_FRAME_V1` if `summaryFrame`, `HISTORY_FRAME_V1` if `history_frame`, `TOOL_RESULTS_V1` if `toolResultsFrame`, `POST_TOOL_NUDGE_V1` if `postToolNudge`. That reproduces today's five `blocks` arrays exactly (compare with the current file before deleting them). `promptVersionsForPhase` uses it. `evals/levels/l0.ts` reads `PHASE_PROMPTS[...].entry` and `STANDALONE_PROMPTS` only — confirm with `grep -n "blocks" evals/levels/l0.ts` → empty; if it does read `blocks`, switch it to `blocksForLayout(layout)`.

Registry test additions: a table test that `blocksForLayout(PHASE_PROMPTS[p].layout).map(b => b.id)` equals the five arrays as they are today (write the expected arrays literally, from the pre-change file). Keep every existing assertion untouched.

- [x] **Step 5: Commit**

`feat(ai): context assembler with per-phase layouts and budgetReport (ADR-0013 §3.4, reporting half)`

> **Task 4 result (2026-09-17):** TDD confirmed — both new suites failed before the implementation (missing modules/exports). `assembleContext` implemented in `src/infra/ai/context/assemble-context.ts` (pure; fixed order per the plan's snippet; report estimated per part before merging, `messages` counted after `mergeMessageRuns`, before the nudge); `renderToolResults` moved verbatim to `src/infra/ai/context/tool-results.ts` (still imports the error prefixes from `graph/tools/training.tools`, P3 removes that); registry: `blocks` → `layout: PhaseLayout` with the D-D transitional JSDoc, `blocksForLayout` derives the block list, `promptVersionsForPhase` uses it — its existing test assertions untouched and green (the D-D arbiter). `training.subgraph.ts` imports `renderToolResults` from the new home and calls it in place; no wiring beyond that (Task 5). The evals fixture comment that named the old helper was updated so `grep -rn buildToolResultsInjection src evals` → empty. Table test pins all five derived id arrays against the literals from the pre-change registry — exact match. The 9 Step-1 cases plus one extra (layout provenance from `PHASE_PROMPTS`) pass; the only test-side fix during the run was case 2's `expected` missing the trailing human message (test bug, not implementation). `evals/levels/l0.ts` reads no `.blocks` (grep empty — no change needed). The Date grep rail is clean; the file's own JSDoc was reworded so it does not literally contain the grepped snippets. Verification from `apps/server/`: `npx jest --ci src/infra/ai/context src/infra/ai/prompts` → 6 suites / 39 tests green; `npm run type-check` clean; `npm run lint` → 0 errors (413 pre-existing warnings); `npx jest --ci evals/snapshots` → 39 tests / 38 snapshots green, nothing written or obsolete (nothing wired yet); `npm run evals -- --level L0` → 120/120 unchanged. Pre-commit hook (lint, format:check, type-check, full unit suite) green on the commit.

**Verification:** `npx jest --ci src/infra/ai/context src/infra/ai/prompts`; `npm run type-check`; `npm run lint`. The Task 1 snapshots are still green because nothing is wired yet (`npx jest --ci evals/snapshots`). AC: master plan P2 item 3 (assembler exists, reports, does not trim).

---

### Task 5: Wire the five subgraphs — the snapshots are the judge

**Files:**
- Modify: `apps/server/src/infra/ai/graph/subgraphs/{registration,chat,plan-creation,session-planning,training}.subgraph.ts`
- Tests: existing `subgraphs/__tests__/*.unit.test.ts` keep passing; `evals/snapshots/__tests__/message-assembly.unit.test.ts` (Task 1) is the acceptance test

Per subgraph, inside `agentNode`, replace the hand-built `llmMessages` with:

```typescript
const { messages: llmMessages, budgetReport } = assembleContext({
  phase: 'chat',
  systemPrompt,
  previousSummary,            // omit for registration
  history,
  userMessage,
  inFlight: state.messages ?? [],
});
attachBudgetReport(config.metadata?.['runId'] as string, budgetReport);
const response = await model.invoke(llmMessages, config);      // or invokeWithRetry(model, llmMessages, config) — unchanged per phase
```

- [x] **Step 1: Registration and chat** (direct `model.invoke`; registration passes no summary and does not add a `getLatestSummary` call — it never had one)
- [x] **Step 2: Plan creation and session planning** (`invokeWithRetry`)
- [x] **Step 3: Training** — the tool-results block and history frame are now the assembler's; delete the local `summaryBlock`, `toolResultsInjection`, the `HISTORY_FRAME_V1` render and the `llmMessages` literal. Keep everything else (`LLM_ERROR_RETRY_BUDGET` logic, dynamic tool filtering, `currentSessionIds`, error `AIMessage`s) exactly where it is.
- [x] **Step 4: Remove the dead imports** — `SystemMessage`, `HumanMessage`, `mergeMessageRuns`, `renderBlock`, block modules, from every subgraph where nothing else uses them (`AIMessage` stays where `extractNode` or the error paths use it). `grep -rn "renderBlock\|SUMMARY_FRAME_V1\|HISTORY_FRAME_V1\|TOOL_RESULTS_V1\|mergeMessageRuns" src/infra/ai/graph/subgraphs` → empty.
- [x] **Step 5: Run the arbiter** — `npx jest --ci evals/snapshots/__tests__/message-assembly.unit.test.ts` → 15/15 with **no** snapshot written or obsolete. Any mismatch is a wiring bug: diff the snapshot output, fix the subgraph or the layout, never the `.snap`.
- [x] **Step 6: Commit**

`refactor(graph): every phase agentNode assembles its context through assembleContext (byte-identical, 15 snapshots)`

> **Task 5 result (2026-09-17):** all five agentNodes now build their array via `assembleContext` and call `attachBudgetReport(config.metadata?.['runId'] as string, budgetReport)` — the same `metadata.runId` channel the llm-log-handler reads. Invocation style unchanged per phase: registration/chat direct `model.invoke`, plan_creation/session_planning/training `invokeWithRetry`. Registration passes no `previousSummary`; training's local `summaryBlock`, `toolResultsInjection`, the `HISTORY_FRAME_V1` render, the `llmMessages` literal and the `renderToolResults` import are gone — `LLM_ERROR_RETRY_BUDGET`, dynamic tool filtering, `currentSessionIds` and the error `AIMessage`s untouched. Dead imports removed (each subgraph now imports only `AIMessage`, plus `ToolMessage` in training); the Step-4 grep is empty; first lint run flagged 5 `import/order` errors on the new imports (auto-fix moved them after the prompts imports), final lint 0 errors / 413 pre-existing warnings. The arbiter passed first try: 15/15 assembly snapshots, 16/16 tests in the suite, nothing written, nothing obsolete — training `post-tool` still ends on the tool-results system block with no nudge (today's real behaviour, preserved). Verification: `npx jest --ci evals/snapshots src/infra/ai/graph` → 18 suites / 179 tests / 38 snapshots green; `npm run type-check` clean. Commit: `0658f1ae`.

**Verification:** `npx jest --ci evals/snapshots src/infra/ai/graph` (15 assembly + 23 prompt snapshots + subgraph tests green); `npm run type-check`; `npm run lint`; the grep above is empty. AC: this plan's byte-identity arbiter; AC-1323 (every phase agent now attaches a report).

---

### Task 6: Rails and the L1 observation

**Files:**
- Modify: `apps/server/eslint.config.js` (the `no-restricted-syntax` block at `files: ['src/infra/ai/graph/**/*.ts', 'src/infra/ai/*.ts']` → add `'src/infra/ai/context/**/*.ts'`)
- Modify: `apps/server/evals/levels/__tests__/no-inline-prompts.unit.test.ts` (scan `src/infra/ai/graph` **and** `src/infra/ai/context`)
- Modify: `apps/server/evals/lib/run-case.ts` (`CaseObservation.budgetReport`; pass `metadata: { runId, userId }` in the invoke config, as the route does)
- Modify: `apps/server/evals/levels/l1.ts` (structural check `budget-report-present`)
- Tests: `evals/levels/__tests__/l1.unit.test.ts`, `evals/lib/__tests__/run-case.unit.test.ts`

- [x] **Step 1: Extend both rails to `infra/ai/context`** (closes the P2 advisory "Extend the inline-prompt rails to future infra dirs" for this directory; `infra/ai/messages` is P3's). Prove the ESLint rail bites: temporarily add `new SystemMessage('x')` to `assemble-context.ts`, run `npm run lint`, **paste the one-line error into this plan under Task 6 results**, revert. (P2 advisory: "Record rail-bite proofs".)
- [x] **Step 2: `run-case.ts`** — `CaseObservation.budgetReport: BudgetReport | null` from `recordedRuns[0]?.budgetReport ?? null`. The invoke config gains `metadata: { runId, userId }`; without it `config.metadata.runId` is undefined in evals and no report is attached (the LLM callback handler has the same blind spot today — this also makes eval run rows carry model/tokens like production).
- [x] **Step 3: `l1.ts`** — new check `budget-report-present`: passes when `observation.budgetReport !== null && observation.budgetReport.total > 0`; skipped (not added) when `observation.threw` (the existing early return). This is §4.2's "Collect … `budgetReport`" made true; the `budgetReport.history ≤ budget.history` structural check stays deferred (no budgets until P4) — leave the spec sentence as is except for the collection part (Task 8).
- [x] **Step 4: Commit**

`test(evals): budgetReport in L1 observations; inline-prompt rails cover infra/ai/context`

**Task 6 result (2026-09-17):** both rails now cover `src/infra/ai/context/**` — the eslint.config.js `no-restricted-syntax` files array gained `'src/infra/ai/context/**/*.ts'`, and `no-inline-prompts.unit.test.ts` greps `graph/` **and** `context/`. Rail-bite proof (temporary `new SystemMessage('x')` in `assemble-context.ts`, then reverted):

```
  93:23  error    Inline system prompt text. Render it from a module in src/infra/ai/prompts/ (ADR-0013 §5)  no-restricted-syntax
```

`run-case.ts` reads `budgetReport: recordedRuns[0]?.budgetReport ?? null` into `CaseObservation` and passes `metadata: { runId, userId }` in the graph invoke config — the same `config.metadata?.['runId']` channel the agentNode uses to `attachBudgetReport`, so eval run rows now carry a report (and model/tokens) like production. L1 gained the structural check `budget-report-present` (passes iff `budgetReport !== null && budgetReport.total > 0`; not added on the `threw` early return); the `budgetReport.history ≤ budget.history` check stays deferred to P4 per the plan. TDD: both test suites failed to compile first (no `budgetReport` on `CaseObservation`), then green. Verification: `npm run lint` → 0 errors / 413 pre-existing warnings; `npx jest --ci evals` → 12 suites / 105 tests / 38 snapshots green; `npx jest --ci evals/snapshots` → 39 tests / 38 snapshots; `npm run evals -- --level L0` → 120/120 unchanged. Commit: `991f9e98`.

**Verification:** `npm run lint` (with the bite proof recorded); `npx jest --ci evals`; `npm run evals -- --level L0` unchanged counts. AC-1323 (L1 side: every eval run carries a report).

---

### Task 7: AC-1322 re-run — the phase's regression guard (orchestrator runs this; not the executor)

The wiring is proven byte-identical by Task 1/5, so this is a sanity sweep, but the master plan names AC-1322 as the rollback trigger for item 3 and the run costs nothing on the dev route (direct Z.AI). Same procedure as `refactor-p2-prompt-modules` Task 7.

- [ ] **Step 1:** `RUN_LLM_EVALS=1 npm run evals -- --level L1 --phase all --samples 3 --baseline compare --baseline-version v0` on the branch (flags per `evals/run.ts`); the comparator prints regressions / improvements / missing / new checks per phase.
- [ ] **Step 2:** Paste the per-dataset table (v0 / this run / Δ / regressions) into this plan under **AC-1322 result**. Every `budget-report-present` check must be green. Commit the compare report JSON next to the table (P2 advisory "AC-1322 evidence durability") at `docs/superpowers/plans/evidence/refactor-p2-context-assembler-l1-compare.json` — small, and it is the only durable evidence.
- [ ] **Step 3:** If any dataset drifts by more than ±2 pp on a check that is not BUG-014/BUG-015: investigate twice; on the second failure apply the rollback condition (revert Task 5's wiring only, keep Tasks 1–4, 6) and stop for the owner.

**Verification:** the table; `git show --stat` of the evidence commit. AC-1322.

---

### Task 8: Dev deploy, AC-1323 on real runs, the §3.4 measurement, docs reconcile, close-out (orchestrator)

- [ ] **Step 1: Deploy to dev** (reserved action): push the branch, `./deploy/deploy.sh dev` on the VPS **from this branch** (or merge first per the owner's usual order — same as P2), then a manual smoke on `@MyFitAiCoachDevBot`: one registration-phase message on a fresh test user is not required; cover **chat, plan_creation, session_planning, training** at least once each (training needs a started session; the P2 smoke path is documented in that plan's close-out).
- [ ] **Step 2: AC-1323 query on dev**:

```sql
SELECT phase_in, count(*) AS runs,
       avg((budget_report->>'total')::int)  AS avg_total,
       avg((budget_report->>'system')::int) AS avg_system,
       max((budget_report->>'assemblies')::int) AS max_assemblies
FROM conversation_runs
WHERE created_at > now() - interval '1 hour'
GROUP BY 1 ORDER BY 1;

-- must be 0 rows: an agent-backed run without a report
SELECT run_id, phase_in FROM conversation_runs
WHERE created_at > now() - interval '1 hour' AND budget_report IS NULL AND model <> 'unknown';
```

Paste both outputs into this plan under **AC-1323 result**. Also grep `docker logs fitcoach-dev-server` for one `Conversation run recorded` line and confirm it carries `budgetReport`.

- [ ] **Step 3: The ADR-0013 §3.4 measurement** (master plan P2 Notes): record `avg_system` and the max for `session_planning` and `training` from the query above under **§3.4 measurement**, next to the L0 fixture numbers (`session_planning` fixtures render at 2199–2216 estimated tokens per `evals/levels/l0.ts`; the hypothesis is 6–10k with a real plan). This number sets P4's budget defaults — write it where P4's planner will look: this plan and the PR description.
- [ ] **Step 4: Docs reconcile** (pre-approved factual bucket; anything else → owner):
  - `docs/PROMPT_EVAL_FRAMEWORK.md` §4.2: "Collect: … `budgetReport`" is now true; the structural bullet becomes "`budget-report-present` implemented; `budgetReport.history ≤ budget.history` and orphan-tool-message checks still deferred (budgets are P4)".
  - `docs/CONTRIBUTING_AI.md` ("where prompts live" pointers around line 130): add the assembler — "message order and token accounting: `src/infra/ai/context/assemble-context.ts`; per-phase layout on `src/infra/ai/prompts/index.ts`".
  - `docs/BACKLOG.md`: tick/close "Registry `blocks` arrays must not survive AC-1323" and, for the `infra/ai/context` part, "Extend the inline-prompt rails to future infra dirs" (leave the `infra/ai/messages` part open, P3); note on "Small P2 duplications" that the role-narrowing lambda now has one home on the assembly side.
  - `docs/LLM_CORE_REFACTOR_PLAN.md` and ADR-0013 stay forward-looking — no progress markers (STATE.md rule).
- [ ] **Step 5: Close-out** — follow `superpowers:finishing-a-development-branch`: run the `close-out-review` skill (four zones), tick every checkbox above and close each with its result (15+23 snapshots, unit counts, lint bite proof, the AC-1322 table, both AC-1323 query outputs, the §3.4 numbers), set `- Status: done`, `node scripts/state.mjs --write` from the repo root, commit, merge. `node scripts/state.mjs --check` must pass. Update `docs/STATE.md` *Next*: P2 complete in full (items 1–5); next is P3.

**Verification:** the pasted outputs; `node scripts/state.mjs --check` → OK. AC-1323 (dev half), master plan P2 Notes.

---

## AC-1322 result

_(filled in Task 7)_

## AC-1323 result

_(filled in Task 8)_

## §3.4 measurement

_(filled in Task 8)_

## Follow-up (not part of this plan)

- P3 (`refactor-p3-*`): `PhaseSpec` takes over rendering and data loading; the assembler's `AssembleInput` shrinks to `(phaseSpec, state, ctx)` per ADR-0013 §3.4; `attachBudgetReport`/run-metrics fold into the `commit` node and run context; the post-tool nudge moves into the shared agent node and enters the report.
- P4: `PhaseSpec.budget`, `trimMessages`, INV-LLM-004 resolution order; `budget-report-present` becomes `budgetReport.history ≤ budget.history`.
