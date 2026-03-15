# ADR-0007: Gradual Migration to LangGraph for Conversation Phase Management

## Status: IN PROGRESS (Architecture Rework — Steps 0–6 complete)

## Implementation Plan: `docs/ADR-0007-IMPLEMENTATION-PLAN.md`

## Date: 2026-02-11

## Context

### The Problem

The current conversation phase management in `ChatService` has architectural limitations:

1. **JSON parsing bug**: `chat` phase sets `jsonMode: false` (line 77 of `chat.service.ts`), but `parseLLMResponse()` on line 139 tries to parse the LLM's plain-text response as JSON. This crashes with `"Unexpected token 'О', "Отлично, с"... is not valid JSON"`.

2. **Training intent naming mismatch** (discovered 2026-02-15): The training system prompt (`training.prompt.ts`) instructs the LLM to use **camelCase** intent types (`logSet`, `nextExercise`, `finishTraining`, etc.), but the Zod schema (`training-intent.types.ts`) expects **snake_case** (`log_set`, `complete_current_exercise`, `finish_training`, etc.). This causes two failure modes:
   - When LLM **includes** intent: `TrainingIntentSchema` (discriminated union on `type`) rejects the camelCase value → `parseTrainingResponse()` throws `"Invalid training response format"` → **500 error to user**.
   - When LLM **omits** intent (field is `.optional()`): validation passes silently → `executeTrainingIntent()` is never called → **data not saved to DB, but user sees "Recorded!"** (silent data loss).
   - Combined effect: training phase cannot save any data regardless of LLM behavior.

3. **No inline actions**: A user cannot update their profile (e.g., fix gender) from the `chat` phase without a full phase transition to `registration`. This is a UX problem.

4. **Manual orchestration**: Phase routing, transition validation, side effects (DB writes), and LLM response parsing are all manually wired in one 589-line `ChatService`. Adding new phases or actions means editing this monolith.

5. **Phase resolution split across layers**: Phase is determined in `chat.routes.ts` (HTTP layer, lines 106-120) by querying DB contexts, then passed to `ChatService`. This creates a leaky abstraction.

### Why LangGraph

After evaluating custom FSM, State Pattern, Agent Router, and LangGraph, the decision is to use **LangGraph** because:

- Phases map directly to **graph nodes**
- Phase transitions map to **conditional edges** with guard functions
- Training intents (7 types) map to **LangChain tools**
- `@langchain/core` and `@langchain/openai` are already dependencies
- LangGraph provides built-in checkpointing, message management, and typed state
- Avoids reinventing a state machine that frameworks already solve

### Why NOT a Full Rewrite

The current code works (except for the chat-phase bug). A full rewrite of 2000+ lines across 30+ files has ~50% chance of introducing regressions. The gradual migration approach:

- Keeps existing code running at every step
- Allows testing each phase independently
- Can be paused/reverted at any point
- Each step is a small, reviewable PR

---

## Decision

### Strategy: Full Architecture Rework (revised from original Gradual Migration plan)

**Note (2026-02-23):** The original "Gradual Migration with Coexistence" strategy was abandoned during implementation. Live testing revealed that keeping MVP infrastructure (LLMService, JSON mode parsing, ConversationContextService with phase detection) was incompatible with LangGraph's native patterns and caused fundamental bugs (infinite recursion, stale phase state). A full rework was the correct decision. See `docs/ADR-0007-IMPLEMENTATION-PLAN.md` — Architecture Rework section for the full rationale.

### Architecture Overview

