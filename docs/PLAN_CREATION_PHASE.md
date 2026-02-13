# Plan Creation Phase — Detailed Documentation

## Overview

The `plan_creation` phase is a conversational workflow where the LLM helps users design their personalized long-term workout plan. This phase was introduced to ensure users have a comprehensive training strategy before they start planning individual workout sessions.

### Purpose

- **Create structured workout plans** with clear goals, training styles, and session templates
- **Define recovery guidelines** based on muscle groups and intensity
- **Establish progression rules** for sustainable long-term progress
- **Provide personalized recommendations** based on user profile (fitness level, goals, equipment)

### Position in Conversation Flow

```
registration → plan_creation → session_planning → training → chat
                    ↓
                  chat (if user cancels)
```

**Key principle:** Users must have an active `WorkoutPlan` before they can proceed to `session_planning`.

---

## Architecture

### 1. Database Schema

#### Conversation Phase Enum

```sql
-- apps/server/src/infra/db/schema.ts
export const conversationPhaseEnum = pgEnum('conversation_phase', [
  'registration',
  'chat',
  'plan_creation',      // ← New phase
  'session_planning',
  'training'
]);
```

#### Workout Plans Table

```sql
-- Stores long-term workout plans
CREATE TABLE workout_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,                    -- e.g., "PPL 6-Day Split"
  plan_json JSONB NOT NULL,              -- Full plan structure (see WorkoutPlanJson)
  status workout_plan_status NOT NULL DEFAULT 'active',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_workout_plans_user_status ON workout_plans(user_id, status);
```

#### WorkoutPlanJson Structure

```typescript
// apps/server/src/domain/training/types.ts
export interface WorkoutPlanJson {
  goal: string;                          // "Muscle gain, 4-day upper/lower split"
  trainingStyle: string;                 // "Progressive overload, compound focus"
  targetMuscleGroups: MuscleGroup[];     // ['chest', 'back_lats', 'quads', ...]
  recoveryGuidelines: RecoveryGuidelines;
  sessionTemplates: SessionTemplate[];   // 2-7 templates (e.g., Upper A, Lower B)
  progressionRules: string[];            // ["Increase weight by 2.5kg when...", ...]
}
```

#### Session Template Structure

```typescript
// apps/server/src/domain/training/types.ts
export interface SessionTemplate {
  key: string;                           // 'upper_a', 'lower_b', 'full_body_a'
  name: string;                          // 'Upper A - Chest/Back'
  focus: string;                         // 'Horizontal push/pull movements'
  energyCost: EnergyCost;                // 'very_low' | 'low' | 'medium' | 'high' | 'very_high'
  estimatedDuration: number;             // minutes (e.g., 60)
  exercises: SessionTemplateExercise[];  // 1-15 exercises
}

export interface SessionTemplateExercise {
  exerciseId: number;                    // FK to exercises table
  exerciseName: string;                  // 'Bench Press'
  energyCost: EnergyCost;
  targetSets: number;                    // 1-10
  targetReps: string;                    // '8-10', '12-15', '20-30'
  targetWeight?: number;                 // Optional, in kg
  restSeconds: number;                   // 0-600
  estimatedDuration: number;             // minutes per exercise
  notes?: string;                        // Form cues, tips
}
```

#### Recovery Guidelines Structure

```typescript
// apps/server/src/domain/training/types.ts
export interface RecoveryGuidelines {
  majorMuscleGroups: {
    minRestDays: number;                 // 1-7
    maxRestDays: number;                 // 1-14
  };
  smallMuscleGroups: {
    minRestDays: number;                 // 0-7
    maxRestDays: number;                 // 1-14
  };
  highIntensity: {
    minRestDays: number;                 // 1-7
  };
  cardio?: {
    minRestDays: number;                 // 0-7
    maxRestDays: number;                 // 1-14
  };
  functional?: {
    minRestDays: number;                 // 0-7
    maxRestDays: number;                 // 1-14
  };
  customRules: string[];                 // ["If RPE > 8, add +1 rest day", ...]
}
```

### 2. Domain Layer

#### Conversation Context

