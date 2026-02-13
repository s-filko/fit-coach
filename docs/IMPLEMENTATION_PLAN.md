# Training Session Management - Implementation Plan

**Feature**: FEAT-0010 Training Session Management  
**Status**: ✅ **MVP READY FOR TESTING** + ✅ **PLAN CREATION PHASE ADDED**  
**Last Updated**: 2026-02-13

## Overview

This document tracks the implementation progress of the Training Session Management MVP. The feature enables conversational workout planning and tracking through the `/api/chat` endpoint.

## Architecture Principles

1. **Single Endpoint**: All training interactions via `/api/chat` (no separate REST endpoints)
2. **AI as Brain**: ChatService routes based on conversation phase
3. **Database as Truth**: No LLM memory, always load from DB
4. **Phase-Aware Prompts**: Different prompts for different phases
5. **LLM-Driven Transitions**: LLM requests transitions, code validates
6. **Dynamic Exercise Creation**: Exercises created during training, not planning

## Implementation Steps

### ✅ Step 1: Conversation Phases & Context Types
**Status**: COMPLETED + EXTENDED  
**Commits**: `eb75cc2`, `9d8ec37`, `2026-02-13 plan_creation`

- [x] Add `session_planning` to `ConversationPhase` enum
- [x] Add `plan_creation` to `ConversationPhase` enum (2026-02-13)
- [x] Define `PlanCreationContext` type (draftPlanId) (2026-02-13)
- [x] Define `SessionPlanningContext` type (recommendedSessionId)
- [x] Define `TrainingContext` type (activeSessionId)
- [x] Update `ConversationContext` discriminated union
- [ ] **TEST**: Unit tests for phase transitions

**Files Changed**:
- `apps/server/src/domain/conversation/ports/conversation-context.ports.ts`
- `apps/server/drizzle/0004_add_session_planning_phase.sql`
- `apps/server/drizzle/0005_add_plan_creation_phase.sql` (2026-02-13)

---

### ✅ Step 2: LLM Response Schema with Phase Transitions
**Status**: COMPLETED  
**Commits**: `9d8ec37`, `7652750`

- [x] Define `PhaseTransition` type with `toPhase` and `reason`
- [x] Create `LLMResponseSchema` with Zod validation
- [x] Implement `parseLLMResponse()` parser
- [x] Add phase transition validation logic
- [ ] **TEST**: Unit tests for LLM response parsing

**Files Changed**:
- `apps/server/src/domain/conversation/llm-response.types.ts`

---

### ✅ Step 3: Session Planning Context Builder
**Status**: COMPLETED  
**Commits**: `442135d`

- [x] Create `SessionPlanningContextBuilder` class
- [x] Load last 5 workout sessions with details
- [x] Load active workout plan with recovery guidelines
- [x] Calculate days since last workout
- [x] Count available exercises
- [x] Build structured context for LLM prompt
- [ ] **TEST**: Unit tests with mock repositories

**Files Changed**:
- `apps/server/src/domain/training/services/session-planning-context.builder.ts`

---

### ✅ Step 4: Training Intent Types
**Status**: COMPLETED  
**Commits**: `90257bc`

- [x] Define all training intents (logSet, nextExercise, skipExercise, etc.)
- [x] Create Zod schemas for each intent type
- [x] Implement discriminated union `TrainingIntent`
- [x] Create `LLMTrainingResponse` schema
- [x] Implement `parseTrainingResponse()` parser
- [ ] **TEST**: Unit tests for intent type definitions

**Files Changed**:
- `apps/server/src/domain/training/training-intent.types.ts`

---

### ✅ Step 5: ChatService Phase-Aware Routing
**Status**: COMPLETED  
**Commits**: `aa873ba`

- [x] Add TrainingService to ChatService dependencies
- [x] Implement `buildSystemPrompt()` with phase switching
- [x] Implement `executePhaseTransition()` method
- [x] Implement `validatePhaseTransition()` skeleton
- [x] Add phase transition note builder
- [ ] **TEST**: Unit tests for ChatService routing

**Files Changed**:
- `apps/server/src/domain/user/services/chat.service.ts`
- `apps/server/src/main/register-infra-services.ts`

---

