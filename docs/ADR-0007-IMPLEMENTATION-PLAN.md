# ADR-0007 LangGraph Migration — Implementation Plan

**ADR**: `docs/adr/0007-langgraph-gradual-migration.md`  
**Status**: IN PROGRESS (Architecture Rework)  
**Last Updated**: 2026-02-23

## Related

- ADR-0007: Gradual Migration to LangGraph
- ADR-0005: Conversation Context Session
- ADR-0006: Session Plan Storage
- FEAT-0010: Training Session Management (`docs/features/FEAT-0010-training-session-management.md`)
- FEAT-0009: Conversation Context (`docs/features/FEAT-0009-conversation-context.md`)

---

## Architecture Rework — Why

Steps 0-2 were implemented under the assumption that existing MVP infrastructure (ConversationContextService, JSON mode + manual parsing, LLMService wrapper) would be reused as-is. Live testing exposed a fundamental problem: **conversation phase (state) was determined by parsing `[PHASE_ENDED]` markers from conversation history** — an anti-pattern equivalent to parsing HTML tags to find cursor position.

This triggered a full architectural review. The conclusion: MVP patterns must not be carried into the new architecture. Everything that LangGraph can handle natively must live in LangGraph. This is a 2026 production application — not a prototype.

### MVP Anti-Patterns Being Replaced

**1. State stored in conversation history (CRITICAL)**
- `ConversationContextService.getContext()` determines active phase by scanning `conversation_turns` for `[PHASE_ENDED]` markers
- 3 parallel DB queries per incoming message to guess the current phase
- Hanging "open" system notes block users (observed in production 2026-02-23)
- `phaseContextStore` — in-memory `Map` for `activeSessionId` and `lastSessionPlan` — lost on server restart

**Replaced by:** LangGraph PostgreSQL Checkpointer — atomic state persistence, one query by `thread_id`

**2. JSON mode + manual parsing in all phases (MEDIUM)**
- Every phase forces LLM to respond in JSON, then manually parses with Zod
- 5 separate parsers: `parseLLMResponse`, `parseTrainingResponse`, `parseSessionPlanningResponse`, `parsePlanCreationResponse`, `registrationLLMResponseSchema`
- Each parser has its own retry logic for malformed JSON
- Prompts spend ~150 lines per phase describing JSON format to the LLM

**Replaced by:** LangGraph tool calling — `model.bindTools()` + `ToolNode`. LLM calls typed tools for side effects, responds with natural text. Zod schemas on tool inputs provide validation natively.

**3. LLMService wrapper (MEDIUM)**
- Wraps `ChatOpenAI` returning `string` — incompatible with tool calling (needs `AIMessage` with `tool_calls`)
- Logging and retry baked into wrapper instead of using LangChain's callback system

**Replaced by:** `ChatOpenAI` directly in graph nodes via shared model factory. Logging via LangChain `CallbackHandler`.

**4. Phase determination in HTTP route (LOW)**
- `chat.routes.ts` (180 lines) contains business logic: registration check, phase priority, context loading, phase transitions, error handling
- Route should be a thin proxy

**Replaced by:** Router Node inside the graph. Route becomes ~20 lines.

**5. `ConversationContextService` scope creep (LOW)**
- Originally: conversation history storage (ADR-0005)
- Grew into: phase state management, phase transition orchestration, in-memory context cache
- Mixed responsibilities: history for prompts + state for routing

**Replaced by:** Clear separation — checkpointer owns state, `ConversationContextService` owns only conversation history (appendTurn + getMessagesForPrompt)

**6. `validatePhaseTransition` never executed (FOUND DURING AUDIT)**
- 12 transition rules written in `ChatService.validatePhaseTransition` (lines 604-718)
- `chat.routes.ts` calls `conversationContextService.startNewPhase()` directly, bypassing validation
- `executePhaseTransition()` is dead code — never called from any live path
- Transition rules must be verified against business logic, not blindly copied

**7. `primaryMuscles`/`secondaryMuscles` always empty in plan_creation (FOUND DURING AUDIT)**
- `prompt.service.ts:232-239` maps exercises with `primaryMuscles: []` and `secondaryMuscles: []`
- LLM cannot see which muscles each exercise targets when creating workout plans
- Must load muscle groups from `exercise_muscle_groups` table

---

## Principles

- Each step produces a **testable result**: unit tests pass, or a manual curl confirms behavior
- Old code is **deleted immediately** when replaced — no `// TODO: remove` pattern, no dead code accumulation
- No time estimates — done when done, each step is a commit
- **All state lives in LangGraph checkpointer** — no custom state management
- **All LLM side effects go through tool calling** — no JSON mode + manual parsing
- **Use library features, not custom code** — `ToolNode`, `toolsCondition`, `PostgresSaver`, `CallbackHandler`
- **No migration, no backward compatibility** — one test user, data can be reset (`TRUNCATE conversation_turns`)
- **Tools only for side effects** — if an action has no DB/state change, LLM responds with text naturally (no no-op tools)

