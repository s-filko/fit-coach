# Refactor P3 — Run Context, Commit Node and Conversation Run Port Implementation Plan

- Status: in progress
- Branch: plan/refactor-p3-run-context-commit
- After: refactor-p3-phase-spec

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The parent graph state holds only what must survive between runs (`phase`, `activeSessionId`, `messages`, `pendingTransition`); everything about *this* run (`runId`, `userId`, `user`, `now`, `client`, `trigger`, the metrics collector) travels as run context and is never checkpointed. The topology becomes `prepare → route → <phase> → commit → END`; `commit` persists the run, decides the transition against the domain matrix and guards, and raises one typed transition event whose handlers do the side effects. The route talks to a domain port (`ConversationRunPort.run(input) → { text, phase, runId }`) and no longer imports the graph. Domain imports no LangGraph. Failed runs get a run row.

**Architecture:** ADR-0013 §3.2 (durable state vs run context), §4.1 (parent graph, `commit`), §4.3 (transitions in domain, `commit` decides, BR-LLM-006), §6 (graph-level errors — mapping itself is P5), §8 (run records; metadata channel for callbacks), §11 (module boundaries; `domain/**` bans `@langchain/*`). Master plan P3 items 1, 2, 5, 6 (rest of the catalog), 7 and "Not in scope: messages persistence across runs — `commit` still clears `messages`". Owner decisions 2026-09-17: phase transition is a typed in-process event raised by `commit`; consumers today are session lifecycle and the legacy phase summary, P4 adds compaction.

**Tech Stack:** TypeScript, LangGraph 1.1.5 (`contextSchema`, `Command`, `RemoveMessage`, `updateState`), `@langchain/core` callbacks, Fastify route, Drizzle (no schema change), Jest, ESLint boundaries.

**Spec:** ADR-0013 §3.2, §4.1, §4.3, §8, §11; `docs/LLM_CORE_REFACTOR_PLAN.md` § P3 items 1, 2, 5, 6, 7; `docs/domain/conversation.spec.md` BR-CONV-007, BR-CONV-015..018.

**Acceptance criteria:** AC-1333 (`domain/**` imports no `@langchain/*`; ESLint rule green and bites), AC-1335 (`POST /api/bot/chat` body unchanged: `{ data: { content, timestamp } }`; integration tests green), AC-1331 re-checked (no module-level mutable state in `infra/ai/graph/**`; `run-metrics.ts` module maps gone), AC-1334 (L1 within ±2 pp of `v1`), plus: one `conversation_runs` row per `POST /api/bot/chat` including failed runs (outcome ≠ `ok`).

## Global Constraints

- **Plumbing phase.** No prompt wording change; the message-assembly snapshots from `refactor-p3-phase-spec` stay byte-identical (the harness passes the user message as the first `HumanMessage` of `messages` instead of `userMessage` — same array, same bytes).
- **`messages` is cleared at the end of every run** by `commit` (`RemoveMessage` with `REMOVE_ALL_MESSAGES`), so prompt history still comes from `conversation_turns` via `getMessagesForPrompt` — P4 stops the clearing. INV-LLM-001/002 are P4.
- **Run context is provided by the caller, never mutated by nodes.** LangGraph's `context` is what the adapter passes at `invoke`; `prepare` reads `ctx.user`, it does not load it (decision D-A — an ADR §4.1 wording amendment to escalate).
- **The run-metrics module maps are deleted**, not moved: a per-run `RunMetricsCollector` lives in run context; its LangChain callback handler is passed in the invoke config (`callbacks` are inherited by nested runs, so every model call of the run reports to it). `startRun` leaves the route; `llm-log-handler.ts` keeps its `debug` line and drops the runId bridge.
- **Blocked transitions have no side effects** (ADR §6: "not an error; logged `info`"). Today the cleanup node runs after a blocked guard too; that is the one deliberate behaviour difference of this plan and it is listed in the PR.
- **Error mapping is P5.** The adapter records the failed run and rethrows; the route still answers `500 { error: { message: 'Processing failed' } }` — with `details` removed (INV-LLM-006 half-step; the field is optional in the schema, no client reads it — verified by grep in `apps/bot`).
- **No schema change.** `trigger`/`client` already exist as columns (migration 0002); they move from hardcoded values in the Drizzle service to the record (BACKLOG item).
- **Reserved to the orchestrator:** Task 6. Verification from `apps/server/`. No attribution lines.

