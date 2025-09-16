FEAT-0006 Registration — Implementation Plan (MVP Extension)

x-status: Planned

Scope
- Expand registration to full registration field set (10 fields) with derived confirmation and onboarding phase.
- Move registration storage to dedicated 1:1 profile; add 1:1 JSONB user context for onboarding/preferences; keep API stable.
- Ensure onboarding captures optional preferences and transitions users to `planning` once completed or skipped (plan feature will later set `active`).
- Update domain services and ports to reflect new storage and behaviors.

Non-Goals
- No API route changes (clients still POST /api/chat and receive `{ data: { content, timestamp } }`).
- No mandatory vector search; embeddings are optional later.

Data Model (See ADR-0004)
- users (thin): id, provider, provider_user_id, language_code, profile_status default 'registration'.
- user_profile (1:1 → users.id): sex, date_of_birth, height_cm, weight_kg, fitness_level, goal, training_location, health_restrictions text[], equipment_present text[], availability jsonb.
- user_context (1:1 → users.id): context jsonb with sections (coachSettings, preferences, healthNotes[], schedule, nutrition, equipmentExtra, notes).
- user_metrics (1:N → users.id) [optional when needed]: time-series (weight, circumferences, body_fat, resting_hr, bp).

Domain Contracts — Changes
- IUserService
  - Add: `getUserProfile(userId): Promise<UserProfile | null>`
  - Add: `upsertUserProfile(userId, profile: Partial<UserProfile>): Promise<UserProfile>`
  - Add: `getUserContext(userId): Promise<UserContext>`
  - Add: `updateUserContext(userId, patch: JsonObject): Promise<UserContext>`
  - Change: `isRegistrationComplete(user)` → compute from UserProfile registration field coverage.
- IRegistrationService
  - processUserMessage(user, message): unchanged signature; semantics updated:
    - extract registration fields across conversation; write to user_profile; produce adaptive prompts
    - when registration fields complete: show full summary; on explicit confirm → set users.profile_status='onboarding'
    - onboarding: store optional data in user_context; on "skip" or completion → set 'active'
  - getRegistrationPrompt(user): must reflect missing-only logic.
- IProfileParserService
  - parseProfileData: extend to normalize registration fields into metric units and English enums
  - parseUniversal: unchanged; must support multilingual extraction and ambiguity flags.
- Repositories (new logical ports)
  - UserProfileRepository: getByUserId, upsert, updatePartial
  - UserContextRepository: getByUserId (create on first read with {}), patch
  - UserMetricsRepository [optional]: appendMeasurement, listRecent

Behavior Rules (align with domain spec)
- Status model: registration → onboarding → planning (plan feature later leads to active). Confirmation is derived (not stored).
- Send a structured greeting that introduces the coach, summarizes the process, and asks if the user is ready before prompting for fields.
- Registration completeness required for transition out of registration: goal, sex, dateOfBirth, height, weight, fitnessLevel, healthRestrictions, trainingLocation, equipmentPresent, availability.
- Onboarding collects optional context (coachSettings, preferences, equipment nuances, etc.) sorted by priority (open fields first: schedule > coachSettings > preferences > equipmentExtra > notes); once done or skipped, user enters planning stage.
- Missing-only prompts; one concise clarification on ambiguity; last-write-wins during registration.
- Extraction applies only in registration or explicit edit; otherwise normal chat.
- Language: switch immediately only on explicit user ask or when an entire message is clearly in another single language; otherwise keep current language and continue.
- Persistence is incremental; restart resumes progress.
- Edits while active: show preview and persist only on explicit confirmation (status stays 'active'); plan change requests return the user to planning and restart the plan flow.

Scenarios (additions)
- S-0049: Given partial registration data present, When message includes multiple remaining fields, Then store all recognized fields and ask only for what’s still missing.
- S-0050: Given registration fields complete and status='registration', When user confirms, Then set status='onboarding' and begin optional questions.
- S-0051: Given status='onboarding', When user says "skip", Then set status='planning'.
- S-0052: Given weight update during onboarding, When provided, Then update user_profile.weight_kg (snapshot) and optionally append to user_metrics.
- S-0053: Given status='planning', When plan feature requests context, Then provide stored onboarding data (out of scope here).
- S-0054: Given status='active' and user requests plan changes, Then reset profileStatus to "planning" and hand off to the plan feature for a new approval loop.
- S-0055: Given explicit edit in 'active', When user changes fields, Then show updated summary and persist on confirm; status remains 'active'.
- S-0056: Given equipment unavailable note, When provided, Then store in user_context.equipmentExtra.unavailable and consider in prompts.

Acceptance Criteria (delta)
- AC-0101: Registration data lives under user_profile; onboarding/preferences under user_context.
- AC-0102: `isRegistrationComplete` derives from user_profile fields only.
- AC-0103: Confirmation shows a full registration summary; switch to onboarding only after explicit positive.
- AC-0104: Off-topic handling: brief answer + redirect to current prompt (missing fields or confirmation).
- AC-0105: Language switch behaviors per rules; store language_code immediately on explicit request.
- AC-0106: Transition to planning happens only after onboarding completes or is skipped; plan approval will later switch to `active`.

Phased Delivery
- Phase 1: Status and confirmation behaviors (no storage refactor visible to API).
- Phase 2: Introduce user_profile and user_context; rewire services; keep API stable.
- Phase 3: Extend parser/prompt for missing-only, ambiguity clarifications, language flows.
- Phase 4: Optional user_metrics and related write-paths.

Testing
- Update integration tests to use new status taxonomy and confirmation behavior; add scenarios S-0049..S-0056 (planning handoff + replan).
- Verify chat contract remains `{ data: { content, timestamp } }`.
- Add filters tests for equipment present/unavailable (array + JSONB).

Notes
- See ADR-0004 for schema details and indexing guidance.
- API Spec remains authoritative for routes; this feature alters internal behavior and storage only.
- Planning stage is handled by the workout-plan feature (future); registration continues to capture missing profile data even while in planning/active.