### Refactor and Improve, Not Copy-Paste

Each graph node is built **based on existing logic**, but with active improvement:

1. Study the source code — understand **what** it does and **why**
2. Identify what to **keep** (business rules, invariants), what to **simplify**, and what to **drop**
3. Build with LangGraph-native patterns — tool calling, checkpointer state, ToolNode loops
4. If something doesn't fit — **raise for discussion immediately**

**Business invariants (keep):**
- `saveWorkoutPlan` only when LLM calls `save_workout_plan` tool with user approval [FEAT-0010]
- `saveSessionPlan` only when LLM calls `start_training_session` tool + return `sessionId`
- Registration completeness: all 6 fields + explicit user confirmation
- Session linked to workout plan via `planId`

### What Stays

- `TrainingService` (`domain/training/`) — domain logic, called from tools
- `PromptService` (`domain/user/services/prompt.service.ts`) — prompt building, but prompts simplified (no JSON format instructions)
- `conversation_turns` table — conversation history for prompts and analytics (NOT for state)
- DB schema — unchanged (checkpointer creates its own tables)
- API contract — `POST /api/chat` request/response format identical
- `SessionPlanningContextBuilder.buildContext()` — data loading for prompts
- `registration.validation.ts` — field validators reused in tool schemas
- All repository implementations
- Exercise/session/set domain types

### What Gets Replaced (deleted immediately)

- `LLMService` → `ChatOpenAI` directly via model factory + LangChain callbacks for logging
- `ChatService` → phase subgraphs (chat, plan_creation, session_planning, training)
- `RegistrationService` → registration subgraph
- `ConversationContextService` → rewritten to 2 methods (appendTurn + getMessagesForPrompt)
- `parseLLMResponse`, `parseTrainingResponse`, `parseSessionPlanningResponse` → tool calling
- `TrainingIntentSchema` + `executeTrainingIntent` switch → individual tools
- Phase determination in `chat.routes.ts` → Router Node
- `[PHASE_ENDED]` markers, `phaseContextStore`, `startNewPhase()` → checkpointer state
- `SessionPlanningContextBuilder.formatForPrompt()` → dead code, never called

---

## Architecture (Target)

### Graph Topology

```
POST /api/chat
  → chat.routes.ts (thin proxy: ~20 lines)
  → graph.invoke({ userMessage, userId }, { configurable: { thread_id: userId } })
  → ConversationGraph (compiled with PostgresSaver checkpointer)
      │
      ├── [Router Node]
      │     Loads user from DB → state.user
      │     Resets requestedTransition = null (prevent stale blocked transitions)
      │     Auto-closes timed-out sessions
      │     For new threads: phase from profileStatus
      │     For existing: phase from checkpointer
      │     Handles session timeout edge case
      │
      ├── [Phase Subgraph] (one of 5, routed by state.phase)
      │     Each phase is a compiled subgraph with its own tool-calling loop:
      │     ┌─ [agent_node] model.bindTools(tools).invoke(messages)
      │     │    ↓ has tool_calls? (toolsCondition)
      │     ├─ [tool_node] ToolNode executes, returns ToolMessage
      │     │    ↓ always → back to agent_node
      │     └─ agent_node (no tool_calls) → END subgraph
      │     Returns: responseMessage, requestedTransition
      │
      ├── [Persist Node]
      │     Writes user+assistant turn to conversation_turns
      │     Uses state.phase BEFORE any transition (correct phase attribution)
      │
      ├── [Transition Guard] (conditional edge)
      │     Validates requestedTransition against 12 rules
      │     If blocked → END (return response without transition)
      │
      ├── [Cleanup Node] (if transition allowed)
      │     Side effects: auto-complete session, session planning→in_progress
      │     Updates state.phase, clears state.activeSessionId if needed
      │
      └── State saved to PostgreSQL checkpointer
          (phase, activeSessionId, user)
```

**Key ordering: Persist → Guard → Cleanup.** Turn is recorded under the phase where it was processed, not under the new phase after transition.

### State Definition

```
ConversationState:
  userId:              string                  — set on input
  phase:               ConversationPhase       — persisted by checkpointer, default 'registration'
  userMessage:         string                  — set on input per invocation
  responseMessage:     string                  — set by phase subgraph
  user:                User | null             — loaded by router, updated by profile tools
  activeSessionId:     string | null           — persisted, set by start_training_session
  requestedTransition: TransitionRequest|null  — set by tools or phase subgraphs
```

No `messages` field — history loaded from `conversation_turns` inside each subgraph.

