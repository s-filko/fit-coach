# FEAT-0006: Registration Data Collection (Unified JSON Mode)

**Status**: ✅ Implemented
**Version**: 2.0 (Refactored with unified JSON mode LLM approach)

## Overview

Registration collects essential user profile data through conversational AI using a single unified LLM call with JSON mode. The system dynamically generates prompts based on missing fields, extracts structured data, and provides natural language responses in a single API round-trip.

## User Story

As a new user, I want to complete registration through natural conversation in my language, so that the AI coach can create a personalized fitness plan for me.

## Key Changes from v1.0

### What Changed
- **Single LLM call** with JSON mode instead of multiple parsing steps
- **Removed services**: ProfileParserService, data-transformers, messages.ts, registration.config.ts
- **Centralized validation**: All field validators in `registration.validation.ts`
- **Dynamic prompts**: PromptService generates context-aware system prompts
- **Incremental extraction**: Fields extracted and saved as they appear in conversation

### Current Implementation
- `RegistrationService.processUserMessage()` - single entry point
- JSON response schema: `{extracted_data, response, is_confirmed}`
- Zod-based validation with centralized field validators
- Conversation context integration (sliding window, phase transitions)

## Technical Architecture

### Flow Diagram

```
User Message → RegistrationService.processUserMessage()
                ↓
                Load conversation context (phase='registration')
                ↓
                PromptService.buildUnifiedRegistrationPrompt(user)
                ↓
                LLMService.generateWithSystemPrompt(messages, prompt, {jsonMode: true})
                ↓
                Parse JSON: {extracted_data, response, is_confirmed}
                ↓
                Validate fields with Zod validators
                ↓
                Merge into user profile
                ↓
                Check completeness (all 6 fields + confirmation)
                ↓
                Save conversation turn
                ↓
                Return {updatedUser, response, isComplete, parsedData}
```

### Components

#### RegistrationService
**Location**: `apps/server/src/domain/user/services/registration.service.ts`

**Interface**:
```typescript
interface IRegistrationService {
  processUserMessage(
    user: User,
    message: string,
    historyMessages: ChatMsg[]
  ): Promise<{
    updatedUser: User;
    response: string;
    isComplete: boolean;
    parsedData?: RegistrationData;
  }>;
}
```

**Responsibilities**:
- Build context-aware system prompt with PromptService
- Call LLM with JSON mode enabled
- Parse and validate JSON response
- Merge extracted fields into user profile
- Determine registration completion status

#### PromptService
**Location**: `apps/server/src/domain/user/services/prompt.service.ts`

**Method**: `buildUnifiedRegistrationPrompt(user: User): string`

**Responsibilities**:
- Generate dynamic system prompt based on:
  - Already collected fields
  - Missing required fields
  - User's language preference
- Include validation rules and expected formats
- Provide examples for field extraction

#### LLMService
**Location**: `apps/server/src/infra/ai/llm.service.ts`

**Method**:
```typescript
generateWithSystemPrompt(
  messages: ChatMsg[],
  systemPrompt: string,
  options?: { jsonMode?: boolean }
): Promise<string>
```

**Features**:
- OpenAI-compatible API abstraction
- JSON mode support (structured output)
- Debug mode with request/response history
- Metrics tracking

#### Validation
**Location**: `apps/server/src/domain/user/validation/registration.validation.ts`

**Validators**:
```typescript
export const fieldValidators = {
  age: z.number().int().min(10).max(100),
  gender: z.enum(['male', 'female']),
  height: z.number().int().min(120).max(220), // cm
  weight: z.number().int().min(30).max(200),  // kg
  fitnessLevel: z.enum(['beginner', 'intermediate', 'advanced']),
  fitnessGoal: z.string().min(1).max(100),
};
```

**Schema**: `registrationLLMResponseSchema`
```typescript
{
  extracted_data: {
    age?: number | null,
    gender?: 'male' | 'female' | null,
    height?: number | null,  // cm
    weight?: number | null,  // kg
    fitnessLevel?: 'beginner' | 'intermediate' | 'advanced' | null,
    fitnessGoal?: string | null
  },
  response: string,
  is_confirmed: boolean
}
```