```typescript
// apps/server/src/domain/conversation/ports/conversation-context.ports.ts

export type ConversationPhase = 
  | 'registration' 
  | 'chat' 
  | 'plan_creation'      // ← New phase
  | 'session_planning' 
  | 'training';

export interface PlanCreationContext {
  draftPlanId?: string;  // Optional: if we pre-create a draft plan
}

export type ConversationContext =
  | (BaseConversationContext & { phase: 'registration' })
  | (BaseConversationContext & { phase: 'chat' })
  | (BaseConversationContext & { phase: 'plan_creation'; planCreationContext?: PlanCreationContext })
  | (BaseConversationContext & { phase: 'session_planning'; sessionPlanningContext?: SessionPlanningContext })
  | (BaseConversationContext & { phase: 'training'; trainingContext: TrainingContext });
```

#### LLM Response Schema

```typescript
// apps/server/src/domain/training/plan-creation.types.ts

export const WorkoutPlanDraftSchema = z.object({
  name: z.string().min(1).max(100),
  goal: z.string().min(10).max(500),
  trainingStyle: z.string().min(10).max(500),
  targetMuscleGroups: z.array(MuscleGroupSchema).min(1).max(16),
  recoveryGuidelines: RecoveryGuidelinesSchema,
  sessionTemplates: z.array(SessionTemplateSchema).min(1).max(10),
  progressionRules: z.array(z.string().min(10)).min(1).max(10),
});

export const PlanCreationLLMResponseSchema = z.object({
  message: z.string().min(1),
  workoutPlan: WorkoutPlanDraftSchema.optional(),
  phaseTransition: z.object({
    toPhase: z.enum(['chat', 'session_planning']),
    reason: z.string().optional(),
  }).optional(),
});

export function parsePlanCreationResponse(jsonString: string): PlanCreationLLMResponse {
  const parsed = JSON.parse(jsonString);
  return PlanCreationLLMResponseSchema.parse(parsed);
}
```

#### ChatService Integration

```typescript
// apps/server/src/domain/user/services/chat.service.ts

async processMessage(
  user: User,
  message: string,
  phase: ConversationPhase,
  historyMessages: ChatMsg[] = [],
): Promise<string> {
  // 1. Build phase-specific system prompt
  const systemPrompt = await this.buildSystemPrompt(user, phase);

  // 2. Call LLM
  const llmResponse = await this.llmService.generateWithSystemPrompt(
    [...historyMessages, { role: 'user', content: message }],
    systemPrompt,
    { jsonMode: true },
  );

  // 3. Parse response based on phase
  if (phase === 'plan_creation') {
    const planCreationResponse = parsePlanCreationResponse(llmResponse);
    
    // Save workout plan ONLY if transitioning to session_planning (user approved)
    if (planCreationResponse.workoutPlan && 
        planCreationResponse.phaseTransition?.toPhase === 'session_planning') {
      await this.saveWorkoutPlan(user.id, planCreationResponse.workoutPlan);
    }
    
    return planCreationResponse.message;
  }
  // ... other phases
}

private async saveWorkoutPlan(userId: string, plan: WorkoutPlanDraft): Promise<void> {
  await this.workoutPlanRepo.create(userId, {
    name: plan.name,
    planJson: {
      goal: plan.goal,
      trainingStyle: plan.trainingStyle,
      targetMuscleGroups: plan.targetMuscleGroups,
      recoveryGuidelines: plan.recoveryGuidelines,
      sessionTemplates: plan.sessionTemplates,
      progressionRules: plan.progressionRules,
    },
    status: 'active',
  });
}
```

### 3. LLM Prompt

#### Context Builder

```typescript
// apps/server/src/domain/user/services/chat.service.ts

private async loadPlanCreationContext(user: User): Promise<PlanCreationPromptContext> {
  const exercises = await this.exerciseRepo.findAll();

  return {
    user,
    availableExercises: exercises,
    totalExercisesAvailable: exercises.length,
  };
}
```

#### Prompt Structure

```typescript
// apps/server/src/domain/user/services/prompts/plan-creation.prompt.ts

export function buildPlanCreationPrompt(context: PlanCreationPromptContext): string {
  return `You are FitCoach, a professional fitness trainer helping a user create their personalized long-term workout plan.

Current Date: ${dateOnly}
Current Time: ${time}