### ✅ Step 6: Phase-Specific System Prompts
**Status**: COMPLETED  
**Commits**: `bbdf65d`

- [x] Create `session-planning.prompt.ts` with detailed instructions
- [x] Create `training.prompt.ts` with real-time coaching
- [x] Include timestamps in all prompts for context awareness
- [x] Define `SessionPlanningPromptContext` interface
- [x] Define `TrainingPromptContext` interface
- [x] Add methods to `IPromptService` interface
- [x] Implement methods in `PromptService`
- [ ] **CRITICAL**: Connect prompts to ChatService.buildSystemPrompt()
- [ ] **CRITICAL**: Load context data for prompts
- [ ] **TEST**: Integration tests with LLM

**Files Changed**:
- `apps/server/src/domain/user/services/prompts/session-planning.prompt.ts`
- `apps/server/src/domain/user/services/prompts/training.prompt.ts`
- `apps/server/src/domain/user/ports/prompt.ports.ts`
- `apps/server/src/domain/user/services/prompt.service.ts`

---

### ✅ Step 6.1: Connect Prompts to ChatService
**Status**: COMPLETED  
**Commits**: `4b17a92`

- [x] Connect `session_planning` phase to `buildSessionPlanningPrompt()`
- [x] Connect `training` phase to `buildTrainingPrompt()`
- [x] Add `loadSessionPlanningContext()` method
- [x] Add `loadTrainingContext()` method
- [x] Remove TODO comments and fallback logic
- [ ] **TEST**: Integration tests with LLM

**Files Changed**:
- `apps/server/src/domain/user/services/chat.service.ts`
- `apps/server/src/main/register-infra-services.ts`

---

### ✅ Step 6.2: Load Prompt Context Data
**Status**: COMPLETED  
**Commits**: `4b17a92`

- [x] Implement `loadSessionPlanningContext()` using `SessionPlanningContextBuilder`
- [x] Implement `loadTrainingContext()` loading active session details
- [x] Register `SessionPlanningContextBuilder` in DI container
- [x] Add TrainingService to ChatService constructor
- [ ] **TEST**: Unit tests for context loading

**Files Changed**:
- `apps/server/src/domain/user/services/chat.service.ts`
- `apps/server/src/main/register-infra-services.ts`

---

### ✅ Step 7: Training Intent Routing
**Status**: COMPLETED  
**Commits**: `bcc948c`

- [x] Parse `LLMTrainingResponse` in training phase
- [x] Implement `executeTrainingIntent()` method
- [x] Route `log_set` to calculate set number and log
- [x] Route `next_exercise` to complete current and start next
- [x] Route `skip_exercise` to skip current exercise
- [x] Route `finish_training` to complete session
- [x] Handle `request_advice`, `modify_session`, `just_chat` conversationally
- [x] Add exercise management methods to TrainingService:
  - `startNextExercise()` - starts first pending exercise
  - `skipCurrentExercise()` - skips current in_progress exercise
  - `completeCurrentExercise()` - marks current exercise as completed
- [ ] **TEST**: Unit tests for intent routing

**Files Changed**:
- `apps/server/src/domain/user/services/chat.service.ts`
- `apps/server/src/domain/training/services/training.service.ts`
- `apps/server/src/domain/training/ports/service.ports.ts`

---

### ✅ Step 7.1: Phase Transition Validation
**Status**: COMPLETED  
**Commits**: `c33bd35`

- [x] Validate `session_planning → training`:
  - Session exists and belongs to user
  - Session is in 'planning' status
  - No other active training session exists
- [x] Validate `training → chat`:
  - Auto-complete active session if still in progress
- [x] Validate `session_planning → chat`:
  - Auto-complete (skip) draft session if still in planning
- [x] Add detailed error messages for all validation failures
- [ ] **TEST**: Unit tests for validation logic

**Files Changed**:
- `apps/server/src/domain/user/services/chat.service.ts`

---

### ❌ Step 8: Auto-Close Mechanism
**Status**: PENDING  
**Priority**: MEDIUM

**What to do**:
1. Add lazy check in `ChatService.processMessage()`:
   - Load active session (if in training phase)
   - Check `last_activity_at` timestamp
   - If > 2 hours, auto-close session
