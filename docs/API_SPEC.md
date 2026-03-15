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

  Notes:
  - **All conversational phases (registration, chat, plan_creation, session_planning, training) interact exclusively through this `/api/chat` endpoint.**
  - **No separate REST endpoints for training operations** — all interactions happen through conversational AI via `/api/chat`.
  - Server routes through `ConversationGraph` (LangGraph StateGraph with PostgreSQL checkpointer). Phase state is persisted atomically per user.
  - **Phase routing** (handled by Router Node inside the graph):
    - New user: `profileStatus === 'registration'` → registration subgraph (collects profile data via tool calling)
    - `profileStatus === 'complete'`, no plan/session → chat subgraph (general fitness coaching)
    - User requests plan → plan_creation subgraph (LLM calls `save_workout_plan` tool)
    - Plan saved → session_planning subgraph (LLM calls `start_training_session` tool) ✓
    - Session started → training subgraph (LLM calls `log_set`, `complete_current_exercise`, etc.) [pending Step 7]
  - **Phase transitions**: LLM calls phase transition tools (`request_transition`, `complete_registration`, `finish_training`, etc.). Transition is validated by guard node and persisted by PostgresSaver.
  - **Tool calling**: LLM responds with natural text; uses typed tools for all DB side effects (save profile, save plan, log sets, complete session). No JSON mode parsing.
  - **Training flow** (all via `/api/chat`, pending Step 7 — training subgraph):
    1. User requests workout → chat LLM calls `request_transition` → phase → session_planning
    2. Session planning → LLM calls `start_training_session` tool → session created in DB → phase → training
    3. User: "Did 10 reps with 50kg" → LLM calls `log_set` tool → set saved to DB
    4. User: "Finished" → LLM calls `finish_training` tool → session completed → phase → chat

### Notes
- x-feature: FEAT-0009 ✅ IMPLEMENTED (simplified to 2-method interface)
- Response time may vary based on AI model load (typically < 3 seconds)
- Conversation history persisted in `conversation_turns` table per (userId, phase) [BR-CONV-001].
- **Sliding window** (default 20 turns) limits token usage [BR-CONV-003].
- **Phase state** persisted in `langgraph_checkpoints` table by PostgresSaver (not in `conversation_turns`).
- Conversation history is loaded before each LLM call by agentNode and appended after response by persist.node [BR-CONV-001][BR-CONV-002].

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