=== USER PROFILE ===

Name: ${profile.name}
Age: ${profile.age}
Gender: ${profile.gender}
Height: ${profile.height} cm
Weight: ${profile.weight} kg
Fitness Level: ${profile.fitnessLevel}
Fitness Goal: ${profile.fitnessGoal}

=== AVAILABLE EXERCISES (${context.totalExercisesAvailable} total) ===

${exercisesSection}  // Grouped by category

=== YOUR TASK ===

Help the user create a comprehensive workout plan that includes:

1. **Plan Overview**:
   - Name (e.g., "PPL 6-Day Split", "Upper/Lower 4-Day")
   - Goal (detailed description of what user wants to achieve)
   - Training style (e.g., "Progressive overload, compound focus")
   - Target muscle groups (list all muscles to train)

2. **Recovery Guidelines**:
   - Rest days for major muscle groups (e.g., chest, back, legs)
   - Rest days for small muscle groups (e.g., biceps, calves)
   - Rest after high-intensity sessions
   - Custom rules based on user's recovery ability

3. **Session Templates** (2-7 templates depending on split):
   Each template should include:
   - Key (e.g., "upper_a", "lower_b")
   - Name (e.g., "Upper A - Chest/Back")
   - Focus (what muscles/movements)
   - Energy cost (very_low/low/medium/high/very_high)
   - Estimated duration (minutes)
   - Exercises list with sets, reps, weight, rest

4. **Progression Rules**:
   - When to increase weight
   - When to add reps
   - When to deload
   - How to handle plateaus

=== CONVERSATION FLOW ===

**Step 1: Gather Information**
Ask about:
- Training frequency (how many days per week?)
- Session duration preference (30min, 60min, 90min?)
- Split preference (full body, upper/lower, PPL, bro split?)
- Equipment limitations
- Specific focus areas or weak points
- Any exercises to avoid

**Step 2: Propose Plan**
Based on gathered info, propose a complete plan:
- Explain the split and rationale
- Show session templates overview
- Explain recovery approach
- Ask for feedback

**Step 3: Refine Plan**
- Answer questions
- Modify based on feedback
- Adjust exercises, volume, frequency
- Keep iterating until user is satisfied

**Step 4: Finalize and Save**
When user approves:
- Include complete \`workoutPlan\` object in response
- Set \`phaseTransition.toPhase\` to "session_planning"
- Congratulate and explain next steps

=== IMPORTANT RULES ===

- ONLY use exercises from the available list (by ID)
- Match exercises to user's fitness level
- Consider user's goal (muscle gain, strength, endurance, weight loss)
- Balance volume across muscle groups
- Ensure adequate recovery between sessions
- Progression rules must be specific and actionable
- Session templates should be realistic (30-90 min each)
- ALWAYS respond in Russian

=== PHASE TRANSITIONS ===

**Stay in plan_creation when:**
- Gathering information
- Proposing initial plan
- Answering questions
- Refining plan based on feedback

**Transition to session_planning when:**
- User explicitly approves the plan
- Include complete \`workoutPlan\` object

**Transition to chat when:**
- User wants to cancel/postpone plan creation
- User wants to chat about something else

=== RESPONSE FORMAT ===

ALWAYS respond with valid JSON:

\`\`\`json
{
  "message": "Your response in Russian",
  "workoutPlan": { /* optional, only when user approves */ },
  "phaseTransition": { /* optional, only when changing phase */ }
}
\`\`\`
`;
}
```

### 4. Phase Transitions

#### Validation Rules

```typescript
// apps/server/src/domain/user/services/chat.service.ts

