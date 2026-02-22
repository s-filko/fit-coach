# ADR-0007 LangGraph Migration — Implementation Plan

**ADR**: `docs/adr/0007-langgraph-gradual-migration.md`  
**Status**: IN PROGRESS  
**Last Updated**: 2026-02-22

## Related

- ADR-0007: Gradual Migration to LangGraph
- ADR-0005: Conversation Context Session
- ADR-0006: Session Plan Storage
- FEAT-0010: Training Session Management (`docs/features/FEAT-0010-training-session-management.md`)
- FEAT-0009: Conversation Context (`docs/features/FEAT-0009-conversation-context.md`)
- Previous implementation plan: `docs/IMPLEMENTATION_PLAN.md` (FEAT-0010 steps — completed, this plan supersedes the architecture)

## Principles

- Each step produces a **testable result**: unit tests pass, or a manual curl confirms behavior
- Old code stays alive until the new path is proven; dead code gets `// TODO: remove — migrated to <file>` comments
- ADR-0007 is updated incrementally — only improvements and safety clarifications
- No time estimates — done when done, each step is a commit

### Migration = Transfer, Not Rewrite

Each graph node is created by **moving existing logic from ChatService / RegistrationService**, not by writing new code from scratch. The process for each step:

1. Open the source code (the specific `if/else` branch in `ChatService.processMessage` or `RegistrationService.processUserMessage`)
2. Transfer logic line-by-line into the new node, preserving all edge cases: retry on parse failure, conditional saves, fallback responses, error handling
3. Adapt to graph state interface (read from `state.X`, write to `state.responseMessage`) instead of direct returns
4. Reference the original code with comments like `// Ported from ChatService.processMessage, plan_creation branch`
5. Mark the old code `// TODO: remove — migrated to nodes/<node-file>.ts`
6. Both paths coexist; route selects which one to use

Key existing logic that must NOT be lost during transfer:
- `loadPlanCreationContext` / `loadSessionPlanningContext` / `loadTrainingContext` — phase-specific data loading
- Retry-on-parse-failure in training and session_planning branches
- `saveWorkoutPlan` only when `phaseTransition?.toPhase === 'session_planning'` [BR from FEAT-0010 Step 11]
- `saveSessionPlan` only when transitioning to training + returning `sessionId`
- `handleProfileUpdate` filtering in chat phase
- Registration fallback response on LLM/parse error
- `stripJsonFromMarkdown` preprocessing in registration

### What Stays Unchanged

These components are reused as-is (not migrated, not rewritten):
- `LLMService` (`infra/ai/llm.service.ts`) — all LLM calls go through it
- `ConversationContextService` (`infra/conversation/`) — source of truth for conversation history
- `TrainingService` (`domain/training/services/training.service.ts`) — called from tool implementations
- `PromptService` (`domain/user/services/prompt.service.ts`) — prompt building for each phase
- All Zod schemas and parsers (except `TrainingIntentSchema` which is replaced by tools in Step 6)
- API contract: `POST /api/chat` request/response format identical

---

## Test Strategy

**22 existing test files.** Handled as follows during migration:

### Tests that stay untouched

Test pure domain logic, schemas, parsers — not affected by graph migration:
- `llm-response.unit.test.ts` — LLM response Zod schemas
- `plan-creation.unit.test.ts` — plan creation Zod schemas
- `session-planning-context.builder.unit.test.ts` — context builder
- `llm-json-validation.unit.test.ts` — LLM JSON mode validation
- `user.service.*.unit.test.ts` — user service logic
- `user.repository.unit.test.ts` — repository
- `conversation-context.service.unit.test.ts` — context service
- All middleware/cors/validation integration tests
- All database integration tests

### Tests updated when their step is done

- `plan-creation.integration.test.ts` — update to test graph node (Step 4)
- `registration.integration.test.ts` — update to test graph node (Step 3)
- `chat.routes.integration.test.ts` — update when route is simplified (Step 8)
- `chat-json-mode.unit.test.ts` — update if prompt structure changes

### Tests replaced

- `training-intent.unit.test.ts` — training intent Zod schemas become irrelevant when tools replace JSON intents (Step 6); new tests for tool definitions replace them

