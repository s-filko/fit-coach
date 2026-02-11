# Fit Coach API Spec (MVP)

This spec is the canonical definition of the MVP API. Code must match this document.

Base URL: `/`

## Security
- Protected routes: all under `/api/*` require header `X-Api-Key: <secret>`.
- Public routes: `/health`, `/docs`, `/docs/*`.
- Error codes:
  - 401 Unauthorized — header `X-Api-Key` is missing
  - 403 Forbidden — invalid `X-Api-Key`

Swagger (OpenAPI) additions:
```yaml
components:
  securitySchemes:
    ApiKeyAuth:
      type: apiKey
      in: header
      name: X-Api-Key
```
Protected endpoints should declare:
```yaml
security:
  - ApiKeyAuth: []
```

## 1. Health
- GET `/health`
- Response 200: `{ "status": "ok" }`

## 2. Users

### 2.1 Create/Upsert User
- x-feature: FEAT-0001
- POST `/api/user`
- Request body (Zod):
```ts
{
  provider: string(min:1),
  providerUserId: string(min:1),
  username?: string,
  firstName?: string,
  lastName?: string,
  languageCode?: string,
}
```
- Responses:
  - 200 `{ data: { id: string } }`
  - 400 `{ error: { message: string } }`
  - 401 `{ error: { message: string } }`
  - 403 `{ error: { message: string } }`

### 2.2 Get User by Id
- x-feature: FEAT-0002
- GET `/api/user/{id}`
- Path params: `{ id: string }`
- Responses:
  - 200 `{ data: { id: string } }`
  - 401 `{ error: { message: string } }`
  - 403 `{ error: { message: string } }`
  - 404 `{ error: { message: "User not found" } }`

## 3. AI Chat

### 3.1 Send Chat Message
- x-feature: FEAT-0003
- POST `/api/chat`
- Request body (Zod):
```ts
{
  userId: string(min:1),
  message: string(min:1),
}
```
- Responses:
  - 200 `{ data: { content: string, timestamp: string, registrationComplete?: boolean } }`
  - 401 `{ error: { message: string } }`
  - 403 `{ error: { message: string } }`
  - 404 `{ error: { message: "User not found" } }`
  - 500 `{ error: { message: "Processing failed" } }`

  Response fields:
  - `content` (string): AI-generated response message
  - `timestamp` (string): ISO 8601 timestamp of the response
  - `registrationComplete` (boolean, optional): Present only during registration phase. `true` when user completes registration and transitions to chat phase.

  Notes:
  - All conversational phases (registration, chat, training, planning) interact exclusively through this `/api/chat` endpoint.
  - Server automatically determines the phase based on user's `profileStatus` field.
  - **Phase routing**:
    - `profileStatus === 'registration'` → RegistrationService (collects profile data via JSON mode LLM)
    - `profileStatus === 'complete'` → ChatService (general fitness coaching conversation)
  - **Phase transitions**: When registration is completed, server updates `profileStatus` to `'complete'`, persists the conversation turn with a system note, and returns `registrationComplete: true`. Subsequent requests use ChatService.

### Notes
- x-feature: FEAT-0009 ✅ IMPLEMENTED
- Response time may vary based on AI model load (typically < 3 seconds)
- Server maintains conversation context per (userId, phase) internally [BR-CONV-001]; context is persisted in `conversation_turns` table.
- **Sliding window** (default 20 turns) limits token usage [BR-CONV-003].
- **Phase transitions** create system notes and reset context [BR-CONV-005].
- Conversation history is loaded before each LLM call and appended after response generation [BR-CONV-001][BR-CONV-002].

## 4. Debug Endpoints (Development Only)

### 4.1 Get LLM Debug Info
- GET `/api/debug/llm`
- **Availability**: Only in development mode (`NODE_ENV=development`)
- **Security**: Requires `X-Api-Key` authentication
- Response 200:
```ts
{
  data: {
    debugInfo: {
      isDebugMode: boolean,
      metrics: {
        totalRequests: number,
        totalErrors: number,
        totalTokens: number,
        averageResponseTime: number,
        errorRate: number
      },
      requestHistory: Array<{
        timestamp: string,
        messages: ChatMsg[],
        model: string,
        temperature: number
      }>,  // Last 50 requests
      responseHistory: Array<{
        timestamp: string,
        content: string,
        tokenUsage?: { promptTokens, completionTokens, totalTokens },
        processingTime: number
      }>  // Last 50 responses
    },
    timestamp: string
  }
}
```

### 4.2 Clear LLM Debug History
- POST `/api/debug/llm/clear`
- **Availability**: Only in development mode (`NODE_ENV=development`)
- **Security**: Requires `X-Api-Key` authentication
- Response 200:
```ts
{
  data: {
    message: "Debug history cleared",
    timestamp: string
  }
}
```

Notes:
- Debug endpoints return 404 in production environment.
- Debug mode can be toggled at runtime via `LLM_DEBUG=true` environment variable.
- History is stored in memory and cleared on server restart.

## Notes
- All responses are JSON.
- Errors follow `{ error: { message, code? } }`.
- On future DB integration, user payloads may expand; this spec will be updated first.