private async validatePhaseTransition(
  userId: string,
  fromPhase: ConversationPhase,
  toPhase: ConversationPhase,
  sessionId?: string,
): Promise<void> {
  // registration → plan_creation: always allowed
  if (fromPhase === 'registration' && toPhase === 'plan_creation') {
    return;
  }

  // chat → plan_creation: always allowed
  if (fromPhase === 'chat' && toPhase === 'plan_creation') {
    return;
  }

  // plan_creation → session_planning: validate user has active plan
  if (fromPhase === 'plan_creation' && toPhase === 'session_planning') {
    const activePlan = await this.workoutPlanRepo.findActiveByUserId(userId);
    if (!activePlan) {
      throw new Error('Cannot proceed to session planning: no active workout plan found');
    }
    return;
  }

  // plan_creation → chat: user cancelled plan creation
  if (fromPhase === 'plan_creation' && toPhase === 'chat') {
    return;
  }

  // chat → session_planning: validate user has active plan
  if (fromPhase === 'chat' && toPhase === 'session_planning') {
    const activePlan = await this.workoutPlanRepo.findActiveByUserId(userId);
    if (!activePlan) {
      throw new Error('Cannot plan session: no active workout plan. Create a plan first.');
    }
    return;
  }

  // ... other transitions
}
```

#### Transition Notes

```typescript
private buildPhaseTransitionNote(
  fromPhase: ConversationPhase,
  toPhase: ConversationPhase,
  reason?: string,
): string {
  const transitions: Record<string, string> = {
    'registration->plan_creation': 'Starting workout plan creation',
    'chat->plan_creation': 'Starting workout plan creation',
    'plan_creation->session_planning': 'Workout plan created, ready for session planning',
    'plan_creation->chat': 'Plan creation cancelled',
    // ... other transitions
  };

  const key = `${fromPhase}->${toPhase}`;
  const note = transitions[key] ?? `Phase transition: ${fromPhase} → ${toPhase}`;
  return reason ? `${note} (${reason})` : note;
}
```

### 5. Registration Integration

#### Updated Registration Flow

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
  phaseTransition?: { toPhase: 'chat' | 'plan_creation'; reason?: string };
}> {
  // ... registration logic

  // When registration is complete, LLM decides next phase:
  // - "да, давай начнем тренировку" → plan_creation
  // - "подтверждаю, хочу узнать больше" → chat
}
```

#### Registration Prompt Update

```typescript
// apps/server/src/domain/user/services/prompt.service.ts

PHASE TRANSITION AFTER REGISTRATION:
- When registration is complete (is_confirmed = true), you can suggest next steps:
  - If user wants to start training immediately → set phaseTransition.toPhase = "plan_creation"
  - If user wants to chat first, ask questions, or is not ready → set phaseTransition.toPhase = "chat"
- Read user's intent from their confirmation message. Examples:
  - "да, давай начнем тренировку" → plan_creation
  - "да, все верно, когда начнем?" → plan_creation
  - "подтверждаю, хочу узнать больше о программе" → chat
  - "верно, но сначала хочу задать вопросы" → chat
- If unclear, default to "plan_creation" (most users want to start right away)
```

### 6. Chat Phase Integration

#### Updated Chat Prompt

```typescript
// apps/server/src/domain/user/services/prompt.service.ts

buildChatSystemPrompt(user: User, hasActivePlan: boolean): string {
  const planStatus = hasActivePlan 
    ? 'User HAS an active workout plan. They can start planning workout sessions.'
    : 'User DOES NOT have a workout plan yet. Suggest creating one when appropriate.';

  return `Your name is FitCoach. You are a professional fitness coach and personal trainer.

CLIENT PROFILE: ${profile}
WORKOUT PLAN STATUS: ${planStatus}

RULES:
1. IDENTITY: Your name is FitCoach. Never mention AI or technology.
2. SCOPE: You ONLY discuss fitness, training, nutrition, health, and wellness.
3. PERSONALIZATION: Always consider the client's profile when giving advice.
4. STYLE: Keep responses brief (1-3 sentences), motivating, and conversational.
5. PROACTIVE: Suggest relevant actions based on user's status.
6. WORKOUT PLAN: ${
  hasActivePlan 
    ? 'User can start planning sessions. If they ask about training, guide them to plan a session.' 
    : 'If user wants to train, suggest creating a workout plan first. Explain it will help personalize their training.'
}`;
}
```

#### Phase Detection in Routes