## Decisions taken by this plan (not settled by the durable specs — owner may overrule)

| # | Decision | Alternative rejected | Why |
|---|---|---|---|
| D-A | The **adapter** (outside the graph) loads the user and builds the run context; `prepare` only validates/uses it | `prepare` loads the user "into run context" (ADR §4.1 wording) | LangGraph's `context` is caller-provided and immutable inside the graph; a node cannot fill it. One SELECT either way; the adapter is also where a missing user must become an error before any checkpoint is touched. |
| D-B | Tools and the agent node keep reading `userId`/`activeSessionId`/`runId` from `config.configurable`, populated by the **executor** from `ctx` + state; `runId` also stays in `metadata` for the LLM log handler | Read `config.context` inside tools | Task 1 verifies where `context` actually propagates in 1.1.5; whatever the answer, the executor is the single place that maps run context into what a tool sees (ADR §4.4 says exactly this). |
| D-C | The transition event is `PhaseTransitionCommitted` (domain type) delivered to an ordered list of **awaited** handlers passed to `commit` (`onTransition: TransitionHandler[]`) | An EventEmitter; fire-and-forget | Session activation must complete before the reply (the next run reads the session status). A typed handler list is an event with ordering and error isolation (one failing handler is logged at `error`, the others still run, the reply is not failed — BR-CONV-007 spirit). P4's compaction flag joins the list. |
| D-D | P3 handlers: `sessionLifecycleHandler` (today's `cleanupNode` logic, verbatim) and `legacyPhaseSummaryHandler` (today's fire-and-forget `generatePhaseSummary`, still not awaited internally; deleted in P4) | Inline in `commit` | The owner's decision names consumers; keeping them out of `commit` makes P4's deletion a one-line list edit. |
| D-E | `prepare`'s two training short-circuits become `pendingTransition: { toPhase: 'chat', reason: 'session_ended' \| 'session_missing' }` + the catalog reply, `Command({ goto: 'commit' })`; `commit` evaluates them like any transition (training → chat is allowed; `sessionLifecycleHandler` sees an already-completed or missing session and only clears `activeSessionId`; the phase-summary handler runs as today) | Keep the direct `phase: 'chat'` write in `prepare` | One path for every phase change that is a conversation transition; the registration ↔ chat *sync* is not a transition and stays a direct write (no event, no summary — as today). |
| D-F | Failed runs are recorded by the adapter with `outcome: 'llm_unavailable'` (provider/network error, detected by the error class/`status` the OpenAI client throws) or `'core_error'` (anything else), `model` from the collector or `null` | Leave failed runs unrecorded (today) | BACKLOG "Run rows are invisible for failed runs" asked for an owner ruling; this is the proposal: AC-1301's "one row per POST" becomes true. `ConversationRunRecord.model` becomes `string \| null` (the `'unknown'` sentinel goes; the column is already nullable — verify in `schema.ts`, else keep `'unknown'` and note it). |
| D-G | Port name `ConversationRunPort` with token `CONVERSATION_RUN_PORT_TOKEN`, in `domain/conversation/ports/conversation-run.ports.ts` next to the run record types | `IConversationRunner` | ADR §11 names it; the file already is "everything about a run". The repo's `I`-prefix convention is the `ports-layout-consistency` plan's business; note it there. |
| D-H | Eval `run-case.ts` seeds `phase`/`activeSessionId` with `graph.updateState(config, seed)` before calling the port | A test-only `seed` argument on `run()` | No test-only surface in the production port; `updateState` is the LangGraph way to set a thread's state. |

