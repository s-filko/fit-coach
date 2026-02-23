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
**Status**: PENDING

The largest step. Builds the entire foundation of the new architecture.

**New dependency:** `@langchain/langgraph-checkpoint-postgres`

**New files:**
- `infra/ai/model.factory.ts` — shared `ChatOpenAI` factory with env config, LangChain `CallbackHandler` for logging
- `infra/ai/graph/nodes/router.node.ts` — loads user, determines phase, handles session timeout
- `infra/ai/graph/nodes/persist.node.ts` — writes user+assistant turn to `conversation_turns`

**Rewritten files:**
- `domain/conversation/graph/conversation.state.ts` — redesigned state (see Architecture section)
- `domain/conversation/ports/conversation-context.ports.ts` — 2-method interface only
- `infra/conversation/drizzle-conversation-context.service.ts` — rewritten: delete `getContext`, `startNewPhase`, `phaseContextStore`, `PHASE_ENDED_PREFIX`, `updatePhaseContext`, `reset`, `summarize`. New `getMessagesForPrompt(userId, phase, options)` queries DB directly.
- `infra/ai/graph/conversation.graph.ts` — `compile({ checkpointer })`, router + persist + phase routing + transition guard + cleanup
- `app/routes/chat.routes.ts` — thin proxy (~20 lines)
- `main/register-infra-services.ts` — init checkpointer, remove ChatService/RegistrationService from route dependencies
- `app/types/fastify.d.ts` — update services type
- `infra/db/repositories/user.repository.ts` — `profileStatus` default `'incomplete'` → `'registration'`

**Deleted:**
- `getContext()`, `startNewPhase()`, `reset()`, `summarize()`, `updatePhaseContext()` from ConversationContextService
- `PHASE_ENDED_PREFIX` constant
- `phaseContextStore` in-memory Map
- All phase detection logic in `chat.routes.ts` (~150 lines)
- Registration/ChatService orchestration in route

**Data reset:** `TRUNCATE conversation_turns` — removes old `[PHASE_ENDED]` markers

**How to test:**
- [ ] Unit test: router node — new user → phase 'registration'
- [ ] Unit test: router node — complete user → phase 'chat'
- [ ] Unit test: router node — session timeout → phase 'chat', message returned
- [ ] Unit test: router node — resets `requestedTransition` to null
- [ ] Unit test: persist node — appendTurn called with correct userId, phase, messages
- [ ] Unit test: persist node — appendTurn failure does not throw (logs warning, continues)
- [ ] Unit test: invoke graph twice with same thread_id, verify state.phase persists
- [ ] `conversation-context.service.unit.test.ts` — rewrite for 2-method interface
- [ ] `npx tsc --noEmit` — clean
- [ ] `npm run test:unit` — all pass

---

### Step 3: Chat Subgraph (tool calling)
**Status**: PENDING

First phase subgraph — establishes the pattern for all other phases.

**Key decision:** Determine the tools→state update mechanism (Command, post-processing, or closure — see Architecture section). This pattern is reused by all subsequent subgraphs.

**New files:**
- `infra/ai/graph/tools/chat.tools.ts`:
  - `update_profile` — Zod: `{ age?, gender?, height?, weight?, fitnessLevel?, fitnessGoal? }`. Calls `userService.updateProfileData()`, re-reads user, returns confirmation string. Updates `state.user`.
  - `request_transition` — Zod: `{ toPhase, reason? }`. Sets `state.requestedTransition`.
- `infra/ai/graph/subgraphs/chat.subgraph.ts` — agent_node + ToolNode + toolsCondition loop

**Rewritten files:**
- `infra/ai/graph/nodes/chat.node.ts` — becomes agent_node inside subgraph: loads history via `getMessagesForPrompt(userId, phase)`, builds prompt, invokes model with tools
- `domain/user/services/prompt.service.ts` — `buildChatSystemPrompt`: remove JSON response format section (~40 lines)

**Deleted:**
- `parseLLMResponse()` function
- `LLMConversationResponseSchema`
- `chat.node.unit.test.ts` (old JSON-mode test) — replaced by new subgraph test

**How to test:**
- [ ] Unit test: LLM returns text only → responseMessage set, no tools called
- [ ] Unit test: LLM calls `update_profile` → `userService.updateProfileData` called, state.user updated
- [ ] Unit test: LLM calls `request_transition` → `requestedTransition` set in state via chosen mechanism
- [ ] Unit test: tools→state mechanism works end-to-end (tool updates state, subgraph returns updated state)
- [ ] Manual: send "change my weight to 85kg" → verify DB updated, natural text response
- [ ] `npm run test:unit` — all pass

---

### Step 4: Registration Subgraph
**Status**: PENDING

**New files:**
- `infra/ai/graph/tools/registration.tools.ts`:
  - `save_profile_fields` — Zod schema uses validators from `registration.validation.ts`: `{ name?, age?, gender?, height?, weight?, fitnessLevel?, fitnessGoal? }`. Calls `userService.updateProfileData()`, re-reads user, updates `state.user`. Returns confirmation of saved fields.
  - `complete_registration` — checks all 6 fields present on `state.user`, sets `profileStatus = 'complete'`, sets `requestedTransition` to `'chat'` or `'plan_creation'` (LLM passes desired phase). Returns error if fields missing.
- `infra/ai/graph/subgraphs/registration.subgraph.ts`
- `infra/ai/graph/nodes/registration.node.ts`

**Deleted:**
- `RegistrationService` class + `REGISTRATION_SERVICE_TOKEN` + DI registration
- `registrationLLMResponseSchema`
- `stripJsonFromMarkdown`
- JSON format in registration prompt (~30 lines)
- `registration.service.ts` file

**How to test:**
- [ ] Unit test: LLM calls `save_profile_fields` → DB updated, state.user refreshed
- [ ] Unit test: `complete_registration` with all fields → profileStatus 'complete', transition set
- [ ] Unit test: `complete_registration` with missing fields → error returned, no transition
- [ ] Manual: fresh user, complete registration through Telegram bot

---

### Step 5: Plan Creation Subgraph
**Status**: PENDING

**New files:**
- `infra/ai/graph/tools/plan-creation.tools.ts`:
  - `save_workout_plan` — Zod schema = `WorkoutPlanDraftSchema`. Includes exercise resolution logic (resolve by ID → by name → keep as-is with warning). Saves plan to DB, sets `requestedTransition` to `session_planning`.
- `infra/ai/graph/subgraphs/plan-creation.subgraph.ts`
- `infra/ai/graph/nodes/plan-creation.node.ts`

**Bug fixes:**
- Load exercises with muscle groups: add `findAllWithMuscles()` to exercise repo (or use `findByIdsWithMuscles`). Pass real `primaryMuscles`/`secondaryMuscles` to prompt.
- Remove duplicate `UserProfile` and `PlanCreationPromptContext` types from `plan-creation.prompt.ts` — use domain types directly from `prompt.ports.ts`.

**Deleted:**
- `PlanCreationLLMResponseSchema`, `parsePlanCreationResponse`
- `generateStructured` usage in ChatService
- Plan creation branch in `ChatService`
- JSON format in plan creation prompt (~50 lines)
- Duplicate type definitions in `plan-creation.prompt.ts`

**How to test:**
- [ ] Unit test: LLM calls `save_workout_plan` → plan saved, exercise IDs resolved, transition set
- [ ] Unit test: LLM responds without calling tool → no plan saved (conversation continues)
- [ ] Unit test: tool rejects plan with invalid Zod schema
- [ ] Verify: prompt includes real muscle groups for exercises

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