**Reducer note:** `requestedTransition` uses last-write-wins reducer. Router node resets it to `null` at the start of each invocation to prevent stale blocked transitions from persisting across calls.

### Tools → State Update Mechanism

Tools return a string (ToolMessage content) for the LLM to see. But several tools also need to update graph state (`requestedTransition`, `activeSessionId`, `user`). The mechanism for this is determined in Step 3 (first subgraph) and reused by all others.

Options (decide in Step 3 based on LangGraph JS/TS API):
- **Command pattern** — tool returns `Command({ update: { requestedTransition: ... } })` alongside ToolMessage
- **Agent node post-processing** — after tool loop ends, agent node inspects which tools were called and sets state accordingly
- **Closure pattern** — tools are closures created per-invocation with mutable state reference

Whichever pattern is chosen, it must handle: `requestedTransition` (set by `request_transition`, `finish_training`, `complete_registration`, `cancel_planning`, `save_workout_plan`, `start_training_session`), `activeSessionId` (set by `start_training_session`, cleared by cleanup), `user` (updated by `update_profile`, `save_profile_fields`, `complete_registration`).

### ConversationContextService (final interface)

```
IConversationContextService:
  appendTurn(userId, phase, userMessage, assistantResponse): Promise<void>
  getMessagesForPrompt(userId, phase, options?: { maxTurns }): Promise<ChatMsg[]>
```

`getMessagesForPrompt` implementation: `SELECT FROM conversation_turns WHERE userId AND phase ORDER BY createdAt DESC LIMIT maxTurns`, reverse, return. No `[PHASE_ENDED]` filtering — old data truncated.

### Tool Calling per Phase

- **Registration** (2): `save_profile_fields`, `complete_registration`
- **Chat** (2): `update_profile`, `request_transition`
- **Plan Creation** (1): `save_workout_plan`
- **Session Planning** (2): `start_training_session`, `cancel_planning`
- **Training** (4): `log_set`, `next_exercise`, `skip_exercise`, `finish_training`

Total: 11 tools across 5 phases.

### Tool Return Values (ToolMessage content seen by LLM)

- `save_profile_fields` → `"Saved: age=25, gender=male, height=180cm"`
- `complete_registration` → `"Registration complete. All 6 fields confirmed."` | `"Cannot complete: missing fields: fitnessGoal, weight"`
- `update_profile` → `"Profile updated: weight 85kg"`
- `request_transition` → `"Transition to plan_creation requested."`
- `save_workout_plan` → `"Plan 'Upper/Lower 4-Day' saved with 4 templates, 24 exercises."`
- `start_training_session` → `"Session created (ID: xxx, status: planning). 6 exercises, est. 60 min."`
- `cancel_planning` → `"Planning cancelled."`
- `log_set` → `"Set 3 logged: Bench Press — 8 reps @ 80kg (RPE 8)"`
- `next_exercise` → `"Bench Press completed (3 sets). Next pending: Barbell Row"`
- `skip_exercise` → `"Lat Pulldown skipped. Next pending: Dumbbell Curl"`
- `finish_training` → `"Session completed. Duration: 47 min, 5 exercises, 18 sets total."`

### Error Handling Pattern

Each subgraph wraps `model.invoke` in try/catch. On LLM error → fallback response:
```
return { responseMessage: "Sorry, something went wrong. Please try again." }
```

Tool errors are handled natively by ToolNode — error becomes ToolMessage, LLM sees it and self-corrects.

### Persist Node Resilience

Persist node wraps `appendTurn` in try/catch. If DB write fails (connection error, timeout), log warning and continue — do not fail the user response. Conversation history is for analytics, not for correctness. The response has already been generated and must be returned to the user.

### Session Timeout Handling

Router node calls `trainingService.autoCloseTimedOutSessions(userId)` on every invocation. If `state.phase === 'training'` and session status is `completed` (timeout), router sets `phase = 'chat'`, `activeSessionId = null`, and returns timeout message without invoking the phase subgraph.

### Session Creation Flow

`start_training_session` tool creates session with `status: 'planning'` and `planId` from active workout plan. Cleanup node (on `session_planning → training` transition) updates session to `status: 'in_progress'` with `startedAt`. Clean separation of create and start.

### `state.user` Freshness

Profile-updating tools (`update_profile`, `save_profile_fields`, `complete_registration`) re-read user from DB after update and propagate updated user to state.

---

## Test Strategy

### Tests that stay untouched
- `session-planning-context.builder.unit.test.ts` — context builder
- `user.service.*.unit.test.ts` — user service logic
- `user.repository.unit.test.ts` — repository
- All middleware/cors/validation integration tests
- All database integration tests

### Tests updated during migration
- `conversation-context.service.unit.test.ts` — rewrite for 2-method interface (Step 2.5)
- `chat.routes.integration.test.ts` — update for thin proxy route (Step 2.5)

