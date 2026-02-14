# Chat Phase JSON Mode Fix & Profile Update Feature

## Date: 2026-02-11

## Problem

The `chat` phase had a JSON parsing bug:
- `ChatService.processMessage()` set `jsonMode: false` for chat phase (line 77)
- LLM returned plain text (e.g., "Отлично, с...")
- But `parseLLMResponse()` tried to parse it as JSON → crash: `"Unexpected token 'О'"`

## Solution

### 1. Enable JSON Mode for ALL Phases

Changed `chat.service.ts` line 77:

```typescript
// BEFORE:
const needsJsonMode = phase !== 'chat';

// AFTER:
const llmResponse = await this.llmService.generateWithSystemPrompt(
  messages,
  systemPrompt,
  { jsonMode: true }, // All phases now use JSON mode
);
```

### 2. Update Chat System Prompt

Added JSON format instructions to `prompt.service.ts` `buildChatSystemPrompt()`:

```typescript
RESPONSE FORMAT:
You MUST respond with ONLY a valid JSON object. No markdown, no code blocks, no plain text.
{
  "message": "<your response to the user>",
  "phaseTransition": { ... }, // optional
  "profileUpdate": { ... }    // optional - NEW FEATURE
}
```

### 3. Add Profile Update Feature

Users can now update their profile from the chat phase without phase transitions.

**Schema** (`llm-response.types.ts`):
```typescript
export const ProfileUpdateSchema = z.object({
  age: z.number().int().positive().optional(),
  gender: z.enum(['male', 'female']).optional(),
  height: z.number().positive().optional(),
  weight: z.number().positive().optional(),
  fitnessLevel: z.enum(['beginner', 'intermediate', 'advanced']).optional(),
  fitnessGoal: z.string().optional(),
});
```

**Handling** (`chat.service.ts`):
- Parse `profileUpdate` from LLM response
- Call `userService.updateProfileData()` with non-null fields
- No phase transition needed

**Example:**
```
User: "Кстати, я не женщина, я мужчина"
LLM: {
  "message": "Извини за ошибку! Записал, что ты мужчина.",
  "profileUpdate": { "gender": "male" }
}
→ Profile updated in DB, conversation continues in chat phase
```

## Files Changed

| File | Change |
|------|--------|
| `domain/user/services/chat.service.ts` | - Set `jsonMode: true` always<br>- Add `userService` to constructor<br>- Add `handleProfileUpdate()` method<br>- Parse `profileUpdate` from LLM response |
| `domain/user/services/prompt.service.ts` | Add JSON format instructions + profileUpdate field to chat prompt |
| `domain/conversation/llm-response.types.ts` | Add `ProfileUpdateSchema` and `profileUpdate` field to `LLMConversationResponseSchema` |
| `main/register-infra-services.ts` | Pass `userService` to `ChatService` constructor |
| `tests/integration/services/plan-creation.integration.test.ts` | Add mock `userService` to ChatService constructor |
| `tests/unit/services/chat-json-mode.unit.test.ts` | Update test: chat phase now requires "json" in prompt |

## Testing

All unit tests pass (46 tests).

## Related

- ADR-0007: LangGraph gradual migration plan (future work)
- `docs/troubleshooting/llm-json-mode-error.md`: Original error documentation
