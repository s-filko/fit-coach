Domain: User

Terms
	• User: identified by `id`, provider and providerUserId

Invariants
	• INV-USER-001: A user is uniquely identified by (provider, providerUserId)
	• INV-USER-002: profileStatus ∈ { 'collecting','complete' }
	• INV-USER-003: profileStatus='complete' implies age, gender, height, weight, fitnessLevel, fitnessGoal are present and explicitly confirmed
	• INV-USER-007: If all required fields are present and profileStatus='collecting', the system must request confirmation before switching to 'complete' (confirmation is derived, not stored)
	• INV-USER-004: age is an integer in range [6..100]
	• INV-USER-005: height is an integer centimeters value in range [80..250]
	• INV-USER-006: weight is an integer kilograms value in range [20..250]

Business Rules
	• BR-USER-001: Upsert must return existing user if already registered [INV-USER-001]
	• BR-USER-002: Public read returns 404 for unknown id
	• BR-USER-003: Any endpoint referencing unknown user id returns 404
	• BR-USER-004: Upsert initializes profileStatus to 'collecting'
	• BR-USER-006: Language change occurs immediately on explicit user request; when system proposes due to detected mismatch, require explicit confirmation; persist by updating user.languageCode
	• BR-USER-007: Upsert persists provider metadata when present (username, firstName, lastName, languageCode)
	• BR-USER-008: Cross-phase extraction — collect any missing fields at any step; do not re-ask once captured
	• BR-USER-009: Clarify ambiguous values/units before persisting; only store when unambiguous
	• BR-USER-010: Registration data is persisted incrementally; flow resumes after interruption
	• BR-USER-011: Completion requires explicit confirmation after showing a full profile summary
		• BR-USER-012: During registration, later user updates override earlier values (last-write-wins in session)
		• BR-USER-013: Post-completion edits: show current profile, propose changes, save only after confirmation
		• BR-USER-014: Data extraction occurs only while profileStatus='collecting' or an explicit edit session is active; otherwise normal chat applies
		• BR-USER-015: During an edit session, profile is treated as incomplete until user confirms the updated summary; after confirmation, status returns to 'complete'
		• BR-USER-016: Normalize stored profile values to English enums and metric units; accept inputs in any language/units
		• BR-USER-017: Provider metadata updates on upsert must not override user-provided profile fields; provider data is stored separately

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

Rules:
- One file per domain (≤ 50 lines).
- Must match apps/server/src/domain/user/ports/service.ports.ts.