### Tests deleted during migration
- `training-intent.unit.test.ts` → replaced by tool tests (Step 7)
- `llm-response.unit.test.ts` → JSON parsers removed (Step 3)
- `llm-json-validation.unit.test.ts` → JSON parsers removed (Step 3)
- `chat-json-mode.unit.test.ts` → replaced by tool calling tests (Step 3)

### New tests per step
- Each tool: unit test (mock service, verify correct method + args + return value)
- Each subgraph: unit test (mock model + tools, verify state output)
- Router node: unit test (new user → registration, complete user → chat, session timeout → chat)
- Transition guards: unit test per rule (12 rules — verify each manually, they were never tested)
- Persist node: unit test (verify appendTurn called with correct phase)
- Integration: graph.invoke with thread_id, verify state persisted across calls

---

## Implementation Steps

### Step 0: Library Upgrade
**Status**: DONE

Upgraded LangChain ecosystem + added LangGraph + bumped Zod.

- `@langchain/core`: ^0.3.72 → ^1.1.27
- `@langchain/openai`: ^0.6.9 → ^1.2.9
- `@langchain/langgraph`: NEW → ^1.1.5
- `zod`: ^4.1.5 → ^4.3.6

---

### Step 1: Graph State + Skeleton Graph
**Status**: DONE

Created LangGraph state definition and skeleton graph with passthrough node. DI registration in `register-infra-services.ts`.

---

### Step 2: Chat Phase Node (initial, JSON mode)
**Status**: DONE → REPLACED by Step 3

Transferred chat branch from `ChatService.processMessage()` into graph node with JSON mode + `parseLLMResponse`. Uses old pattern — Step 3 replaces entirely.

---

### Step 2.5: Foundation — Checkpointer + Model Factory + State + Router + Route + ConversationContextService
**Status**: DONE

The largest step. Builds the entire foundation of the new architecture.

**New dependency:** `@langchain/langgraph-checkpoint-postgres@1.0.1` ✓

**New files (all created):**
- `infra/ai/model.factory.ts` ✓
- `infra/ai/graph/nodes/router.node.ts` ✓
- `infra/ai/graph/nodes/persist.node.ts` ✓

**Rewritten files (all done):**
- `domain/conversation/graph/conversation.state.ts` ✓ — `user`, `activeSessionId`, `requestedTransition` added; `messages` removed
- `domain/conversation/ports/conversation-context.ports.ts` ✓ — 2-method interface
- `infra/conversation/drizzle-conversation-context.service.ts` ✓ — rewritten, no phase detection
- `infra/ai/graph/conversation.graph.ts` ✓ — checkpointer, router→phase→persist→guard→cleanup
- `app/routes/chat.routes.ts` ✓ — thin proxy, ~20 lines
- `main/register-infra-services.ts` ✓ — checkpointer init, ChatService/RegistrationService removed
- `app/types/fastify.d.ts` ✓ — 4 services only
- `infra/db/repositories/user.repository.ts` ✓ — `profileStatus` default `'registration'`

**Deleted:**
- `ChatService` (29k строк) ✓
- Old 7-method `IConversationContextService` interface ✓
- Phase detection in `chat.routes.ts` ✓
- `plan-creation.integration.test.ts` (tested deleted service) ✓

**Bug fixed post-commit:**
- Router node: `if (!state.userId)` never fired → replaced with `if (state.phase === 'registration' && isRegistrationComplete)` ✓

**Data reset:** `TRUNCATE conversation_turns` ✓

**How to test:**
- [ ] Unit test: router node — new user → phase 'registration' (not written, covered by manual test)
- [ ] Unit test: router node — complete user, phase 'registration' → advances to 'chat' (manually verified ✓)
- [ ] Unit test: router node — session timeout → phase 'chat', message returned
- [ ] Unit test: router node — resets `requestedTransition` to null
- [ ] Unit test: persist node — appendTurn called with correct userId, phase, messages
- [ ] Unit test: persist node — appendTurn failure does not throw (logs warning, continues)
- [x] `conversation-context.service.unit.test.ts` — rewritten for 2-method interface ✓
- [x] `npx tsc --noEmit` — clean ✓
- [x] `npm run test:unit` — 136 pass ✓
- [x] `npm run test:integration` — 73 pass ✓

---

### Step 3: Chat Subgraph (tool calling)
**Status**: **DONE** ✓ (2026-02-23)

First phase subgraph — establishes the pattern for all other phases.

#### Tools → State Update: Closure Ref Pattern (revised after live testing)

Tools inside a subgraph need to update the **parent graph state** (`requestedTransition`, `activeSessionId`, `user`). Three options were considered:

