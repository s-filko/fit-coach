FEAT-0006 Registration Conversation Improvements

x-status: Proposed

User Story

As a user, I want the registration chat to avoid repeated questions, respect my language, and confirm once all data is complete so that onboarding is fast and clear.

Principles
- Conversational and context-aware: the bot maintains helpful context and guides naturally.
- Steps are UX-only: backend continuously extracts missing profile fields only while profileStatus='collecting' or an explicit edit session is active.
- Complete profile: in normal chat (profile complete) no data collection occurs unless the user asks to edit; in edit mode, once all required data is gathered, the bot immediately presents a summary for confirmation and exits edit mode after confirmation.
- Next question is adaptive: chosen based on what is already captured and what is still missing; avoid re-asking captured fields.
    - Clarify as needed (no spam): ask concise clarifying questions on ambiguity (e.g., units), group requests for multiple missing fields into a single prompt when possible; conservative emoji use.
- Confirm once at the end: show a full summary and complete only after explicit confirmation.
- Off-topic handling: answer in one short sentence (if needed) and immediately redirect to the active prompt (missing fields or confirmation) without derailing the flow.
- Confirmation phrasing: prefer a friendly invitation to continue (e.g., “If everything looks good, we can continue.”) rather than imperative “say yes/no”; treat positive intents as confirmation.
- Optional bilingual first prompt: on first detected language mismatch, the initial greeting may include a short bilingual line to propose switching; lock to the confirmed language afterwards.
- Languages: default is English, but users may interact in any language; explicit language change requests are honored immediately, otherwise the system proposes switching on first detected mismatch.

Status Taxonomy (Proposed)
- Target simplification:
  - collecting — any state before final confirmation (covers all intermediate steps)
  - complete — confirmed profile
- Current step-like values map to collecting (except complete) for backward compatibility.

Diagram
- See: `docs/features/FEAT-0006-registration-flow.md`

Scenarios
	• S-0025: Given a field is already captured (e.g., age), When user mentions age again, Then bot acknowledges but does not re-ask age [BR-USER-005]
	• S-0026: Given user provides multiple fields at once (age, gender, height, weight), When parsed, Then all recognized fields are stored and only missing ones are requested [BR-USER-005]
	• S-0027: Given user messages predominantly in a language different from stored languageCode, When responding, Then bot asks a one-line confirmation to switch language ("Switch to <lang>?"), and keeps replying in stored language until confirmed [BR-UX-001]
	• S-0028: Given user provides “exercised 1-2 years”, When parsed, Then fitnessLevel maps to "intermediate"
	• S-0029: Given not all required fields are present, When at confirmation step, Then bot asks for missing data and does not set profileStatus=complete [INV-USER-003]
	• S-0030: Given user sends an explicit confirmation (e.g., "yes", "confirm"), When all required fields present, Then profileStatus=complete and subsequent chats are normal
	• S-0031: Given user explicitly asks to change language in free form (e.g., "let's speak English", "switch to Spanish"), When detected, Then bot switches language immediately and persists the change (no extra confirmation) [BR-USER-006][BR-UX-001]
	• S-0032: Given user declines or gives no clear confirmation, When asked to switch, Then language remains unchanged and bot continues in stored languageCode [BR-UX-001]
	• S-0033: Given user writes in any language, When parsing, Then system extracts profile data regardless of message language [BR-AI-003]
	• S-0034: Given registration is in any phase, When a message contains any missing profile fields, Then system extracts and persists them immediately and does not re-ask those fields [BR-USER-008]
	• S-0035: Given ambiguity or unknown units (e.g., "177"), When parsing, Then bot asks concise clarifying question(s) and persists only after clarification [BR-USER-009]
	• S-0036: Given server restart or crash during registration, When user continues, Then previously captured fields remain saved and flow resumes from the correct next step [BR-USER-010]
	• S-0037: Given user changes previously provided data during registration, When new value is detected, Then the latest value overrides the prior one and the bot acknowledges the update [BR-USER-012]
	• S-0038: Given profile is complete and user requests to edit profile, When user provides updates, Then system enters edit, normalizes values, shows full profile summary reflecting updates, and saves only after confirmation [BR-USER-013]

