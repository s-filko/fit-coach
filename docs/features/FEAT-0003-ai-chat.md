# FEAT-0003: AI Chat

**Status**: ✅ Implemented
**Version**: 3.0 (LangGraph Architecture — tool calling, PostgreSQL checkpointer, subgraphs)

## User Story

As a user, I want to send messages and receive AI-generated responses through natural conversation, so that I can interact with my Fit Coach assistant for registration, training guidance, and fitness coaching.

## Overview

The AI Chat feature provides a unified conversational interface for all user interactions. The system routes each message through a LangGraph `ConversationGraph` that manages phase state via PostgreSQL checkpointer, invokes the appropriate phase subgraph, and persists conversation history.

## Key Features

- **Phase-based routing via LangGraph**: Router node determines phase from checkpointer state or user profile
- **Tool calling**: LLM calls typed tools for side effects (save profile, save plan, log sets); responds with natural text
- **Conversation history**: Persistent dialogue history with sliding window (20 turns) via `conversation_turns` table
- **Multi-language support**: LLM responds in user's preferred language
- **Atomic state**: Phase, activeSessionId persisted atomically by PostgreSQL checkpointer

## Technical Architecture

### Flow Diagram

```
POST /api/chat
  ↓
Validate API key & user existence
  ↓
graph.invoke({ userMessage, userId }, { configurable: { thread_id: userId, userId } })
  ↓
ConversationGraph (PostgresSaver checkpointer)
  ↓
[Router Node]
  ├─ Loads user from DB → state.user
  ├─ Resets requestedTransition to null
  ├─ New thread: phase = profileStatus === 'registration' ? 'registration' : 'chat'
  ├─ Existing thread: phase from checkpointer
  └─ Auto-closes timed-out sessions
  ↓
[Phase Subgraph] (one of 5, selected by state.phase)
  ├─ agentNode: history from conversation_turns + user message + state.messages
  │              → model.bindTools(phaseTools).invoke()
  ├─ ToolNode: executes tool calls (Zod-validated), returns ToolMessages
  ├─ (loop until no tool_calls)
  └─ extractNode: reads pendingTransition ref, re-fetches user, sets responseMessage
  ↓
[Persist Node]
  └─ appendTurn(userId, phase, userMessage, responseMessage) → conversation_turns
  ↓
[Transition Guard] (conditional edge)
  └─ Validates requestedTransition; if blocked → END
  ↓
[Cleanup Node] (if transition allowed)
  └─ Side effects (session state changes) + phase update
  ↓
Return { data: { content: responseMessage, timestamp } }
```

### Components

#### Route Handler (thin proxy)
**Location**: `apps/server/src/app/routes/chat.routes.ts`

**Responsibilities** (~20 lines):
- Validate request (API key, userId, message)
- Verify user exists in DB
- Call `graph.invoke()` with `{ userMessage, userId }` + configurable
- Return `{ data: { content, timestamp } }`

#### ConversationGraph
**Location**: `apps/server/src/infra/ai/graph/conversation.graph.ts`

**Responsibilities**:
- Wire all nodes and subgraphs into a `StateGraph`
- Configure PostgresSaver checkpointer
- Export compiled graph

#### Router Node
**Location**: `apps/server/src/infra/ai/graph/nodes/router.node.ts`

**Responsibilities**:
- Load user from DB
- Determine phase for new threads from `profileStatus`
- Auto-close timed-out training sessions
- Reset stale `requestedTransition`

#### Phase Subgraphs (implemented: registration, chat, plan_creation)
**Location**: `apps/server/src/infra/ai/graph/subgraphs/`

Each subgraph: `agentNode → toolsCondition → ToolNode → agentNode → extractNode`

#### Phase Nodes (system prompt builders)
**Location**: `apps/server/src/infra/ai/graph/nodes/`
- `registration.node.ts` — `buildRegistrationSystemPrompt()`
- `chat.node.ts` — `buildChatSystemPrompt()`
- `plan-creation.node.ts` — `buildPlanCreationSystemPrompt()` (loads exercises with muscle groups)

