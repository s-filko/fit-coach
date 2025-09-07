FEAT-0007 Registration Quick Setup

x-status: Proposed

User Story

As a new user, I want to complete a quick setup that captures my essential training context so the coach can personalize my plan from day one.

Scenarios

	• S-0039: Given profileStatus='registration', When the user states "no injuries", Then healthRestrictions=['none'] is saved [BR-USER-022]
	• S-0040: Given profileStatus='registration', When the user lists equipment (e.g., "bands, mat"), Then equipmentPresent=['resistance_bands','mat'] is saved (normalized) [BR-USER-020]
	• S-0041: Given profileStatus='registration', When the user provides availability (e.g., "3 days, 45 minutes"), Then availability={ daysPerWeek:3, sessionDurationMinutes:45 } is saved [BR-USER-021]
	• S-0042: Given profileStatus='registration', When the user provides dateOfBirth, Then the derived age is validated within [6..100] and DOB is stored [INV-USER-004]
	• S-0043: Given ambiguous numeric input (e.g., "180, 80"), When processed, Then the system asks a single clarification before persisting height/weight [BR-USER-009]
	• S-0044: Given all Stage 1 fields present, When the system shows a full summary and the user confirms, Then profileStatus becomes 'onboarding' [BR-USER-011]

Acceptance Criteria

	• AC-0031: Stage 1 completion requires: goal, sex, dateOfBirth, height, weight, fitnessLevel, healthRestrictions, trainingLocation, equipmentPresent (can be 'none'), availability
	• AC-0032: A full summary including all Stage 1 fields is shown before switching to 'onboarding'; explicit confirmation is required [BR-USER-011]
	• AC-0033: The system does not re-ask already captured fields within registration [BR-USER-008]
	• AC-0034: Values are normalized to English enums and metric units (years, cm, kg) [BR-USER-016, BR-USER-019..021]
	• AC-0035: 'none' is accepted for healthRestrictions; equipmentPresent may be 'none'; equipmentUnavailable is optional [BR-USER-020, BR-USER-022]
	• AC-0036: After switching to 'onboarding', activation occurs when onboarding is completed or explicitly skipped; optional data must not block activation [BR-USER-024..026]

API Mapping

	• POST /api/chat → RegistrationService.processUserMessage (Stage 1 extraction, normalization, summary, confirmation)

Domain Rules Reference

	• INV-USER-002, INV-USER-003, INV-USER-004, INV-USER-005, INV-USER-006
	• BR-USER-004, BR-USER-008, BR-USER-009, BR-USER-010, BR-USER-011
	• BR-USER-018, BR-USER-019, BR-USER-020, BR-USER-021, BR-USER-022, BR-USER-023

Notes
- Stage 1 is required to transition from 'registration' to 'onboarding'.
- Optional extended onboarding questions follow; upon completion or explicit skip, the system transitions to 'active'.