```
Target (current implementation in progress):
  POST /api/chat → chat.routes.ts (~20 lines, thin proxy)
                 → graph.invoke({ userMessage, userId }, { configurable: { thread_id: userId, userId } })
                 → ConversationGraph (compiled with PostgresSaver checkpointer)
                     ├── [Router Node]
                     │     Loads user from DB → state.user
                     │     Determines phase (new: from profileStatus; existing: from checkpointer)
                     │     Auto-closes timed-out sessions
                     │     Resets requestedTransition to null (prevents stale transitions)
                     │
                     ├── [Phase Subgraph] (one of 5, routed by state.phase)
                     │     Each is a compiled subgraph with tool-calling loop:
                     │     ┌─ [agentNode] model.bindTools(tools).invoke(messages)
                     │     │    ↓ has tool_calls? (toolsCondition)
                     │     ├─ [toolNode] ToolNode executes, returns ToolMessage
                     │     │    ↓ always → back to agentNode
                     │     └─ agentNode (no tool_calls) → extractNode → END subgraph
                     │     Returns: responseMessage, requestedTransition, freshUser
                     │
                     ├── [Persist Node]
                     │     Writes user+assistant turn to conversation_turns
                     │
                     ├── [Transition Guard] (conditional edge)
                     │     Validates requestedTransition against 12 rules
                     │
                     ├── [Cleanup Node] (if transition allowed)
                     │     Side effects: session state changes, phase update
                     │
                     └── State saved to PostgreSQL checkpointer
                         (phase, activeSessionId, user)
```

### Key Design Decisions (as actually implemented)

#### 1. State Management: PostgreSQL Checkpointer

LangGraph `PostgresSaver` (from `@langchain/langgraph-checkpoint-postgres`) is the single source of truth for conversation phase state. No custom phase detection — checkpointer stores `phase`, `activeSessionId`, `requestedTransition` atomically per `thread_id` (= `userId`).

#### 2. LLMService: REPLACED

`LLMService` wrapper was removed. All graph nodes use `ChatOpenAI` directly via a shared `model.factory.ts` (`getModel()`). Logging via LangChain callback system. `generateWithSystemPrompt()` was incompatible with tool calling (returned `string` instead of `AIMessage` with `tool_calls`).

#### 3. Zod Parsers: REPLACED by Tool Calling

All JSON-mode parsers (`parseLLMResponse`, `parsePlanCreationResponse`, `parseTrainingResponse`, etc.) are eliminated. LLM calls typed tools for side effects and responds with natural text. Zod schemas on tool inputs provide native validation.

#### 4. PromptService: DEPRECATED (phase by phase)

`PromptService` methods for migrated phases are superseded by `buildXxxSystemPrompt()` functions co-located with each graph node (`infra/ai/graph/nodes/`). `PromptService` will be fully removed in Step 9 cleanup.

#### 5. ConversationContextService: SIMPLIFIED to 2 methods

Original 7-method `IConversationContextService` (with phase detection via `[PHASE_ENDED]` markers) replaced by 2-method interface: `appendTurn()` + `getMessagesForPrompt()`. History storage for prompts only — state management moved to checkpointer.

#### 6. Tools: CLOSURE REF PATTERN for State Updates

Tools are closures created per-subgraph invocation. They write state updates to mutable refs (`pendingTransition: { value: T | null }`). `extractNode` reads and clears refs to propagate changes to parent graph. `Command` pattern with `resume` was attempted but rejected — it breaks `ToolNode`'s ToolMessage flow causing infinite recursion.

#### 7. Phase-specific Tools

| Phase | Tools |
|-------|-------|
| Registration | `save_profile_fields`, `complete_registration` |
| Chat | `update_profile`, `request_transition` |
| Plan Creation | `save_workout_plan`, `request_transition` |
| Session Planning | `start_training_session`, `request_transition` |
| Training | `log_set`, `complete_current_exercise`, `finish_training` |

---

## Implementation Plan

### Prerequisites (before any LangGraph code)

**Step 0a: Fix chat-phase JSON bug** (~30 min)

File: `apps/server/src/domain/user/services/chat.service.ts`

The `chat` phase must use `jsonMode: true` (same as all other phases). The system prompt for `chat` must include "json" in its text. Update `prompt.service.ts` `buildChatSystemPrompt()` to include JSON format instructions.

Change line 77:
```typescript
// BEFORE:
const needsJsonMode = phase !== 'chat';
// AFTER:
const needsJsonMode = true; // All phases use JSON mode for structured responses
```

This is a prerequisite because it fixes the production bug and validates that all phases work with JSON mode before migration begins.

