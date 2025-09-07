FEAT-0005 Registration Conversation v0

x-status: Implemented

User Story

As a new user, I want the bot to collect the required profile data through a short conversation so that I can receive a personalized training plan.

Scenarios
	• S-0018: Given profileStatus=collecting, When user sends any first message, Then server switches to collecting and replies with a registration prompt [BR-AI-002]
	• S-0019: Given user provides combined input (e.g., "I'm 37, male, 172 cm, and weigh 73 kg"), When processed, Then age, gender, height, weight are extracted and acknowledged; continues collecting the remaining basic fields
	• S-0020: Given basic data collected, When user provides fitness level text (e.g., "exercised 1-2 years"), Then fitnessLevel is set and continues collecting and moves toward confirmation
	• S-0021: Given fitness goal provided (e.g., "muscle gain"), When processed, Then system requests confirmation
	• S-0022: Given user confirms (e.g., "yes", "confirm"), When all required fields are present, Then profileStatus becomes complete and subsequent chats run in normal mode [INV-USER-003]
	• S-0023: Given missing/invalid API key, When POST /api/chat, Then 401/403 is returned
	• S-0024: Given unknown userId, When POST /api/chat, Then 404 'User not found' [BR-USER-003]

Acceptance Criteria
	• AC-0015: Registration steps proceed in order: collecting → confirmation (derived) → complete
	• AC-0016: Server echoes progress (acknowledges captured basic fields) and requests missing data where applicable
		• AC-0017: Response payload is always `{ data: { content, timestamp } }`; profile completeness is internal to the server

Verification Notes (non-normative, v0)
- After basic data is acknowledged, current implementation typically persists age, gender, height, weight and sets profile_status to 'collecting_level'. This is an implementation detail, not a requirement; end‑user behavior is authoritative.

API Mapping
	• POST /api/chat → RegistrationService.processUserMessage (branching by profileStatus), LLMService.generateResponse for phrasing

Domain Rules Reference
	• BR-AI-002, BR-AI-001 from /docs/domain/ai.spec.md
	• BR-USER-003, INV-USER-003 from /docs/domain/user.spec.md

Notes (Known Limitations Observed)
- Bot may re-ask already provided fields (duplicate prompts) and sometimes restarts with name requests.
- Language handling: user messages in Russian may still receive English responses; no stable language selection.
- Occasional inconsistency when confirming or reordering prompts; improvements proposed in FEAT-0006.
