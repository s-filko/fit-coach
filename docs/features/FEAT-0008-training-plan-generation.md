FEAT-0008 Training Plan Generation

x-status: Proposed

User Story

As a fully profiled user, I want the coach to generate, refine, and finalize a personalized workout plan so that I can start training with clarity and confidence.

Scenarios
	• S-0057: Given profileStatus='planning' and no unarchived WorkoutPlan, When planning starts, Then the system creates a WorkoutPlan (version incremented, approvedAt=null) seeded from the latest profile snapshot [BR-USER-026][BR-TRAINING-001][BR-TRAINING-005]
	• S-0058: Given WorkoutPlan.approvedAt is null, When the assistant shares the plan overview, Then the response enumerates phases, weekly cadence, and exercise templates derived from the editable payload [BR-TRAINING-002][BR-TRAINING-005]
	• S-0059: Given WorkoutPlan.approvedAt is null, When the user requests adjustments (e.g., "убери бег"), Then the plan payload is updated accordingly and the change log references which fields were modified [BR-TRAINING-002]
	• S-0060: Given the user approves the plan, When confirmation is captured, Then WorkoutPlan.approvedAt is set, workouts reference the planId, and profileStatus becomes 'active' [BR-TRAINING-003][BR-USER-027]
	• S-0061: Given profileStatus='active', When the user asks to change the plan, Then the current plan receives archivedAt, profileStatus switches to 'planning', and a new WorkoutPlan with approvedAt=null is created [BR-TRAINING-001][BR-TRAINING-004][BR-USER-028]
	• S-0062: Given an editable plan references exercises without sufficient progress data, When the gap is detected, Then the assistant asks targeted follow-ups or schedules calibration sessions before approval [BR-USER-008][BR-TRAINING-005]

Acceptance Criteria
	• AC-0200: Plan summaries always include: version, weekly frequency, split/phases, key exercises with target sets/reps/rest, and rationale tied to goals and constraints.
	• AC-0201: All plan modifications before approval are persisted through WorkoutPlanService.updateContext and reflected in subsequent summaries [BR-TRAINING-002].
	• AC-0202: Approved plans expose planId for downstream workout sessions; every workout log must reference the associated planId [BR-TRAINING-003][BR-TRAINING-004].
	• AC-0203: Replanning archives the previously approved plan by setting archivedAt and creating a new plan with approvedAt=null; historical workouts keep referencing the archived plan [BR-TRAINING-001][BR-TRAINING-004].
	• AC-0204: Approval transitions immediately unlock the training session flow and enqueue the first workout recommendation tied to the approved plan [BR-USER-027].
	• AC-0205: Planning conversations remain within `/api/chat`; no alternate endpoints manage plan lifecycle.

API Mapping
	• POST /api/chat (profileStatus='planning' or replan from 'active') → PlanningFlowService.handleMessage → WorkoutPlanService.*

Domain Rules Reference
	• BR-USER-026, BR-USER-027, BR-USER-028 from docs/domain/user.spec.md
	• BR-TRAINING-001..005 from docs/domain/training.spec.md

Storage Model (High-Level)
	• Table `workout_plans`
		– Fields: id, userId, version, approvedAt, archivedAt, targetStartAt, targetEndAt, goalSnapshotJson, constraintsJson, notesJson, createdAt, updatedAt
		– Invariant: at most one row per user with archivedAt=null; approvedAt immutable once set
	• Table `workout_plan_cycles`
		– Fields: id, planId, cycleType, orderIndex, parentCycleId, state, plannedStartAt, plannedEndAt, activatedAt, completedAt, focusJson, scheduleJson, payloadJson, createdAt, updatedAt
		– cycleType enum: macro_phase | meso_block | micro_week; state enum: upcoming | active | completed | skipped
		– FK: planId → workout_plans.id; parentCycleId → workout_plan_cycles.id (same plan)
	• Table `workout_plan_sessions` (optional extension)
		– Fields: id, cycleId (micro_week), dayOfWeek, sessionFocus, instructionsJson, alternativesJson
		– FK: cycleId → workout_plan_cycles.id
	• Table `workout_plan_exercises` (optional extension)
		– Fields: id, sessionId, exerciseId, priority, targetSets, targetRepsRange, targetRestSeconds, initialLoadJson, progressionRuleJson
		– FK: sessionId → workout_plan_sessions.id
	• Table `exercise_progress` (existing/planned)
		– Fields: id, userId, exerciseId, estimatedOneRepMax, lastSessionAt, historyJson
		– Used for calibrating initial loads and tracking adjustments

Notes
- WorkoutPlan payloads combine structured fields (goal snapshot, schedule, phase definitions) and JSON blocks for flexibility.
- WorkoutPlanCycle entries model macro → meso → micro hierarchy with state (`upcoming|active|completed|skipped`) and plannedStartAt/plannedEndAt so the assistant can reason about past/present/future blocks.
- Each plan must capture exercise templates aligned with equipment availability and restrictions; calibration prompts cover missing load data.
- Historical plans stay archived for reference so completed workouts keep their original plan linkage.
