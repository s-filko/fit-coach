# Registration Flow

## Overview

The registration flow collects 6 required profile fields from the user and then intelligently transitions to the next phase based on user intent.

## Required Fields

1. **age** - number (10-100)
2. **gender** - "male" or "female"
3. **height** - number in cm (120-220)
4. **weight** - number in kg (30-200, accepts decimals like 72.5)
5. **fitnessLevel** - "beginner", "intermediate", or "advanced"
6. **fitnessGoal** - string (e.g., "lose weight", "build muscle")

## Flow Stages

### 1. Data Collection

- LLM introduces itself and asks for missing fields
- User can provide multiple fields in one message
- LLM extracts all mentioned fields from conversation history
- System validates each field with strict Zod schemas

### 2. Confirmation

- When all 6 fields are collected, LLM shows a summary
- User must explicitly confirm (e.g., "да", "верно", "подтверждаю")
- User can edit fields before confirming
- `is_confirmed` flag is set to `true` only on explicit confirmation

### 3. Phase Transition (LLM-Driven)

After confirmation, LLM decides the next phase based on user intent:

#### Option A: Direct to Training Planning
**User signals:** "давай начнем", "когда начнем?", "хочу тренироваться"

**LLM response:**
```json
{
  "response": "Отлично! Давай подберем тренировку.",
  "is_confirmed": true,
  "phaseTransition": {
    "toPhase": "session_planning",
    "reason": "user_wants_to_start_immediately"
  }
}
```

**Result:** User enters `session_planning` phase to create first workout

#### Option B: Chat First
**User signals:** "хочу задать вопросы", "расскажи больше", "что дальше?"

**LLM response:**
```json
{
  "response": "Конечно! Что хочешь узнать?",
  "is_confirmed": true,
  "phaseTransition": {
    "toPhase": "chat",
    "reason": "user_wants_to_chat_first"
  }
}
```

**Result:** User enters `chat` phase for general conversation

#### Default Behavior
If user intent is ambiguous (e.g., just "да"), LLM defaults to `session_planning` since most users want to start training right away.

## Technical Implementation

### Schema

```typescript
// apps/server/src/domain/user/services/registration.validation.ts
export const registrationLLMResponseSchema = z.object({
  extracted_data: z.object({
    age: z.union([z.number(), z.null()]).optional(),
    gender: z.union([z.string(), z.null()]).optional(),
    height: z.union([z.number(), z.null()]).optional(),
    weight: z.union([z.number(), z.null()]).optional(),
    fitnessLevel: z.union([z.string(), z.null()]).optional(),
    fitnessGoal: z.union([z.string(), z.null()]).optional(),
  }),
  response: z.string().min(1),
  is_confirmed: z.boolean(),
  phaseTransition: z.object({
    toPhase: z.enum(['chat', 'session_planning']),
    reason: z.string().optional(),
  }).optional(),
});
```

### Service

```typescript
// apps/server/src/domain/user/services/registration.service.ts
async processUserMessage(
  user: User,
  message: string,
  historyMessages: ChatMsg[] = [],
): Promise<{
  updatedUser: User;
  response: string;
  isComplete: boolean;
  parsedData?: ParsedProfileData;
  phaseTransition?: { toPhase: 'chat' | 'session_planning'; reason?: string };
}>
```

### Route Handler

```typescript
// apps/server/src/app/routes/chat.routes.ts
const { response, updatedUser, phaseTransition } = result;

if (nowComplete && phaseTransition) {
  const targetPhase = phaseTransition.toPhase;
  const transitionNote = targetPhase === 'session_planning'
    ? 'Registration complete. Let\'s plan your first workout!'
    : 'Registration complete. Ready to chat!';
  
  await conversationContextService.startNewPhase(
    userId, 'registration', targetPhase, transitionNote,
  );
}
```

### Validation

```typescript
// apps/server/src/domain/user/services/chat.service.ts
// registration → session_planning: always allowed
if (fromPhase === 'registration' && toPhase === 'session_planning') {
  return;
}

// registration → chat: always allowed
if (fromPhase === 'registration' && toPhase === 'chat') {
  return;
}
```

## User Experience Examples

### Example 1: Eager User
```
User: hi
Bot: Привет! Я FitCoach, твой AI фитнес-тренер. Чтобы составить программу, мне нужно узнать о тебе несколько вещей. Сколько тебе лет и какой у тебя пол?

User: мне 30 лет, мужчина
Bot: Отлично! Теперь скажи мне рост и вес?

User: рост 180, вес 75
Bot: Супер! Какой у тебя уровень подготовки и какая цель тренировок?

User: средний уровень, хочу набрать массу
Bot: Отлично! Вот твои данные:
- Возраст: 30 лет
- Пол: мужчина
- Рост: 180 см
- Вес: 75 кг
- Уровень: средний
- Цель: набрать массу

Все верно?

User: да, давай начнем
Bot: Отлично! Давай подберем тренировку.
[Transition to session_planning]
```

### Example 2: Curious User
```
User: hi
Bot: Привет! Я FitCoach, твой AI фитнес-тренер...
[... data collection ...]

User: да, все верно, но сначала хочу узнать как работает программа
Bot: Конечно! Что хочешь узнать?
[Transition to chat]
```

## Benefits

1. **Natural Flow**: Respects user's pace and preferences
2. **Flexible**: Accommodates different user types (eager vs. cautious)
3. **Intelligent**: LLM interprets intent, no rigid rules
4. **Maintainable**: Single source of truth for transition logic (LLM prompt)
5. **Testable**: Clear test cases for both transition paths

## Testing

```typescript
// apps/server/tests/integration/services/registration.integration.test.ts

it('should transition to session_planning when user wants to start training', async () => {
  // User: "yes, let's start training now!"
  expect(result.phaseTransition).toEqual({
    toPhase: 'session_planning',
    reason: 'user_wants_to_start_immediately',
  });
});

it('should transition to chat when user wants to chat first', async () => {
  // User: "yes, but I have some questions first"
  expect(result.phaseTransition).toEqual({
    toPhase: 'chat',
    reason: 'user_wants_to_chat_first',
  });
});
```

## Future Enhancements

Possible improvements:
- Add `skip_planning` transition to go directly to `training` if user has a saved plan
- Support multi-language intent detection
- Add analytics to track which transition path users prefer
- Allow users to change their mind and switch phases mid-conversation