### New tests added per step

- Each graph node gets a unit test (mock LLMService, verify input/output)
- Each tool gets a unit test (mock TrainingService, verify DB calls)
- Router node gets a unit test (mock contexts, verify phase selection)
- Edge guards get unit tests (verify valid/invalid transitions)

---

## Implementation Steps

### Step 0: Library Upgrade
**Status**: PENDING

**What:** Upgrade LangChain ecosystem + add LangGraph + bump Zod.

**Changes in** `apps/server/package.json`:
- `@langchain/core`: ^0.3.72 → ^1.1.27
- `@langchain/openai`: ^0.6.9 → ^1.2.9
- `@langchain/langgraph`: NEW → ^1.1.5
- `zod`: ^4.1.5 → ^4.3.6

**Rationale**: LangGraph 1.1.5 requires `@langchain/core` >= 1.1.16 and `zod` >= 4.2.0. Current `@langchain/openai` 0.6.9 requires `@langchain/core` < 0.4.0 which conflicts, so it must also be upgraded to 1.2.9.

**Risk assessment**: Only 2 import lines from LangChain in the entire project (`llm.service.ts`). `AIMessage`, `HumanMessage`, `SystemMessage`, `ChatOpenAI` — all remain the same in v1. No code changes expected.

**How to test:**
- [ ] `npm install` — no peer dep conflicts
- [ ] `npx tsc --noEmit` — no type errors
- [ ] `npm run test:unit` — all existing tests pass
- [ ] Smoke test: `ChatOpenAI.invoke()` + `model.bindTools()` work with OpenRouter

**ADR-0007 update**: Update Dependencies section with actual installed versions.

---

### Step 1: Graph State + Skeleton Graph
**Status**: PENDING

**What:** Create the LangGraph state definition and an empty graph skeleton.

**New files:**
- `domain/conversation/graph/conversation.state.ts` — state type using LangGraph `Annotation.Root`
- `infra/ai/graph/conversation.graph.ts` — `StateGraph` builder, initially with a single passthrough node

**State shape:**
```typescript
{
  userId: string,
  phase: ConversationPhase,
  messages: ChatMsg[],              // history loaded from ConversationContextService
  userMessage: string,              // current user input
  responseMessage: string,          // LLM output to return
  requestedTransition: {
    toPhase: ConversationPhase,
    reason?: string,
    sessionId?: string
  } | null,
}
```

**DI registration** in `main/register-infra-services.ts` — alongside existing services.

**How to test:**
- [ ] Unit test: create graph, invoke with dummy state, verify it returns state unchanged
- [ ] `npx tsc --noEmit` — types compile

---

### Step 2: Chat Phase Node + Hybrid Routing
**Status**: PENDING

**What:** Transfer the `chat` branch from `ChatService.processMessage()` into a graph node. Simplest phase — no DB side effects, just LLM call + response + optional profileUpdate.

**Source code to transfer from:** `ChatService.processMessage`, chat branch:
- `buildSystemPrompt('chat')` — load user, build prompt via `PromptService.buildChatSystemPrompt()`
- `generateWithSystemPrompt(messages, prompt, { jsonMode: true })` — same call
- `parseLLMResponse()` — reuse existing parser as-is
- `handleProfileUpdate()` — transfer profile update logic for chat phase

**New file:** `infra/ai/graph/nodes/chat.node.ts`

**Route change in** `app/routes/chat.routes.ts`:
- Add hybrid routing: if `phase === 'chat'` → invoke graph, else → old `ChatService.processMessage()`
- Graph returns `{ responseMessage, requestedTransition }`, route handles `appendTurn` and `startNewPhase` same as before

**How to test:**
- [ ] Unit test: mock LLMService + PromptService, invoke chatNode, verify output shape matches `ProcessMessageResult`
- [ ] Manual curl: send message as registered user in chat phase, verify response identical to old path
- [ ] `npm run test:unit` — existing tests still pass

---

### Step 3: Registration Phase Node
**Status**: PENDING

**What:** Transfer `RegistrationService.processUserMessage()` (126 lines) into a graph node.