**Step 0b: Fix training-phase intent naming mismatch + make intent required** (~30 min)

Three files must be changed together:

1. **`training.prompt.ts`** — Fix all intent type examples from camelCase to snake_case (`logSet` → `log_set`, `nextExercise` → `complete_current_exercise`, etc.) to match the Zod schema.

2. **`training-intent.types.ts`** — Make `intent` field **required** in `LLMTrainingResponseSchema`:
   ```typescript
   // BEFORE:
   intent: TrainingIntentSchema.optional(),
   // AFTER:
   intent: TrainingIntentSchema,
   ```
   The `just_chat` type already exists as a catch-all for non-action messages.

3. **`training.prompt.ts`** — Add explicit instruction: *"You MUST ALWAYS include the intent field. Use type just_chat when user message is not a training action."*

This is a **blocking prerequisite**. Without this fix, the training phase cannot save any data to the database. The naming mismatch causes 100% failure rate for intent parsing. See detailed fix plan in `docs/proposals/TRAINING_INTENT_HOTFIX.md`.

**Relationship to Phase 5:** Step 0b is an interim fix. Phase 5 (training tools migration) will eliminate the intent JSON pattern entirely, replacing it with LangChain tool calling. Step 0b ensures training works correctly in the current architecture until Phase 5 is reached.

### Phase 1: Infrastructure Setup (~2-3 hours)

**Step 1.1: Add LangGraph dependency**

```bash
cd apps/server && npm install @langchain/langgraph
```

Verify compatibility with existing `@langchain/core` ^0.3.72 and `zod` ^4.1.5.

**Step 1.2: Create graph state definition**

New file: `apps/server/src/domain/conversation/graph-state.ts`

```typescript
import { Annotation } from '@langchain/langgraph';
import { ConversationPhase } from './ports/conversation-context.ports';
import { ChatMsg } from '@domain/user/ports';

// Graph state definition
export const ConversationState = Annotation.Root({
  // Current user ID
  userId: Annotation<string>,
  // Current conversation phase
  phase: Annotation<ConversationPhase>,
  // Messages for this invocation (loaded from ConversationContextService)
  messages: Annotation<ChatMsg[]>({
    reducer: (current, update) => [...current, ...update],
    default: () => [],
  }),
  // Current user message
  userMessage: Annotation<string>,
  // LLM response text (to be returned to user)
  responseMessage: Annotation<string>({
    reducer: (_, update) => update,
    default: () => '',
  }),
  // Phase transition requested by LLM (if any)
  requestedTransition: Annotation<{ toPhase: ConversationPhase; reason?: string; sessionId?: string } | null>({
    reducer: (_, update) => update,
    default: () => null,
  }),
});
```

**Step 1.3: Create graph builder skeleton**

New file: `apps/server/src/infra/ai/conversation-graph.ts`

This file creates the `StateGraph` with node placeholders. Initially only the `chat` node is implemented; others delegate to `ChatService`.

**Step 1.4: Wire into DI**

Update `apps/server/src/main/register-infra-services.ts` to register the graph alongside existing services.

### Phase 2: Migrate `chat` Phase (~1 day)

The simplest phase. No side effects, no DB writes, just LLM call + response.

**What changes:**
- New graph node `chatNode` in `conversation-graph.ts` that:
  1. Loads history from `ConversationContextService`
  2. Builds system prompt via `PromptService.buildChatSystemPrompt()`
  3. Calls `LLMService.generateWithSystemPrompt()` with `jsonMode: true`
  4. Parses response with `parseLLMResponse()`
  5. Sets `responseMessage` and `requestedTransition` in graph state

**What stays the same:**
- `chat.routes.ts` still determines phase
- `ChatService.processMessage()` still handles non-chat phases
- `ConversationContextService` still stores turns

**Test:** Unit test for chatNode with mocked LLMService and PromptService.

### Phase 3: Migrate `plan_creation` Phase (~1 day)