Acceptance Criteria
	• AC-0018: Registration never regresses to earlier prompts unless user explicitly asks to edit
	• AC-0019: Each captured field is idempotent; re-mentioning does not reset flow
	• AC-0020: Response language matches stored user.languageCode
	• AC-0021: On language mismatch, bot proposes switching with a short confirmation prompt; no switch without explicit confirmation
	• AC-0022: On explicit user request to change language, switch immediately and persist the new languageCode; on proposal flow, switch only after positive confirmation; on negative/unclear — remain unchanged
	• AC-0023: Continuous extraction across phases — any missing field provided at any time is captured once and not re-asked
	• AC-0024: Ambiguous inputs trigger a single concise clarification; value is persisted only after clarity (e.g., units)
	• AC-0025: Registration progress is durable; after restart, previously captured fields remain and conversation resumes correctly
	• AC-0026: Before marking complete, bot shows a minimal readable summary of age, gender, height, weight, fitnessLevel, fitnessGoal and asks for confirmation; completion occurs only after positive confirmation
	• AC-0033: Inputs in any language/units are accepted; stored values are normalized to English enums and metric units with integer rounding (years, cm, kg)
	• AC-0034: Language switch: explicit request switches immediately; proposal on first mismatch requires consent; if user does not continue in the chosen language, propose switching back in that language

Utterance Patterns (examples)
- Edit fields: "change my weight to 70 kg", "set my height to 180", "I'm no longer a beginner"
- Change goal: "let's change my goal to muscle gain"
- Confirm: "yes", "confirm", "correct"
- Decline/Edit: "no", "edit", "change"
    • AC-0027: During registration, user edits are allowed; last value wins and is acknowledged to the user
    • AC-0028: Post-completion edit flow: show current profile, accept updates, show proposed changes, save after confirmation
    • AC-0029: Next prompt targets the most relevant missing field using current context and never includes fields already captured
    • AC-0030: When profileStatus='complete' and there is no explicit edit request, the system does not collect or change profile data (normal chat only)
    • AC-0031: Upon explicit edit request with profile complete, the system enters edit collection; after all required changes are gathered, it shows an updated summary and requires confirmation
    • AC-0032: After edit confirmation, the system exits collection mode and restores profileStatus='complete'
	• AC-0033: Positive intents such as “continue”, “looks good”, “go ahead” are accepted as confirmation equivalents.
	• AC-0034: For off-topic questions, reply concisely (≤ 1 sentence) and return to the active prompt without starting new flows.

API Mapping
	• No API changes; logic lives in RegistrationService, ProfileParser, PromptService

Domain Rules Reference (Proposed)
	• BR-USER-005: Registration flow must not re-ask already captured fields; only request missing ones
	• BR-UX-001: Response language must follow user.languageCode; detected language is used only to propose switching with confirmation
	• BR-USER-006: Language change occurs immediately on explicit user request; when the system proposes due to detected mismatch, require explicit confirmation; persist by updating user.languageCode
	• BR-AI-003: Parsing should work for input in any language irrespective of response language
	• BR-USER-008: Cross-phase extraction — collect any missing fields at any step; do not re-ask once captured
	• BR-USER-009: Clarify ambiguous values/units before persisting; only store when unambiguous
	• BR-USER-010: Registration data is persisted incrementally; flow resumes after interruption
	• BR-USER-012: During registration, later user updates override earlier values
	• BR-USER-013: Post-completion edit requires confirmation before saving updated profile
	• BR-USER-016: Normalize stored profile values to English enums and metric units; accept inputs in any language/units
	• BR-USER-017: Provider metadata updates on upsert must not override user-provided profile fields; provider data is stored separately

Implementation Notes (Code Alignment)
- Status model:
  - Replace step statuses with `'collecting' | 'complete'` across domain/infra/tests.
  - Set default status to `'collecting'` on user creation.
  - Treat confirmation as a derived phase: when all required fields are present and status is `'collecting'`, show summary and wait for explicit confirmation; only then set `'complete'`.
- Chat response schema:
  - Remove `registrationComplete` from route schemas; success reply is `{ data: { content: string, timestamp: string } }`.
- Normalization & storage:
  - Inputs may be any language/units; LLM normalizes to English enums and metric integers (years, cm, kg). Server stores normalized values as-is.
- Tests update checklist:
  - Update response expectations for `/api/chat` (no `registrationComplete`).
  - Update status transitions and initial state assertions to `'collecting'`.
  - Adjust any tests relying on step-like statuses to use the new model.

Notes
- This feature refines conversational logic; requires updates in parser/prompt/registration services.

Conformance Status (current v0)
- AC-0018 (no regression to earlier prompts): FAIL — bot may re-ask already provided fields.
- AC-0019 (idempotent captured fields): FAIL — re-mentions can reset or re-prompt.
- AC-0020 (responses follow stored languageCode): PASS — responses in English while language_code='en'.
- AC-0021 (proposal with confirmation on mismatch): NOT IMPLEMENTED — no explicit proposal observed.
- AC-0022 (explicit request switches immediately; proposal requires confirm): NOT VERIFIED — behavior not observed yet.
