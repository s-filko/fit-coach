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
- Previous implementation plan: `docs/IMPLEMENTATION_PLAN.md` (FEAT-0010 steps — completed, this plan supersedes the architecture)

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

---

## Principles

- Each step produces a **testable result**: unit tests pass, or a manual curl confirms behavior
- Old code stays alive until the new path is proven; dead code gets `// TODO: remove — migrated to <file>` comments
- No time estimates — done when done, each step is a commit
- **All state lives in LangGraph checkpointer** — no custom state management
- **All LLM side effects go through tool calling** — no JSON mode + manual parsing
- **Use library features, not custom code** — `ToolNode`, `toolsCondition`, `PostgresSaver`, `CallbackHandler`

### Migration = Refactor and Improve, Not Copy-Paste

Each graph node is built **based on existing logic**, but with active improvement:

1. Study the source code — understand **what** it does and **why**
2. Identify what to **keep** (business rules, invariants), what to **simplify**, and what to **drop**
3. Build with LangGraph-native patterns — tool calling, checkpointer state, ToolNode loops
4. If something doesn't fit — **raise for discussion immediately**
5. Mark old code `// TODO: remove — migrated to nodes/<node-file>.ts`

**Business invariants (keep):**
- `saveWorkoutPlan` only when LLM calls `save_workout_plan` tool with user approval [FEAT-0010]
- `saveSessionPlan` only when LLM calls `start_training_session` tool + return `sessionId`
- Registration completeness: all 6 fields + explicit user confirmation
- Phase priority for migration: training > session_planning > plan_creation > chat

### What Stays

- `TrainingService` (`domain/training/`) — domain logic, called from tools
- `PromptService` (`domain/user/services/prompt.service.ts`) — prompt building, but prompts simplified (no JSON format instructions)
- `conversation_turns` table — conversation history for prompts and analytics (NOT for state)
- DB schema — unchanged (checkpointer creates its own tables)
- API contract — `POST /api/chat` request/response format identical

### What Gets Replaced

- `LLMService` → `ChatOpenAI` directly via model factory + LangChain callbacks for logging
- `ChatService` → graph nodes (chat, plan_creation, session_planning, training)
- `RegistrationService` → registration graph node
- `ConversationContextService.getContext()` for phase detection → checkpointer
- `ConversationContextService.startNewPhase()` + `[PHASE_ENDED]` markers → checkpointer state update
- `phaseContextStore` in-memory Map → checkpointer persisted state
- `parseLLMResponse`, `parseTrainingResponse`, `parseSessionPlanningResponse` → tool calling
- `TrainingIntentSchema` + `executeTrainingIntent` switch → individual tools
- Phase determination in `chat.routes.ts` → Router Node

---

## Test Strategy

### Tests that stay untouched
- `session-planning-context.builder.unit.test.ts` — context builder
- `user.service.*.unit.test.ts` — user service logic
- `user.repository.unit.test.ts` — repository
- All middleware/cors/validation integration tests
- All database integration tests

### Tests updated during migration
- `conversation-context.service.unit.test.ts` — update when service is simplified (Step 9)
- `chat.routes.integration.test.ts` — update when route is simplified (Step 2.5)
- `plan-creation.integration.test.ts` — update to test graph node (Step 5)
- `registration.integration.test.ts` — update to test graph node (Step 4)

### Tests replaced
- `training-intent.unit.test.ts` → new tool tests (Step 7)
- `llm-response.unit.test.ts` → becomes irrelevant when JSON parsers removed (Step 10)
- `llm-json-validation.unit.test.ts` → becomes irrelevant (Step 10)
- `chat-json-mode.unit.test.ts` → replaced by tool calling tests

### New tests per step
- Each tool: unit test (mock service, verify correct method + args)
- Each node: unit test (mock model + tools, verify state output)
- Router node: unit test (verify phase from checkpointer + migration scenarios)
- Transition guards: unit test per rule (12 rules)
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
**Status**: DONE → NEEDS REWORK (Step 3 replaces with tool calling)

