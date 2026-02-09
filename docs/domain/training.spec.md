Domain: Training

Terms
	• WorkoutPlan: structured template of future workouts linked to a user
	• WorkoutPlanCycle: hierarchical element of a plan (macro|meso|micro)

Invariants
	• INV-TRAINING-001: A user can have at most one WorkoutPlan with archivedAt=null
	• INV-TRAINING-002: approvedAt is null until the plan is confirmed and, once set, remains immutable
	• INV-TRAINING-003: archivedAt is immutable once set and implies approvedAt is non-null
	• INV-TRAINING-004: Each WorkoutPlanCycle belongs to exactly one WorkoutPlan and, if parentCycleId is present, the parent belongs to the same plan
	• INV-TRAINING-005: At most one WorkoutPlanCycle per (plan,cycleType) may be in state='active'
	• INV-TRAINING-006: plannedStartAt ≤ plannedEndAt for every WorkoutPlanCycle

Business Rules
	• BR-TRAINING-001: Creating a WorkoutPlan archives any previous unarchived plan for the user [INV-TRAINING-001]
	• BR-TRAINING-002: Plans remain editable only while approvedAt is null; approval freezes the payload
	• BR-TRAINING-003: Approving a plan sets approvedAt and makes the plan referenceable from workouts
	• BR-TRAINING-004: Archiving a plan (setting archivedAt) detaches it from future workouts but keeps historical associations intact [INV-TRAINING-003]
	• BR-TRAINING-005: WorkoutPlan payload captures goal snapshot, constraints, schedule, phased structure (macro→meso→micro cycles), and exercise templates prior to approval
	• BR-TRAINING-006: WorkoutPlanCycle.state transitions: upcoming → active → completed|skipped; activatedAt/completedAt record factual timestamps
	• BR-TRAINING-007: Cycle ordering (orderIndex) is contiguous per (plan,cycleType,parentCycleId) and determines progression

Ports
	• WorkoutPlanService (TRAINING_CONTEXT_SERVICE_TOKEN)
	• getContext(userId): WorkoutPlan | null [BR-TRAINING-001]
	• createContext(userId, data): WorkoutPlan [BR-TRAINING-001][BR-TRAINING-005]
	• updateContext(id, data): WorkoutPlan | null [BR-TRAINING-002]
	• deleteContext(id): boolean (archives plan) [BR-TRAINING-004]

Rules:
- One file per domain (≤ 50 lines).
- Matches apps/server/src/domain/training/ports.ts.
