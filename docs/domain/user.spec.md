Domain: User (identified by `id`, provider, providerUserId)
Invariants
	• INV-USER-001: A user is uniquely identified by (provider, providerUserId)
	• INV-USER-002: profileStatus ∈ { 'registration','onboarding','planning','active' }
	• INV-USER-003: profileStatus in {'planning','active'} implies registration fields are present and explicitly confirmed: goal, sex, dateOfBirth, height, weight, fitnessLevel, healthRestrictions, trainingLocation, equipmentPresent, availability
	• INV-USER-007: If all required registration fields are present and profileStatus='registration', the system must request confirmation before switching to 'onboarding' (confirmation is derived, not stored)
	• INV-USER-004: derived age (from dateOfBirth) is an integer in range [6..100]
	• INV-USER-005: height is an integer centimeters value in range [80..250]
	• INV-USER-006: weight is an integer kilograms value in range [20..250]
	• INV-USER-008: While profileStatus='active', user-initiated edits do not change profileStatus; updates persist only after explicit confirmation
	• INV-USER-009: profileStatus='planning' requires an unarchived WorkoutPlan with approvedAt=null; profileStatus='active' requires an unarchived WorkoutPlan with approvedAt≠null [INV-TRAINING-001][INV-TRAINING-002]
Business Rules
	• BR-USER-001: Upsert must return existing user if already registered [INV-USER-001]
	• BR-USER-002: Public read returns 404 for unknown id
	• BR-USER-003: Any endpoint referencing unknown user id returns 404
	• BR-USER-004: Upsert initializes profileStatus to 'registration'
	• BR-USER-006: Language change occurs immediately on explicit user request; when system proposes due to detected mismatch, require explicit confirmation; persist by updating user.languageCode
	• BR-USER-006a: Timezone (IANA, e.g. "Europe/Berlin") is optional, nullable, collected lazily via save_timezone tool in any phase; used in all date/time formatting; falls back to UTC
	• BR-USER-007: Upsert persists provider metadata when present (username, firstName, lastName, languageCode)
	• BR-USER-008: Cross-phase extraction — collect any missing registration/onboarding fields whenever they appear (registration, planning, active); do not re-ask once captured
	• BR-USER-009: Clarify ambiguous values/units before persisting; only store when unambiguous
	• BR-USER-010: Registration data is persisted incrementally; flow resumes after interruption
	• BR-USER-011: Switching to 'onboarding' requires showing a full registration profile summary and explicit confirmation
		• BR-USER-012: During registration, later user updates override earlier values (last-write-wins in session)
		• BR-USER-013: Post-activation edits: show current profile, propose changes, save only after confirmation
		• BR-USER-014: Data extraction prompts happen only while profileStatus='registration' or during explicit edit; however passive updates (from conversation context) may still refresh stored data in planning/active without extra prompts
		• BR-USER-015: While profileStatus='active', user-initiated edits do not change profileStatus; show an updated summary and persist changes only after explicit confirmation; on cancel/unclear, keep existing data
		• BR-USER-016: Normalize stored profile values to English enums and metric units; accept inputs in any language/units
		• BR-USER-017: Provider metadata updates on upsert must not override user-provided profile fields; provider data is stored separately
		• BR-USER-018: Registration required fields: goal, sex, dateOfBirth, height, weight, fitnessLevel, healthRestrictions, trainingLocation, equipmentPresent, availability
		• BR-USER-019: Normalize enums to English: goal (weight_loss|muscle_gain|body_toning|endurance|general_health), sex (male|female|other), fitnessLevel (beginner|intermediate|advanced), trainingLocation (home|gym|outdoors); fields are nullable until collected
		• BR-USER-020: Equipment model supports equipmentPresent[] (normalized; 'none' allowed) and optional equipmentUnavailable[]; Registration requires equipmentPresent (can be 'none')
		• BR-USER-021: Availability shape is { daysPerWeek: 1..7, sessionDurationMinutes: 15..180 } and is required for registration
		• BR-USER-022: HealthRestrictions is a string[]; accept 'none' for no restrictions
		• BR-USER-023: dateOfBirth is mandatory for registration; age is always derived from dateOfBirth
		• BR-USER-024: After registration confirmation, set profileStatus='onboarding'; begin optional extended questions
		• BR-USER-025: Onboarding questions are optional; user may answer or say 'skip'
		• BR-USER-026: Transition to 'planning' occurs when onboarding is completed or explicitly skipped; optional data must not block handoff
		• BR-USER-027: Plan approval sets profileStatus='active', records planApprovedAt, and surfaces next workout [BR-TRAINING-003]
		• BR-USER-028: Replan requests from an active user reset profileStatus='planning', archive the previous plan, and create a new WorkoutPlan with approvedAt=null [BR-TRAINING-001][BR-TRAINING-004][BR-TRAINING-005]
Ports
	• IUserService (USER_SERVICE_TOKEN)
	• upsertUser(input): { id: string } [BR-USER-001]
	• getUser(id): { id: string } | null [BR-USER-002]
	• isRegistrationComplete(user): boolean
	• UserRepository (USER_REPOSITORY_TOKEN)
	• findByProvider(provider, providerUserId): User | null [INV-USER-001]
	• create(data): User [INV-USER-001]
	• getById(id): User | null [BR-USER-002]
	• updateProfileData(id, data): User | null
Rules: One file per domain (≤ 50 lines). Must match apps/server/src/domain/user/ports/service.ports.ts.