2. Optional: Add cron job for global cleanup (3 AM daily)

**Business Rules**:
- BR-TRAINING-023: Sessions with last_activity_at > 2 hours are auto-closed
- BR-TRAINING-024: Daily cron job closes all abandoned sessions

**Files to Change**:
- `apps/server/src/domain/user/services/chat.service.ts`

**Tests**:
- [ ] Unit tests for timeout calculation
- [ ] Unit tests for auto-close trigger

---

### ❌ Step 9: E2E Tests
**Status**: PENDING  
**Priority**: LOW (but important for confidence)

**Test Scenarios**:
1. Full flow: chat → planning → training → chat
2. Retrospective logging (create completed session)
3. Auto-close scenario (timeout)
4. Cancel planning (planning → chat)
5. Modify session mid-training

**Files to Create**:
- `apps/server/tests/e2e/training-flow.e2e.test.ts`

---

### ❌ Step 10: Exercise Catalog Seed Data
**Status**: PENDING  
**Priority**: LOW

**What to do**:
- Expand `exercises.seed.ts` with 20-30 popular exercises
- Cover all muscle groups
- Include variety of exercise types

**Files to Change**:
- `apps/server/src/infra/db/seeds/exercises.seed.ts`

---

## Database Schema

**Migrations Applied**:
- `0003_wandering_colleen_wing.sql` - Initial training schema
- `0004_add_session_planning_phase.sql` - Added session_planning phase
- `0005_add_session_plan_json.sql` - Added session_plan_json field

**Key Tables**:
- `workout_plans` - User's training plans with recovery guidelines
- `exercises` - Exercise library with muscle groups, energy cost
- `workout_sessions` - Sessions with status (planning|in_progress|completed|skipped)
  - `session_plan_json` - LLM-generated plan (SessionRecommendation)
  - `user_context_json` - User state at planning start
- `session_exercises` - Exercises performed (created dynamically during training)
- `session_sets` - Individual sets with JSONB data

---

## Critical Path to MVP

**✅ ALL CRITICAL STEPS COMPLETED!**

1. ✅ Step 1: Conversation phases & context types
2. ✅ Step 2: LLM response schema with phase transitions
3. ✅ Step 3: Session planning context builder
4. ✅ Step 4: Training intent types
5. ✅ Step 5: ChatService phase-aware routing
6. ✅ Step 6: Phase-specific system prompts
7. ✅ Step 6.1: Connect prompts to ChatService
8. ✅ Step 6.2: Load prompt context data
9. ✅ Step 7: Training intent routing
10. ✅ Step 7.1: Phase transition validation

**System is Ready for Basic Testing!**

**Remaining (Non-Critical)**:
- Step 8: Auto-close mechanism (already implemented in TrainingService, just needs ChatService integration)
- Step 9: E2E tests
- Step 10: Seed data

---

## Testing Status

| Step | Unit Tests | Integration Tests | E2E Tests |
|------|-----------|------------------|-----------|
| 1    | ❌        | -                | -         |
| 2    | ❌        | -                | -         |
| 3    | ❌        | -                | -         |
| 4    | ❌        | -                | -         |
| 5    | ❌        | -                | -         |
| 6    | -         | ❌               | -         |
| 7    | ❌        | -                | -         |
| 8    | ❌        | -                | -         |
| 9    | -         | -                | ❌        |

**Overall Test Coverage**: 0% (158 existing tests, 0 for training flow)

---

## What Works Now (MVP Ready!)

**✅ Complete Conversation Flow**:
- User can chat normally (`chat` phase)
- User can plan workout (`session_planning` phase)
  - LLM collects user context (mood, time, intensity)
  - LLM generates personalized plan based on history
  - Plan stored in `session_plan_json`
- User can start training (`training` phase)
  - LLM guides through exercises
  - User logs sets with weight/reps/RPE
  - LLM provides real-time coaching
- User can finish training (back to `chat` phase)

**✅ Training Actions**:
- Log sets (strength, cardio, functional, isometric, interval)
- Move to next exercise
- Skip exercises
- Finish training
- Request advice
- Just chat during training

**✅ Data Validation**:
- All phase transitions validated
- Session ownership verified
- No duplicate active sessions
- Auto-complete on phase exit

