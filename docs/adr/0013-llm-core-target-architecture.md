# ADR-0013: LLM Core Target Architecture (graph, state, memory, prompts, errors)

**Status**: PROPOSED (target architecture; supersedes the memory/state parts of ADR-0005, ADR-0007 §1/§5/§6, and refines ADR-0009, ADR-0010, ADR-0011)
**Date**: 2026-09-10
**Deciders**: Owner (solo developer) + AI agents
**Audience**: AI coding agents picking this up cold. Read `docs/LLM_CORE_REFACTOR_PLAN.md` for the execution order and `docs/PROMPT_EVAL_FRAMEWORK.md` for how quality is measured.

Scope: bot + server + LLM core (`apps/bot`, `apps/server/src/{app,domain,infra/ai,infra/conversation}`). The mini-app (`apps/webapp`, `/api/app/*`) is frozen and out of scope except for §9 (product intent + constraints the redesign must respect) and §7 (the legacy LLM path it consumes, retired). Ops/hygiene items from the parallel review live in `docs/PLAN-architecture-refactor-backlog.md` (HB-01..HB-07, E-05); HB-01 is a hard precondition of refactor phase P0.

Evidence labels used throughout: **VERIFIED** = read in code at the cited location; **HYPOTHESIS** = plausible, needs a log/DB/experiment to confirm.

---

## 1. Context — what the code does today

The runtime works and has absorbed many field lessons (ADR-0011 hardening, dedup, retry nudges). The structural problems are not bugs; they are places where the design will not carry the product vision (long-term memory, progress awareness, plan iteration, measurable prompt quality).

### 1.1 Two memory systems, neither authoritative (VERIFIED)

- Durable graph state has seven last-write channels and **no `messages` channel**: `userId, phase, userMessage, responseMessage, user, activeSessionId, requestedTransition` (`apps/server/src/domain/conversation/graph/conversation.state.ts:11-41`).
- Each phase subgraph declares its own `messages` channel via `MessagesAnnotation` and is compiled **without** a checkpointer (`infra/ai/graph/subgraphs/chat.subgraph.ts:26-33,118`; same shape in the other four). Its comment states the consequence: in-flight `AIMessage(tool_calls)+ToolMessage` exist only "from the current turn" (`registration.subgraph.ts:59-62`).
- History for the prompt is rebuilt every turn from `conversation_turns`, filtered by `(userId, phase)`, last 20 pairs, roles `user|assistant` only (`infra/conversation/drizzle-conversation-context.service.ts:6,49-75`). `persist.node.ts:17` writes only the user text and the final assistant text.
- Net effect: **tool calls and tool results are never part of history after the turn ends.** Yet the prompts instruct the model as if they were: "IDs from search results are valid for the entire conversation — reuse them, never re-fetch" (`infra/ai/graph/nodes/plan-creation.node.ts:57`; `session-planning.node.ts:114`). The dedup node (`dedup-tool-node.ts`) exists because the model re-searches; it re-searches because it cannot see earlier results.
- History is assembled differently per phase: chat/plan/session-planning interleave `HumanMessage/AIMessage` (`chat.subgraph.ts:70-76`); registration omits the summary block (`registration.subgraph.ts:64-69`); training flattens history into one `SystemMessage` text block labelled "memory only" (`training.subgraph.ts`, `=== CONVERSATION HISTORY` block in `agentNode`). There is no token budget anywhere; the only bound is "20 pairs".

### 1.2 Summaries are rolling and asynchronous (VERIFIED)

- `generatePhaseSummary` summarises the last 15 turns of the outgoing phase and is told to "incorporate" the previous summary (`infra/ai/graph/nodes/phase-summary.node.ts:15-16,28-38`), i.e. a rolling summary — the pattern ADR-0010 explicitly rejected for contextual drift.
- It is fire-and-forget from `transitionGuardNode` and from the router; the race is acknowledged in a comment (`infra/ai/graph/conversation.graph.ts:116-121`; `router.node.ts:52-54`).
- `getLatestSummary` is per user, not per phase or episode (`drizzle-conversation-context.service.ts:85-93`), so a summary of the registration chat is what a training turn sees.

### 1.3 Tool → state propagation via mutable per-user maps (VERIFIED)

- Every subgraph owns `PendingRefMap`s keyed by `userId`; tools write, `extractNode` reads and deletes (`chat.subgraph.ts:45,99-100`; `session-planning.subgraph.ts:66-67,129-133`; `training.subgraph.ts` `currentSessionIds`). Training tools resolve the session id from such a map (`tools/training.tools.ts:84-85`).
- This exists because ADR-0007 §6 rejected `Command` after an attempt with `Command({resume})`. LangGraph 1.1.5 in `node_modules` supports tools returning `Command({update})` through `ToolNode` (`@langchain/langgraph/dist/prebuilt/tool_node.js` handles `Command`), and `contextSchema` for run-scoped, non-checkpointed data (`dist/graph/state.d.ts`). The workaround is no longer needed.
- Nothing serialises concurrent runs for the same user: `chat.routes.ts:80-82` invokes the singleton graph per request; the bot dispatches every `message` event concurrently (`apps/bot/handlers.ts:56`). Two overlapping runs on one `thread_id` share the maps and race on the checkpoint. **HYPOTHESIS**: rare in practice (Telegram users type one message at a time), but it is the failure mode behind "phantom" transitions when a user double-sends; confirm by grepping logs for two `POST /api/bot/chat` with the same `userId` within one run's latency window.