```typescript
// apps/server/src/app/routes/chat.routes.ts

// Registration complete - determine phase from existing contexts
// Priority: training > session_planning > plan_creation > chat
let phase: 'chat' | 'plan_creation' | 'session_planning' | 'training' = 'chat';

const trainingCtx = await conversationContextService.getContext(userId, 'training');
const planningCtx = await conversationContextService.getContext(userId, 'session_planning');
const planCreationCtx = await conversationContextService.getContext(userId, 'plan_creation');

if (trainingCtx) {
  phase = 'training';
} else if (planningCtx) {
  phase = 'session_planning';
} else if (planCreationCtx) {
  phase = 'plan_creation';
}
```

---

## Usage Flow

### 1. User Completes Registration

```
User: "да, все верно, давай начнем!"
LLM: {
  "response": "Отлично! Давай создадим твой план тренировок...",
  "phaseTransition": {
    "toPhase": "plan_creation",
    "reason": "User ready to start training"
  }
}
```

**System action:**
- Saves user profile with `profileStatus: 'complete'`
- Transitions from `registration` → `plan_creation`
- Creates conversation context for `plan_creation` phase

### 2. Information Gathering

```
LLM: "Сколько раз в неделю ты хочешь тренироваться?"
User: "4 раза в неделю"

LLM: "Отлично! Какой сплит тебе больше нравится - верх/низ или PPL?"
User: "верх низ"

LLM: "Понял! Сколько времени у тебя есть на одну тренировку?"
User: "около часа"
```

**System action:**
- Appends each turn to `conversation_turns` table
- Maintains conversation history in `plan_creation` phase
- LLM stays in `plan_creation` phase (no `phaseTransition`)

### 3. Plan Proposal

```
LLM: {
  "message": "Отлично! Вот что я предлагаю:\n\n**План: Upper/Lower 4-Day Split**\n\n**Цель:** Набор мышечной массы...\n\n**Тренировки:**\n- Upper A (Грудь/Спина): 60 мин\n- Lower A (Квадры/Ягодицы): 60 мин\n- Upper B (Плечи/Руки): 55 мин\n- Lower B (Задняя/Икры): 55 мин\n\n**Восстановление:**\n- Большие группы: 2-4 дня отдыха\n- Малые группы: 1-3 дня отдыха\n\nЧто думаешь? Хочешь что-то изменить?"
}
```

**System action:**
- LLM stays in `plan_creation` phase
- Plan is kept in conversation history (not saved to DB yet)

### 4. Plan Refinement

```
User: "можно добавить больше упражнений на плечи?"

LLM: {
  "message": "Конечно! Добавлю в Upper B:\n- Жим гантелей сидя\n- Махи в стороны\n- Махи в наклоне\n\nТеперь плечи будут прорабатываться лучше. Устраивает?"
}
```

**System action:**
- LLM stays in `plan_creation` phase
- Updated plan is in conversation history

### 5. Plan Approval

```
User: "да, отлично, давай сохраним"

LLM: {
  "message": "Супер! План сохранён. Теперь давай запланируем твою первую тренировку!",
  "workoutPlan": {
    "name": "Upper/Lower 4-Day Split",
    "goal": "Muscle gain with balanced development",
    "trainingStyle": "Progressive overload, compound movements",
    "targetMuscleGroups": ["chest", "back_lats", "quads", "hamstrings", ...],
    "recoveryGuidelines": {
      "majorMuscleGroups": { "minRestDays": 2, "maxRestDays": 4 },
      "smallMuscleGroups": { "minRestDays": 1, "maxRestDays": 3 },
      "highIntensity": { "minRestDays": 3 },
      "customRules": ["If RPE > 8, add +1 rest day"]
    },
    "sessionTemplates": [
      {
        "key": "upper_a",
        "name": "Upper A - Chest/Back",
        "focus": "Horizontal push/pull",
        "energyCost": "high",
        "estimatedDuration": 60,
        "exercises": [
          {
            "exerciseId": 1,
            "exerciseName": "Bench Press",
            "energyCost": "high",
            "targetSets": 3,
            "targetReps": "8-10",
            "targetWeight": 60,
            "restSeconds": 120,
            "estimatedDuration": 12,
            "notes": "Focus on full range of motion"
          },
          // ... more exercises
        ]
      },
      // ... more templates
    ],
    "progressionRules": [
      "Increase weight by 2.5kg when hitting top of rep range for 2 consecutive sessions",
      "Deload by 10% if failing to hit bottom of rep range for 2 sessions"
    ]
  },
  "phaseTransition": {
    "toPhase": "session_planning",
    "reason": "User approved workout plan"
  }
}
```

