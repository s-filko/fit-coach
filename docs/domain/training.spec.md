Domain: Training

Terms
	• WorkoutPlan: flexible training plan with recovery guidelines (JSONB structure)
	• WorkoutSession: actual workout session with status tracking (planning|in_progress|completed|skipped)
	• SessionExercise: exercise performed in a session with target and actual data
	• SessionSet: individual set logged during training with flexible JSONB data
	• Exercise: exercise from library with muscle groups, energy cost, complexity
	• SessionRecommendation: AI-generated workout recommendation based on history and recovery
	• UserContext: user's current state (mood, sleep, energy, availableTime, intensity) collected at planning start

Invariants
	• INV-TRAINING-001: A user can have at most one WorkoutPlan with status='active'
	• INV-TRAINING-002: A user can have at most one WorkoutSession with status='in_progress'
	• INV-TRAINING-003: session_sets.set_data JSONB must have 'type' field (discriminated union)
	• INV-TRAINING-004: workout_sessions.last_activity_at is updated on every training action, except a retro-logged catch-up set [BR-TRAINING-030]
	• INV-TRAINING-005: An in_progress session idle more than 2 hours (from last_activity_at) is completed at the user's next message, before the phase answers it; completed_at = last_activity_at; there is no scheduled job (owner-approved 2026-10-08, plan stale-session-autoclose)
	• INV-TRAINING-006: On every completion path (finish, completeSession, auto-close) completed_at >= started_at and duration_minutes >= 0