### 1.4 `user` is checkpointed but never trusted (VERIFIED)

`user` is a durable channel (`conversation.state.ts:28-31`), yet the router reloads it (`router.node.ts:30`), every `agentNode` reloads it (`registration.subgraph.ts:56`, `plan-creation.subgraph.ts:64`), and every `extractNode` reloads it again (`chat.subgraph.ts:96`). It is a stale cache stored in the wrong tier.

### 1.5 Prompts are inline template strings; no versions, no composition contract (VERIFIED)

- Each phase prompt is a 60–300 line template literal inside a node file (`nodes/chat.node.ts:55-78`, `nodes/session-planning.node.ts:9-133`, `nodes/training.node.ts:11-115`). Cross-cutting directives are functions concatenated in fixed order by `composeDirectives` (`prompt-directives.ts:109-128`) — a good seed for a composition system, but unversioned and without a section model.
- Russian user-facing literals live in code paths (`prompt-directives.ts:55-58,99`; `training.subgraph.ts` error `AIMessage`s "Произошла техническая ошибка…"; `session-planning.node.ts` off-topic examples). Language policy is otherwise "respond in user's language" (`languageDirective`).
- Nothing records which prompt produced which answer. `LLMLogHandler` logs a replay payload only at `debug` (`model.factory.ts:63-79`); `conversation_turns` has no `run_id`, `prompt_version`, model, tokens, or tool-call columns (`infra/db/schema.ts:75-95`). **The owner cannot tell whether a prompt change made the bot better or worse** — there is no dataset, no judge, no baseline; CI runs unit tests with the model mocked to a constant `AIMessage` (`.github/workflows/ci.yml` → `npm run test:unit`; `graph/__tests__/conversation.graph.unit.test.ts:15-21`).

### 1.6 Error model is ad hoc (VERIFIED)

- Training uses string prefixes `LLM_ERROR:`/`SYSTEM_ERROR:` plus a retry budget of 1 (`tools/training.tools.ts:59-65`; `training.subgraph.ts` `LLM_ERROR_RETRY_BUDGET`); the dedup node returns `Error: …` (`dedup-tool-node.ts:47-50`); chat/registration use plain `ToolNode` with no policy. `invokeWithRetry` patches empty responses with a system nudge (`invoke-with-retry.ts:27-45`) in three subgraphs but not in chat/registration.
- The route converts any failure into HTTP 500 with `details: error.message` (`chat.routes.ts:92-95`); the bot then shows a generic English apology (`handlers.ts:161`). Provider outages, tool bugs, and LLM misbehaviour are indistinguishable to the client and to logs.

### 1.7 Legacy LLM path still alive beside the graph (VERIFIED)

- `LLMService` (JSON mode, `infra/ai/llm.service.ts`) is consumed only by `TrainingService.createPlanFromPrompt/getNextSessionRecommendation/recommendForSession/generateFreeformRecommendation` (`domain/training/services/training.service.ts:134,181,211,668`), which are reachable only from the frozen mini-app routes `app/routes/app/plan.routes.ts:50` and `app/routes/app/session.routes.ts:305`. It builds its own `ChatOpenAI` (`llm.service.ts:21-30`) bypassing `getModel()`, contrary to ADR-0007 guardrail 3.
- Dead with zero consumers: `PromptService` (registered `main/register-infra-services.ts:65`, never resolved), `domain/user/services/prompts/{plan-creation,session-planning,training}.prompt.ts` (978 lines), `domain/training/training-intent.types.ts` (imported only by the dead training prompt), `domain/training/plan-creation.types.ts`, `domain/user/ports/prompt.ports.ts` (`IPromptService`), and `session-planning.types.ts` JSON parsers (`parseSessionPlanningResponse`, only `SessionRecommendationSchema` is used by tools).

### 1.8 Doctrine drift (VERIFIED)

- `docs/domain/conversation.spec.md` still specifies `[PHASE_ENDED]` markers, `jsonMode`, `getContext/reset/startNewPhase` (BR-CONV-005, -012, -013) — none exist. `docs/domain/ai.spec.md` documents `generateResponse/getDebugInfo/clearHistory` — none exist. `ARCHITECTURE.md:253-262` says the context port has 2 methods; it has 6 (`domain/conversation/ports/conversation-context.ports.ts:11-18`).
- INV-CONV-004 ("domain has no dependency on LangChain") is violated by `domain/conversation/graph/conversation.state.ts:1` importing `@langchain/langgraph`.
- `docs/CONVERSATION_CONTEXT_ARCHITECTURE.md` describes the pre-LangGraph orchestrator; it is now misleading and should be archived.

### 1.9 What is good and must be kept

Tool calling instead of JSON parsing; phase subgraphs with phase-scoped toolsets; PostgresSaver as phase-state source of truth; server-side guards in the training tool executor (ordering, batch dedup, correction tools, audit logs — ADR-0011); exercise vector search as a tool (ADR-0012); the `composeDirectives` seed; structured Pino logging with module loggers; the BUGS.md forensics discipline.

