# ADR-0006: Session Plan Storage in workout_sessions Table

**Status**: Accepted  
**Date**: 2026-02-11  
**Context**: FEAT-0010 Training Session Management

## Context

Training sessions go through two distinct phases:
1. **Planning**: User asks "What should I do today?", LLM analyzes history and generates a workout plan
2. **Training**: User performs the workout, logging sets and exercises in real-time

We need to decide where to store the LLM-generated workout plan and how to structure the session lifecycle.

## Decision

Store the LLM-generated plan directly in the `workout_sessions` table as a JSONB field `session_plan_json`.

### Data Structure

```typescript
// WorkoutSession type
interface WorkoutSession {
  id: string;
  userId: string;
  planId: string | null;
  sessionKey: string | null;
  status: 'planning' | 'in_progress' | 'completed' | 'skipped';
  startedAt: Date | null;
  completedAt: Date | null;
  durationMinutes: number | null;
  userContextJson: UserContext | null;
  sessionPlanJson: SessionRecommendation | null;  // NEW: LLM plan
  lastActivityAt: Date;
  autoCloseReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

// UserContext collected at planning start
interface UserContext {
  mood?: 'good' | 'tired' | 'energetic' | 'stressed' | 'motivated';
  sleep?: 'poor' | 'normal' | 'excellent';
  energy?: number; // 1-10
  availableTime?: number; // minutes
  intensity?: 'low' | 'moderate' | 'high';
  notes?: string;
}

// SessionRecommendation stored in session_plan_json
interface SessionRecommendation {
  sessionKey: string;
  sessionName: string;
  reasoning: string;
  exercises: ExercisePlanItem[];
  estimatedDuration: number;
  timeLimit?: number; // User's available time (hard constraint)
  warnings?: string[];
  modifications?: string[];
}
```

### Session Lifecycle

1. **Planning Phase** (status='planning'):
   - Session created when user asks for recommendation
   - UserContext collected (mood, availableTime, intensity, etc.)
   - LLM generates plan → stored in `session_plan_json`
   - Plan can be modified during planning
   - `session_exercises` table remains empty

2. **Training Phase** (status='in_progress'):
   - User confirms plan and starts training
   - `session_plan_json` becomes read-only (reference for LLM)
   - `session_exercises` created dynamically as user performs them
   - `session_sets` logged for each completed set

3. **Completed** (status='completed'):
   - All data finalized
   - `session_plan_json` shows what was planned
   - `session_exercises` + `session_sets` show what was actually done

### Conversation Phase Mapping

- `session_planning` phase → session with status='planning'
- `training` phase → session with status='in_progress'
- Phase transitions controlled by LLM via `phaseTransition` flags
- Code validates transitions before executing

## Alternatives Considered

### Alternative 1: Store plan in conversation_turns
**Rejected**: conversation_turns is for chat history, not structured session data. Mixing concerns would make it hard to query, validate, and maintain consistency.

### Alternative 2: Create session_exercises immediately during planning
**Rejected**: User may modify the plan during planning phase. Creating exercises early would require complex update/delete logic. Dynamic creation during training is simpler and more flexible.

### Alternative 3: Separate session_plans table
**Rejected**: Adds unnecessary complexity. The plan is tightly coupled to the session and doesn't need independent lifecycle management.

## Consequences

### Positive
- **Clear separation**: Planning data (plan) vs execution data (exercises, sets)
- **Flexibility**: Plan can be modified during planning without touching exercises
- **Simplicity**: Single source of truth for session state
- **Query efficiency**: All session data in one table, easy to join
- **LLM context**: Plan always available for reference during training

### Negative
- **JSONB field**: Slightly less type-safe than normalized tables, but acceptable for flexible LLM output
- **Migration required**: Need to add `session_plan_json` column to existing table

### Implementation Notes
- Migration `0005_add_session_plan_json.sql` adds the field
- Status enum updated: `'planned'` → `'planning'` for consistency
- `timeLimit` enforced only when user explicitly provides it
- All LLM prompts include detailed timestamps for context awareness

## Related
- FEAT-0010: Training Session Management
- ADR-0005: Conversation Context Session
- Migration: 0005_add_session_plan_json.sql
