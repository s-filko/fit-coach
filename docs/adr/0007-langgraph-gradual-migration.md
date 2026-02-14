# ADR-0007: Gradual Migration to LangGraph for Conversation Phase Management

## Status: ACCEPTED (Pending Implementation)

## Date: 2026-02-11

## Context

### The Problem

The current conversation phase management in `ChatService` has architectural limitations:

1. **JSON parsing bug**: `chat` phase sets `jsonMode: false` (line 77 of `chat.service.ts`), but `parseLLMResponse()` on line 139 tries to parse the LLM's plain-text response as JSON. This crashes with `"Unexpected token 'О', "Отлично, с"... is not valid JSON"`.

2. **No inline actions**: A user cannot update their profile (e.g., fix gender) from the `chat` phase without a full phase transition to `registration`. This is a UX problem.

3. **Manual orchestration**: Phase routing, transition validation, side effects (DB writes), and LLM response parsing are all manually wired in one 589-line `ChatService`. Adding new phases or actions means editing this monolith.

4. **Phase resolution split across layers**: Phase is determined in `chat.routes.ts` (HTTP layer, lines 106-120) by querying DB contexts, then passed to `ChatService`. This creates a leaky abstraction.

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

### Strategy: Gradual Migration with Coexistence

Migrate one phase at a time from the current manual orchestration to a LangGraph StateGraph. During migration, old and new code coexist. A routing layer decides which path to use based on which phases have been migrated.

### Architecture Overview

```
Current:
  POST /api/chat → chat.routes.ts → [phase resolution] → ChatService.processMessage()
                                                            ├── buildSystemPrompt()
                                                            ├── LLMService.generateWithSystemPrompt()
                                                            ├── parseXxxResponse()
                                                            ├── side effects (DB writes)
                                                            └── executePhaseTransition()

Target (after full migration):
  POST /api/chat → chat.routes.ts → ConversationGraph.invoke({ messages, userId })
                                      ├── [router node] → determines phase from state
                                      ├── [phase node]  → calls LLM with phase-specific prompt
                                      ├── [tools]       → training intents, profile updates
                                      ├── [transition]  → conditional edges validate & route
                                      └── state persisted via checkpointer

During migration (hybrid):
  POST /api/chat → chat.routes.ts → if phase in migratedPhases
                                        → ConversationGraph.invoke(...)
                                     else
                                        → ChatService.processMessage(...)  (old path)
```

### Key Design Decisions

#### 1. ConversationContextService: COEXIST (option b)

Do NOT replace `IConversationContextService` with LangGraph checkpointing. Instead:

- LangGraph graph state holds **messages for the current invocation only**
- `ConversationContextService` remains the **source of truth** for persistent conversation history
- Graph nodes read history from `ConversationContextService` at the start
- Graph nodes write turns back via `ConversationContextService` at the end
- This preserves all existing DB data, sliding window logic, and phase-specific contexts

Rationale: replacing the conversation storage is the highest-risk change with the least payoff. The current DB-backed system works. LangGraph checkpointing can be adopted later if needed.

#### 2. LLMService: KEEP as-is

Do NOT replace `LLMService` with direct `ChatOpenAI` usage in graph nodes. Instead:

- Graph nodes call `LLMService.generateWithSystemPrompt()` just like current code
- This preserves: debug logging, metrics, JSON mode validation, error handling
- LLMService is injected into graph node functions via closure

Rationale: LLMService has 315 lines of battle-tested debug infrastructure. Bypassing it would lose observability.

#### 3. Zod Parsers: REUSE

All existing Zod schemas and parse functions stay:

- `parseLLMResponse()` — for chat phase
- `parsePlanCreationResponse()` — for plan_creation phase  
- `parseSessionPlanningResponse()` — for session_planning phase
- `parseTrainingResponse()` — for training phase
- `registrationLLMResponseSchema` — for registration phase

Graph nodes will call these parsers on LLM output, same as today.

#### 4. PromptService: REUSE

`PromptService` methods (`buildChatSystemPrompt`, `buildPlanCreationPrompt`, etc.) are reused in graph nodes. No changes needed.

#### 5. Validation Logic: MOVE to Edge Guards

`validatePhaseTransition()` (100+ lines in `ChatService`) becomes guard functions on conditional edges. The business rules stay identical; only the location changes.

#### 6. Training Intents: CONVERT to LangChain Tools

The 7 training intent types become LangChain `tool()` definitions:

```typescript
// Example: log_set tool
const logSetTool = tool(
  async ({ reps, weight, rpe }) => {
    await trainingService.logSet(exerciseId, { setNumber, setData: { type: 'strength', reps, weight }, rpe });
    return 'Set logged successfully';
  },
  { name: 'log_set', description: 'Log a completed set', schema: LogSetIntentSchema }
);
```

This is the biggest architectural improvement: instead of LLM outputting JSON intents that code parses and routes, the LLM directly calls tools. This eliminates the intent parsing layer entirely for training.