**Source code to transfer from:** `RegistrationService.processUserMessage` (lines 34-126):
- Prompt build → LLM call → JSON parse with error fallback → field validation → user merge → completeness check

**Must preserve:**
- Fallback response on LLM error
- `stripJsonFromMarkdown` preprocessing
- `validateExtractedFields` filtering
- Completeness check: all 6 fields + `is_confirmed` → `isComplete`
- `profileStatus` update

**New file:** `infra/ai/graph/nodes/registration.node.ts`

**How to test:**
- [ ] Unit test: mock deps, send registration message, verify profile fields extracted and merged
- [ ] Unit test: verify fallback response when LLM call fails
- [ ] Update `registration.integration.test.ts` to test through graph node
- [ ] Manual curl: start fresh user, complete registration flow through graph

---

### Step 4: Plan Creation Phase Node
**Status**: PENDING

**What:** Transfer `plan_creation` branch from `ChatService.processMessage()`.

**Source code to transfer from:** ChatService plan_creation branch + `loadPlanCreationContext()` + `saveWorkoutPlan()`

**Critical invariant [FEAT-0010 Step 11]:** `saveWorkoutPlan()` called **only** when `phaseTransition?.toPhase === 'session_planning'`.

**New file:** `infra/ai/graph/nodes/plan-creation.node.ts`

**How to test:**
- [ ] Unit test: LLM returns plan WITH transition → verify `saveWorkoutPlan` called
- [ ] Unit test: LLM returns plan WITHOUT transition → verify `saveWorkoutPlan` NOT called
- [ ] Update `plan-creation.integration.test.ts` to test through graph node

---

### Step 5: Session Planning Phase Node
**Status**: PENDING

**What:** Transfer `session_planning` branch from `ChatService.processMessage()`.

**Source code to transfer from:** ChatService session_planning branch + `loadSessionPlanningContext()` + `saveSessionPlan()`

**Must preserve:**
- Parse retry on failure
- `lastSessionPlan` caching in conversation context
- `saveSessionPlan()` only on transition to training + returning `sessionId`

**New file:** `infra/ai/graph/nodes/session-planning.node.ts`

**How to test:**
- [ ] Unit test: verify session plan cached in context
- [ ] Unit test: verify session created only on transition to training, `sessionId` returned
- [ ] Unit test: verify parse retry works on malformed LLM response

---

### Step 6: Training Phase Node + LangChain Tools
**Status**: PENDING

**What:** Replace JSON intent parsing with LangChain tool calling. The existing `TrainingService` methods become tool implementations.

**Source code to transfer from:** ChatService training branch + `loadTrainingContext()` + `executeTrainingIntent()` switch statement

**Mapping from current intents to tools:**

| Current intent (`executeTrainingIntent`) | LangChain tool | TrainingService method |
|---|---|---|
| `log_set` | `log_set` | `trainingService.logSet()` |
| `next_exercise` | `next_exercise` | `completeCurrentExercise()` + `startNextExercise()` |
| `skip_exercise` | `skip_exercise` | `skipCurrentExercise()` |
| `finish_training` | `finish_training` | `completeSession()` |
| `request_advice` | `request_advice` | no DB action |
| `modify_session` | `modify_session` | no DB action |
| `just_chat` | `just_chat` | no DB action |

**New files:**
- `infra/ai/graph/nodes/training.node.ts` — training graph node with tool loop
- `infra/ai/graph/tools/training.tools.ts` — 7 `tool()` definitions

**Key architecture change:** Uses `model.bindTools()` instead of JSON mode. Tool loop:
1. LLM returns `tool_calls` → execute tools → feed `ToolMessage` back → LLM returns final text
2. Error handling: if DB fails, tool returns error string, LLM communicates failure naturally

**OpenRouter compatibility:** Verified 2026-02-22 — `google/gemini-3-flash-preview` supports tool calling with 5+ tools simultaneously through OpenRouter. Full tool loop (call → result → final response) confirmed working.

