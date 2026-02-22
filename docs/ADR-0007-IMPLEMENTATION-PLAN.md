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

### Migration = Refactor and Improve, Not Copy-Paste

Each graph node is built **based on existing logic**, but with active improvement. The process for each step:

1. Study the source code (the specific branch in `ChatService.processMessage` or `RegistrationService.processUserMessage`) — understand **what** it does and **why**
2. Identify what to **keep** (business rules, invariants), what to **simplify** (unnecessary abstractions, workarounds), and what to **drop** (dead code, vestigial patterns)
3. Build the new node with clean code that leverages LangGraph patterns — not a line-by-line port
4. If something doesn't fit the new architecture naturally or is questionable — **raise for discussion immediately** before proceeding
5. Mark the old code `// TODO: remove — migrated to nodes/<node-file>.ts`
6. Both paths coexist during migration; route selects which one to use

**What to improve during transfer:**
- Flatten nested if/else chains into clear graph node logic
- Replace manual retry loops with proper error handling
- Remove intermediate parsing layers where LangGraph/tools handle it natively (especially training intents)
- Simplify context loading — if a method does 5 DB calls, question whether all are needed
- Drop "just in case" code that handles impossible states

**What to keep (business invariants):**
- `saveWorkoutPlan` only on transition to `session_planning` [FEAT-0010 Step 11]
- `saveSessionPlan` only on transition to `training` + return `sessionId`
- Registration completeness: all 6 fields + `is_confirmed`
- Phase priority: training > session_planning > plan_creation > chat

**When to stop and discuss:**
- Logic that seems wrong or overly complex in the original
- Cases where the old behavior might be a bug, not a feature
- Patterns that don't map cleanly to LangGraph

### What Stays Unchanged

These components are reused as-is (not migrated, not rewritten):
- `LLMService` (`infra/ai/llm.service.ts`) — all LLM calls go through it
- `ConversationContextService` (`infra/conversation/`) — source of truth for conversation history; graph state does NOT duplicate phase-specific context — nodes read it via `getContext()`
- `TrainingService` (`domain/training/services/training.service.ts`) — called from tool implementations (new method `logSetWithContext` added in Step 6)
- `PromptService` (`domain/user/services/prompt.service.ts`) — prompt building for each phase
- All Zod schemas and parsers (except `TrainingIntentSchema` which is replaced by tools in Step 6)
- API contract: `POST /api/chat` request/response format identical

### What Changes Beyond Graph Migration

- **Training prompt** (`prompts/training.prompt.ts`) — rewritten in Step 6: removes JSON intent format instructions (~150 lines), tools describe themselves via Zod schemas. Prompt keeps: coaching role, session context, progress display, exercise catalog.
- **`profileStatus` normalization** — fixed in Step 8: `incomplete` (legacy default from `user.repository.ts`) unified to `registration`. Only two valid values: `registration` and `complete`.

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
| `log_set` | `log_set` | `trainingService.logSetWithContext()` (NEW — see below) |
| `next_exercise` | `next_exercise` | `completeCurrentExercise()` + `startNextExercise()` |
| `skip_exercise` | `skip_exercise` | `skipCurrentExercise()` |
| `finish_training` | `finish_training` | `completeSession()` |
| `request_advice` | `request_advice` | no DB action |
| `modify_session` | `modify_session` | no DB action |
| `just_chat` | `just_chat` | no DB action |

**`log_set` is non-trivial.** Current `executeTrainingIntent` for `log_set` does 4 operations:
1. `ensureCurrentExercise(sessionId, { exerciseId?, exerciseName? })` — resolve by ID or name, create if needed
2. `getSessionDetails(sessionId)` — load session to find exercise
3. Calculate `nextSetNumber = existingSets.length + 1`
4. `trainingService.logSet(exerciseId, { setNumber, setData, rpe, userFeedback })`

**Decision:** Create a new method `TrainingService.logSetWithContext(sessionId, { exerciseId?, exerciseName?, setData, rpe, userFeedback })` that encapsulates all 4 steps. The `log_set` tool calls this single method — tool stays thin, domain logic stays in domain service.

**Training prompt rewrite.** The current `training.prompt.ts` instructs LLM to return JSON with `intents` array (~150 lines of format description). With tool calling, this is replaced: tools describe themselves via Zod schemas. Prompt keeps coaching role, session context, progress display, exercise catalog — but drops all JSON format instructions and intent type documentation.

**New files:**
- `infra/ai/graph/nodes/training.node.ts` — training graph node with tool loop
- `infra/ai/graph/tools/training.tools.ts` — 7 `tool()` definitions

**Key architecture change:** Uses `model.bindTools()` instead of JSON mode. Tool loop:
1. LLM returns `tool_calls` → execute tools → feed `ToolMessage` back → LLM returns final text
2. Error handling: if DB fails, tool returns error string, LLM communicates failure naturally