**✅ Auto-Close**:
- TrainingService auto-closes sessions > 2 hours old
- Runs on every `getNextSessionRecommendation()` and `startSession()` call

## Known Limitations

1. **No unit/integration tests for training flow**:
   - Existing tests (224) cover infrastructure
   - Need tests for phase transitions, intent routing, validation

2. **Limited exercise catalog**:
   - Only 3 seed exercises
   - Need 20-30 for realistic recommendations

3. **No explicit auto-close in ChatService**:
   - Auto-close happens in TrainingService methods
   - Could add explicit check in `processMessage()` for safety

---

## How to Test the MVP

### Prerequisites
1. Start the server: `npm run dev`
2. Ensure database is seeded with:
   - A registered user
   - An active workout plan for the user
   - At least 3 exercises in catalog

### Test Flow 1: Complete Training Session

```bash
# 1. Chat phase - normal conversation
POST /api/chat
{
  "userId": "user-123",
  "message": "Привет!"
}
# Expected: Normal chat response

# 2. Request workout planning
POST /api/chat
{
  "userId": "user-123",
  "message": "Что сегодня делаем?"
}
# Expected: LLM asks about mood, time, intensity
# Phase: chat → session_planning

# 3. Provide context
POST /api/chat
{
  "userId": "user-123",
  "message": "Чувствую себя хорошо, есть час времени, средняя интенсивность"
}
# Expected: LLM generates workout plan with exercises
# Phase: session_planning (stays)

# 4. Accept plan and start training
POST /api/chat
{
  "userId": "user-123",
  "message": "Давай начнем!"
}
# Expected: LLM confirms start, shows first exercise
# Phase: session_planning → training

# 5. Log first set
POST /api/chat
{
  "userId": "user-123",
  "message": "Сделал 10 раз по 50 кг, RPE 7"
}
# Expected: LLM logs set, asks for next set
# Intent: log_set executed

# 6. Move to next exercise
POST /api/chat
{
  "userId": "user-123",
  "message": "Переходим к следующему"
}
# Expected: LLM shows next exercise
# Intent: next_exercise executed

# 7. Finish training
POST /api/chat
{
  "userId": "user-123",
  "message": "Закончил тренировку"
}
# Expected: LLM congratulates, summarizes session
# Phase: training → chat
# Intent: finish_training executed
```

### Test Flow 2: Cancel Planning

```bash
# 1. Start planning
POST /api/chat
{
  "userId": "user-123",
  "message": "Давай запланируем тренировку"
}

# 2. Cancel
POST /api/chat
{
  "userId": "user-123",
  "message": "Передумал, отмена"
}
# Expected: LLM acknowledges cancellation
# Phase: session_planning → chat
# Session marked as completed (skipped)
```

### Verify in Database

```sql
-- Check conversation phase
SELECT phase, training_context, session_planning_context 
FROM conversation_contexts 
WHERE user_id = 'user-123';

-- Check session status
SELECT id, status, started_at, completed_at, session_plan_json
FROM workout_sessions 
WHERE user_id = 'user-123' 
ORDER BY created_at DESC 
LIMIT 1;

-- Check logged exercises and sets
SELECT se.id, e.name, se.status, COUNT(ss.id) as sets_logged
FROM session_exercises se
JOIN exercises e ON e.id = se.exercise_id
LEFT JOIN session_sets ss ON ss.session_exercise_id = se.id
WHERE se.session_id = '<session-id>'
GROUP BY se.id, e.name, se.status;
```

---

## ✅ Step 11: Plan Creation Phase (2026-02-13)
**Status**: COMPLETED  
**Date**: 2026-02-13

### Overview
Added `plan_creation` phase to enable users to create long-term workout plans with LLM assistance before starting session planning.

### Implementation Details