- **Command pattern** — tool returns `new Command({ update: { requestedTransition: ... } })`. Attempted first, but `Command` with `resume` breaks `ToolNode`: when tool returns `Command`, ToolNode does NOT create a `ToolMessage` → LLM sees unclosed `tool_call` → infinite recursion loop. **Rejected.**
- **Post-processing** — agent node reads `tool_calls` from last `AIMessage` after ToolNode loop and maps args to state updates. Works but duplicates logic and requires manual parsing.
- **Closure ref** ✓ — tools close over a mutable `{ value: T | null }` ref created per subgraph instance. Tool writes to ref, `extractNode` reads it once and resets to null. Single-threaded (one subgraph invocation at a time per thread_id) — safe.

**Decision: Closure ref pattern.** All tools return plain strings (proper ToolMessages). State updates propagate via:
- `pendingTransition: { value: TransitionRequest | null }` — written by `request_transition`, `complete_registration`, `cancel_planning`, `finish_training`, `start_training_session`
- `state.user` freshness — `extractNode` re-fetches user from DB after tool loop to capture any profile changes
- `activeSessionId` — `start_training_session` (Step 6) writes to a separate `pendingActiveSessionId` ref

In practice:
- `request_transition` → writes `pendingTransition.value = { toPhase, reason }`, returns `"Transition to plan_creation requested."`
- `update_profile` → calls `userService.updateProfileData()`, returns `"Profile updated: weight 85kg"`. `extractNode` re-fetches user from DB.
- `complete_registration` → writes `pendingTransition.value`, calls `updateProfileData({ profileStatus: 'complete' })`, returns `"Registration complete."`
- `start_training_session` (Step 6) → writes both `pendingTransition` and `pendingActiveSessionId` refs

**New files:**
- `infra/ai/graph/tools/chat.tools.ts`:
  - `update_profile` — Zod: `{ age?, gender?, height?, weight?, fitnessLevel?, fitnessGoal? }`. Calls `userService.updateProfileData()`, returns `Command({ update: { user: updatedUser } })` + confirmation string.
  - `request_transition` — Zod: `{ toPhase, reason? }`. Returns `Command({ update: { requestedTransition: { toPhase, reason } } })`.
- `infra/ai/graph/subgraphs/chat.subgraph.ts` — agent_node + ToolNode + toolsCondition loop. Subgraph state extends `MessagesAnnotation` + relevant parent fields passed as input.

**Rewritten files:**
- `infra/ai/graph/nodes/chat.node.ts` — agent node inside subgraph: loads history via `getMessagesForPrompt(userId, phase)`, builds system prompt, invokes `model.bindTools([...])`, returns `AIMessage`.
- `domain/user/services/prompt.service.ts` — `buildChatSystemPrompt`: remove JSON response format section (~40 lines).

**Deleted:**
- `parseLLMResponse()` function and `LLMConversationResponseSchema`
- `chat.node.unit.test.ts` (old stub test) — replaced by subgraph test

**Implemented:**
- [x] `infra/ai/graph/tools/chat.tools.ts` — `update_profile` + `request_transition` tools using Command pattern
- [x] `infra/ai/graph/subgraphs/chat.subgraph.ts` — agent + ToolNode + toolsCondition loop with extract node
- [x] `infra/ai/graph/nodes/chat.node.ts` — `buildChatSystemPrompt()`, natural text, no JSON format
- [x] `conversation.graph.ts` — stub replaced with real `chatSubgraph`
- [x] `llm-response.types.ts` deleted (parseLLMResponse, LLMConversationResponseSchema removed)
- [x] `prompt.service.ts` — `buildChatSystemPrompt` marked TODO:remove, returns `''`
- [x] `chat.node.unit.test.ts` — tests for `buildChatSystemPrompt`
- [x] `conversation.graph.unit.test.ts` — model factory mocked, LLM not called in tests
- [x] Integration tests for `profileStatus: 'registration'` default updated
- [x] `npx tsc --noEmit` ✓ | `npm run test:unit` 43/43 ✓ | `npm run test:integration` 136/136 ✓

**Notes:**
- Command pattern works within subgraph state. Tools update `user` and `requestedTransition` in subgraph state; `extract` node propagates them to parent graph output.
- `getModel().bindTools(tools)` — readonly tuple issue fixed by not using `as const`.
- LangGraph `ToolNode` handles Command returns: if tool returns `Command`, it's passed through directly (not wrapped in ToolMessage).

---

### Step 4: Registration Subgraph
**Status**: **DONE + TESTED** ✓ (2026-02-24)