Transferred chat branch from `ChatService.processMessage()` into graph node with JSON mode + `parseLLMResponse`. This works but uses the old pattern (JSON mode + manual parsing). Step 3 replaces it with tool calling.

**Files created (will be rewritten):**
- `infra/ai/graph/nodes/chat.node.ts`
- `infra/ai/graph/nodes/__tests__/chat.node.unit.test.ts`

---

### Step 2.5: PostgreSQL Checkpointer + Model Factory + State Redesign
**Status**: PENDING

**What:** Foundation of the new architecture. State persistence, model access, route simplification.

**New dependency:** `@langchain/langgraph-checkpoint-postgres` ^1.0.1

**New files:**
- `infra/ai/model.factory.ts` — shared `ChatOpenAI` factory with config from env, LangChain `CallbackHandler` for logging (replaces `LLMService` wrapper)
- `infra/ai/graph/nodes/router.node.ts` — loads user from DB, determines initial phase (for new users and migration from old system)
- `infra/ai/graph/nodes/persist.node.ts` — writes user+assistant turn to `conversation_turns` after each invocation

**Updated files:**
- `domain/conversation/graph/conversation.state.ts` — redesigned state:
  ```
  phase: ConversationPhase          — persisted by checkpointer, default 'registration'
  userId: string                    — set on input
  userMessage: string               — set on input
  responseMessage: string           — set by phase node
  user: User | null                 — loaded by router node
  activeSessionId: string | null    — persisted, replaces in-memory Map
  requestedTransition: {...} | null — set by request_transition tool
  ```
- `infra/ai/graph/conversation.graph.ts` — `compile({ checkpointer })`, add router node, persist node
- `app/routes/chat.routes.ts` — thin proxy: `graph.invoke({ userMessage }, { configurable: { thread_id: userId } })` → response
- `main/register-infra-services.ts` — init checkpointer with DB connection string, call `setup()`
- `app/types/fastify.d.ts` — update services type

**Route before (180 lines):**
- Get user, check registration, 3x getContext for phase, load history, invoke graph, appendTurn, startNewPhase, error handling

**Route after (~25 lines):**
- Get user (for 404 check only), invoke graph with thread_id, return response

**How to test:**
- [ ] Unit test: invoke graph twice with same thread_id, verify state.phase persists
- [ ] Unit test: invoke graph with new thread_id, verify default phase = 'registration'
- [ ] Unit test: router node loads user and sets state.user
- [ ] `npx tsc --noEmit` — clean
- [ ] `npm run test:unit` — all tests pass

---

### Step 3: Chat Node → Tool Calling
**Status**: PENDING

**What:** Rewrite chat node from JSON mode to tool calling. First node using the new pattern — establishes template for all other nodes.

**New files:**
- `infra/ai/graph/tools/chat.tools.ts`:
  - `update_profile` — calls `userService.updateProfileData()`, Zod schema: `{ age?, gender?, height?, weight?, fitnessLevel?, fitnessGoal? }`
  - `request_transition` — sets `state.requestedTransition`, Zod schema: `{ toPhase, reason? }`

**Updated files:**
- `infra/ai/graph/nodes/chat.node.ts` — rewritten:
  - Load history from `ConversationContextService.getMessagesForPrompt()`
  - Build system prompt via `PromptService.buildChatSystemPrompt()` (simplified, no JSON format)
  - `model.bindTools(chatTools).invoke(messages)` → `ToolNode` loop → final text response
  - Return `{ responseMessage, requestedTransition }`
- `domain/user/services/prompt.service.ts` — `buildChatSystemPrompt`: remove JSON response format section (~40 lines)

**Architecture pattern (reused by all subsequent nodes):**
```
[phase_node] → calls model.bindTools(tools).invoke(messages)
     ↓ (has tool_calls?)
[tool_node] → executes tools, returns ToolMessage
     ↓ (loop back)
[phase_node] → model sees tool results, generates final text
     ↓ (no more tool_calls)
→ return { responseMessage }
```