#### Phase Tools
**Location**: `apps/server/src/infra/ai/graph/tools/`
- `registration.tools.ts` — `save_profile_fields`, `complete_registration`
- `chat.tools.ts` — `update_profile`, `request_transition`
- `plan-creation.tools.ts` — `save_workout_plan`, `request_transition`

#### Persist Node
**Location**: `apps/server/src/infra/ai/graph/nodes/persist.node.ts`

**Responsibilities**:
- `appendTurn()` to `conversation_turns` table after each response
- Failure does not stop the response (try/catch + log)

#### ConversationContextService (simplified)
**Location**: `apps/server/src/infra/conversation/drizzle-conversation-context.service.ts`

**2 methods only**:
- `appendTurn(userId, phase, userMessage, assistantResponse)` — called by persist node
- `getMessagesForPrompt(userId, phase, options?)` — called by each agentNode to load history

## Conversation Context Integration

### Phase Management

| Phase | Implemented | State Source | History Source |
|-------|-------------|-------------|----------------|
| Registration | ✅ | PostgresSaver checkpointer | `conversation_turns` |
| Chat | ✅ | PostgresSaver checkpointer | `conversation_turns` |
| Plan Creation | ✅ | PostgresSaver checkpointer | `conversation_turns` |
| Session Planning | 🔄 pending Step 6 | PostgresSaver checkpointer | `conversation_turns` |
| Training | 🔄 pending Step 7 | PostgresSaver checkpointer | `conversation_turns` |

### Sliding Window

- **Default**: 20 most recent turns loaded per agentNode invocation
- **Implementation**: `SELECT ... ORDER BY created_at DESC LIMIT 20` reversed to chronological order
- **Token budget**: Prevents context overflow
- **Chronological**: Oldest to newest in LLM prompt

### Turn Storage

**Table**: `conversation_turns`

**Schema**:
```sql
CREATE TABLE conversation_turns (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  phase TEXT NOT NULL,  -- 'registration' | 'chat' | 'plan_creation' | 'session_planning' | 'training'
  role TEXT NOT NULL,    -- 'user' | 'assistant'
  content TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_conversation_turns_user_phase_created
  ON conversation_turns(user_id, phase, created_at);
```

**LangGraph checkpointer table** (managed by PostgresSaver, not manually):
```
langgraph_checkpoints — stores serialized graph state per thread_id
```

### Phase Transitions

Phase transitions are managed by `requestedTransition` in graph state:
1. Tool sets `pendingTransition.value = { toPhase: 'chat' }` (closure ref)
2. `extractNode` reads ref and sets `state.requestedTransition`
3. `persist.node.ts` writes conversation turn under **current phase** (before transition)
4. Transition guard validates the requested transition (12 rules)
5. If allowed: cleanup node updates `state.phase`, handles session side effects
6. PostgresSaver persists new `state.phase` — next invocation starts in new phase

## API Specification

### Endpoint
`POST /api/chat`

### Security
- Requires `X-Api-Key` header
- All `/api/*` routes protected

### Request
```typescript
{
  userId: string,    // UUID
  message: string    // User message (min 1 char)
}
```

### Response (Success)
```typescript
{
  data: {
    content: string,               // AI-generated response
    timestamp: string,             // ISO 8601 timestamp
    registrationComplete?: boolean // Present only when registration completes
  }
}
```

### Error Responses
- `401 Unauthorized` - Missing X-Api-Key header
- `403 Forbidden` - Invalid X-Api-Key
- `404 Not Found` - User not found
- `500 Internal Server Error` - Processing failed

## Scenarios

### S-0008: Valid Chat Request
**Given**: Valid userId and message
**When**: POST /api/chat
**Then**: 200 with `{content, timestamp}` is returned [BR-AI-001][BR-AI-002]

