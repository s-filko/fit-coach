# Training Session Management - Implementation Plan

**Feature**: FEAT-0010 Training Session Management  
**Status**: In Progress  
**Last Updated**: 2026-02-11

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
**Status**: COMPLETED  
**Commits**: `eb75cc2`, `9d8ec37`

- [x] Add `session_planning` to `ConversationPhase` enum
- [x] Define `SessionPlanningContext` type (recommendedSessionId)
- [x] Define `TrainingContext` type (activeSessionId)
- [x] Update `ConversationContext` discriminated union
- [ ] **TEST**: Unit tests for phase transitions

**Files Changed**:
- `apps/server/src/domain/conversation/ports/conversation-context.ports.ts`
- `apps/server/drizzle/0004_add_session_planning_phase.sql`

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

**Remaining Work**:
```typescript
// In ChatService.buildSystemPrompt():
case 'session_planning':
  // TODO: Load context and call promptService.buildSessionPlanningPrompt()
  
case 'training':
  // TODO: Load context and call promptService.buildTrainingPrompt()
```

---

### ❌ Step 6.1: Connect Prompts to ChatService (CRITICAL)
**Status**: PENDING  
**Priority**: HIGH - Blocks all functionality

**What to do**:
1. In `ChatService.buildSystemPrompt()`:
   - For `session_planning`: Load context and call `promptService.buildSessionPlanningPrompt()`
   - For `training`: Load context and call `promptService.buildTrainingPrompt()`
2. Remove TODO comments and fallback to chat prompt

**Files to Change**:
- `apps/server/src/domain/user/services/chat.service.ts` (lines 86-110)

---

### ❌ Step 6.2: Load Prompt Context Data (CRITICAL)
**Status**: PENDING  
**Priority**: HIGH - Required for Step 6.1

**What to do**:
1. Add methods to ChatService:
   - `loadSessionPlanningContext(userId): Promise<SessionPlanningPromptContext>`
   - `loadTrainingContext(userId): Promise<TrainingPromptContext>`
2. Use `SessionPlanningContextBuilder` for planning phase
3. Load active session with details for training phase

**Dependencies**:
- TrainingService (already injected)
- SessionPlanningContextBuilder (exists)

**Files to Change**:
- `apps/server/src/domain/user/services/chat.service.ts`

---

### ❌ Step 7: Training Intent Routing (CRITICAL)
**Status**: PENDING  
**Priority**: HIGH - Blocks training functionality

**What to do**:
1. Parse `LLMTrainingResponse` in training phase
2. Route intents to TrainingService methods:
   - `log_set` → `TrainingService.logSet()`
   - `next_exercise` → `TrainingService.nextExercise()`
   - `skip_exercise` → `TrainingService.skipExercise()`
   - `finish_training` → `TrainingService.completeSession()`
   - `modify_session` → `TrainingService.addExerciseToSession()`
3. Handle `just_chat` and `request_advice` (no action needed)

**Files to Change**:
- `apps/server/src/domain/user/services/chat.service.ts`

---

### ❌ Step 7.1: Phase Transition Validation
**Status**: PENDING  
**Priority**: MEDIUM

**What to do**:
Implement TODOs in `ChatService.validatePhaseTransition()`:
1. `session_planning → training`:
   - Validate session exists and belongs to user
   - Validate user has active workout plan
   - Validate no other active session exists
2. `training → chat`:
   - Auto-complete the active session if not already completed
3. `session_planning → chat`:
   - Clean up draft recommendation if exists

**Files to Change**:
- `apps/server/src/domain/user/services/chat.service.ts` (lines 183-200)

**Tests**:
- [ ] Unit tests for validation logic

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

**Must Complete for Basic Functionality**:
1. ✅ Step 6.1: Connect prompts to ChatService
2. ✅ Step 6.2: Load prompt context data
3. ✅ Step 7: Training intent routing

**Nice to Have**:
4. Step 7.1: Phase transition validation
5. Step 8: Auto-close mechanism
6. Step 9: E2E tests
7. Step 10: Seed data

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

## Known Issues & TODOs

1. **ChatService.buildSystemPrompt()** (lines 92-99):
   - Returns chat prompt for session_planning and training phases
   - Should call phase-specific prompt builders

2. **ChatService.validatePhaseTransition()** (lines 183-200):
   - Has TODO comments for validation logic
   - Currently allows invalid transitions

3. **No intent routing**:
   - Training intents are parsed but not executed
   - Need to call TrainingService methods

4. **No auto-close**:
   - Sessions never timeout
   - Can accumulate abandoned sessions

---

## Related Documentation

- Feature Spec: `docs/features/FEAT-0010-training-session-management.md`
- Domain Spec: `docs/domain/training.spec.md`
- ADR: `docs/adr/0006-session-plan-storage.md`
- Architecture: `docs/ARCHITECTURE.md`
- API Spec: `docs/API_SPEC.md`