### Data Flow

1. **User message arrives** at `/api/chat`
2. **Route handler** checks `profileStatus === 'registration'`
3. **Load conversation context** with sliding window (default 20 turns)
4. **Call RegistrationService** with user, message, and history
5. **Generate prompt** dynamically based on missing fields
6. **LLM responds** with JSON containing extracted data + user-facing response
7. **Validate** extracted fields with Zod schemas
8. **Merge** valid fields into user object (last-write-wins)
9. **Check completeness**: all 6 fields present + explicit confirmation
10. **Save** conversation turn (user message + assistant response)
11. **Phase transition** if complete: `registration` → `chat` with system note
12. **Return** response to user

## Registration Fields

### Required Fields (6)

| Field | Type | Validation | Notes |
|-------|------|------------|-------|
| age | number | 10-100 | Calculated from dateOfBirth in full version |
| gender | enum | 'male' \| 'female' | Normalized to English |
| height | number | 120-220 cm | Metric units only |
| weight | number | 30-200 kg | Metric units only |
| fitnessLevel | enum | 'beginner' \| 'intermediate' \| 'advanced' | Experience level |
| fitnessGoal | string | 1-100 chars | User's training objective |

### Completion Criteria
- All 6 fields must be present AND
- User provides explicit confirmation (`is_confirmed: true`)

## Domain Rules

### Invariants
- **INV-USER-001**: User uniqueness by (provider, providerUserId)
- **INV-USER-002**: ProfileStatus starts as 'registration' on user creation
- **INV-USER-003**: Registration fields required before status can change to 'complete'

### Business Rules
- **BR-USER-005**: Never re-ask already captured fields
- **BR-USER-008**: Extract missing fields opportunistically across conversation
- **BR-USER-009**: Clarify ambiguous values before persisting
- **BR-USER-010**: Registration data persists incrementally (resume after restart)
- **BR-USER-012**: Last-write-wins during registration
- **BR-USER-016**: Normalize to English enums and metric units

## API Integration

### Endpoint
`POST /api/chat`

### Request
```json
{
  "userId": "uuid",
  "message": "I'm 25 years old, male, 180cm tall"
}
```

### Response (during registration)
```json
{
  "data": {
    "content": "Great! I've noted your age, gender, and height. Now, what's your current weight and fitness level?",
    "timestamp": "2025-01-15T10:30:00.000Z"
  }
}
```

### Response (registration complete)
```json
{
  "data": {
    "content": "Perfect! Your profile is complete. Let's start building your fitness plan!",
    "timestamp": "2025-01-15T10:35:00.000Z",
    "registrationComplete": true
  }
}
```

## Conversation Context Integration

### Phase Management
- **Phase**: `'registration'`
- **Context**: Loaded by (userId, phase)
- **Sliding window**: Default 20 most recent turns
- **Transition**: `registration` → `chat` with system note when complete

### Turn Storage
Each interaction saves:
```typescript
{
  userId: string,
  phase: 'registration',
  turns: [
    { role: 'user', content: string, timestamp: Date },
    { role: 'assistant', content: string, timestamp: Date }
  ]
}
```

## Scenarios

### S-0025: No Re-asking Captured Fields
**Given**: Age already captured
**When**: User mentions age again
**Then**: Bot acknowledges but doesn't re-ask age [BR-USER-005]

### S-0026: Batch Field Extraction
**Given**: User provides multiple fields at once
**When**: Parsed
**Then**: All recognized fields stored, only missing ones requested [BR-USER-005]

### S-0029: Incomplete Data Prevents Transition
**Given**: Not all required fields present
**When**: At confirmation step
**Then**: Bot asks for missing data, doesn't set profileStatus='complete' [INV-USER-003]

### S-0030: Explicit Confirmation Required
**Given**: User sends confirmation ("yes", "confirm")
**When**: All required fields present
**Then**: profileStatus='complete', phase transitions to 'chat'

### S-0034: Cross-conversation Extraction
**Given**: Registration in any phase
**When**: Message contains missing profile fields
**Then**: System extracts and persists immediately, doesn't re-ask [BR-USER-008]