### S-0009: Invalid API Key
**Given**: Missing/invalid API key
**When**: POST /api/chat
**Then**: 401/403 is returned

### S-0010: AI Processing Error
**Given**: AI processing error occurs
**When**: POST /api/chat
**Then**: 500 with generic error is returned [BR-AI-001]

### S-0011: Unknown User
**Given**: Unknown userId
**When**: POST /api/chat
**Then**: 404 `{error: {message: 'User not found'}}` [BR-USER-003]

### S-0040: Registration Phase Routing
**Given**: User with `profileStatus='registration'`
**When**: POST /api/chat
**Then**: RegistrationService processes message, extracts profile data

### S-0041: Chat Phase Routing
**Given**: User with `profileStatus='complete'`
**When**: POST /api/chat
**Then**: ChatService processes message, provides coaching

### S-0042: Phase Transition
**Given**: Registration completes on this message
**When**: POST /api/chat
**Then**: Response includes `registrationComplete: true`, status updates to 'complete'

### S-0043: Conversation Context Loaded
**Given**: User has previous conversation history
**When**: POST /api/chat
**Then**: Last 20 turns loaded and included in LLM context

### S-0044: Turn Persistence
**Given**: Any successful chat interaction
**When**: Response generated
**Then**: Both user and assistant messages saved to `conversation_turns`

## Acceptance Criteria

- **AC-0005**: Success response: `200 {data: {content: string, timestamp: string}}`
- **AC-0006**: Not found response: `404 {error: {message: "User not found"}}`
- **AC-0007**: Server error response: `500 {error: {message: "Processing failed"}}`
- **AC-0110**: Conversation context used internally without API contract changes
- **AC-0111**: Phase-based routing transparent to client
- **AC-0112**: Registration completion signaled with `registrationComplete: true`
- **AC-0113**: Sliding window limits context to 20 most recent turns
- **AC-0114**: Phase transitions create system notes in conversation history

## Domain Rules

### From AI Domain
- **BR-AI-001**: LLM errors must be caught and returned as 500 with generic message
- **BR-AI-002**: AI response must include timestamp
- **BR-AI-003**: LLM must handle multilingual input

### From User Domain
- **BR-USER-003**: Unknown user returns 404

### From Conversation Domain
- **BR-CONV-001**: Context loaded by (userId, phase) before each LLM call
- **BR-CONV-002**: Conversation turns appended after response generation
- **BR-CONV-003**: Sliding window default 20 turns for token budget
- **BR-CONV-005**: Phase transitions create system notes

## Implementation Details

### Route Implementation
```typescript
// apps/server/src/app/routes/chat.routes.ts

fastify.post('/chat', async (request, reply) => {
  const { userId, message } = request.body;

  // 1. Load user
  const user = await userService.getUser(userId);
  if (!user) throw new AppError(404, 'User not found');

  // 2. Determine phase & load context
  const phase = user.profileStatus === 'registration' ? 'registration' : 'chat';
  const context = conversationContextService.getContext(userId, phase);
  const history = context
    ? conversationContextService.getMessagesForPrompt(context)
    : [];

  // 3. Route to appropriate service
  let content: string;
  let registrationComplete: boolean | undefined;
  let updatedUser = user;

  if (user.profileStatus === 'registration') {
    const result = await registrationService.processUserMessage(user, message, history);
    content = result.response;
    updatedUser = result.updatedUser;

    if (result.isComplete) {
      updatedUser.profileStatus = 'complete';
      registrationComplete = true;
    }
  } else {
    content = await chatService.processMessage(user, message, history);
  }

  // 4. Save updated user if changed
  if (updatedUser !== user) {
    await userService.updateUser(updatedUser.id, updatedUser);
  }

  // 5. Persist conversation turn
  conversationContextService.appendTurn(userId, phase, message, content);

  // 6. Handle phase transition if registration completed
  if (registrationComplete) {
    conversationContextService.startNewPhase(
      userId,
      'registration',
      'chat',
      'User completed registration, transitioning to chat phase'
    );
  }

  // 7. Return response
  return {
    data: {
      content,
      timestamp: new Date().toISOString(),
      ...(registrationComplete !== undefined && { registrationComplete })
    }
  };
});
```