**What changes:**
- New graph node `planCreationNode` that:
  1. Loads context via `loadPlanCreationContext()`
  2. Builds prompt via `PromptService.buildPlanCreationPrompt()`
  3. Calls LLM, parses with `parsePlanCreationResponse()`
  4. If plan approved (transition to session_planning), calls `saveWorkoutPlan()`
  5. Sets state

**Critical:** `saveWorkoutPlan()` logic (only save when transitioning) must be preserved exactly.

### Phase 4: Migrate `session_planning` Phase (~1 day)

Similar to plan_creation. Key difference: `saveSessionPlan()` creates a workout session and returns `sessionId` for the training phase transition.

### Phase 5: Convert Training Intents to Tools (~2 days)

This is the most complex migration step.

**What changes:**
- 7 training intents become LangChain tools:
  - `log_set` — logs a completed set
  - `complete_current_exercise` — completes current exercise, starts next
  -  — skips current exercise
  - `finish_training` — completes the session
  - `request_advice` — no DB action, just conversation
  - `modify_session` — no DB action, just conversation
  - `just_chat` — no DB action, just conversation

- Training node uses `modelWithTools.invoke()` instead of JSON mode
- Tool execution replaces `executeTrainingIntent()` switch statement
- Phase transition (training → chat) triggered by `finish_training` tool

**Tool result loop (standard LangChain pattern):**

Tool calling requires a multi-step loop, not a single LLM call:

1. LLM receives messages + tool descriptions → returns `AIMessage` with `tool_calls`
2. Code executes each tool → produces `ToolMessage` with result per tool call
3. `ToolMessage` results are appended to messages and sent back to LLM
4. LLM produces final `AIMessage` with user-facing text (informed by tool results)

This is critical: the LLM must see tool results to produce contextual responses (e.g., "Logged set 3 of 4 for bench press" requires knowing the actual DB state after `log_set` executed). LangGraph provides `ToolNode` that handles steps 2-3 automatically.

**Simplified graph structure for training node:**
```
[trainingNode] → LLM call with tools
       ↓
[should_continue] → if tool_calls present → [toolNode] → back to [trainingNode]
       ↓                                        (executes tools, returns ToolMessages)
  if no tool_calls → END (final response)
```

**What this eliminates:**
- `parseTrainingResponse()` — replaced by tool calls
- `executeTrainingIntent()` — replaced by tool implementations
- `TrainingIntentSchema` — replaced by tool schemas (Zod schemas reused)
- The intent naming mismatch problem (Step 0b fix) — no longer relevant since tools replace JSON intents

**What stays:** `TrainingService` methods (`logSet`, `completeCurrentExercise`, etc.) are called from inside tool implementations.

**Error handling in tools:** If a tool execution fails (e.g., DB error), the tool returns an error message string as its result. The LLM sees this error in the next iteration and communicates the failure to the user naturally. No special error handling needed at the graph level.

**OpenRouter compatibility prerequisite:** Before implementing this phase, verify that the configured model supports tool/function calling through the current API provider. Check OpenRouter docs for the specific `LLM_MODEL` value. If tool calling is not supported, this phase is blocked until the model/provider is updated.

### Phase 6: Add Profile Update Tool (~0.5 day)

New tool available in ALL phases:

```typescript
const updateProfileTool = tool(
  async ({ field, value }) => { /* ... */ },
  {
    name: 'update_profile',
    description: 'Update a user profile field. Available fields: age, gender, height, weight, fitnessLevel, fitnessGoal',
    schema: z.object({
      field: z.enum(['age', 'gender', 'height', 'weight', 'fitnessLevel', 'fitnessGoal']),
      value: z.union([z.string(), z.number()]),
    }),
  }
);
```

This is bound to the model in every phase node. The system prompt for each phase gets a brief section about available tools.

### Phase 7: Migrate `registration` Phase (~1 day)

Last because it's the most isolated (separate `RegistrationService`).

**What changes:**
- Registration becomes a graph node
- `RegistrationService.processUserMessage()` logic moves into the node
- Profile field extraction stays as Zod validation

**What this eliminates:**
- `RegistrationService` class (logic absorbed into graph node)
- Special-case handling in `chat.routes.ts` (lines 49-103)