### S-0036: Durability After Restart
**Given**: Server restart during registration
**When**: User continues
**Then**: Previously captured fields remain, flow resumes correctly [BR-USER-010]

### S-0037: Last-Write-Wins
**Given**: User changes previously provided data
**When**: New value detected
**Then**: Latest value overrides prior one, bot acknowledges update [BR-USER-012]

## Acceptance Criteria

- **AC-0018**: Registration never regresses to earlier prompts unless user explicitly edits
- **AC-0019**: Each captured field is idempotent; re-mentioning doesn't reset flow
- **AC-0023**: Continuous extraction across conversation; any missing field captured once
- **AC-0024**: Ambiguous inputs trigger single concise clarification
- **AC-0025**: Registration progress is durable; restarts preserve captured fields
- **AC-0033**: Inputs in any language/units accepted; stored as English enums and metric integers

## Testing

### Unit Tests
**Location**: `apps/server/src/domain/user/services/__tests__/registration.service.unit.test.ts`

**Coverage**:
- JSON parsing and validation
- Field extraction logic
- Completion detection
- Error handling

### Integration Tests
**Location**: `tests/integration/registration.integration.test.ts`

**Coverage**:
- Full registration flow end-to-end
- Multi-turn conversations
- Field persistence
- Phase transitions
- Conversation context integration

## Migration Notes

### Removed Components
- ❌ `profile-parser.service.ts` - Multi-step parsing logic
- ❌ `data-transformers.ts` - Field transformation utilities
- ❌ `messages.ts` - Static message templates
- ❌ `registration.config.ts` - Old configuration approach

### Current Components
- ✅ `registration.service.ts` - Unified registration service
- ✅ `prompt.service.ts` - Dynamic prompt generation
- ✅ `registration.validation.ts` - Centralized Zod validators
- ✅ `llm.service.ts` - OpenAI-compatible LLM service with JSON mode

## Configuration

### Environment Variables
```bash
LLM_API_KEY=<api-key>          # Required
LLM_MODEL=gpt-4-turbo          # Required
LLM_API_URL=<custom-url>       # Optional (defaults to OpenAI)
LLM_TEMPERATURE=0.7            # Required (0-2)
LLM_DEBUG=true                 # Optional (enables debug mode)
```

### DI Registration
**Location**: `apps/server/src/main/register-infra-services.ts`

**Order**:
1. ConversationContextService
2. UserRepository
3. UserService
4. PromptService
5. LLMService
6. **RegistrationService** ← depends on PromptService + LLMService
7. ChatService

## Debug Support

### Debug Endpoints (Development Only)
- `GET /api/debug/llm` - View request/response history and metrics
- `POST /api/debug/llm/clear` - Clear debug history

### Metrics Tracked
- Total requests
- Total errors
- Total tokens used
- Average response time
- Error rate

## Future Enhancements

### Planned (Post-MVP)
- Extended profile fields (healthRestrictions, trainingLocation, equipment, availability)
- Onboarding phase for optional extended questions
- Multi-language prompt templates
- Advanced validation with field dependencies
- Progress indicators for users

### Not Planned
- Multiple confirmation steps (single confirmation at end)
- Step-by-step wizard UI (conversational only)
- Profile editing during registration (last-write-wins)

## References

- **Domain Spec**: `docs/domain/user.spec.md`
- **API Spec**: `docs/API_SPEC.md`
- **Architecture**: `docs/ARCHITECTURE.md`
- **ADR-0004**: User profile and context storage model
- **ADR-0005**: Conversation context with sliding window
- **FEAT-0003**: AI Chat implementation
- **FEAT-0009**: Conversation context architecture

## Implementation Checklist

- [x] Remove old ProfileParserService and related code
- [x] Implement RegistrationService with JSON mode
- [x] Create PromptService for dynamic prompt generation
- [x] Centralize validation in registration.validation.ts
- [x] Integrate with ConversationContextService
- [x] Update routes to handle phase transitions
- [x] Add debug endpoints for development
- [x] Write unit tests for new services
- [x] Write integration tests for full flow
- [x] Update API documentation
- [x] Update architecture documentation