---

### Task 1: Where does run context propagate? (spike as a unit test)

**Files:**
- Create: `apps/server/src/infra/ai/graph/__tests__/run-context-propagation.unit.test.ts`

A toy `StateGraph` with `contextSchema` (`Annotation.Root({ runId: Annotation<string> })`), a parent node, a compiled subgraph node, and a `tool()` invoked from the subgraph node with the node's config. Invoke with `{ context: { runId: 'r1' } }` and assert where `config.context?.runId` is visible: parent node, subgraph node, tool. Also assert `config.configurable.thread_id` and `config.metadata` visibility at the same three points.

- [x] **Step 1:** Run 2026-09-17 (LangGraph 1.1.5). Table: `parent → context: yes, metadata: yes`;
  `subgraph → context: yes, metadata: yes`; `tool → context: yes, metadata: yes` (configurable.thread_id
  visible at all three). Original step text:
- [x] **Step 2:** `context` DOES reach the subgraph node and the tool — `ctxOf` reads `config.context`
  directly; no `configurable.ctx` fallback needed. Original step text: Task 3's agent node reads `ctx` through `config.configurable.ctx` set by the adapter (a single object reference; `configurable` is not serialised into checkpoints) — record the branch taken here. The tool contract is unaffected (D-B).
- [x] **Step 3: Commit** — `test(ai): pin LangGraph run-context propagation (contextSchema, metadata) across parent, subgraph, tool`

**Verification:** the test is green and its table is pasted. Informs Task 3.

---

### Task 2: Domain — phases, transitions, events; LangGraph out of `domain/**` (AC-1333)

**Files:**
- Create: `apps/server/src/domain/conversation/phases.ts` (`ConversationPhase` moves here; `ports/conversation-context.ports.ts` re-exports it so existing imports compile), `transitions.ts`, `events.ts`, `__tests__/transitions.unit.test.ts`
- Delete: `apps/server/src/domain/conversation/graph/` (`conversation.state.ts`, `conversation.graph.ports.ts`, tests) — `TransitionRequest` moves to `transitions.ts`; `ICompiledConversationGraph` is replaced by the port in Task 5 (delete in Task 5, after the route moves)
- Modify: `apps/server/eslint.config.js` — `no-restricted-imports` pattern `@langchain/*` for `src/domain/**` with the message "ADR-0013 §11 / INV-CONV-004: domain owns phases, transitions and ports; LangGraph lives in infra/ai"

**Interfaces:**

```typescript
// transitions.ts
export interface TransitionRequest { toPhase: ConversationPhase; reason?: string }
export const TRANSITION_MATRIX: Readonly<Record<ConversationPhase, readonly ConversationPhase[]>>;  // today's `allowed` map, verbatim
export interface TransitionInput { phase: ConversationPhase; activeSessionId: string | null; request: TransitionRequest }
export type TransitionVerdict =
  | { ok: true; toPhase: ConversationPhase }
  | { ok: false; reason: 'not_allowed' | 'no_active_session' };
export function evaluateTransition(input: TransitionInput): TransitionVerdict;   // BR-CONV-015 (matrix), BR-CONV-016 (training needs activeSessionId), BR-CONV-017 (training → session_planning not in matrix)

// events.ts
export interface PhaseTransitionCommitted {
  type: 'phase_transition_committed';
  userId: string; runId: string;
  from: ConversationPhase; to: ConversationPhase; reason: string | null;
  activeSessionId: string | null;   // as it was before commit's handlers ran
  at: Date;
}
export type TransitionHandler = (event: PhaseTransitionCommitted) => Promise<void>;
```