---

## 2. Decision summary

| ID | Decision | Replaces |
|----|----------|----------|
| D-01 | One authoritative short-term memory: a `messages` channel in the **parent** graph state, checkpointed, containing tool calls and results. `conversation_turns` becomes an append-only transcript/run log (projection), never a prompt source. | ADR-0005 window from DB; ADR-0007 §5 |
| D-02 | Thread lifecycle: `thread_id = userId` stays; **episodes** are managed inside state by a synchronous `compact` step (inactivity gap, committed phase transition, or budget overflow) producing independent per-episode summaries (max 3 kept). | fire-and-forget rolling `phase-summary` |
| D-03 | Deterministic context assembly with a per-phase token budget, one assembler for all phases, block order fixed and versioned. | per-subgraph ad hoc assembly |
| D-04 | Split durable state (checkpointed) from run context (`contextSchema`, not checkpointed). `user`, `userMessage`, `responseMessage` leave durable state. | `conversation.state.ts` |
| D-05 | Tools update state by returning `Command({update})`; delete `PendingRefMap`. Session id and user id reach tools via run context. | ADR-0007 §6 closure refs |
| D-06 | Topology: `prepare → route → <phase subgraph> → commit`. One `buildPhaseSubgraph(PhaseSpec)` factory; one shared tool executor with per-phase policy. | five hand-written subgraphs |
| D-07 | Transition matrix and guards are data in `domain/conversation` (pure), side effects only in `commit`. | inline matrix in `conversation.graph.ts:98-104` |
| D-08 | Structured `ToolOutcome` envelope + graph-level error policy + typed failures to the route (503 with fallback text, never 500 with internals). User-facing strings live in a message catalog keyed by language. | prefixes, hardcoded Russian |
| D-09 | Prompts are versioned modules (`infra/ai/prompts/<phase>/vN.ts`) composed from versioned directive modules into a `PromptSpec` (ordered, id'd sections). Every run records `promptVersions`. | inline templates |
| D-10 | One `LlmGateway` port (`chat`, `structured`) over `getModel(profile)`; per-phase model profiles from config. Delete `LLMService`, `PromptService`, dead prompts/parsers now; **retire** both legacy mini-app LLM endpoints (410) — no migration (OQ-1). | legacy path |
| D-11 | Every run writes a `conversation_runs` row (ids, phase, prompt versions, model, tokens, latency, tool calls, outcome). This is the source for datasets and regression baselines. | nothing |
| D-12 | Per-thread serialisation of runs (in-process keyed mutex; single instance) and a bot watchdog that exits on fatal polling errors. | none |
| D-13 | Domain boundary restored: LangGraph types live in `infra/ai`; domain owns phases, transitions, ports, prompt-context types. Stale docs reconciled or archived. | INV-CONV-004 violation |
| D-14 | Capability enablers, scoped by the vision: user facts (ADR-0009), muscle-centric progress blocks (BUG-005 plan), structured plan draft in state. **Cut**: vector retrieval over conversation history, proactive push, topic-based thread detection. | — |

Each decision is expanded below with invariants (`INV-LLM-###`), business rules (`BR-LLM-###`) and rejected alternatives.

---

## 3. State, memory and thread lifecycle (D-01, D-02, D-03, D-04)

### 3.1 Memory tiers (the one story)

| Tier | Holds | Lives in | Written by | Bounded by |
|------|-------|----------|------------|------------|
| Working | messages of the current run (agent ↔ tools loop) | subgraph `messages` (inherits parent channel) | agent/tools nodes | recursion limit |
| Episode (short-term) | messages of the current episode incl. tool calls/results, `episodeSummaries[]` (≤3), `phase`, `activeSessionId`, `draft` | parent state, PostgresSaver, `thread_id = userId` | `commit`, `compact` | token budget (D-03) |
| Long-term | profile, plans, sessions, sets (progress); `user_facts`; episode summaries mirrored to DB | Postgres domain tables | domain services via tools | schema |
| Transcript / runs | every message and every run's metadata | `conversation_turns` (+ new columns), `conversation_runs` | `commit` | retention policy |

INV-LLM-001: The prompt's dialogue history is derived only from the checkpointed `messages` channel; no node reads `conversation_turns` to build a prompt.
INV-LLM-002: Every tool call and tool result of a completed run is present in `messages` until compacted; compaction is the only way messages leave the channel.
INV-LLM-003: Long-term facts about the user are never inferred from `messages` at prompt time; they are read from domain tables or `user_facts`.

### 3.2 Durable state vs run context

Durable state (checkpointed; parent graph):

```
phase: ConversationPhase                 // last-write
activeSessionId: string | null           // last-write
messages: BaseMessage[]                  // messagesStateReducer (supports RemoveMessage)
episodeSummaries: EpisodeSummary[]       // last-write, max 3, oldest first
episodeStartedAt: ISO string             // last-write
lastUserMessageAt: ISO string | null     // last-write
pendingTransition: TransitionRequest|null// last-write; reset by prepare
draft: PlanDraft | null                  // last-write (D-14, plan iteration)
```

Run context (`contextSchema`; provided per invoke; never checkpointed):

```
runId, userId, user (loaded once in prepare), now, client: 'telegram'|'webapp',
trigger: 'user_message'|'system', promptVersions (filled by assembler), modelProfile
```

Run output: the final `AIMessage.content` of the run (text) plus `phase`. No `responseMessage` channel; the route reads the last AI message. Rationale for dropping `user` from state: it is reloaded 3× per turn today (§1.4); a checkpointed copy only adds staleness.

Rejected: keeping `user` in state "for the LLM to see it" — the assembler renders profile from run context; a per-run load is one indexed SELECT.

### 3.3 Episode lifecycle (thread lifecycle)

`thread_id` remains `userId` (stable, trivially discoverable, `clear-context` remains `checkpointer.deleteThread(userId)` instead of raw SQL on three tables — `chat.routes.ts:41-43`).

An **episode** is a contiguous span of `messages`. `prepare` runs `compact` before the first LLM call of a run when any of:

- BR-LLM-001 (inactivity): `now - lastUserMessageAt ≥ EPISODE_GAP` (default 3 h, from ADR-0010) and `messages` non-empty.
- BR-LLM-002 (phase boundary): the previous run committed a phase transition (flag set by `commit`).
- BR-LLM-003 (budget): estimated tokens of `messages` exceed the phase history budget (D-03).

`compact` is synchronous and deterministic: it summarises the messages being removed into **one new `EpisodeSummary`** (independent, not merged with older ones — per ADR-0010 rationale), keeps the last 3 summaries, and emits `RemoveMessage`s for the compacted range. For BR-LLM-003 it removes the oldest whole turns (a turn = human message through the following final AI message, never splitting a tool-call/tool-result pair) until under budget. On summariser failure it falls back to trimming without a summary and logs `warn` (graceful degradation, BR-LLM-004).

The summariser uses the `LlmGateway.structured` call with schema `{ topics[], decisions[], userState[], trainingFeedback[], openItems[] }` and the ADR-0010 "facts only, no style" instruction; summary text is rendered from that structure (deterministic, evaluable). Summaries are mirrored to `conversation_summaries` (user_id, episode_id, phase_at_end, structured json, created_at) for analytics and eval datasets; the prompt reads them from state, not from the table.

Rejected alternatives:
- New `thread_id` per episode: requires a `current_thread` lookup table, breaks `clear-context` simplicity, and LangGraph offers nothing extra for it. The in-state episode gives the same isolation.
- Asynchronous summary (current): verified race; the first message after a long gap is exactly when the summary matters.
- Rolling summary (current prompt): contextual drift; ADR-0010 already rejected it.
- Topic-based boundaries: extra LLM call per message, not justified.

Checkpoint growth (**HYPOTHESIS**: `checkpoints` rows grow by ~1 parent + ~1 per subgraph step per turn and are never pruned; `cleanup-orphan-checkpoints.ts` addresses only deleted users). Confirm with `SELECT thread_id, count(*) FROM checkpoints GROUP BY 1 ORDER BY 2 DESC LIMIT 5;`. Policy (BR-LLM-005): nightly job deletes checkpoints older than 14 days except the latest per `(thread_id, checkpoint_ns)`; checkpoint blobs are not the transcript of record (that is `conversation_turns`).

### 3.4 Deterministic context assembly and token budget

One function, `assembleContext(phaseSpec, state, ctx): { messages: BaseMessage[]; promptVersions; budgetReport }`, in `infra/ai/context/`. Output order is fixed:

1. `SystemMessage` — rendered `PromptSpec` for the phase (identity, phase task, rules, tools, directives). Versioned (D-09).
2. `SystemMessage` — **long-term blocks**: `## User Facts` (D-14), `## Previous episodes` (≤3 summaries, oldest first).
3. `SystemMessage` — **domain blocks** for the phase (profile, plan, session state, muscle recovery, previous performance). Each block is a pure `render(data) → {id, text, tokens}` with a declared max token share; data loaders are declared in the `PhaseSpec` and run in parallel.
4. `messages` — the episode history after `trimMessages` to the history budget (strategy `last`, `startOn: human`, `includeSystem: false`, keep tool pairs intact).
5. In-flight messages are already inside `messages` (they are the same channel) — no separate splice.

Budget (per phase, in `PhaseSpec.budget`, tokens estimated with a fixed estimator so results are reproducible offline):

| Phase | system | long-term | domain | history | output reserve |
|-------|-------:|----------:|-------:|--------:|---------------:|
| registration | 2.5k | 1k | 1k | 6k | 1.5k |
| chat | 3k | 1.5k | 2k | 8k | 2k |
| plan_creation | 4k | 1.5k | 2k | 12k | 4k |
| session_planning | 5k | 1.5k | 6k | 8k | 3k |
| training | 5k | 1.5k | 6k | 8k | 2k |

Numbers are initial defaults to be tuned with the eval harness; the invariant is the mechanism, not the values. INV-LLM-004: the assembler never drops or truncates block 1; over-budget is resolved by (a) trimming history, (b) reducing domain block depth (e.g. 5 → 3 sessions), (c) dropping oldest episode summary — in that order, and the `budgetReport` is logged per run. **HYPOTHESIS**: today's session-planning system prompt alone is 6–10k tokens (full plan JSON + 5 sessions + recovery + ~130 lines of instructions); measure with the estimator in P2 before choosing values.

Training's "history as a system text block" is replaced by the same message channel for all phases; the anti-"act on past messages" protection moves to (i) the `=== TOOL EXECUTION RESULTS ===` block, which stays, and (ii) an eval rubric criterion (TR-4 in the eval spec) instead of a structural hack.

Rejected: per-phase bespoke assembly (current); token counting via provider API (adds latency and provider coupling); no budget (current).

---

## 4. Graph topology, tools and transitions (D-05, D-06, D-07)

### 4.1 Parent graph

```
START → prepare → route ──Command(goto=phase)──▶ <phase subgraph> → commit → END
                    └──Command(goto=commit) for short-circuit replies (session ended, recovery)
```

- `prepare`: load `user` into run context; reset `pendingTransition`; run `compact` (BR-LLM-001..003); run phase safety sync (today's router logic at `router.node.ts:39-93` — keep the behaviour, move the strings to the catalog).
- `route`: pure function of `(state.phase)`; uses `Command` with `ends` declared (as now).
- `<phase subgraph>`: built by `buildPhaseSubgraph(spec)` — `agent → (tools | finalize)`; `tools → agent`; `finalize → END`. `finalize` no longer re-reads the user or consumes maps; it validates that the final `AIMessage` has non-empty text (else applies the post-tool nudge once — today's `invokeWithRetry`) and returns nothing else.
- `commit` (replaces `persist + transition_guard + cleanup`): (1) append run's new messages to `conversation_turns` and write `conversation_runs`; (2) evaluate `pendingTransition` against the matrix and guards (§4.3); (3) execute side effects (session activation/completion as in `cleanupNode`, `conversation.graph.ts:127-151`); (4) set `phase`, set the compaction flag for the next run. Failures in (1) must not fail the reply (BR-CONV-007 kept) but are logged at `error`, not `warn`.

Subgraphs share the parent's `messages` channel (same key in both schemas), so the working tier is the episode tier — one channel, one reducer. Subgraphs are compiled without their own checkpointer (unchanged); only the parent checkpoints.

### 4.2 `PhaseSpec` — the one place a phase is defined

```
PhaseSpec {
  name: ConversationPhase
  prompt: PromptModule                       // D-09, versioned
  tools: ToolFactory[]                       // built with deps at composition root
  toolPolicy: { ordering?: PriorityMap; dedup?: DedupRule[]; llmErrorBudget: number; availability?: (state, ctx) => toolName[] }
  contextBlocks: ContextBlockLoader[]        // D-03 domain blocks
  budget: TokenBudget
  modelProfile: 'default' | 'planning' | 'training' | ...
}
```

The five phases become five `PhaseSpec` objects plus one factory. The current training-specific behaviours map onto policy fields: priority ordering (`TOOL_PRIORITY`), batch dedup of `log_set`, `search_exercises` dedup, dynamic tool availability (`training.subgraph.ts` "Dynamic tool filtering"), error budget. The shared tool executor implements all of them once (it replaces `ToolNode`, `dedupToolNode`, `sequentialToolNode`).

INV-LLM-005: Adding a phase means adding a `PhaseSpec`, its prompt module, its tools, and a row in the transition matrix — no edits to the graph builder.

### 4.3 Transitions

`domain/conversation/transitions.ts` exports the matrix (today's `allowed` map, `conversation.graph.ts:98-104`) and guard predicates as pure functions over `(state, ctx)` with typed reasons (`{ ok: true } | { ok: false, reason: 'not_allowed' | 'no_active_session' | ... }`). Tools request transitions by returning `Command({ update: { pendingTransition } })`. `commit` decides. Guards remain server-side (BR-CONV-015/016/017/018 keep their IDs).

BR-LLM-006: A transition committed in run N takes effect in run N+1's `route`; the reply of run N is produced by the outgoing phase (unchanged from today) — the eval rubric requires that reply to announce the hand-off.

### 4.4 Tools

- Tools are pure adapters over domain services (unchanged principle). They receive `userId`, `activeSessionId`, `runId` from `config.configurable`/run context (LangGraph passes `config` to tools; today only `userId` is passed — `chat.subgraph.ts:78-80`).
- State updates: return `Command({ update })`. `ToolNode`/the shared executor handles `Command` returns (verified in `tool_node.js`). ADR-0007 guardrail 2 ("do not use Command") is **rescinded** for `Command({update})`; `Command({resume})` remains out of scope (no interrupts planned).
- Every tool returns a `ToolOutcome` (§6) which the executor serialises to a `ToolMessage` in a fixed textual shape the prompts and evals can rely on.

Rejected: a single flat agent with all tools and a "phase" instruction — phase-scoped toolsets are the main defence against the ADR-0011 incident class (a chat model that cannot see `log_set` cannot log phantom sets).

---

## 5. Prompt architecture (D-09)

### 5.1 Layout

```
apps/server/src/infra/ai/prompts/
  directives/            identity.v1.ts, formatting.telegram.v1.ts, formatting.plain.v1.ts,
                         language.v1.ts, timezone.v1.ts, name-usage.v1.ts, tool-reply.v1.ts,
                         time-reference.v1.ts, greeting.v1.ts, memory-usage.v1.ts
  phases/
    registration/ v1.ts ... vN.ts, index.ts (exports current)
    chat/ ...
    plan_creation/ ...
    session_planning/ ...
    training/ ...
  summarizer/ v1.ts
  judge/                 (eval judge prompts — see PROMPT_EVAL_FRAMEWORK.md)
  compose.ts             PromptSpec → SystemMessage text, section ids preserved as headers
```

### 5.2 Contract

```
PromptModule {
  id: string             // 'phase.session_planning'
  version: string        // 'v3' — bump on ANY wording change
  directives: DirectiveModule[]        // each has id + version
  render(ctx: PromptContext): Section[]  // pure; no I/O; no Date.now() (now comes from ctx)
}
Section { id: string; text: string; required: boolean }
promptVersions = { 'phase.session_planning': 'v3', 'directive.formatting.telegram': 'v1', ... }
```

BR-LLM-007: `render` is pure and deterministic given `PromptContext`; unit tests snapshot the rendered text per version.
BR-LLM-008: Any wording change creates a new version file; old versions stay until no baseline references them (eval spec §6). The composite `promptVersions` map is recorded on every run (`conversation_runs`) and in the LLM `info` log line.
BR-LLM-009: No natural-language literal addressed to the user may live outside prompt modules or the message catalog (`infra/ai/messages/<lang>.ts`). Examples inside prompts are allowed in any language but must be marked as examples.
BR-LLM-010: The formatting directive is selected by `ctx.client` (Telegram HTML vs plain/markdown) — the first mini-app constraint (§9).

`composeDirectives` becomes `compose(spec)`; its current fixed order is preserved as the v1 order.

Rejected: external prompt registry/SaaS (adds a vendor to a BYOK solo project; the repo + versions + run log give the same traceability); a templating language (renders are TypeScript functions already; snapshots make them testable).

---

## 6. Error model (D-08)

```
ToolOutcome =
  | { ok: true;  summary: string; data?: unknown; stateUpdate?: Partial<State> }
  | { ok: false; kind: 'user_error' | 'llm_error' | 'system_error'; message: string; hint?: string }
```

- `user_error`: valid call, business rule says no (e.g. delete more sets than exist). Model relays to the user; does not count against the error budget.
- `llm_error`: malformed or impossible arguments (invalid exercise id, duplicate batch). Counts against `toolPolicy.llmErrorBudget`; when exhausted, the executor emits a terminal `AIMessage` from the catalog (`tool_error_budget_exhausted`) and the run ends.
- `system_error`: infrastructure. Executor stops the loop immediately and raises `ToolSystemError` → graph-level handler.

Graph-level (in the route/`ConversationService` wrapper around `graph.invoke`):

| Failure | Mapped to | Client gets |
|---------|-----------|-------------|
| Provider error / timeout (OpenRouter 4xx/5xx, network) | `LlmUnavailableError` | HTTP 503 `{ error: { code: 'LLM_UNAVAILABLE' } }` |
| `ToolSystemError` | `CoreError` | HTTP 500 `{ code: 'CORE_ERROR' }`, no internals |
| Guard-blocked transition | not an error; logged `info` | normal 200 |
| Concurrent run for the same thread (D-12) | wait up to N s, else `ThreadBusyError` | HTTP 409 `{ code: 'THREAD_BUSY' }` |

The bot maps codes to localized catalog messages (it already knows `language_code`). INV-LLM-006: no HTTP response body contains an exception message.

The empty-response nudge (`invokeWithRetry`) becomes part of the shared agent node for all phases (one retry, then the catalog fallback), removing the chat/registration inconsistency.

---

## 7. LLM access and the legacy path (D-10)

- `domain/ai/ports.ts` is rewritten as `LlmGateway { chat(input, opts): AIMessage; structured<T>(schema, input, opts): T }` — no `ChatMsg`, no `jsonMode`. Implementation in `infra/ai/llm.gateway.ts` over `getModel(profile)`; `structured` uses `withStructuredOutput` (available in `@langchain/openai` 1.x) with one retry on schema failure.
- `getModel(profile)`: profiles from config `LLM_MODEL`, `LLM_TEMPERATURE` (defaults) with optional `LLM_PROFILE_<NAME>_MODEL/_TEMPERATURE/_MAX_TOKENS` overrides. Rationale: the summariser and the judge want low temperature and possibly a cheaper model; training may want a different one than plan creation; today one singleton at `maxTokens: 4096` serves everything (`model.factory.ts:117-125`).
- Delete now (zero consumers): `PromptService`, `IPromptService`/`PROMPT_SERVICE_TOKEN`, `domain/user/services/prompts/*`, `training-intent.types.ts`, `plan-creation.types.ts`, `parseSessionPlanningResponse` and `SessionPlanningLLMResponseSchema`, `InMemoryConversationContextService` (after tests are moved to the new port).
- `LLMService` and the four `TrainingService` LLM methods (`createPlanFromPrompt`, `getNextSessionRecommendation`, `recommendForSession`, `generateFreeformRecommendation`): **delete, do not migrate** (OQ-1, answered). `POST /api/app/plan` and `POST /api/app/session/:id/recommend` return `410 { error: { code: 'RETIRED' } }`. Rationale: the mini-app is a state visualization and control surface, not a conversational client (§9) — plan generation is a bot conversation, and "what do I do today" in the UI is deterministic (next session from the saved plan). Precondition before shipping the 410s: check prod access logs for `POST /api/app/*` over the last weeks (usage is [ASSUMPTION]-none, not log-verified); real traffic is surfaced to the owner, not retired silently.
- If a "smart pick" is ever wanted in the UI, it is a thin `LlmGateway.structured` adapter over the same context blocks and prompt modules (§9), never a separate LLM path.

Rejected: keeping `LLMService` "until the mini-app redesign" — it is the only remaining JSON-mode path, has its own model instance, its own logging and no versioning; every month it survives it diverges further from the evaluated core. Also rejected: migrating `recommendForSession` to the gateway "just in case" — it would preserve an endpoint the product intent says should not exist.

---

## 8. Observability and run records (D-11)

`conversation_runs` (new): `run_id, thread_id (user_id), phase_in, phase_out, trigger, client, model, prompt_versions jsonb, tokens_in, tokens_out, latency_ms, tool_calls jsonb [{name, argsHash, outcomeKind}], transition jsonb, outcome ('ok'|'llm_unavailable'|'core_error'|'budget_exhausted'), budget_report jsonb, created_at`.

`conversation_turns` gains: `run_id, thread_episode_id, kind ('human'|'ai'|'tool_call'|'tool_result'|'system_note'|'summary'), payload jsonb` (tool call args / structured summary), while `content` stays for text. Existing rows are kept; `phase` stays for analytics.

The LLM `info` log line carries `runId, phase, promptVersions, model, tokens, latencyMs`; the full replay payload stays at `debug` (BUG-003 behaviour preserved). LangSmith/OTel tracing is optional and not required by this ADR.

P0 implementation note (2026-09-12): the `info` line ("Conversation run recorded") is emitted by the persist node next to the row write — the module boundary keeps the LLM callback `debug`-only while feeding the run-metrics accumulator. Constraint discovered during execution: LangChain strips `configurable` from the options callback handlers receive (`runnables/base.js` deletes it from callOptions), so run identity must travel via config `metadata`, which is inherited by nested runs — P3's run context must not assume `configurable` reaches callbacks.

INV-LLM-007: A run is reproducible offline from `(conversation_runs.prompt_versions, the run's input messages from conversation_turns, the domain snapshot referenced by the eval fixture)`. This is what makes the eval framework possible.

---

## 9. Mini-app: product intent and integration constraints (not a design)

### 9.0 Product intent [OWNER-CONFIRMED, 2026-09-10]

The mini-app is **not a conversational client**. It has no chat history and will not need one. It is a **state visualization and control surface**: logging sets, starting/completing sessions, and phase-driven UI happen through UI interactions, not a chat box. Consequences:

- Plan generation stays conversational (bot); the mini-app renders the saved plan as a read model.
- "What do I do today" in the UI is deterministic: the next session derived from the plan. A future "smart pick", if ever wanted, is a thin `LlmGateway.structured` adapter over the same context blocks and prompt modules — never a separate LLM path.
- UI writes go to domain services and append `system_note` messages to the thread, so the coach's memory stays coherent with out-of-band actions.
- Therefore no LLM endpoints exist under `/api/app/*` (both legacy ones are retired in P1, §7).

### 9.1 Constraints the redesign must respect

1. **One core path.** Any coach reasoning reachable from the app goes through the graph or through `LlmGateway.structured` adapters over the same context blocks and prompt modules. No second LLM path, no JSON-mode endpoints. (The app itself is not expected to call the coach at all.)
2. **Rendering profile, not a different prompt.** Should the app ever render coach text, `client: 'webapp'` in run context only switches the formatting directive (BR-LLM-010) and the message catalog; phase logic and tools are identical.
3. **Writes go through domain services**, the same ones the tools use (log a set, start/complete a session). Every such write appends a `system_note` message to the user's thread (e.g. "User logged set 3 of Bench Press via app") — INV-LLM-002 extended to out-of-band writes. Phase-relevant writes (session started/completed) also update the durable state the graph would have set itself (`activeSessionId`, `phase`) via the same commit rules, so the next bot turn does not contradict the UI.
4. **Reads are read models** from Postgres (plans, sessions, sets, runs, facts), never from checkpoints and never from `messages`.
5. **Streaming is allowed later** — the graph is stream-capable; the parent state design does not depend on the reply channel.
6. **Auth remains per client** (`initData` for the app, API key for the bot); the run context carries the authenticated `userId` only.

## 10. Capability enablers, scoped by the product vision (D-14)

| Capability (vision reference) | Exists | Missing | Minimal enabler | Justified? |
|---|---|---|---|---|
| Long-term user memory (Ongoing Data Collection) | profile fields; rolling summary | durable facts across phases | ADR-0009 `user_facts` + `remember_fact` tool in all phases; injected as long-term block, ≤50 facts, hard-constraint category respected by plan/session tools (validation, not just prompt) | Yes |
| Progress awareness between sessions (Training Sessions §) | 5 recent sessions; previous session by `sessionKey` (BUG-005) | per-exercise / per-muscle history | muscle-centric context blocks (PLAN-muscle-centric-history) as D-03 domain loaders: `muscleRecovery` (session_planning) and `currentExerciseHistory` (training) | Yes |
| Multi-turn plan iteration (Workout Plan Generation §, steps 3–4) | free-text iteration; `save_workout_plan` at the end | a structured draft the model edits | `draft` channel + `propose_plan_draft`/`update_plan_draft` tools; `save_workout_plan` saves the draft (no re-emission of the whole plan); same for session drafts | Yes — also makes plan quality evaluable deterministically |
| Retrieval over conversation history | none | — | **Cut.** Training facts live in tables; episode summaries + facts cover narrative context. Re-open only if evals show "user referenced something older than 3 episodes" failures. | No |
| Proactive session planning / nudges | none | scheduler, outbound send | **Cut for now** (vision: "Motivation … Planned Expansion"). Keep the cheap seam: `trigger: 'system'` in run context and a bot endpoint contract (`POST /notify`), no implementation. | Not yet |
| "What should I do today?" (Training Sessions §) | session_planning phase | recovery data quality (see progress) | covered by muscle-centric blocks | Yes |
| Adaptation mid-session (Adaptation §) | correction tools, off-plan logging | — | none beyond error model | Already |

---

## 11. Module boundaries after the refactor

```
domain/conversation/    phases.ts (ConversationPhase), transitions.ts (matrix + guards), ports/
                        (ConversationRunPort: run(input) → RunResult; TranscriptPort; SummaryPort)
domain/ai/              llm.gateway.ports.ts (LlmGateway), prompt-context.types.ts
domain/user|training/   unchanged services; + user-facts service/port (ADR-0009)
infra/ai/graph/         conversation.graph.ts (topology), phase-subgraph.factory.ts, tool-executor.ts,
                        nodes/{prepare,route,commit,compact}.ts, state.ts (annotations + contextSchema)
infra/ai/context/       assemble-context.ts, blocks/*.ts, token-estimator.ts
infra/ai/prompts/       §5 layout
infra/ai/messages/      catalog per language
infra/ai/tools/         one file per tool (not per phase); PhaseSpecs import them
infra/ai/llm.gateway.ts, model.factory.ts
infra/conversation/     transcript.repository.ts, runs.repository.ts, summaries.repository.ts
app/                    chat.routes.ts → ConversationService (mutex, error mapping)
evals/                  see PROMPT_EVAL_FRAMEWORK.md
```

ESLint boundaries stay; `domain/**` must not import `@langchain/*` (add to the boundary rule set).

---

## 12. Open questions — ANSWERED 2026-09-10

Status tags: [OWNER-CONFIRMED] stated by the owner; [DEFAULT] working default, change if the owner objects; [ASSUMPTION] believed true, verify before depending on it; [RECOMMENDATION] owner leaning yes, not formally confirmed. Items tagged [ASSUMPTION]/[RECOMMENDATION] are not settled decisions.

- **OQ-1 — Retire both `POST /api/app/plan` and `POST /api/app/session/:id/recommend` (410) in P1; do not migrate `recommend`.** [OWNER-CONFIRMED direction]. "Nobody uses them in prod" is [ASSUMPTION]: check prod access logs for `POST /api/app/*` before merging; surface real usage to the owner.
- **OQ-2 — Episode gap = 3 h, single constant** (replaces the 4 h greeting heuristic). [DEFAULT]
- **OQ-3 — Judge = Gemini 3 Flash via the Google AI Studio PAYG key, as config profile `judge`.** [RECOMMENDATION]. Rationale: Z.AI subscription quota is shared with dev tooling; ~$0.30 per full nightly L1+L2; out-of-family judge avoids self-preference bias. Per-dataset escalation to a Pro-tier judge allowed if calibration fails. Batching via Google Batch API is a later optimisation (not P0). Fallback if overturned: subscription GLM with mandatory calibration. The eval framework must not depend on which judge is configured.
- **OQ-4 — Turns/runs retained indefinitely; checkpoints pruned at 14 days (BR-LLM-005).** [DEFAULT]
- **OQ-5 — Message catalog driven by `language_code`, English fallback.** [DEFAULT]
- **OQ-6 — Store `source_turn_id` on `user_facts` now** (cheap; keeps mini-app options open, see backlog E-05). [DEFAULT]

## 13. Consequences

Positive: one memory model that matches LangGraph's native pattern (messages + checkpointer + trimming), tool transcripts preserved, deterministic and budgeted context, prompts versioned and evaluable, errors typed, dead code removed, domain boundary restored, and a run log that turns production traffic into eval data.

Negative / risks: P4 (memory migration) changes prompt inputs for every phase and must be gated by the eval baseline; checkpoint blobs grow with `messages` (mitigated by compaction and pruning); `Command` from tools requires the shared executor to handle both `ToolMessage` and `Command` returns (covered by unit tests); the estimator-based token budget is approximate (acceptable — it is a guard, not billing).

References: ADR-0005, ADR-0007, ADR-0009, ADR-0010, ADR-0011, ADR-0012; `docs/BUGS.md` BUG-005, BUG-009, BUG-011, BUG-012; `docs/PLAN-muscle-centric-history.md`; LangGraph JS docs: persistence/threads, `messagesStateReducer` + `RemoveMessage`, "update state from tools" (`Command`), `contextSchema`, `trimMessages`.
