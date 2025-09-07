FEAT-0004 Telegram Onboarding Start

x-status: Proposed

User Story

As a Telegram user, I want a clear welcome message after pressing Start so that I understand the bot’s role and what to do next.

Scenarios
	• S-0011: Given user presses Start and has no account, When client calls POST /api/user with provider='telegram' and providerUserId, Then 200 with { id } and server initializes profileStatus='registration' [BR-USER-004][INV-USER-001]
	• S-0012: Given account exists for the same provider+providerUserId, When POST /api/user, Then 200 with the same { id } (no duplicate) [BR-USER-001]
	• S-0017: Given POST /api/user returned 200, When onboarding begins, Then bot sends a Welcome message greeting by firstName or username, states role “personal fitness coach”, and prompts user to describe themselves and goals
	• S-0014: Given unknown userId, When POST /api/chat, Then 404 { error: { message: 'User not found' } } [BR-USER-003]
	• S-0016: Given profileStatus='active', When POST /api/chat, Then 200 with a normal chat response [BR-AI-002]

Acceptance Criteria
	• AC-0012: Welcome includes “Hi <name>”, “I’m your personal fitness coach”, and a prompt to tell about themselves and goals
	• AC-0013: Single message (≤ 2 paragraphs, ≤ 300 chars), emoji allowed
	• AC-0014: Fallback name is “there” if neither firstName nor username present

API Mapping
	• POST /api/user → IUserService.upsertUser
	• POST /api/chat → LLMService.generateResponse | RegistrationService.processUserMessage (branch by profileStatus)

Domain Rules Reference
	• BR-USER-001, BR-USER-003, BR-USER-004 from /docs/domain/user.spec.md
	• BR-AI-001, BR-AI-002 from /docs/domain/ai.spec.md

Notes
- Welcome message is client (Telegram bot) behavior; server contracts unchanged.