**Implemented:**
- [x] `infra/ai/graph/tools/registration.tools.ts` — `save_profile_fields` + `complete_registration`
- [x] `infra/ai/graph/subgraphs/registration.subgraph.ts` — agent + ToolNode loop + extract node
- [x] `infra/ai/graph/nodes/registration.node.ts` — `buildRegistrationSystemPrompt()`, natural text, no JSON
- [x] `conversation.graph.ts` — stub replaced with real `registrationSubgraph`
- [x] `registration.service.ts` deleted — `RegistrationService` fully replaced by subgraph
- [x] `REGISTRATION_SERVICE_TOKEN`, `IRegistrationService` removed from `service.ports.ts`
- [x] `registrationLLMResponseSchema`, `RegistrationLLMResponse` removed from `registration.validation.ts`
- [x] `stripJsonFromMarkdown` removed with `registration.service.ts`
- [x] JSON format (~100 lines) removed from registration prompt
- [x] Old integration tests for `RegistrationService` deleted (2 files)

**Bugs found and fixed during live API testing (2026-02-24):**

**Bug 1 — `Command` with `resume` from tools caused recursion**
- Tools returned `new Command({ resume: ... })` instead of a plain string
- `ToolNode` receiving a `Command` does not create a `ToolMessage` → LLM sees unclosed `tool_call` → calls tool again → infinite loop
- Fix: tools return plain strings; `pendingTransition` propagated via closure ref (`{ value: TransitionRequest | null }`) that `extractNode` reads once per turn
- Applies to: `registration.tools.ts`, `chat.tools.ts`

**Bug 2 — `state.messages` not included in agent prompt → recursion**
- `agentNode` built LLM prompt from `contextService.getMessagesForPrompt()` (DB history) only
- `persist` node runs *after* subgraph finishes, so in-flight `AIMessage(tool_calls)` + `ToolMessage` live only in `state.messages` during the tool loop — DB has no record yet
- On `tools → agent` loop iteration, agent rebuilt the same prompt without ToolMessages → LLM saw only the original HumanMessage → called tool again → infinite loop
- Fix: `agentNode` appends `state.messages` (in-flight messages) after the HumanMessage so LLM sees tool results and responds with text
- Applies to: `registration.subgraph.ts`, `chat.subgraph.ts`

**Bug 3 — `userId` not passed to tools via `configurable`**
- `userId` was only passed to `model.invoke(..., { configurable: { userId } })` — scoped to that LLM call only
- `ToolNode` passes the *node's* config to tools, which contains only `thread_id` from `graph.invoke()`
- Tools checked `config.configurable.userId` → always `undefined` → returned `"Error: could not identify user"` → nothing saved to DB
- Fix: add `userId` to graph-level `configurable` in `chat.routes.ts`: `{ configurable: { thread_id: userId, userId } }`

**New tests added:**
- [x] `infra/ai/graph/tools/__tests__/registration.tools.unit.test.ts` — 13 tests: string return (not Command), field validation, pendingTransition mechanics, missing-fields block, error paths
- [x] `infra/ai/graph/tools/__tests__/chat.tools.unit.test.ts` — 11 tests: string return, updateProfileData calls, transition ref, no userService calls for request_transition
- [x] `infra/ai/graph/subgraphs/__tests__/registration.subgraph.unit.test.ts` — 2 RED-then-GREEN tests reproducing Bug 2: verify ToolMessage and AIMessage(tool_calls) appear in the second LLM call's messages array

**Test methodology note:** Tests were written RED first (reproducing the actual bug), confirmed to fail, then the fix was applied, tests turned GREEN. This is the required approach for all future bug fixes.

**Final state after all fixes:**
- [x] `npm run test:unit` — 69/69 ✓
- [x] API end-to-end: 5-step registration flow via `curl`, all fields saved to DB, `profile_status = 'complete'` ✓

