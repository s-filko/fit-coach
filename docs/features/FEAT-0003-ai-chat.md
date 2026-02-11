# FEAT-0003: AI Chat

**Status**: ✅ Implemented
**Version**: 2.0 (Refactored with conversation context and phase-based routing)

## User Story

As a user, I want to send messages and receive AI-generated responses through natural conversation, so that I can interact with my Fit Coach assistant for registration, training guidance, and fitness coaching.

## Overview

The AI Chat feature provides a unified conversational interface for all user interactions. The system automatically determines the appropriate service (Registration or Chat) based on the user's profile status and manages conversation history with a sliding window approach.

## Key Features

- **Phase-based routing**: Automatic service selection based on `profileStatus`
- **Conversation context**: Persistent dialogue history with sliding window
- **Multi-language support**: Responds in user's preferred language
- **Incremental state management**: Progress saved after each interaction

## Technical Architecture

### Flow Diagram

```
POST /api/chat
  ↓
Validate API key & user
  ↓
Check profileStatus
  ↓
├─ profileStatus === 'registration'
│    ↓
│    Load conversation context (userId, 'registration')
│    ↓
│    Get messages for prompt (sliding window: 20 turns)
│    ↓
│    RegistrationService.processUserMessage(user, message, history)
│    ↓
│    Update user profile if fields extracted
│    ↓
│    Check if registration complete
│    ↓
│    Save conversation turn
│    ↓
│    Phase transition if complete: 'registration' → 'chat'
│    ↓
│    Return {content, timestamp, registrationComplete?}
│
└─ profileStatus === 'complete'
     ↓
     Load conversation context (userId, 'chat')
     ↓
     Get messages for prompt (sliding window: 20 turns)
     ↓
     ChatService.processMessage(user, message, history)
     ↓
     Save conversation turn
     ↓
     Return {content, timestamp}
```

### Components

#### Route Handler
**Location**: `apps/server/src/app/routes/chat.routes.ts`

**Responsibilities**:
- Validate request (API key, userId, message)
- Load user profile
- Determine phase based on `profileStatus`
- Load conversation context for appropriate phase
- Route to RegistrationService or ChatService
- Handle phase transitions
- Persist conversation turns
- Return formatted response

#### RegistrationService
**Location**: `apps/server/src/domain/user/services/registration.service.ts`

**Used when**: `profileStatus === 'registration'`

**Responsibilities**:
- Extract profile data from messages
- Validate and normalize fields
- Track registration progress
- Determine when registration is complete
- Return structured data + user-facing response

#### ChatService
**Location**: `apps/server/src/domain/user/services/chat.service.ts`

**Used when**: `profileStatus === 'complete'`

**Responsibilities**:
- Generate personalized fitness coaching responses
- Use user profile for context-aware coaching
- Provide training advice, motivation, Q&A

#### ConversationContextService
**Location**: `apps/server/src/infra/conversation/drizzle-conversation-context.service.ts`

**Responsibilities**:
- Load conversation history by (userId, phase)
- Build message history with sliding window
- Persist conversation turns (user + assistant)
- Manage phase transitions with system notes

## Conversation Context Integration

### Phase Management

| Phase | profileStatus | Service | Context Identity |
|-------|--------------|---------|------------------|
| Registration | 'registration' | RegistrationService | (userId, 'registration') |
| Chat | 'complete' | ChatService | (userId, 'chat') |
| Future: Training | 'training' | TrainingService | (userId, 'training') |

### Sliding Window

- **Default**: 20 most recent turns loaded for LLM context
- **Configurable**: Can be adjusted via `getMessagesForPrompt(ctx, {limit: N})`
- **Token budget**: Prevents context overflow
- **Chronological**: Oldest to newest ordering

### Turn Storage

**Table**: `conversation_turns`

**Schema**:
```sql
CREATE TABLE conversation_turns (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  phase TEXT NOT NULL,  -- 'registration' | 'chat' | 'training'
  role TEXT NOT NULL,    -- 'user' | 'assistant' | 'system'
  content TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_conversation_turns_user_phase_created
  ON conversation_turns(user_id, phase, created_at);
```

### Phase Transitions

When registration completes:
1. Set `profileStatus = 'complete'`
2. Save final conversation turn in 'registration' context
3. Create system note: "User completed registration, transitioning to chat phase"
4. Subsequent messages use 'chat' context

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
**Location**: `apps/server/src/domain/user/services/__tests__/chat.service.unit.test.ts`

**Coverage**:
- Chat response generation
- System prompt construction
- Multi-language support

### Integration Tests
**Location**: `tests/integration/chat.integration.test.ts`

**Coverage**:
- Full chat flow with context
- Phase-based routing
- Registration to chat transition
- Conversation persistence
- Error scenarios (404, 401, 403, 500)

### Test Scenarios
```typescript
describe('FEAT-0003: AI Chat', () => {
  test('S-0008: Valid chat request returns response', async () => {
    // Test happy path
  });

  test('S-0040: Registration phase routes to RegistrationService', async () => {
    // Test phase routing
  });

  test('S-0041: Chat phase routes to ChatService', async () => {
    // Test phase routing
  });

  test('S-0043: Conversation context loaded with sliding window', async () => {
    // Test context loading
  });

  test('S-0044: Conversation turns persisted after interaction', async () => {
    // Test persistence
  });
});
```

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

### What Changed in v2.0
- ✅ Added conversation context integration
- ✅ Implemented phase-based routing
- ✅ Added sliding window for context management
- ✅ Implemented phase transitions with system notes
- ✅ Separated RegistrationService and ChatService
- ✅ Added `registrationComplete` field to response

### Backward Compatibility
- API contract unchanged (except optional `registrationComplete` field)
- All existing clients continue to work
- New field ignored by clients that don't expect it