- [x] **Step 1: Tests first** — every matrix row (`it` names carry `BR-CONV-015`); `training` request without `activeSessionId` → `no_active_session` (`BR-CONV-016`); `training → session_planning` → `not_allowed` (`BR-CONV-017`); `training → chat` ok (`BR-CONV-018` side effect is Task 4's handler test).
- [x] **Step 2: Implement; move `TransitionRequest`; delete `conversation.state.ts` after Task 3's state exists** (order: create the infra state in Task 3 first if the executor prefers — the two tasks may be one commit; the ESLint rule must be green at the end of Task 3 at the latest).
- [x] **Step 3: ESLint bite** — a temporary `import { Command } from '@langchain/langgraph'` in `domain/conversation/phases.ts`, `npm run lint`, paste the error, remove.
- [x] **Step 4: Commit** — `feat(domain): transition matrix, guards and the PhaseTransitionCommitted event; @langchain banned in domain (AC-1333)`

**Verification:** `grep -rn "@langchain" apps/server/src/domain` → empty; bite pasted; `npx jest --ci src/domain/conversation`.

---

### Task 3: Infra state and run context; the metrics collector

**Files:**
- Create: `apps/server/src/infra/ai/graph/state.ts`, `__tests__/state.unit.test.ts`
- Rewrite: `apps/server/src/infra/ai/run-metrics.ts` → `RunMetricsCollector` (instance) + `LlmMetricsHandler` (callback handler); tests
- Modify: `apps/server/src/infra/ai/llm-log-handler.ts` (drop `bindCallToRun`/`startLlmCall`/`finishLlmCall` calls; keep `debug` logging keyed by `metadata.userId`/`runId`)
- Modify: `phase-subgraph.factory.ts` (subgraph state = `ConversationState`), `nodes/agent.node.ts` (user message = first `HumanMessage` of `state.messages`; in-flight = the rest; `user` from `ctx`; `ctx.metrics.attachBudgetReport(report)`), `nodes/finalize.node.ts` (returns `{}` — kept as the place that validates the final `AIMessage` has text; the fallback already guarantees it), `tool-executor.ts` (`configurable` from `ctx.userId`, `state.activeSessionId`, `ctx.runId`; `requestedTransition` → `pendingTransition`)

**Interfaces:**

```typescript
// state.ts
export const ConversationState = Annotation.Root({
  phase: Annotation<ConversationPhase>({ reducer: (_, v) => v, default: () => 'registration' }),
  activeSessionId: Annotation<string | null>({ reducer: (_, v) => v, default: () => null }),
  messages: Annotation<BaseMessage[]>({ reducer: messagesStateReducer, default: () => [] }),
  pendingTransition: Annotation<TransitionRequest | null>({ reducer: (_, v) => v, default: () => null }),
  // P4 adds: episodeSummaries, episodeStartedAt, lastUserMessageAt, draft
});
export type ConversationStateType = typeof ConversationState.State;
export const RunContext = Annotation.Root({
  runId: Annotation<string>, userId: Annotation<string>, user: Annotation<User>,
  now: Annotation<Date>, client: Annotation<'telegram' | 'webapp'>, trigger: Annotation<'user_message' | 'system'>,
  metrics: Annotation<RunMetricsCollector>,
});
export type RunContextType = typeof RunContext.State;
export function ctxOf(config: LangGraphRunnableConfig): RunContextType;   // one accessor; implements Task 1's branch (context vs configurable.ctx); throws if absent

// run-metrics.ts
export class RunMetricsCollector {
  constructor(startedAt = Date.now());
  handler(): BaseCallbackHandler;                     // handleChatModelStart/handleLLMEnd → model, tokens, llmCalls
  attachBudgetReport(report: BudgetReport): void;     // last wins + assemblies++ (P2 D-B)
  snapshot(): RunMetrics;                             // { model: string|null, tokensIn, tokensOut, latencyMs, llmCalls, budgetReport, assemblies }
}
```

- [x] **Step 1: Tests first** — state defaults and reducers (`RemoveMessage` with `REMOVE_ALL_MESSAGES` empties `messages`); the collector: two model calls accumulate tokens, `model` is the last seen, `snapshot()` latency ≥ 0, `attachBudgetReport` semantics; the handler ignores calls whose `metadata.runId` is not the collector's (the phase-summary call sets `runId: undefined` on purpose — today's BACKLOG note becomes a test).
- [x] **Step 2: Implement.** Delete `startRun`, `startLlmCall`, `finishLlmCall`, `bindCallToRun`, `resolveCallRun`, `drainRunMetrics`, `attachBudgetReport` module functions and the two maps.
- [x] **Step 3:** Message-assembly snapshots: the harness now invokes with `{ messages: [new HumanMessage(text), ...scenarioInFlight] }` and `context` (or `configurable.ctx`) — snapshots **byte-identical**, `git status` shows no `.snap` change. `budgetReport.user`/`inFlight` are derived from the first human message and the rest; add an `it` that pins this split.
- [x] **Step 4: Commit** — `refactor(ai): durable ConversationState + RunContext; per-run metrics collector replaces the module maps (ADR-0013 §3.2, §8)`