**Notes:**
- `complete_registration` re-fetches user from DB to verify all 6 fields before marking `profileStatus = 'complete'`
- `save_profile_fields` reuses `validateExtractedFields()` from `registration.validation.ts` — same strict validators
- `firstName` is passed to `save_profile_fields` when user provides a name preference
- Command pattern documented in Step 3 was revised: tools do NOT return `Command` — closure ref pattern used instead (Command with `resume` breaks ToolNode's ToolMessage flow)

---

### Step 5: Plan Creation Subgraph
**Status**: **DONE + TESTED** ✓ (2026-02-24)

**New files:**
- `infra/ai/graph/tools/plan-creation.tools.ts` — 2 tools:
  - `save_workout_plan` — Zod schema: full workout plan with cycles, sessions, exercises. Calls `workoutPlanRepository.create()`, sets `pendingTransition` to `{ toPhase: 'chat' }`. Returns confirmation string with plan name and exercise count.
  - `request_transition` — allows user to cancel plan creation, sets `pendingTransition` to `{ toPhase: 'chat' }`.
- `infra/ai/graph/subgraphs/plan-creation.subgraph.ts` — agent + ToolNode + toolsCondition loop + extract node. Same pattern as registration and chat subgraphs.
- `infra/ai/graph/nodes/plan-creation.node.ts` — `buildPlanCreationSystemPrompt()`. Loads exercises with real `primaryMuscles`/`secondaryMuscles` from DB. Natural text, no JSON format instructions.

**Bug fixed during implementation:**
- `primaryMuscles`/`secondaryMuscles` always empty — fixed by adding `findAllWithMuscles()` to `IExerciseRepository` and `ExerciseRepository`. Exercises now loaded with muscle group data before building the system prompt.

**Wiring:**
- `conversation.graph.ts` — `stubPhaseNode('plan_creation')` replaced with real `buildPlanCreationSubgraph`.
- `register-infra-services.ts` — `exerciseRepository` added to `buildConversationGraph` call.
- `ConversationGraphDeps` — `exerciseRepository: IExerciseRepository` added.

**Implemented:**
- [x] `infra/ai/graph/tools/plan-creation.tools.ts` — `save_workout_plan` + `request_transition` with closure ref pattern
- [x] `infra/ai/graph/subgraphs/plan-creation.subgraph.ts` — agent + ToolNode + extract node
- [x] `infra/ai/graph/nodes/plan-creation.node.ts` — `buildPlanCreationSystemPrompt()` with muscle groups
- [x] `domain/training/ports/repository.ports.ts` — `findAllWithMuscles()` added to `IExerciseRepository`
- [x] `infra/db/repositories/exercise.repository.ts` — `findAllWithMuscles()` implemented
- [x] `conversation.graph.ts` — stub replaced with real subgraph
- [x] `infra/ai/graph/tools/__tests__/plan-creation.tools.unit.test.ts` — tool unit tests
- [x] `infra/ai/graph/subgraphs/__tests__/plan-creation.subgraph.unit.test.ts` — subgraph unit tests
- [x] All existing test suites updated (mocks extended for `findAllWithMuscles`)

**Dead code from old JSON-mode architecture (marked TODO: remove):**
- `domain/user/services/prompts/plan-creation.prompt.ts` — old 310-line JSON-mode prompt, superseded by `infra/ai/graph/nodes/plan-creation.node.ts`
- `domain/user/services/prompt.service.ts` — `buildPlanCreationPrompt()` marked TODO: remove
- `domain/user/ports/prompt.ports.ts` — `buildPlanCreationPrompt` in `IPromptService` marked TODO: remove
- `domain/training/plan-creation.types.ts` — `PlanCreationLLMResponseSchema`, `parsePlanCreationResponse` dead code (will be deleted in Step 9)

**Note on `promptService` in `ConversationGraphDeps`:** Kept for now as `IPromptService` is still referenced; will be removed in Step 9 cleanup when all phase nodes build prompts locally (in `infra/ai/graph/nodes/`).

**Final state:**
- [x] `npm run test` — 275/275 ✓
- [x] `npx tsc --noEmit` ✓

---

### Step 6: Session Planning Subgraph
**Status**: PENDING

**New files:**
- `infra/ai/graph/tools/session-planning.tools.ts`:
  - `start_training_session` — Zod schema includes `SessionRecommendationSchema`. Creates session with `status: 'planning'` and `planId` from active workout plan. Sets `state.activeSessionId`, sets `requestedTransition` to `training`. LLM must include full session plan in tool call args (prompt instructs this).
  - `cancel_planning` — sets `requestedTransition` to `chat`
- `infra/ai/graph/subgraphs/session-planning.subgraph.ts`
- `infra/ai/graph/nodes/session-planning.node.ts`

**Deleted:**
- `SessionPlanningLLMResponseSchema`, `parseSessionPlanningResponse`
- `lastSessionPlan` caching in `phaseContextStore`
- Session planning branch in `ChatService`
- JSON format in session planning prompt (~50 lines)

**How to test:**
- [ ] Unit test: LLM calls `start_training_session` → session created with status 'planning', planId set, activeSessionId set
- [ ] Unit test: LLM calls `cancel_planning` → transition to chat
- [ ] Unit test: tool validates session plan against Zod schema, rejects invalid plans

---

### Step 7: Training Subgraph
**Status**: PENDING

**New files:**
- `infra/ai/graph/tools/training.tools.ts` — 4 tools:
  - `log_set` — calls `TrainingService.logSetWithContext(sessionId, { exerciseId?, exerciseName?, setData, rpe?, feedback? })`
  - `next_exercise` — calls `completeCurrentExercise(sessionId)`
  - `skip_exercise` — calls `skipCurrentExercise(sessionId)`
  - `finish_training` — calls `completeSession(sessionId)`, sets `requestedTransition` to `chat`
- `infra/ai/graph/subgraphs/training.subgraph.ts`
- `infra/ai/graph/nodes/training.node.ts`

**New domain method:** `TrainingService.logSetWithContext(sessionId, opts)` — encapsulates:
1. `ensureCurrentExercise(sessionId, { exerciseId?, exerciseName? })`
2. `getSessionDetails(sessionId)` → find exercise
3. Calculate `nextSetNumber`
4. `logSet(exerciseId, { setNumber, setData, rpe, userFeedback })`

**No no-op tools:** `request_advice`, `modify_session`, `just_chat` eliminated — LLM responds with text naturally when no action is needed.

**Deleted:**
- `TrainingIntentSchema`, `LLMTrainingResponseSchema`, all training intent types
- `parseTrainingResponse`, `normalizeTrainingResponse`, `normalizeSetData`
- `executeTrainingIntent` method in ChatService
- Training branch in `ChatService`
- JSON format + intent documentation in training prompt (~150 lines)

**How to test:**
- [ ] Unit test for `TrainingService.logSetWithContext()` — mock repos, verify all 4 sub-steps
- [ ] Unit test per tool: mock TrainingService, verify correct method + args + return message
- [ ] Unit test: LLM responds without tools → just text response
- [ ] Manual: log sets during training via Telegram, verify data in DB

---

### Step 8: Transition Guards + Cleanup Node
**Status**: PENDING

**New files:**
- `infra/ai/graph/guards/transition.guard.ts` — pure validation functions
- `infra/ai/graph/nodes/transition-cleanup.node.ts` — side effects on allowed transitions

**Graph wiring:**
```
[Phase Subgraph] → [Persist Node] → [Transition Guard] → [Cleanup Node] → END
                                          ↓ (blocked)
                                         END (return response without transition)
```

**12 transition rules (VERIFY EACH — never executed in production):**

Allowed without conditions (5):
- `registration → plan_creation`
- `registration → chat`
- `chat → plan_creation`
- `plan_creation → chat` (user cancels)
- `session_planning → chat` (user cancels)

Allowed with conditions (4):
- `plan_creation → session_planning` — requires active workout plan
- `chat → session_planning` — requires active workout plan
- `session_planning → training` — requires `activeSessionId`, session exists, belongs to user, status='planning'. **Side effect:** cleanup node updates session to `status: 'in_progress'`, sets `startedAt`.
- `training → chat` — **side effect:** cleanup node auto-completes active session if status is `in_progress`

Blocked (3):
- `training → session_planning` — must complete training first
- `* → registration` — handled by router, not by LLM
- `registration → *` (except chat/plan_creation)

**profileStatus:** Only two values: `registration` and `complete`. User repo creates with `'registration'`.

**How to test:**
- [ ] Unit test per transition rule (12 tests)
- [ ] Unit test: cleanup node auto-completes session on `training → chat`
- [ ] Unit test: cleanup node sets session `in_progress` on `session_planning → training`

---

### Step 9: Final Cleanup
**Status**: PENDING

**Delete:**
- `ChatService` class + `CHAT_SERVICE_TOKEN`
- `LLMService` class + `LLM_SERVICE_TOKEN`
- All JSON parsers (5): `parseLLMResponse`, `parseTrainingResponse`, `parseSessionPlanningResponse`, `parsePlanCreationResponse`, `registrationLLMResponseSchema`
- All Zod response schemas: `LLMConversationResponseSchema`, `LLMTrainingResponseSchema`, `SessionPlanningLLMResponseSchema`, `PlanCreationLLMResponseSchema`
- `SessionPlanningContextBuilder.formatForPrompt()` — dead code, never called
- Unused imports, dead tests, orphaned type files
- Update DI registration (remove ChatService, RegistrationService, LLMService)

**How to test:**
- [ ] `npx tsc --noEmit` — compiles
- [ ] `npm run test:unit` — all tests pass
- [ ] `npm run test:integration` — integration tests pass
- [ ] Full manual flow: registration → chat → plan_creation → session_planning → training → finish → chat

**ADR-0007 update**: Mark status as IMPLEMENTED. Add final architecture diagram.

---

## ADR-0007 Updates (tracked)

| Step | ADR Update |
|------|------------|
| Step 0 | Update Dependencies section with actual versions |
| Step 1 | Add error recovery strategy clarification |
| Step 2.5 | Document checkpointer as state management strategy; ConversationContextService 2-method interface; profileStatus normalization |
| Step 3 | Document tool calling as standard LLM interaction pattern; subgraph architecture |
| Step 5 | Document exercise muscle groups in plan creation context |
| Step 7 | Document `logSetWithContext` method; 4 tools (no no-op tools) |
| Step 8 | Document full transition rule set (12 rules — all verified); session create/start separation; persist→guard→cleanup ordering |
| Step 9 | Mark status IMPLEMENTED, add final diagram |