**How to test:**
- [ ] Unit test: LLM returns text only → responseMessage set, no tools called
- [ ] Unit test: LLM calls `update_profile` → `userService.updateProfileData` called with correct args
- [ ] Unit test: LLM calls `request_transition` → `requestedTransition` set in state
- [ ] Manual: send "change my weight to 85kg" → verify DB updated, natural text response
- [ ] `npm run test:unit` — all tests pass

---

### Step 4: Registration Node + Tools
**Status**: PENDING

**What:** Registration flow via tool calling. LLM extracts profile fields and calls tools.

**New files:**
- `infra/ai/graph/tools/registration.tools.ts`:
  - `save_profile_fields` — Zod schema: `{ name?, age?, gender?, height?, weight?, fitnessLevel?, fitnessGoal? }`. Calls `userService.updateProfileData()`. Returns confirmation of what was saved.
  - `complete_registration` — checks all 6 fields present, sets `profileStatus = 'complete'`, sets `state.phase` to `'chat'` or `'plan_creation'`
- `infra/ai/graph/nodes/registration.node.ts`

**Source logic preserved (as tool behavior):**
- `validateExtractedFields` — validation moves into tool's Zod schema
- Completeness check: tool refuses to complete if fields are missing
- `profileStatus` update: tool handles atomically
- Fallback on LLM error: node catches and returns friendly message

**What gets dropped:**
- `stripJsonFromMarkdown` — no JSON in LLM response
- `registrationLLMResponseSchema` — replaced by tool schemas
- `RegistrationService` class — marked `// TODO: remove`
- JSON format in registration prompt (~30 lines)

**How to test:**
- [ ] Unit test: LLM calls `save_profile_fields` with extracted data → DB updated
- [ ] Unit test: LLM calls `complete_registration` with all fields present → phase changes
- [ ] Unit test: LLM calls `complete_registration` with missing fields → error returned, no transition
- [ ] Manual: fresh user, complete registration through Telegram bot

---

### Step 5: Plan Creation Node + Tools
**Status**: PENDING

**What:** Workout plan creation via tool calling.

**New files:**
- `infra/ai/graph/tools/plan-creation.tools.ts`:
  - `save_workout_plan` — Zod schema = `WorkoutPlanDraftSchema`. Saves plan to DB, sets `requestedTransition` to `session_planning`. LLM calls this when user approves the plan.
- `infra/ai/graph/nodes/plan-creation.node.ts`

**Critical invariant [FEAT-0010]:** Plan is saved ONLY when LLM calls `save_workout_plan` tool — this means user explicitly approved. No implicit saves.

**What gets dropped:**
- `generateStructured` usage — tool schema replaces it
- `PlanCreationLLMResponseSchema` manual parsing
- Plan creation branch in `ChatService`

**How to test:**
- [ ] Unit test: LLM calls `save_workout_plan` → plan saved to DB, transition set
- [ ] Unit test: LLM responds without calling tool → no plan saved (conversation continues)
- [ ] Unit test: tool validates plan against Zod schema, rejects invalid plans

---

### Step 6: Session Planning Node + Tools
**Status**: PENDING

**What:** Session planning via tool calling.

**New files:**
- `infra/ai/graph/tools/session-planning.tools.ts`:
  - `start_training_session` — creates workout session from plan, sets `state.activeSessionId`, sets `requestedTransition` to `training`. Zod schema includes `SessionRecommendationSchema`.
  - `cancel_planning` — sets `requestedTransition` to `chat`
- `infra/ai/graph/nodes/session-planning.node.ts`

**What changes vs MVP:**
- `lastSessionPlan` cached in checkpointer state (not in-memory Map) — survives server restart
- Parse retry eliminated — tool schema validates input, LLM retries naturally via tool loop
- Session created only when LLM calls `start_training_session` (explicit user confirmation)

**How to test:**
- [ ] Unit test: LLM calls `start_training_session` → session created, activeSessionId set
- [ ] Unit test: LLM calls `cancel_planning` → transition to chat
- [ ] Unit test: tool validates session plan schema