- [x] Add `plan_creation` to `ConversationPhase` enum
- [x] Define `PlanCreationContext` type
- [x] Create `WorkoutPlanDraft` Zod schema
- [x] Create `PlanCreationLLMResponse` schema with phase transitions
- [x] Implement `parsePlanCreationResponse()` parser
- [x] Create `plan-creation.prompt.ts` with detailed instructions
- [x] Add `buildPlanCreationPrompt()` to `IPromptService`
- [x] Implement `loadPlanCreationContext()` in ChatService
- [x] Implement `saveWorkoutPlan()` in ChatService
- [x] Update phase transition validation
- [x] Update registration to transition to `plan_creation`
- [x] Update chat prompt to check for active plan
- [x] Add database migration for `plan_creation` enum
- [x] Update route handler to detect `plan_creation` phase
- [x] Fix type errors in DI container
- [ ] **TEST**: Unit tests for plan creation flow
- [ ] **TEST**: Integration tests with LLM
- [ ] **TEST**: E2E test for complete flow

**Files Changed**:
- `apps/server/src/domain/conversation/ports/conversation-context.ports.ts`
- `apps/server/src/domain/training/plan-creation.types.ts` (NEW)
- `apps/server/src/domain/user/services/prompts/plan-creation.prompt.ts` (NEW)
- `apps/server/src/domain/user/ports/prompt.ports.ts`
- `apps/server/src/domain/user/services/prompt.service.ts`
- `apps/server/src/domain/user/services/chat.service.ts`
- `apps/server/src/domain/user/services/registration.service.ts`
- `apps/server/src/domain/user/ports/service.ports.ts`
- `apps/server/src/domain/user/services/registration.validation.ts`
- `apps/server/src/app/routes/chat.routes.ts`
- `apps/server/src/infra/db/schema.ts`
- `apps/server/src/infra/db/seeds/exercises.seed.ts`
- `apps/server/src/main/register-infra-services.ts`
- `apps/server/drizzle/0005_add_plan_creation_phase.sql` (NEW)

**Documentation**:
- `docs/PLAN_CREATION_PHASE.md` (NEW) - Comprehensive documentation

### Key Design Decisions

1. **Plan Saved Only on Approval**
   - Draft plans kept in conversation history only
   - Saved to DB only when user approves and transitions to `session_planning`
   - Prevents database pollution with incomplete plans

2. **Mandatory Plan Before Session Planning**
   - `session_planning` phase requires active `WorkoutPlan`
   - Transition validation enforces this requirement
   - Ensures consistent session recommendations

3. **Exercise Catalog in Prompt**
   - All available exercises loaded and included in prompt
   - LLM must reference exercises by `exerciseId`
   - Prevents hallucinated exercises

4. **Structured Plan Schema**
   - Zod schemas validate all plan components
   - Session templates define exact structure
   - Recovery guidelines are machine-readable

5. **Chat Phase Awareness**
   - Chat prompt includes `hasActivePlan` flag
   - LLM suggests plan creation when needed
   - Smooth user experience

### Conversation Flow

```
registration → plan_creation → session_planning → training → chat
                    ↓
                  chat (if user cancels)
```

### Phase Transitions

- `registration` → `plan_creation`: User ready to start training
- `registration` → `chat`: User wants to chat first
- `chat` → `plan_creation`: User wants to create plan
- `plan_creation` → `session_planning`: Plan approved and saved
- `plan_creation` → `chat`: User cancels plan creation
- `chat` → `session_planning`: Blocked if no active plan

### LLM Response Format

```json
{
  "message": "Response in Russian",
  "workoutPlan": {
    "name": "Upper/Lower 4-Day Split",
    "goal": "Muscle gain with balanced development",
    "trainingStyle": "Progressive overload, compound movements",
    "targetMuscleGroups": ["chest", "back_lats", "quads", ...],
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
        "exercises": [...]
      }
    ],
    "progressionRules": [...]
  },
  "phaseTransition": {
    "toPhase": "session_planning",
    "reason": "User approved workout plan"
  }
}
```

---

## Related Documentation

- **Plan Creation**: `docs/PLAN_CREATION_PHASE.md` (NEW)
- Feature Spec: `docs/features/FEAT-0010-training-session-management.md`
- Domain Spec: `docs/domain/training.spec.md`
- ADR: `docs/adr/0006-session-plan-storage.md`
- Architecture: `docs/ARCHITECTURE.md`
- API Spec: `docs/API_SPEC.md`
- MVP Plan: `docs/MVP_TRAINING_SESSION_MANAGEMENT.md`