**Verification:** `grep -n "new Map" apps/server/src/infra/ai/run-metrics.ts` → empty; `npx jest --ci src/infra/ai evals/snapshots` green with unchanged snapshots; `npm run type-check` (the route will not compile until Task 5 — acceptable inside the branch only if Tasks 3–5 land in one PR; the executor must not push a red `type-check` between tasks: if Task 5 is not in the same commit, keep a one-line shim in the route reading `messages` until Task 5).

---

### Task 4: `prepare`, `route`, `commit`; handlers; the catalog completed

**Files:**
- Create: `apps/server/src/infra/ai/graph/nodes/prepare.node.ts`, `route.node.ts`, `commit.node.ts`, `handlers/session-lifecycle.handler.ts`, `handlers/legacy-phase-summary.handler.ts`, tests for each
- Modify: `conversation.graph.ts` (topology `START → prepare → route → <spec.name> → commit → END`; `prepare` and `route` declare `ends`), `infra/ai/messages/*` (keys `session_ended_return_to_chat`, `session_missing_return_to_chat` with today's English strings verbatim + Russian translations)
- Delete: `nodes/router.node.ts`, `nodes/persist.node.ts` and tests; the inline `transitionGuardNode`/`cleanupNode`/`routeAfterPersist` in `conversation.graph.ts`

`prepare(state, config)`: `ctx = ctxOf(config)`; `updates = { pendingTransition: null }`; registration ↔ chat sync exactly as `router.node.ts:87-98`; training checks as `router.node.ts:46-85` but per D-E: `Command({ goto: 'commit', update: { ...updates, pendingTransition: { toPhase: 'chat', reason }, messages: [new AIMessage(t(key, lang))] } })`; otherwise `Command({ goto: 'route', update: updates })` (or plain updates with a static edge — pick one; `ends: ['route', 'commit']`).

`route(state)`: `Command({ goto: state.phase })`, `ends` = spec names.

`commit(state, config)`:
1. `human = first HumanMessage text`, `ai = textOf(last AIMessage)`; `contextService.appendTurn(userId, phase, human, ai)` — skipped when either is empty (today's guard), failure logged at `error` (ADR §4.1; today `warn`).
2. `verdict = state.pendingTransition ? evaluateTransition({ phase, activeSessionId, request }) : null`; blocked → `log.info` with the reason (today `warn`).
3. `runService.recordRun({ runId, userId, phaseIn: phase, phaseOut: verdict?.ok ? verdict.toPhase : null, trigger: ctx.trigger, client: ctx.client, model, promptVersions: promptVersionsForPhase(phase), tokens…, latencyMs, toolCalls: from state.messages (AIMessage tool_calls → { name, argsHash: sha1(JSON.stringify(args)), outcomeKind: outcomeKindOf(matching ToolMessage) }), transition: request ?? null, outcome: 'ok', budgetReport: snapshot.budgetReport (+ assemblies) })`; the `info` line "Conversation run recorded" as today. `toolCalls` was `null` since P0 — now filled (ADR §8); failure logged `warn`, never fails the reply.
4. `verdict.ok` → `event = { …, from: phase, to: verdict.toPhase, reason, activeSessionId, at: ctx.now }`; for each handler in order: `await handler(event).catch(err => log.error(...))`.
5. Return `{ phase: verdict?.ok ? verdict.toPhase : phase, pendingTransition: null, activeSessionId: <from the lifecycle handler's result — see below>, messages: [new RemoveMessage({ id: REMOVE_ALL_MESSAGES })] }`.

Handler results: `sessionLifecycleHandler` needs to *return* the new `activeSessionId` (null when it completed/cleared the session). Make `TransitionHandler` return `Promise<Partial<{ activeSessionId: string | null }>>`; `commit` merges the returned partials in order. Keep this in the domain type (Task 2) as `TransitionHandlerResult`.

`sessionLifecycleHandler(deps)`: today's `cleanupNode` branches verbatim (`to === 'training' && activeSessionId` → activate a `planning` session; `to !== 'training' && activeSessionId` → complete unless completed/skipped, return `{ activeSessionId: null }`). `legacyPhaseSummaryHandler(contextService)`: `generatePhaseSummary(contextService, userId, from, config?)` fire-and-forget as today (`.catch` → `log.error`), returns `{}`. Note the P4 deletion in its JSDoc.

- [x] **Step 1: Tests first** — `prepare`: the four branches (sync up, sync down, session ended → commit with pendingTransition + catalog message in the user's language, session missing); `commit`: turn appended; run row fields incl. `trigger`/`client`/`toolCalls`; blocked transition → phase unchanged, `info` logged, **no handler called**; committed transition → handlers called in order with the event, `activeSessionId` merged from the handler result, `messages` emptied; a throwing handler does not fail the run; `sessionLifecycleHandler`: `BR-CONV-018` (training → chat completes an in-progress session), activation of a `planning` session on `→ training`, no-op when already completed.
- [x] **Step 2: Implement; rewire `conversation.graph.ts`; delete the old nodes.** `conversation.graph.unit.test.ts`: transition end-to-end (mocked model calls `request_transition`) → run row `transition.toPhase`, final state `phase`, `messages: []`; INV-LLM-005 test still green.
- [x] **Step 3: Commit** — `feat(ai): prepare/route/commit topology; transition event with session-lifecycle and legacy-summary handlers (ADR-0013 §4.1, §4.3)`

**Verification:** `npx jest --ci src/infra/ai/graph`; `grep -rn "requestedTransition\|responseMessage\|userMessage" apps/server/src` → only the route (until Task 5); `npm run evals -- --level L0`.

---

### Task 5: `ConversationRunPort`, the adapter, the route, evals

**Files:**
- Modify: `apps/server/src/domain/conversation/ports/conversation-run.ports.ts` (`ConversationRunPort`, `CONVERSATION_RUN_PORT_TOKEN`, `RunInput { userId; text; client?: 'telegram'|'webapp'; trigger?: 'user_message'|'system' }`, `RunResult { text; phase; runId }`; `ConversationRunRecord` gains `trigger`, `client`; `model: string | null` per D-F)
- Create: `apps/server/src/infra/ai/graph/conversation-run.adapter.ts` (`buildConversationRunner({ graph, userService, runService })`), `__tests__/conversation-run.adapter.unit.test.ts`
- Modify: `apps/server/src/app/routes/chat.routes.ts` (`app.services.conversationRun.run({ userId, text: message })` → `{ data: { content: result.text, timestamp } }`; `startRun` import and the `eslint-disable` gone; 500 body without `details`), `app/types/fastify.d.ts`, `main/bootstrap.ts`, `main/register-infra-services.ts` (register the adapter under the port token; the graph token stays internal to infra), `tests/integration/api/chat.routes.integration.test.ts` (stub `{ run: jest.fn().mockResolvedValue({ text: 'Stub AI response', phase: 'chat', runId: 'r' }) }`; the `invoke`-shape assertions become `run`-shape), `infra/conversation/drizzle-conversation-run.service.ts` (`trigger`/`client` from the record)
- Modify: `apps/server/evals/lib/run-case.ts` (build graph + adapter with stub deps; `graph.updateState({ configurable: { thread_id } }, { phase, activeSessionId })` seed (D-H); `text` from `run()`; `transition`/`outcome`/`budgetReport` from `recordedRuns[0]` as today), `evals/lib/build-stub-deps.ts` (unchanged deps; `recordRun` records `trigger`/`client` too)
- Delete: `domain/conversation/graph/` remainder (`ICompiledConversationGraph`)

Adapter `run(input)`: `user = await userService.getUser(userId)` (missing → throw `new Error('User <id> not found')` as today's router did); `runId = randomUUID()`; `metrics = new RunMetricsCollector()`; `ctx = { runId, userId, user, now: new Date(), client: input.client ?? 'telegram', trigger: input.trigger ?? 'user_message', metrics }`; `graph.invoke({ messages: [new HumanMessage(input.text)] }, { configurable: { thread_id: userId /*, ctx per Task 1 */ }, context: ctx, metadata: { runId, userId }, callbacks: [metrics.handler()], recursionLimit: 50 })`; result `{ text: textOf(last AIMessage of the *run's* messages — read from the graph output's `messages` before `commit` cleared them? No: `commit` returns the cleared channel, so the final state has no messages. Read the reply from the run's final `AIMessage` captured by `commit` into a run-scoped place: `ctx.metrics.finalText` (set by `commit` before clearing) — one field on the collector, documented as "P3: reply text until P4 stops clearing `messages`"`, phase: result.phase, runId }`. On throw: `runService.recordRun({ …, outcome: isProviderError(err) ? 'llm_unavailable' : 'core_error', model: metrics.snapshot().model, … })` best-effort, then rethrow.

- [x] **Step 1: Tests first** — adapter: happy path returns `{ text, phase, runId }` from a stub graph; user missing throws before invoke; a throwing graph records a run with `outcome: 'core_error'` and rethrows; provider error class → `'llm_unavailable'`; the invoke config carries `context`, `metadata.runId`, `callbacks[0]` (the collector's handler). Route integration: existing assertions on `data.content`/`timestamp` (AC-1335) plus `run` called with `{ userId, text }`; the 500 body has no `details`.
- [x] **Step 2: Implement; wire DI; update evals.** `RUN_LLM_EVALS` unset: `npx jest --ci evals` green (unit part); `npm run evals -- --level L0` green.
- [x] **Step 3:** `grep -rn "@infra/ai" apps/server/src/app` → empty (the route no longer imports infra); `grep -rn "requestedTransition\|responseMessage\|userMessage\|startRun\|drainRunMetrics" apps/server/src` → empty.
- [x] **Step 4: Commit** — `feat(conversation): ConversationRunPort and graph adapter; route decoupled from infra/ai; failed runs recorded (ADR-0013 §11, AC-1335)`

**Verification:** `npm run check-all && npm run test:unit`; `npx jest --ci tests/integration/api/chat.routes.integration.test.ts`; the greps pasted.

---

### Task 6: L1 compare, dev deploy and full smoke, AC evidence, docs reconcile, close-out (orchestrator)

> **Owner decision 2026-09-17 (quota):** no further full L1 runs in P3 beyond the one
> already-running tool-executor compare — the weekly Z.AI quota cannot absorb three
> ~171-call compares. AC-1334 for this phase is satisfied by the byte-identity
> snapshots + unit tests + the phase-end dev smoke; an optional scoped mini-L1
> (transition datasets only, 1 sample, ~18 calls) may be run at the phase close-out
> if the owner asks.


- [x] **Step 1: AC-1334** — `RUN_LLM_EVALS=1 npm run evals -- --level L1 --phase all --samples 3 --baseline compare --baseline-version v1`; evidence JSON `docs/superpowers/plans/evidence/refactor-p3-run-context-commit-l1-compare.json`; table pasted.
- [x] **Step 2: Deploy to dev; P3 phase-end smoke** (`docs/MANUAL_TEST_PLAN.md` scenarios 1–3 and 6 via the dev bot/API): registration on a fresh user, chat → session_planning → training with sets, corrections, `finish_training`. Queries pasted:

```sql
-- one row per POST, failed runs included (AC-1301 as re-read by D-F)
SELECT outcome, count(*) FROM conversation_runs WHERE created_at > now() - interval '2 hours' GROUP BY 1;
-- transitions recorded with trigger/client and tool calls filled
SELECT run_id, phase_in, phase_out, trigger, client, jsonb_array_length(tool_calls) AS tools, transition
FROM conversation_runs WHERE created_at > now() - interval '2 hours' ORDER BY created_at;
-- checkpoints carry the reduced state (no user/userMessage blobs)
SELECT count(*) FROM checkpoint_blobs WHERE thread_id = '<dev user>' AND channel IN ('user','userMessage','responseMessage','runId','userId') AND created_at > now() - interval '2 hours';  -- expect 0
```

- [x] **Step 3: AC evidence** — AC-1331 grep (module-level state), AC-1333 grep + bite, AC-1335 integration test names, all pasted.
- [x] **Step 4: Docs reconcile** (factual bucket): `docs/ARCHITECTURE.md` (tree: `state.ts`, `nodes/{prepare,route,commit}.ts`, `handlers/`, `conversation-run.adapter.ts`; `domain/conversation/{phases,transitions,events}.ts`; route → port), `docs/CONTRIBUTING_AI.md` (run context, where a run row comes from, how to add a transition handler), `docs/domain/conversation.spec.md` port section (the new port — this is a durable spec: **escalate the exact diff to the owner**, then apply on approval), `docs/BACKLOG.md` ticks: run-metrics binding contract, chat route owns the run-metrics lifecycle, `'unknown'` sentinel, run rows invisible for failed runs (with the D-F ruling), `DrizzleConversationRunService` invents `trigger`/`client`, phase-summary orphan-accumulator test. ADR-0013 amendments to **escalate** (not edit): §4.1 (adapter loads the user; `commit` raises the event; handlers), §3.2 (`metrics` in run context; `promptVersions`/`modelProfile` not in context), §6 (`system_error` and error mapping timing → P5), §4.4 (tools return `ToolReturn`, executor maps to state — from the executor plan).
- [x] **Step 5: Close-out** — `close-out-review`, checkboxes closed with results, `- Status: done`, `node scripts/state.mjs --write`, commit, merge, worktree removed. `docs/STATE.md`: **P3 complete**; Next → P4 (memory model) and P5 (concurrency/delivery, parallel).

**Verification:** evidence pasted; `node scripts/state.mjs --check` → OK. AC-1331, AC-1333, AC-1334, AC-1335.

## Follow-up (not part of this plan)

- P4: stop clearing `messages` in `commit`; `compact` in `prepare` as a consumer of the transition event (flag) + BR-LLM-001/003; `legacyPhaseSummaryHandler` deleted; `TranscriptPort`/`SummaryPort`; `finalText` leaves the collector (the reply is the last `AIMessage` in state); `clear-context` → `checkpointer.deleteThread`.
- P5: error mapping in the adapter/`ConversationService` (503/409/500 codes), per-user mutex (D-12), `system_error` → `ToolSystemError`.
- `ports-layout-consistency`: `ConversationRunPort` naming vs the `I`-prefix convention.
