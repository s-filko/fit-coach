# FEAT-0010 Training Session Management

**x-status**: In Progress

## User Story

As a user, I want to receive AI-powered workout recommendations based on my training history and recovery status, log my workouts conversationally, and track my progress over time, so that I can follow an effective training program without manual planning.

## Overview

Training session management enables users to:
- Get personalized workout recommendations via conversational AI
- Start and track workout sessions in real-time
- Log exercises, sets, reps, and weights through natural language
- Review training history and progress
- Maintain proper recovery between muscle groups

**Architecture Principle**: All training interactions happen through the `/api/chat` endpoint. No separate REST endpoints for training operations. The AI orchestrates calls to TrainingService based on user intent parsed from conversation.

## Scenarios

### Session Recommendation

- **S-0100**: Given a user with completed profile and active workout plan, When the user asks "What should I do today?", Then the AI analyzes training history (last 5 sessions), recovery guidelines from plan, and current date to recommend a personalized workout session [BR-TRAINING-010]

- **S-0101**: Given a user with no active workout plan, When the user asks for a recommendation, Then the AI responds that a workout plan must be created first [BR-TRAINING-011]

- **S-0102**: Given a user who trained chest yesterday (high intensity, RPE 9), When the user asks for a recommendation today, Then the AI considers recovery guidelines and recommends a different muscle group or lower intensity [BR-TRAINING-012]

### Starting a Session

- **S-0103**: Given a user receives a workout recommendation, When the user says "Let's start" or "Begin workout", Then the AI creates a new workout_session with status='in_progress', stores sessionId in conversation context, and switches to 'training' phase [BR-TRAINING-013]

- **S-0104**: Given a user with an active session (status='in_progress'), When the user tries to start a new session, Then the AI auto-closes the previous session with reason='new_session_started' before creating the new one [BR-TRAINING-014]

- **S-0105**: Given a user starts a session, When the AI extracts user context (mood, sleep, energy) from conversation, Then it stores this data in workout_sessions.user_context_json [BR-TRAINING-015]

### Logging Sets During Session

- **S-0106**: Given a user in an active training session, When the user says "Did 10 reps with 50kg", Then the AI parses the message, identifies the current exercise, calls TrainingService.logSet(), and confirms the logged set [BR-TRAINING-016]

- **S-0107**: Given a user logs a set, When the set data is saved, Then the workout_sessions.last_activity_at is updated to prevent auto-timeout [BR-TRAINING-017]

- **S-0108**: Given a user in a session, When the AI needs context about current progress, Then it loads full session details from DB (exercises, completed sets, targets) to provide accurate guidance [BR-TRAINING-018]

- **S-0109**: Given a user completes all sets for an exercise, When the user says "Next exercise", Then the AI updates session_exercises.status to 'completed' and guides to the next exercise in the session [BR-TRAINING-019]

### Adding Exercises Mid-Session

- **S-0110**: Given a user in an active session, When the user says "Let's add pull-ups", Then the AI calls TrainingService.addExerciseToSession() with the exercise name, creates a session_exercise record, and confirms addition [BR-TRAINING-020]

### Completing a Session

- **S-0111**: Given a user in an active session, When the user says "Finished" or "Done with workout", Then the AI calls TrainingService.completeSession(), updates status to 'completed', calculates duration, clears sessionId from context, and switches back to 'chat' phase [BR-TRAINING-021]

- **S-0112**: Given a session is completed, When the user asks about their workout, Then the AI can retrieve session details from training history [BR-TRAINING-022]

### Auto-Close Mechanism

- **S-0113**: Given a user has an active session (status='in_progress'), When last_activity_at is older than 2 hours, Then the session is auto-closed with status='completed' and auto_close_reason='timeout' [BR-TRAINING-023]

- **S-0114**: Given multiple users with abandoned sessions, When the daily cron job runs at 3 AM, Then all sessions with status='in_progress' and last_activity_at > 2 hours are auto-closed [BR-TRAINING-024]

### Retrospective Logging

- **S-0115**: Given a user in 'chat' phase, When the user says "Yesterday I did squats, 4 sets of 8 reps with 100kg", Then the AI creates a completed session with past timestamp, logs all sets, and confirms the entry [BR-TRAINING-025]

### Training History

- **S-0116**: Given a user with completed sessions, When the user asks "Show my last workouts", Then the AI calls TrainingService.getTrainingHistory() and presents a summary of recent sessions [BR-TRAINING-026]

## Acceptance Criteria