**System action:**
1. Validates `workoutPlan` against Zod schema
2. Saves plan to `workout_plans` table with `status: 'active'`
3. Transitions from `plan_creation` → `session_planning`
4. Creates conversation context for `session_planning` phase

### 6. Plan Cancellation (Alternative)

```
User: "на самом деле, давай потом, хочу сначала почитать о тренировках"

LLM: {
  "message": "Без проблем! Дай знать, когда будешь готов создать план. Могу ответить на любые вопросы о тренировках!",
  "phaseTransition": {
    "toPhase": "chat",
    "reason": "User postponed plan creation"
  }
}
```

**System action:**
1. Transitions from `plan_creation` → `chat`
2. Plan draft is lost (not saved to DB)
3. User can return to `plan_creation` later from `chat` phase

---

## Key Design Decisions

### 1. Plan Saved Only on Approval

**Rationale:** Avoid polluting the database with incomplete or abandoned plans.

- Draft plans are kept **only in conversation history** (JSONB in `conversation_turns`)
- Plan is saved to `workout_plans` table **only when**:
  - User explicitly approves the plan
  - LLM sets `phaseTransition.toPhase = 'session_planning'`
  - `workoutPlan` object is present in LLM response

**Benefits:**
- Clean database (no orphaned drafts)
- Clear user intent (explicit approval required)
- Easy to iterate (LLM can modify plan in conversation without DB writes)

### 2. Mandatory Plan Before Session Planning

**Rationale:** Session planning requires context from the long-term plan.

- `session_planning` phase uses `activePlan` from `workout_plans` table
- Transition validation ensures plan exists:
  ```typescript
  if (fromPhase === 'plan_creation' && toPhase === 'session_planning') {
    const activePlan = await this.workoutPlanRepo.findActiveByUserId(userId);
    if (!activePlan) {
      throw new Error('Cannot proceed: no active workout plan found');
    }
  }
  ```