**OpenRouter compatibility:** Verified 2026-02-22 — `google/gemini-3-flash-preview` supports tool calling with 5+ tools simultaneously through OpenRouter. Full tool loop (call → result → final response) confirmed working.

**How to test:**
- [ ] Unit test for `TrainingService.logSetWithContext()` — mock repos, verify all 4 sub-steps
- [ ] Unit test per tool: mock TrainingService, verify correct method called with correct args
- [ ] Unit test: verify tool loop terminates
- [ ] Unit test: verify tool error handling (DB failure → error message → LLM handles gracefully)
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

### Step 8: Router Node + Route Simplification + profileStatus Fix
**Status**: PENDING

**What:** Move phase determination from `chat.routes.ts` into a router node at graph entry. Also fix `profileStatus` inconsistency.

**Source code to transfer from:** `chat.routes.ts` lines 44-136 — registration check + context-based phase priority (training > session_planning > plan_creation > chat)

**New file:** `infra/ai/graph/nodes/router.node.ts`

**Router logic:**
- Check `userService.isRegistrationComplete(user)` (checks `profileStatus === 'complete'`)
- If not complete → phase = `registration`
- If complete → check contexts by priority: training > session_planning > plan_creation > chat

**profileStatus normalization:** Currently three values exist due to inconsistency:
- `'incomplete'` — default in `user.repository.ts` on upsert (line 69-70)
- `'registration'` — default in DB schema (line 42)
- `'complete'` — set when registration finishes

Only two are meaningful: `registration` and `complete`. Fix: change `user.repository.ts` upsert default from `'incomplete'` to `'registration'` to match DB schema. Router uses `isRegistrationComplete()` which checks `=== 'complete'`, so both non-complete values already route to registration correctly.

**Route simplification:** `chat.routes.ts` becomes: get user → invoke graph → return response. All phase logic inside the graph.

**How to test:**
- [ ] Unit test: verify router returns `registration` for profileStatus `registration`
- [ ] Unit test: verify router returns `registration` for profileStatus `incomplete` (backward compat until cleanup)
- [ ] Unit test: verify router returns correct phase for each context scenario
- [ ] Integration: full flow from registration through chat works via single graph invoke
- [ ] Update `chat.routes.integration.test.ts`
- [ ] Update `user.repository.unit.test.ts` for new default

---

### Step 9: Edge Guards (Transition Validation) + Cleanup Node
**Status**: PENDING

**What:** Move transition validation rules into LangGraph conditional edges. Side effects (auto-complete, auto-skip) happen in a separate cleanup node — guards only validate.

**Source code to transfer from:** `ChatService.validatePhaseTransition()` — currently unused but contains correct business rules.

**Architecture decision:** Guards are pure validators (return allow/block). Side effects go into a `transitionCleanupNode` that runs AFTER guard passes but BEFORE `startNewPhase`. This keeps guards clean and testable.

```
[phase node] → [transition guard] → [cleanup node] → [startNewPhase] → END
                     ↓ (blocked)
                    END (return response without transition)
```

**Complete transition rules (12 rules from `validatePhaseTransition`):**

Allowed without conditions (5):
- `registration → plan_creation` — always allowed
- `registration → chat` — always allowed
- `chat → plan_creation` — always allowed
- `plan_creation → chat` — always allowed (user cancels)
- `session_planning → chat` — always allowed (user cancels, no session created yet)

Allowed with conditions (4):
- `plan_creation → session_planning` — requires active workout plan in DB
- `chat → session_planning` — requires active workout plan in DB
- `session_planning → training` — requires `sessionId` + session exists + belongs to user + status='planning' + no other active session
- `training → chat` — allowed, with side effect: auto-complete active session (cleanup node)

Blocked (3):
- `training → session_planning` — blocked ("Complete or cancel training first")
- `* → registration` — blocked (registration transitions handled by router, not by LLM)
- `registration → *` (except chat/plan_creation) — blocked

**New files:**
- `infra/ai/graph/guards/transition.guard.ts` — pure validation functions
- `infra/ai/graph/nodes/transition-cleanup.node.ts` — side effects (auto-complete session)

**How to test:**
- [ ] Unit test per allowed transition: verify guard returns allow
- [ ] Unit test per blocked transition: verify guard returns block with error message
- [ ] Unit test: `plan_creation → session_planning` without active plan → blocked
- [ ] Unit test: `session_planning → training` without sessionId → blocked
- [ ] Unit test: `training → chat` → cleanup node calls `trainingService.completeSession()`
- [ ] Unit test: cleanup node failure does not crash graph (logs error, transition still happens)

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
| Step 6 | Add OpenRouter tool calling verification note; document `logSetWithContext` method |
| Step 8 | Document `profileStatus` normalization (2→2 states) |
| Step 9 | Document full transition rule set (12 rules) and cleanup node pattern |
| Step 10 | Mark status IMPLEMENTED, add final diagram |