### Phase 8: Migrate Phase Resolution into Graph (~0.5 day)

Move phase determination from `chat.routes.ts` into a **router node** at graph entry:

```typescript
const routerNode = async (state) => {
  // Check DB contexts to determine current phase
  const trainingCtx = await conversationContextService.getContext(state.userId, 'training');
  if (trainingCtx) return { phase: 'training' };
  // ... same logic as current routes lines 106-120
};
```

This eliminates the phase resolution logic from the HTTP layer.

### Phase 9: Cleanup (~0.5 day)

Once all phases are migrated:

- Remove `ChatService` class (replaced by graph)
- Remove `RegistrationService` class (replaced by graph node)
- Simplify `chat.routes.ts` to just call graph
- Remove old parse functions if replaced by tools (training intents)
- Update all tests

### Phase 10: Move Transition Validation to Edge Guards (~0.5 day)

`validatePhaseTransition()` becomes conditional edge logic:

```typescript
graph.addConditionalEdges('checkTransition', async (state) => {
  const { phase, requestedTransition } = state;
  if (!requestedTransition) return END;
  
  // Business rules from validatePhaseTransition()
  if (phase === 'plan_creation' && requestedTransition.toPhase === 'session_planning') {
    const plan = await workoutPlanRepo.findActiveByUserId(state.userId);
    if (!plan) throw new Error('Cannot proceed: no active workout plan');
  }
  // ... rest of validation
  
  return requestedTransition.toPhase;
}, ['chat', 'plan_creation', 'session_planning', 'training', 'registration', END]);
```

---

## Files Affected (Complete List)

### Must Change (core logic)

| File | Phase | Change |
|------|-------|--------|
| `domain/user/services/chat.service.ts` | 0a,2-5,9 | Fix chat JSON bug (Step 0a), then gradually remove methods as phases migrate, delete in Phase 9 |
| `domain/user/services/prompts/training.prompt.ts` | 0b | Fix intent type naming camelCase→snake_case, add required intent instruction, fix schema field mismatches |
| `domain/training/training-intent.types.ts` | 0b,5 | Make `intent` required (Step 0b). Replace with tools in Phase 5 |
| `infra/ai/llm.service.ts` | - | No changes needed (reused as-is) |
| `app/routes/chat.routes.ts` | 2-8 | Gradually simplify: add graph call path, remove old path, simplify phase resolution |
| `domain/user/services/registration.service.ts` | 7,9 | Delete after Phase 7 (absorbed into graph) |
| `domain/user/services/prompt.service.ts` | 0a | Fix chat prompt to include "json" (Step 0a). Otherwise reused as-is |
| `main/register-infra-services.ts` | 1 | Register graph alongside existing services |

### New Files

| File | Phase | Purpose |
|------|-------|---------|
| `domain/conversation/graph-state.ts` | 1 | LangGraph state type definition |
| `infra/ai/conversation-graph.ts` | 1 | Main StateGraph builder + node implementations |
| `infra/ai/tools/training-tools.ts` | 5 | LangChain tool definitions for training intents |
| `infra/ai/tools/profile-tools.ts` | 6 | Profile update tool |
| `docs/adr/0007-langgraph-gradual-migration.md` | 0 | This document |

### Small Adjustments (types, ports)

| File | Phase | Change |
|------|-------|--------|
| `domain/ai/ports.ts` | 1 | Add graph service interface/token if needed |
| `domain/conversation/llm-response.types.ts` | 2 | No change (reused) |
| `domain/training/plan-creation.types.ts` | 3 | No change (reused) |
| `domain/training/session-planning.types.ts` | 4 | No change (reused) |
| `domain/training/training-intent.types.ts` | 5 | May simplify after tools replace intents |
| `domain/user/ports/service.ports.ts` | 9 | Remove IChatService, IRegistrationService after migration |
| `app/types/fastify.d.ts` | 1,9 | Add graph service type, remove old types after cleanup |

### Tests to Update/Add