**Benefits:**
- Consistent session recommendations (based on templates, recovery rules)
- Better progression tracking (LLM knows the overall plan)
- Prevents confusion (users know what they're working towards)

### 3. Exercise Catalog in Prompt

**Rationale:** LLM must use real exercises from the database.

- All available exercises are loaded and included in the prompt
- LLM must reference exercises by `exerciseId` (FK to `exercises` table)
- Grouped by category for easier navigation

**Benefits:**
- No hallucinated exercises (all exercises are real and tracked)
- Consistent exercise naming across sessions
- Enables exercise history and progress tracking

### 4. Structured Plan Schema

**Rationale:** Enforce consistency and enable programmatic use.

- Zod schemas validate all plan components
- Session templates define exact structure (exercises, sets, reps)
- Recovery guidelines are machine-readable (used in session planning)

**Benefits:**
- Type-safe plan manipulation
- Automated session recommendations (LLM follows templates)
- Clear progression rules (can be displayed in UI)

### 5. Chat Phase Awareness

**Rationale:** Guide users to create plan when needed.

- `chat` prompt includes `hasActivePlan` flag
- LLM suggests plan creation if user wants to train but has no plan
- Prevents dead-end conversations ("I want to train" → "Create a plan first")

**Benefits:**
- Smooth user experience (LLM guides next steps)
- Reduces confusion (clear path to training)
- Proactive assistance (LLM suggests plan creation)

---

## Testing Checklist

### Unit Tests

- [ ] `parsePlanCreationResponse()` validates correct schemas
- [ ] `parsePlanCreationResponse()` rejects invalid schemas
- [ ] `saveWorkoutPlan()` creates plan with correct structure
- [ ] `validatePhaseTransition()` allows valid transitions
- [ ] `validatePhaseTransition()` blocks invalid transitions
- [ ] `loadPlanCreationContext()` loads exercises correctly

### Integration Tests

- [ ] Registration → `plan_creation` transition works
- [ ] `plan_creation` → `session_planning` transition saves plan
- [ ] `plan_creation` → `chat` transition discards plan
- [ ] `chat` → `plan_creation` transition works
- [ ] `chat` → `session_planning` blocked without plan
- [ ] Plan is accessible in `session_planning` phase

### E2E Tests

- [ ] Complete flow: registration → plan creation → session planning
- [ ] Plan cancellation flow: plan creation → chat
- [ ] Plan modification flow: propose → refine → approve
- [ ] LLM uses only available exercises
- [ ] LLM respects user's fitness level
- [ ] LLM creates realistic session templates

---

## Troubleshooting

### Issue: Plan not saved after approval

**Symptoms:**
- User approves plan
- Transition to `session_planning` fails with "no active workout plan"

**Diagnosis:**
1. Check LLM response includes `workoutPlan` object
2. Check `phaseTransition.toPhase === 'session_planning'`
3. Check `saveWorkoutPlan()` was called
4. Check database for plan with `user_id` and `status: 'active'`

**Solution:**
- Verify Zod schema validation passes
- Check `workoutPlanRepo.create()` implementation
- Ensure transaction completes before phase transition

### Issue: LLM uses non-existent exercises

**Symptoms:**
- Plan includes exercises not in database
- `exerciseId` references invalid IDs

**Diagnosis:**
1. Check prompt includes all available exercises
2. Check LLM response validation
3. Check exercise catalog seed data

**Solution:**
- Verify `exerciseRepo.findAll()` returns all exercises
- Add validation to reject invalid `exerciseId`
- Update prompt to emphasize "ONLY use exercises from the list"

### Issue: User stuck in `plan_creation` phase

**Symptoms:**
- User wants to exit but LLM keeps asking questions
- No way to cancel plan creation

**Diagnosis:**
1. Check prompt includes cancellation instructions
2. Check LLM recognizes cancellation intent
3. Check transition to `chat` is allowed

**Solution:**
- Update prompt with clear cancellation examples
- Add explicit "cancel" command handling
- Verify `plan_creation` → `chat` transition validation

---

## Future Enhancements

### 1. Plan Templates

**Goal:** Speed up plan creation with pre-built templates.

**Implementation:**
- Add `plan_templates` table with common splits (PPL, Upper/Lower, Full Body)
- LLM can suggest template: "Хочешь использовать готовый шаблон PPL?"
- User can customize template or create from scratch

### 2. Plan Versioning

**Goal:** Track plan changes over time.

**Implementation:**
- Add `version` field to `workout_plans`
- Keep old versions with `status: 'archived'`
- Allow comparing versions in UI

### 3. AI Plan Analysis

**Goal:** Evaluate plan quality and suggest improvements.

**Implementation:**
- Analyze volume distribution across muscle groups
- Check recovery adequacy
- Suggest adjustments for better balance

### 4. Plan Sharing

**Goal:** Users can share plans with friends or coach.

**Implementation:**
- Add `visibility` field ('private' | 'shared' | 'public')
- Generate shareable link
- Allow copying plan to own account

### 5. Automatic Plan Adjustment

**Goal:** Adapt plan based on progress and recovery.

**Implementation:**
- Track session completion rate
- Monitor recovery metrics (soreness, fatigue)
- LLM suggests plan modifications: "Похоже, ты не успеваешь восстанавливаться. Хочешь снизить объём?"

---

## References

- [ARCHITECTURE.md](./ARCHITECTURE.md) - Overall system architecture
- [CONVERSATION_CONTEXT_ARCHITECTURE.md](./CONVERSATION_CONTEXT_ARCHITECTURE.md) - Conversation context design
- [MVP_TRAINING_SESSION_MANAGEMENT.md](./MVP_TRAINING_SESSION_MANAGEMENT.md) - Original MVP plan
- [API_SPEC.md](./API_SPEC.md) - API endpoints specification
- [DB_SETUP.md](./DB_SETUP.md) - Database setup and migrations

---

## Changelog

### 2026-02-13 - Initial Implementation

- Added `plan_creation` phase to conversation flow
- Created `WorkoutPlanDraft` Zod schema
- Implemented `buildPlanCreationPrompt()` with exercise catalog
- Updated `ChatService` to handle plan creation
- Added phase transition validation
- Updated registration to transition to `plan_creation`
- Updated chat phase to check for active plan
- Added database migration for `plan_creation` enum value