---

### Step 7: Training Node + Tools
**Status**: PENDING

**What:** Training session management via tool calling. Largest tool set.

**New files:**
- `infra/ai/graph/tools/training.tools.ts` — 6 tools:
  - `log_set` — calls `TrainingService.logSetWithContext(sessionId, { exerciseId?, exerciseName?, setData, rpe?, feedback? })`
  - `next_exercise` — calls `completeCurrentExercise(sessionId)`
  - `skip_exercise` — calls `skipCurrentExercise(sessionId)`
  - `finish_training` — calls `completeSession(sessionId)`, sets `requestedTransition` to `chat`
  - `request_advice` — no DB action, returns acknowledgment
  - `modify_session` — no DB action, returns acknowledgment
- `infra/ai/graph/nodes/training.node.ts`

**New domain method:** `TrainingService.logSetWithContext(sessionId, opts)` — encapsulates:
1. `ensureCurrentExercise(sessionId, { exerciseId?, exerciseName? })`
2. `getSessionDetails(sessionId)` → find exercise
3. Calculate `nextSetNumber`
4. `logSet(exerciseId, { setNumber, setData, rpe, userFeedback })`

**Training prompt rewrite:** Remove ~150 lines of JSON intent format documentation from `prompts/training.prompt.ts`. Tools describe themselves via Zod `.describe()`. Prompt keeps: coaching role, session context, progress display, exercise catalog.

**`just_chat` intent eliminated** — when user just chats, LLM simply responds with text (no tool call needed). This is the natural behavior of tool calling — tools are optional.

**OpenRouter compatibility:** Verified 2026-02-22 — `google/gemini-3-flash-preview` supports tool calling with 5+ tools through OpenRouter.

**How to test:**
- [ ] Unit test for `TrainingService.logSetWithContext()` — mock repos, verify all 4 sub-steps
- [ ] Unit test per tool: mock TrainingService, verify correct method + args
- [ ] Unit test: LLM responds without tools → just text response (replaces `just_chat`)
- [ ] Manual: log sets during training via Telegram, verify data in DB

---

### Step 8: Transition Guards + Cleanup Node
**Status**: PENDING

**What:** Phase transition validation as LangGraph conditional edges.

**New files:**
- `infra/ai/graph/guards/transition.guard.ts` — pure validation functions
- `infra/ai/graph/nodes/transition-cleanup.node.ts` — side effects

**Guards are pure validators.** Side effects (auto-complete session) in cleanup node.

```
[phase node] → [transition guard] → [cleanup node] → update state.phase → END
                     ↓ (blocked)
                    END (return response without transition)
```

**12 transition rules (from `ChatService.validatePhaseTransition`):**

Allowed without conditions (5):
- `registration → plan_creation`
- `registration → chat`
- `chat → plan_creation`
- `plan_creation → chat` (user cancels)
- `session_planning → chat` (user cancels)

Allowed with conditions (4):
- `plan_creation → session_planning` — requires active workout plan
- `chat → session_planning` — requires active workout plan
- `session_planning → training` — requires sessionId + session exists + belongs to user + status='planning'
- `training → chat` — side effect: auto-complete active session

Blocked (3):
- `training → session_planning` — must complete training first
- `* → registration` — handled by router, not by LLM
- `registration → *` (except chat/plan_creation)

**profileStatus normalization:** `'incomplete'` (legacy) → `'registration'`. Only two valid values: `registration` and `complete`.

**How to test:**
- [ ] Unit test per transition rule
- [ ] Unit test: cleanup node auto-completes session on `training → chat`

---

### Step 9: ConversationContextService Simplification
**Status**: PENDING

**What:** Remove state management responsibilities from ConversationContextService.

**Remove:**
- `getContext()` phase detection logic (`[PHASE_ENDED]` marker scanning)
- `startNewPhase()` (writes `[PHASE_ENDED]` + opens new phase)
- `phaseContextStore` in-memory Map
- `PHASE_ENDED_PREFIX` constant
- `updatePhaseContext()` method
- `reset()` method (was no-op anyway)
- `summarize()` method (was no-op stub)