| File | Phase | Change |
|------|-------|--------|
| `tests/unit/infra/conversation-graph.unit.test.ts` | 1-5 | NEW: test each graph node |
| `tests/unit/infra/training-tools.unit.test.ts` | 5 | NEW: test training tools |
| `tests/integration/api/chat.routes.integration.test.ts` | 2+ | Update to work with graph |
| `tests/unit/services/chat-json-mode.unit.test.ts` | 0 | Update for jsonMode=true always |
| `tests/unit/infra/llm-json-validation.unit.test.ts` | - | No change |

---

## Guardrails (Current Architecture)

**Note:** The original 12 guardrails from the gradual migration plan are superseded by the Architecture Rework. The following rules apply to the current implementation.

1. **DO NOT change the API contract.** `POST /api/chat` request/response format stays identical. Migration is internal only.

2. **DO NOT use Command pattern with `resume` in tools.** Tools must return plain strings. State updates go through closure refs (`pendingTransition`, `pendingActiveSessionId`). `Command({ resume })` breaks `ToolNode`'s ToolMessage flow → infinite recursion.

3. **DO NOT call LLM directly** (bypassing `getModel()` factory). All LLM calls go through the shared model factory to ensure consistent configuration.

4. **DO NOT store phase/session state outside the checkpointer.** No in-memory Maps, no `[PHASE_ENDED]` markers, no DB fields for phase tracking. Checkpointer is the single source of truth.

5. **DO NOT implement logic in agentNode that belongs in a tool.** Any action with a DB side effect must be a tool. Natural conversation (no side effects) needs no tool — LLM responds with text.

6. **DO NOT bypass `IConversationContextService.appendTurn()`.** All conversation turns must be persisted via `persist.node.ts` using the 2-method interface. This is for analytics and prompt history.

7. **DO NOT restructure folders.** Follow existing module layout. Graph files live in `infra/ai/graph/{nodes,tools,subgraphs,guards}/`.

8. **DO NOT introduce new error types.** Use existing `AppError`. Tool errors return error strings — ToolNode handles them, LLM self-corrects.

9. **DO NOT add business logic to `chat.routes.ts`.** Route is a thin proxy (~20 lines). All orchestration is inside the graph.

10. **DO NOT skip writing tests.** Each tool needs a unit test. Each subgraph needs a unit test. Tests must go RED first when reproducing a bug, then GREEN after the fix.

---

## Dependencies

### Installed (Step 0 completed 2026-02-22)
```json
"@langchain/core": "^1.1.27",
"@langchain/openai": "^1.2.9",
"@langchain/langgraph": "^1.1.5",
"zod": "^4.3.6"
```

### Upgrade Notes (Step 0 outcome)
- `@langchain/langgraph` 1.1.5 required upgrading `@langchain/core` from ^0.3.72 → ^1.1.27 and `@langchain/openai` from ^0.6.9 → ^1.2.9
- Breaking change in `@langchain/openai` v1: `.bind({ response_format })` removed — replaced with passing options directly to `.invoke(input, options)`
- `zod` bumped to ^4.3.6 (LangGraph requires ≥4.2.0)
- OpenRouter tool calling verified: `google/gemini-3-flash-preview` supports tool calling with 5+ tools simultaneously (verified 2026-02-22)

---

## Effort Estimate

| Phase | Effort | Risk | Can Deploy After? |
|-------|--------|------|-------------------|
| 0a: Fix chat JSON bug | 30 min | Low | Yes |
| 0b: Fix training intent naming + required | 30 min | Low | Yes (CRITICAL — unblocks training) |
| 1: Infrastructure | 2-3 hours | Low | Yes (no behavior change) |
| 2: Chat phase | 1 day | Low | Yes |
| 3: Plan creation | 1 day | Medium | Yes |
| 4: Session planning | 1 day | Medium | Yes |
| 5: Training tools | 2 days | High | Yes |
| 6: Profile tool | 0.5 day | Low | Yes |
| 7: Registration | 1 day | Medium | Yes |
| 8: Phase resolution | 0.5 day | Medium | Yes |
| 9: Cleanup | 0.5 day | Low | Yes |
| 10: Edge guards | 0.5 day | Medium | Yes |