### Service Dependencies
```
ChatRoute
  ├─ UserService (get/update user)
  ├─ ConversationContextService (load/save context)
  ├─ RegistrationService (if profileStatus='registration')
  │   ├─ PromptService
  │   └─ LLMService
  └─ ChatService (if profileStatus='complete')
      ├─ PromptService
      └─ LLMService
```

## Testing

### Unit Tests
**Location**: `apps/server/src/infra/ai/graph/`

**Coverage**:
- `nodes/__tests__/chat.node.unit.test.ts` — `buildChatSystemPrompt()`
- `tools/__tests__/chat.tools.unit.test.ts` — `update_profile`, `request_transition` (11 tests)
- `tools/__tests__/registration.tools.unit.test.ts` — `save_profile_fields`, `complete_registration` (13 tests)
- `tools/__tests__/plan-creation.tools.unit.test.ts` — `save_workout_plan`, `request_transition`
- `subgraphs/__tests__/registration.subgraph.unit.test.ts` — Bug 2 regression (ToolMessages in prompt)
- `subgraphs/__tests__/plan-creation.subgraph.unit.test.ts` — subgraph state output
- `__tests__/conversation.graph.unit.test.ts` — graph routing, model factory mocked

### Integration Tests
**Location**: `apps/server/tests/integration/api/chat.routes.integration.test.ts`

**Coverage**:
- Thin proxy: `graph.invoke` called with correct args
- User not found → 404
- Invalid API key → 401/403
- Error scenarios (500)

### Test Count
275 passing (as of Step 5 completion)

## Performance Considerations

- **LLM latency**: Typically < 3 seconds for response
- **Context loading**: Indexed query on (userId, phase, createdAt)
- **Sliding window**: Limits memory and token usage
- **Async processing**: Non-blocking conversation persistence

## Future Enhancements

### Planned
- Conversation summarization when window exceeds threshold
- Multiple conversation threads per user
- Training phase with specialized TrainingService
- Planning phase for workout plan creation

### Considered but Deferred
- Real-time streaming responses
- Multi-modal inputs (images, voice)
- Conversation export/import

## References

- **API Spec**: `docs/API_SPEC.md` section 3.1
- **Architecture**: `docs/ARCHITECTURE.md` - Conversation Context section
- **Domain Spec**: `docs/domain/user.spec.md`
- **ADR-0005**: Conversation context with sliding window
- **FEAT-0006**: Registration data collection
- **FEAT-0009**: Conversation context implementation
- **DB Schema**: `docs/DB_SETUP.md` - conversation_turns table

## Migration Notes

### What Changed in v3.0 (LangGraph Architecture)
- ✅ `RegistrationService` → `registration.subgraph.ts` + `registration.tools.ts`
- ✅ `ChatService` → `chat.subgraph.ts` + `chat.tools.ts`
- ✅ Plan creation → `plan-creation.subgraph.ts` + `plan-creation.tools.ts`
- ✅ `LLMService` (JSON mode wrapper) → `model.factory.ts` + tool calling
- ✅ Phase state via `[PHASE_ENDED]` markers → PostgresSaver checkpointer
- ✅ `IConversationContextService` (7 methods) → 2-method interface
- ✅ `chat.routes.ts` (180-line orchestration) → ~20-line thin proxy
- ✅ `registrationComplete` field in response removed (no longer needed — phase tracked by checkpointer)

### Backward Compatibility
- `POST /api/chat` request contract unchanged: `{ userId, message }`
- `POST /api/chat` response: `{ data: { content, timestamp } }` — `registrationComplete` field removed in v3.0
