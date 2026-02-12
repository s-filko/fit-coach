Domain: Training

Terms
	• WorkoutPlan: flexible training plan with recovery guidelines (JSONB structure)
	• WorkoutSession: actual workout session with status tracking (planned|in_progress|completed|skipped)
	• SessionExercise: exercise performed in a session with target and actual data
	• SessionSet: individual set logged during training with flexible JSONB data
	• Exercise: exercise from library with muscle groups, energy cost, complexity
	• SessionRecommendation: AI-generated workout recommendation based on history and recovery

Invariants
	• INV-TRAINING-001: A user can have at most one WorkoutPlan with status='active'
	• INV-TRAINING-002: A user can have at most one WorkoutSession with status='in_progress'
	• INV-TRAINING-003: session_sets.set_data JSONB must have 'type' field (discriminated union)
	• INV-TRAINING-004: workout_sessions.last_activity_at is updated on every training action
	• INV-TRAINING-005: Sessions with last_activity_at > 2 hours and status='in_progress' are auto-closed

Business Rules
	• BR-TRAINING-001: All training interactions happen through /api/chat; no separate REST endpoints
	• BR-TRAINING-002: Database is single source of truth; AI loads session details from DB on each message
	• BR-TRAINING-003: Session recommendations analyze last 5 sessions, recovery guidelines, and current date
	• BR-TRAINING-004: Starting a session creates workout_session (status='in_progress'), stores sessionId in conversation context
	• BR-TRAINING-005: Only one active session per user; starting new session auto-closes previous [INV-TRAINING-002]
	• BR-TRAINING-006: Set logging updates workout_sessions.last_activity_at to prevent timeout [INV-TRAINING-004]
	• BR-TRAINING-007: Sessions auto-close after 2 hours inactivity (lazy on interaction + daily cron) [INV-TRAINING-005]
	• BR-TRAINING-008: Completing session updates status='completed', sets completed_at, clears context
	• BR-TRAINING-009: User context (mood, sleep, energy) extracted from conversation, stored in user_context_json
	• BR-TRAINING-010: Retrospective logging creates sessions with past timestamps, status='completed'

Ports (apps/server/src/domain/training/ports/)
	• ITrainingService (TRAINING_SERVICE_TOKEN)
		• getNextSessionRecommendation(userId): SessionRecommendation [BR-TRAINING-003]
		• startSession(userId, dto): WorkoutSession [BR-TRAINING-004][BR-TRAINING-005]
		• addExerciseToSession(sessionId, dto): SessionExercise
		• logSet(exerciseId, dto): SessionSet [BR-TRAINING-006]
		• completeSession(sessionId, duration?): WorkoutSession [BR-TRAINING-008]
		• getTrainingHistory(userId, limit?): WorkoutSessionWithDetails[]
		• getSessionDetails(sessionId): WorkoutSessionWithDetails | null [BR-TRAINING-002]
	• IWorkoutPlanRepository, IExerciseRepository, IWorkoutSessionRepository, ISessionExerciseRepository, ISessionSetRepository

Conversation Integration
	• Phase 'training': active when user has session with status='in_progress'
	• Context stores: { activeSessionId: string }
	• Phase transitions: chat ↔ training (on session start/complete)
	• AI loads session details from DB before processing each training message [BR-TRAINING-002]

Rules:
- One file per domain (≤ 50 lines).
- Matches apps/server/src/domain/training/ports/.