**Total: ~9-10 working days (2 weeks)**

Each phase produces a deployable state. Migration can be paused at any point.

---

## Success Criteria

After full migration:

1. All existing tests pass (updated for new architecture)
2. `POST /api/chat` API contract unchanged
3. All 5 phases work: registration, chat, plan_creation, session_planning, training
4. Training intents work as LangChain tools (no JSON intent parsing)
5. Profile can be updated from any phase via tool
6. Phase transitions validated by edge guards
7. Conversation history preserved in DB (ConversationContextService)
8. Debug logging and metrics preserved (LLMService)
9. No `ChatService` or `RegistrationService` classes remain (absorbed into graph)

---

## Current Code Reference (Key Files)

For quick orientation when starting a new session:

- **Phase orchestration**: `apps/server/src/domain/user/services/chat.service.ts` (589 lines) — the main file being replaced
- **LLM wrapper**: `apps/server/src/infra/ai/llm.service.ts` (315 lines) — keep as-is
- **Prompts**: `apps/server/src/domain/user/services/prompt.service.ts` (180 lines) — keep as-is
- **Routes**: `apps/server/src/app/routes/chat.routes.ts` (214 lines) — simplify gradually
- **Registration**: `apps/server/src/domain/user/services/registration.service.ts` (116 lines) — absorb into graph
- **Phase types**: `apps/server/src/domain/conversation/ports/conversation-context.ports.ts` (78 lines) — keep as-is
- **Chat response parser**: `apps/server/src/domain/conversation/llm-response.types.ts` (91 lines) — keep
- **Plan creation parser**: `apps/server/src/domain/training/plan-creation.types.ts` (130 lines) — keep
- **Session planning parser**: `apps/server/src/domain/training/session-planning.types.ts` (121 lines) — keep
- **Training intents**: `apps/server/src/domain/training/training-intent.types.ts` (171 lines) — replace with tools
- **DI registration**: `apps/server/src/main/register-infra-services.ts` — update
- **Architecture rules**: `docs/ARCHITECTURE.md` — follow strictly
- **AI contribution rules**: `docs/CONTRIBUTING_AI.md` — follow strictly

---

## Consequences

### Positive
- Eliminates the chat-phase JSON bug (Step 0a)
- Eliminates the training intent naming mismatch and silent data loss (Step 0b)
- Enables inline actions (profile update) from any phase
- Training intents become proper tools (cleaner, more reliable)
- Phase management follows a proven framework pattern
- Each phase is independently testable as a graph node
- Future phases (e.g., nutrition tracking) are easy to add as new nodes

### Negative
- New dependency (`@langchain/langgraph`) — adds ~2MB to bundle
- May require upgrading `@langchain/core` — risk of breaking changes
- Graph debugging is less straightforward than linear service code
- Two systems coexist during migration (complexity)
- Team must learn LangGraph concepts

### Risks
- LangGraph JS API is relatively new; may have breaking changes
- Zod v4 compatibility issues with LangGraph's state annotations
- Performance overhead of graph invocation vs. direct service calls (likely negligible)
- Migration stalls at phase 5 (training tools) due to complexity — mitigation: can stay hybrid (Step 0b ensures training works with JSON intents as fallback)
- OpenRouter may not support tool/function calling for all models — must verify before Phase 5

---

*Author: AI Assistant*
*Decision Date: 2026-02-11*
*Updated: 2026-02-15 — Added Step 0b fix, Phase 5 tool result loop details*
*Updated: 2026-02-22 — Status changed to Implementation Started, linked implementation plan*
*Updated: 2026-02-24 — Architecture Rework: replaced gradual migration strategy with full rework; updated Design Decisions and Guardrails to reflect actual implementation (Steps 0–5 complete: skeleton, chat subgraph, registration subgraph, plan creation subgraph)*
*Supersedes: Custom FSM discussion (not implemented)*
*Related: ADR-0001 (AI integration), ADR-0005 (Conversation context)*
*Implementation Plan: `docs/ADR-0007-IMPLEMENTATION-PLAN.md`*