**How to test:**
- [ ] Unit test per tool: mock TrainingService, verify correct method called
- [ ] Unit test: verify tool loop terminates
- [ ] Unit test: verify tool error handling
- [ ] Manual curl: log a set during training, verify data in DB
- [ ] `training-intent.unit.test.ts` replaced by new tool tests
- [ ] Mark `parseTrainingResponse`, `executeTrainingIntent`, `TrainingIntentSchema` with `// TODO: remove`

---

### Step 7: Profile Update Tool (cross-phase)
**Status**: PENDING

**What:** Add `update_profile` tool available in all phase nodes.

**New file:** `infra/ai/graph/tools/profile.tools.ts`
- `update_profile` tool calls `userService.updateProfileData()`
- Bound to model in every node that uses tools

**How to test:**
- [ ] Unit test: verify profile update from chat phase
- [ ] Manual curl: say "change my weight to 85kg" from chat phase, verify DB updated

---

### Step 8: Router Node + Route Simplification
**Status**: PENDING

**What:** Move phase determination from `chat.routes.ts` into a router node at graph entry.

**Source code to transfer from:** `chat.routes.ts` lines 44-136 — registration check + context-based phase priority (training > session_planning > plan_creation > chat)

**New file:** `infra/ai/graph/nodes/router.node.ts`

**Route simplification:** `chat.routes.ts` becomes: get user → invoke graph → return response. All phase logic inside the graph.

**How to test:**
- [ ] Unit test: verify router returns correct phase for each scenario
- [ ] Integration: full flow from registration through chat works via single graph invoke
- [ ] Update `chat.routes.integration.test.ts`

---

### Step 9: Edge Guards (Transition Validation)
**Status**: PENDING

**What:** Move transition validation rules into LangGraph conditional edges.

**Source code to transfer from:** `ChatService.validatePhaseTransition()` — currently unused but contains correct business rules.

**Rules to implement as guards:**
- `plan_creation → session_planning`: requires active workout plan
- `session_planning → training`: requires valid session + `sessionId`
- `training → chat`: auto-complete session
- `session_planning → chat`: auto-skip draft session
- `training → session_planning`: blocked

**Changes in** `infra/ai/graph/conversation.graph.ts` — `addConditionalEdges` with guard functions.

**How to test:**
- [ ] Unit test: attempt invalid transition, verify blocked
- [ ] Unit test: attempt valid transition, verify proceeds

---

### Step 10: Cleanup
**Status**: PENDING

**What:** Remove all dead code marked with `// TODO: remove`.

**Files to delete/gut:**
- `ChatService` class → replaced by graph nodes
- `RegistrationService` class → replaced by registration node
- `executeTrainingIntent()`, `parseTrainingResponse()`, `TrainingIntentSchema` → replaced by tools
- Old phase resolution in `chat.routes.ts`
- Unused DI tokens (`CHAT_SERVICE_TOKEN`, `REGISTRATION_SERVICE_TOKEN`)

**How to test:**
- [ ] `npx tsc --noEmit` — compiles
- [ ] `npm run test:unit` — all tests pass
- [ ] `npm run test:integration` — integration tests pass
- [ ] Full manual flow: registration → chat → plan_creation → session_planning → training → finish → chat

**ADR-0007 update**: Mark status as IMPLEMENTED. Add final architecture diagram.

---

## Architecture (Target)

```
POST /api/chat → chat.routes.ts → ConversationGraph.invoke({ userId, userMessage })
                                     ├── [Router Node]       → determines phase from DB state
                                     ├── [Registration Node] → registration flow
                                     ├── [Chat Node]         → general chat + profile update tool
                                     ├── [Plan Creation Node] → workout plan generation
                                     ├── [Session Planning Node] → session recommendation
                                     ├── [Training Node]     → workout tracking with LangChain tools
                                     ├── [Transition Check]  → edge guards validate transitions
                                     └── response returned via state.responseMessage
```

---

## ADR-0007 Updates (tracked)

| Step | ADR Update |
|------|------------|
| Step 0 | Update Dependencies section with actual versions |
| Step 1 | Add error recovery strategy clarification |
| Step 6 | Add OpenRouter tool calling verification note |
| Step 10 | Mark status IMPLEMENTED, add final diagram |
