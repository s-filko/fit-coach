# LLM JSON Mode Error: "Response input messages must contain the word 'json'"

## Problem

When using OpenAI/OpenRouter API with `response_format: { type: "json_object" }`, the API returns a 400 error:

```
"message": "Response input messages must contain the word 'json' in some form to use 'text.format' of type 'json_object'."
```

## Root Cause

OpenAI's API requires that when `response_format: json_object` is used, the system prompt MUST explicitly mention JSON format. This is a safety measure to ensure the model understands it should return JSON.

## Solution

### 1. Runtime Validation (Automatic)

The system now includes **automatic runtime validation** in `LLMService.invokeModel()` that catches this error **before** making API calls:

```typescript
// Before making API call, validate JSON mode configuration
if (jsonMode) {
  const promptLower = systemPromptText.toLowerCase();
  if (!promptLower.includes('json')) {
    throw new Error(
      'CONFIGURATION ERROR: JSON mode is enabled but system prompt does not mention "json"'
    );
  }
}
```

Benefits:
- ✅ Catches errors immediately (no API call needed)
- ✅ Clear error message with system prompt preview
- ✅ Prevents wasted API calls and costs
- ✅ Easier debugging with detailed context

### 2. Conditional JSON Mode

Only enable JSON mode for conversation phases that require structured output:

- ✅ `registration` - needs structured data extraction
- ✅ `plan_creation` - needs workout plan JSON
- ✅ `session_planning` - needs session plan JSON  
- ✅ `training` - needs exercise tracking JSON
- ❌ `chat` - free-form conversation, no JSON needed

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

### 3. Ensure Prompts Mention "JSON"

All prompts that use JSON mode must explicitly mention "json" (case-insensitive):

```typescript
// ✅ Good
"You are FitCoach. Respond in JSON format with..."

// ❌ Bad - will be caught by runtime validation
"You are FitCoach. Respond with structured data..."
```

## Debugging

### Runtime Validation Errors

If you see this error:

```
CONFIGURATION ERROR: JSON mode is enabled but system prompt does not mention "json".
```

Check the console logs for details:

```
=== JSON MODE VALIDATION ERROR ===
System prompt does not contain "json" but jsonMode=true
System prompt preview: You are a helpful assistant...
```

This means a prompt needs to be updated to mention "json" or JSON mode should be disabled for that phase.

### LLM Debug Mode

Enable comprehensive logging in `.env`:

```bash
LLM_DEBUG=true
```

This logs:
1. **Request logging**: Full HTTP payload including `response_format`
2. **Response logging**: Token usage, processing time, metadata
3. **Error logging**: Complete provider error messages

Access logs via `/api/debug/llm` endpoint.

## Testing

Run tests to verify JSON mode configuration:

```bash
# Test that all prompts mention "json" when JSON mode is used
npm test -- chat-json-mode.unit

# Test runtime validation logic
npm test -- llm-json-validation.unit
```

## Related Files

- `apps/server/src/domain/user/services/chat.service.ts` - Chat orchestration with conditional JSON mode
- `apps/server/src/infra/ai/llm.service.ts` - LLM API calls with runtime validation
- `apps/server/src/domain/ai/ports.ts` - LLM request/response types
- `apps/server/tests/unit/services/chat-json-mode.unit.test.ts` - Prompt validation tests
- `apps/server/tests/unit/infra/llm-json-validation.unit.test.ts` - Runtime validation tests