#### 7. Profile Update: NEW Inline Tool

A new `update_profile` tool allows profile changes from any phase:

```typescript
const updateProfileTool = tool(
  async ({ field, value }) => {
    await userService.updateProfileData(userId, { [field]: value });
    return `Profile updated: ${field} = ${value}`;
  },
  { name: 'update_profile', description: 'Update user profile field', schema: UpdateProfileSchema }
);
```

This solves the "change gender from chat phase" problem without phase transitions.

---

## Implementation Plan

### Prerequisites (before any LangGraph code)

**Step 0: Fix the current bug** (~30 min)

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
  - `next_exercise` — completes current exercise, starts next
  - `skip_exercise` — skips current exercise
  - `finish_training` — completes the session
  - `request_advice` — no DB action, just conversation
  - `modify_session` — no DB action, just conversation
  - `just_chat` — no DB action, just conversation

- Training node uses `modelWithTools.invoke()` instead of JSON mode
- Tool execution replaces `executeTrainingIntent()` switch statement
- Phase transition (training → chat) triggered by `finish_training` tool

**What this eliminates:**
- `parseTrainingResponse()` — replaced by tool calls
- `executeTrainingIntent()` — replaced by tool implementations
- `TrainingIntentSchema` — replaced by tool schemas (Zod schemas reused)

**What stays:** `TrainingService` methods (`logSet`, `completeCurrentExercise`, etc.) are called from inside tool implementations.

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
| `domain/user/services/chat.service.ts` | 0,2-5,9 | Fix bug (Phase 0), then gradually remove methods as phases migrate, delete in Phase 9 |
| `infra/ai/llm.service.ts` | 0 | No changes needed (reused as-is) |
| `app/routes/chat.routes.ts` | 2-8 | Gradually simplify: add graph call path, remove old path, simplify phase resolution |
| `domain/user/services/registration.service.ts` | 7,9 | Delete after Phase 7 (absorbed into graph) |
| `domain/user/services/prompt.service.ts` | 0 | Fix chat prompt to include "json" (Phase 0). Otherwise reused as-is |
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

## What NOT to Do (Critical Guardrails)

1. **DO NOT replace ConversationContextService with LangGraph checkpointing.** The DB-backed conversation system works. Coexist.

2. **DO NOT bypass LLMService.** All LLM calls go through `LLMService.generateWithSystemPrompt()` to preserve debug logging and metrics.

3. **DO NOT change the API contract.** `POST /api/chat` request/response format stays identical. The migration is internal only.

4. **DO NOT migrate all phases at once.** One phase per step. Test after each step. The hybrid routing (graph for migrated phases, ChatService for others) must work at every intermediate state.

5. **DO NOT delete old code until the phase is fully tested in the graph.** Keep both paths working during migration.

6. **DO NOT change Zod schemas.** Reuse existing `parsePlanCreationResponse`, `parseSessionPlanningResponse`, etc. The validated types are correct.

7. **DO NOT restructure folders** beyond adding new files in `infra/ai/` and `domain/conversation/`. Follow existing module layout from `ARCHITECTURE.md`.

8. **DO NOT introduce new error types.** Use existing `AppError` and error patterns.

9. **DO NOT change DI patterns.** Graph is registered via the same DI container. Nodes access services via closure injection, not new DI mechanisms.

10. **DO NOT skip Phase 0 (bug fix).** The chat-phase JSON bug must be fixed before any LangGraph work. It validates that all phases work with JSON mode.

---

## Dependencies

### Current (already installed)
```json
"@langchain/core": "^0.3.72",
"@langchain/openai": "^0.6.9",
"zod": "^4.1.5"
```

### To Add
```json
"@langchain/langgraph": "latest"  // ~v0.2.x or v1.x (check compatibility with @langchain/core ^0.3.72)
```

### Compatibility Notes
- LangGraph v1.1.x requires `@langchain/core` ^1.1.16 — this may require upgrading `@langchain/core` and `@langchain/openai`
- If upgrading LangChain core, test that `LLMService` still works (message types, ChatOpenAI API)
- Zod v4 compatibility: LangGraph uses `zod/v4` import — verify with project's `zod` ^4.1.5
- **CHECK FIRST**: Run `npm install @langchain/langgraph` and see if peer dependency warnings appear. Resolve before proceeding.

---

## Effort Estimate

| Phase | Effort | Risk | Can Deploy After? |
|-------|--------|------|-------------------|
| 0: Fix bug | 30 min | Low | Yes |
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
- Eliminates the chat-phase JSON bug
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
- Migration stalls at phase 5 (training tools) due to complexity — mitigation: can stay hybrid

---

*Author: AI Assistant*
*Decision Date: 2026-02-11*
*Supersedes: Custom FSM discussion (not implemented)*
*Related: ADR-0001 (AI integration), ADR-0005 (Conversation context)*
