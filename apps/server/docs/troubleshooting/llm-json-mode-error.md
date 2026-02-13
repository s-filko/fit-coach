# LLM JSON Mode Error: "Response input messages must contain the word 'json'"

## Problem

When using OpenAI/OpenRouter API with `response_format: { type: "json_object" }`, the API returns a 400 error:

```
"message": "Response input messages must contain the word 'json' in some form to use 'text.format' of type 'json_object'."
```

## Root Cause

OpenAI's API requires that when `response_format: json_object` is used, the system prompt MUST explicitly mention JSON format. This is a safety measure to ensure the model understands it should return JSON.

## Solution

Only enable JSON mode for conversation phases that require structured output:

- ✅ `registration` - needs structured data extraction
- ✅ `plan_creation` - needs workout plan JSON
- ✅ `session_planning` - needs session plan JSON  
- ✅ `training` - needs exercise tracking JSON
- ❌ `chat` - free-form conversation, no JSON needed

### Code Fix

In `ChatService.processMessage()`:

```typescript
// Only use JSON mode for phases that require structured output
const needsJsonMode = phase !== 'chat';
const llmResponse = await this.llmService.generateWithSystemPrompt(
  messages,
  systemPrompt,
  { jsonMode: needsJsonMode },
);
```

## Debugging

Added comprehensive logging in `LLMService`:

1. **Request logging**: Full HTTP payload including headers, model, temperature, and `response_format`
2. **Response logging**: Token usage, processing time, and full response metadata
3. **Error logging**: Complete error details including provider error messages

Access logs via `/api/debug/llm` endpoint (requires `LLM_DEBUG=true` in `.env`).

## Related Files

- `apps/server/src/domain/user/services/chat.service.ts` - Chat orchestration
- `apps/server/src/infra/ai/llm.service.ts` - LLM API calls with logging
- `apps/server/src/domain/ai/ports.ts` - LLM request/response types