- **AC-0200**: All training interactions happen through `/api/chat` endpoint; no separate REST endpoints exist for training operations
- **AC-0201**: AI correctly identifies training intents (recommendation, start, log set, complete) from natural language
- **AC-0202**: Session recommendations consider: user profile, active plan, last 5 sessions, recovery guidelines, current date
- **AC-0203**: Active session ID is stored in conversation context and used to route all logging operations
- **AC-0204**: Session details (exercises, sets, targets) are loaded from DB on each message to provide accurate context to AI
- **AC-0205**: Database is the single source of truth; AI never relies on memory for training state
- **AC-0206**: Conversation phase switches to 'training' when session starts, back to 'chat' when session completes
- **AC-0207**: Sessions auto-close after 2 hours of inactivity (lazy on user interaction + daily cron)
- **AC-0208**: User context (mood, sleep, energy) is extracted from conversation and stored in session
- **AC-0209**: Set data supports discriminated union by exercise type (strength, cardio, functional, isometric, interval)
- **AC-0210**: Training history queries return sessions with full details (exercises, sets, muscle groups)

## Business Rules

- **BR-TRAINING-010**: Session recommendation analyzes last 5 completed sessions, computes muscle group recovery timeline, and applies plan's recovery guidelines
- **BR-TRAINING-011**: Users must have an active workout plan (status='active') to receive recommendations
- **BR-TRAINING-012**: AI considers RPE (Rate of Perceived Exertion) from previous sessions when assessing recovery readiness
- **BR-TRAINING-013**: Starting a session creates workout_session with status='in_progress', sets started_at timestamp, and stores sessionId in conversation context
- **BR-TRAINING-014**: Only one session per user can have status='in_progress'; starting a new session auto-closes any existing active session
- **BR-TRAINING-015**: User context (mood, sleep, energy, notes) is extracted from conversation and stored in workout_sessions.user_context_json
- **BR-TRAINING-016**: Set logging requires: sessionId (from context), exerciseId (parsed or inferred), set_number (auto-incremented), set_data (discriminated by exercise type)
- **BR-TRAINING-017**: Every training action (log set, add exercise, complete session) updates workout_sessions.last_activity_at
- **BR-TRAINING-018**: AI loads full session details (TrainingService.getSessionDetails) before processing each training message
- **BR-TRAINING-019**: Exercise completion updates session_exercises.status to 'completed' and session_exercises.actual_reps_range with summary
- **BR-TRAINING-020**: Adding exercises mid-session appends to session_exercises with incremented order_index
- **BR-TRAINING-021**: Completing a session updates status to 'completed', sets completed_at timestamp, calculates duration_minutes, and clears active sessionId from context
- **BR-TRAINING-022**: Training history queries use workout_sessions.completed_at DESC for chronological ordering
- **BR-TRAINING-023**: Sessions with last_activity_at older than 2 hours are auto-closed on next user interaction (lazy check)
- **BR-TRAINING-024**: Daily cron job (3 AM) globally closes all abandoned sessions (status='in_progress', last_activity_at > 2 hours)
- **BR-TRAINING-025**: Retrospective logging creates sessions with past timestamps and status='completed' immediately
- **BR-TRAINING-026**: Training history returns WorkoutSessionWithDetails including exercises, sets, muscle groups, and user context

## API Mapping

- **POST /api/chat** → All training interactions (no separate endpoints)
  - User: "What should I do today?" → AI → TrainingService.getNextSessionRecommendation()
  - User: "Let's start" → AI → TrainingService.startSession()
  - User: "Did 10 reps with 50kg" → AI → TrainingService.logSet()
  - User: "Finished" → AI → TrainingService.completeSession()
  - User: "Show my last workouts" → AI → TrainingService.getTrainingHistory()

## Conversation Context Extension

### Training Phase Context

When conversation phase is 'training', the context includes:

```typescript
{
  userId: string,
  phase: 'training',
  turns: ConversationTurn[],
  trainingContext: {
    activeSessionId: string,  // UUID of workout_session with status='in_progress'
  }
}
```

### Phase Transitions

1. **chat → training**: When user starts a session
   - Create workout_session (status='in_progress')
   - Store sessionId in trainingContext.activeSessionId
   - Add system note: "Training session started"

2. **training → chat**: When user completes or session auto-closes
   - Update workout_session (status='completed')
   - Clear trainingContext.activeSessionId
   - Add system note: "Training session completed"

## Database Schema Reference

See migration `0003_wandering_colleen_wing.sql` for complete schema.

Key tables:
- `workout_plans` - User's training plans with recovery guidelines (JSONB)
- `exercises` - Exercise library with muscle groups, energy cost, complexity
- `workout_sessions` - Actual workout sessions with status tracking
- `session_exercises` - Exercises performed in a session
- `session_sets` - Individual sets with flexible JSONB data (discriminated by exercise type)

## Domain Rules Reference

- Training domain: `docs/domain/training.spec.md`
- Conversation domain: `docs/domain/conversation.spec.md`
- AI domain: `docs/domain/ai.spec.md`

## Out of Scope (Future Features)

- Automatic workout plan generation (FEAT-0011)
- Real-time form feedback via video analysis
- Progress charts and analytics dashboard
- Social features (sharing workouts, challenges)
- Exercise video library with technique guides
- Wearable device integration (heart rate, calories)