Business Rules
	• BR-TRAINING-001: All training interactions happen through /api/chat; no separate REST endpoints
	• BR-TRAINING-002: Database is single source of truth; AI loads session details from DB on each message
	• BR-TRAINING-003: Session recommendations analyze last 5 sessions, recovery guidelines, and current date; realized by the session_planning phase (mini-app REST endpoint retired 2026-09, ADR-0013 OQ-1)
	• BR-TRAINING-004: Session created with status='planning'; LLM plan stored in session_plan_json
	• BR-TRAINING-005: UserContext (mood, sleep, energy, availableTime, intensity) collected at planning start
	• BR-TRAINING-006: timeLimit enforced only when user explicitly provides available time
	• BR-TRAINING-007: session_exercises created dynamically during 'training' phase as user performs them
	• BR-TRAINING-008: Starting training transitions session to status='in_progress', stores sessionId in context
	• BR-TRAINING-009: Only one active session per user; starting new session auto-closes previous [INV-TRAINING-002]
	• BR-TRAINING-010: Set logging updates workout_sessions.last_activity_at to prevent timeout, except a retro-logged catch-up set [INV-TRAINING-004][BR-TRAINING-030]
	• BR-TRAINING-011: Sessions auto-close after 2 hours inactivity, lazily at the user's next message (no scheduled job); the message is answered in chat in the same turn [INV-TRAINING-005]
	• BR-TRAINING-012: Completing session updates status='completed', sets completed_at, clears context
	• BR-TRAINING-013: Retrospective logging creates sessions with past timestamps, status='completed'
	• BR-TRAINING-030: A set is retro-logged (stamped last activity + 5 min, activity not advanced) only if the in_progress session is idle > 2 h AND already holds sets (owner 2026-09-30, BUG-043)
	• BR-TRAINING-049: Sets added to the user's last finished workout through edit_last_workout are dated last_activity_at + 5 min and change neither the workout's status, completed_at, last_activity_at nor duration; a row gaining its first set becomes completed, a row losing its last set becomes skipped (owner-approved 2026-10-08, plan stale-session-autoclose T5)
	• BR-TRAINING-048: edit_last_workout adds, updates or deletes sets in the user's most recent completed workout only (without a change it shows that exercise's sets there); the workout stays completed and the conversation stays in its phase — a finished workout is never reopened (owner-approved 2026-10-08, plan stale-session-autoclose T5)
	• BR-TRAINING-031: The first set of a set-less in_progress session idle > 2 h is live: stamped now, and it re-anchors started_at to that set (late start, BUG-043)
	• BR-TRAINING-036: With LOAD_PLAN_SUGGESTION on, LOAD PLAN names a load per strength exercise — `recommend:` and a `conservative:` one step lighter, each with its reason; when one step down would reach ≤ 0 kg the load holds and the block says "no lighter option"; with insufficient data but a last performance that carried a load, `recommend:` is the newest performance's working-weight value (BR-TRAINING-041; never a failed opener), lowered per the break ladder (a restart never starts lighter than a rebuild), at low confidence; with no such reference the block names no number and no conservative option, and the coach does not invent them (amended by plan load-plan-fixes, owner-approved 2026-10-01) — produced in a fixed order (Stage A safety rows → Stage B tactic → Stage C progression scheme) with the deciding stage and row printed; the load is a suggestion, the coach decides by judgement and states its reason when it departs (design Principle 6 as amended by O1; plan load-plan, recorded 2026-10-01; amended by plan load-plan-fixes, owner-approved 2026-10-01)
	• BR-TRAINING-037: With LOAD_PLAN_SUGGESTION on, the first working set of an exercise in a session writes one load_recommendations row (the entry as rendered, the decision, the coach's advised load); completing the exercise fills its outcome; the table is calibration data and never read back into a prompt (plan load-plan D7)
	• BR-TRAINING-038: With LOAD_PLAN_BREAKS on, a gap since the last workout is classified into general-norm tiers (rest ≤ 7 d, rest_with_question > 7 d, return ≥ 14 d, rebuild ≥ 28 d, restart ≥ 84 d); from rest_with_question on, the reason is asked once per break (the answer is a `break` fact, no answer = unknown), and loads follow a return ladder that advances on a workout in range with reserve (plan load-plan D5, D9)
	• BR-TRAINING-039: With LOAD_PLAN_PLANNER_REBIND and LOAD_PLAN_SUGGESTION both on (rebind alone has no effect), session planning writes no targetWeight and WORKOUT OVERVIEW / the active-plan block show sets × reps only; loads come from LOAD PLAN during training (plan load-plan D10)
	• BR-TRAINING-040: log_set: a hold time (`durationSeconds`) on an exercise of type isometric is stored as an isometric set with its duration; cardio is unchanged; a reps-only call on an isometric exercise is stored as given (plan load-plan-fixes W-3, owner-approved 2026-10-01)
	• BR-TRAINING-041: Working weight (LOAD PLAN): the highest load at which every set reached the rep floor, judged by capacity (BR-TRAINING-043), among loads that recur in two recent performances or were reached in the newest one; when no load recurs, every reached load is eligible; when the newest performance's lowest-e1RM set (Epley, sets with capacity ≤ 10) fell short of the floor, the working weight is raised to that indirect estimate, converted to min(range min, 10) reps and rounded down to the step; more reps never lower it (plan load-plan-fixes items 4, 9; owner-approved 2026-10-01)
	• BR-TRAINING-042: Growth (LOAD PLAN), judged on the sets at the working weight by capacity: 2-for-2 — the last set ≥ range top + 2 in two consecutive performances → +1 step; one-session — the last set ≥ range top + 3 at RPE ≤ 8 or unrecorded, gap tier rest or rest_with_question, no short constraint on a primary muscle, no material pre-fatigue → +1 step with conservative = the working weight, confidence at most medium; never more than one step; no load is predicted by formula above 10 reps; where the step exceeds ≈ 10 % of a known total load the smallest step is offered with reps reset to the range bottom, via 2-for-2 only (never on one session); no such cap where the machine's own weight is unknown (plan load-plan-fixes items 5, 11, O-2; owner-approved 2026-10-01; NSCA 2-for-2, APRE, RIR-based RPE)
	• BR-TRAINING-043: Effort (LOAD PLAN): capacity = reps + min(10 − RPE, 3) when RPE is recorded (reps in reserve counted up to 3, the plain "3+" answer), else the reps; a set below the floor by reps but not by capacity (RPE ≤ 7, e.g. 6 @ RPE 7 with floor 8) is an early stop — hold; below the floor even by capacity is a miss — one step down; below the floor without RPE — hold and ask the first time, the same at the same load in the next performance — one step down; an uneven performance (drop-off above the user's usual + 3, or above 4 with no norm) counts neither for growth nor for a step down — hold; every row states the condition of the next increase (plan load-plan-fixes items 6, 7, 10; owner-approved 2026-10-01)
	• BR-TRAINING-044: log_set effort prompt: with LOAD_PLAN_SUGGESTION on, a decision-critical set (the last planned set, a set below the floor, a set ≥ 3 reps outside the range) stored without RPE makes the tool result ask the coach to ask the effort once per exercise per session, in plain words («0, 1–2 или 3 и больше?»); answers map to RPE 0 → 10, 1–2 → 8, 3+ → 7 (plan load-plan-fixes item 10; owner-approved 2026-10-01)
	• BR-TRAINING-045: Equipment step (LOAD PLAN): the default per equipment kind; a step from history only when at least two distinct working loads are each recorded in ≥ 2 performances within 8 weeks — the smallest difference between adjacent such loads, accepted within 0.5 kg … twice the default, printed "from history"; predicted loads snap to a recorded load within 0.3 kg; when recorded loads are off the default grid and no such step exists, the step is unknown: growth goes to the nearest recorded heavier load within twice the default step (else the coach asks which heavier load is available), the conservative option is the nearest recorded load below — no step yields a load the user's equipment cannot have (plan load-plan-fixes W-29, W-37, W-38; owner-approved 2026-10-01)

Ports (apps/server/src/domain/training/ports/)
	• ITrainingService (TRAINING_SERVICE_TOKEN)
		• startSession(userId, dto): WorkoutSession [BR-TRAINING-004][BR-TRAINING-005]
		• addExerciseToSession(sessionId, dto): SessionExercise
		• logSet(exerciseId, dto): SessionSet [BR-TRAINING-006, BR-TRAINING-040]
		• completeSession(sessionId, duration?): WorkoutSession [BR-TRAINING-008]
		• getTrainingHistory(userId, limit?): WorkoutSessionWithDetails[]
		• getSessionDetails(sessionId): WorkoutSessionWithDetails | null [BR-TRAINING-002]
	• IWorkoutPlanRepository, IExerciseRepository, IWorkoutSessionRepository, ISessionExerciseRepository, ISessionSetRepository

Conversation Integration
	• Phase 'session_planning': active when user has session with status='planning'
	• Phase 'training': active when user has session with status='in_progress'
	• Context stores:
		○ sessionPlanningContext: { recommendedSessionId: string }
		○ trainingContext: { activeSessionId: string }
	• Phase transitions: chat ↔ session_planning ↔ training ↔ chat
	• LLM requests transitions via phaseTransition flags; code validates before executing
	• All LLM prompts include detailed timestamps for context awareness
	• AI loads session details from DB before processing each message [BR-TRAINING-002]

Rules:
- One file per domain (≤ 50 lines).
- Matches apps/server/src/domain/training/ports/.