**Keep:**
- `appendTurn(userId, phase, userMessage, assistantResponse)` — write to conversation_turns
- `getMessagesForPrompt(ctx, options)` — sliding window for prompt history

**Simplify interface:** `IConversationContextService` reduces to 2 methods.

**How to test:**
- [ ] Update `conversation-context.service.unit.test.ts`
- [ ] Verify no code references removed methods

---

### Step 10: Cleanup
**Status**: PENDING

**What:** Remove all dead code marked with `// TODO: remove`.

**Delete/gut:**
- `ChatService` class + `CHAT_SERVICE_TOKEN`
- `RegistrationService` class + `REGISTRATION_SERVICE_TOKEN`
- `LLMService` class + `LLM_SERVICE_TOKEN`
- `parseLLMResponse()`, `parseTrainingResponse()`, `parseSessionPlanningResponse()`
- `TrainingIntentSchema`, `LLMConversationResponseSchema`, `registrationLLMResponseSchema`
- `LLMTrainingResponseSchema`, `SessionPlanningLLMResponseSchema`
- Old phase resolution in `chat.routes.ts`
- JSON format sections from all prompts

**How to test:**
- [ ] `npx tsc --noEmit` — compiles
- [ ] `npm run test:unit` — all tests pass
- [ ] `npm run test:integration` — integration tests pass
- [ ] Full manual flow: registration → chat → plan_creation → session_planning → training → finish → chat

**ADR-0007 update**: Mark status as IMPLEMENTED. Add final architecture diagram.

---

## Architecture (Target)

```
POST /api/chat
  → chat.routes.ts (thin proxy: ~25 lines)
  → graph.invoke({ userMessage }, { thread_id: userId })
  → ConversationGraph (compiled with PostgresSaver checkpointer)
      │
      ├── [Router Node]
      │     Loads user from DB
      │     For new users: sets phase from profileStatus
      │     For existing: phase comes from checkpointer
      │
      ├── [Phase Node] (one of 5, routed by state.phase)
      │     Loads conversation history from conversation_turns
      │     Builds system prompt via PromptService
      │     Calls model.bindTools(phaseTools).invoke(messages)
      │     ┌─ [ToolNode] executes tool calls
      │     └─ Loop back to model until no more tool_calls
      │     Returns: responseMessage, requestedTransition
      │
      ├── [Transition Guard] (conditional edge)
      │     Validates requestedTransition against 12 rules
      │     If blocked → skip transition
      │
      ├── [Cleanup Node] (if transition allowed)
      │     Side effects: auto-complete session, etc.
      │     Updates state.phase
      │
      ├── [Persist Node]
      │     Writes user+assistant turn to conversation_turns
      │
      └── State saved to PostgreSQL checkpointer
          (phase, activeSessionId, user, requestedTransition)
```

### Tool Calling per Phase

- **Chat**: `update_profile`, `request_transition`
- **Registration**: `save_profile_fields`, `complete_registration`
- **Plan Creation**: `save_workout_plan`
- **Session Planning**: `start_training_session`, `cancel_planning`
- **Training**: `log_set`, `next_exercise`, `skip_exercise`, `finish_training`, `request_advice`, `modify_session`

---

## ADR-0007 Updates (tracked)

| Step | ADR Update |
|------|------------|
| Step 0 | Update Dependencies section with actual versions |
| Step 1 | Add error recovery strategy clarification |
| Step 2.5 | Document checkpointer as state management strategy; deprecate `[PHASE_ENDED]` pattern |
| Step 3 | Document tool calling as standard LLM interaction pattern |
| Step 7 | Document `logSetWithContext` method; OpenRouter tool calling verification |
| Step 8 | Document full transition rule set (12 rules); `profileStatus` normalization |
| Step 9 | Document ConversationContextService scope reduction |
| Step 10 | Mark status IMPLEMENTED, add final diagram |
