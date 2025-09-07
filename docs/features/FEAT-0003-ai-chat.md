FEAT-0003 AI Chat

User Story

As a user, I want to send a message and receive an AI-generated response so that I can interact with the Fit Coach assistant.

Scenarios
	• S-0008: Given valid userId and message, When POST /api/chat, Then 200 with { content, timestamp } is returned [BR-AI-001][BR-AI-002]
	• S-0009: Given missing/invalid API key, When POST /api/chat, Then 401/403 is returned
	• S-0010: Given AI processing error, When POST /api/chat, Then 500 with generic error is returned [BR-AI-001]
	• S-0011: Given unknown userId, When POST /api/chat, Then 404 { error: { message: 'User not found' } } [BR-USER-003]

Acceptance Criteria
	• AC-0005: 200 { data: { content: string, timestamp: string } }
	• AC-0006: 404 { error: { message: "User not found" } }
	• AC-0007: 500 { error: { message: "Processing failed" } }

API Mapping
	• POST /api/chat → RegistrationService.processUserMessage | LLMService.generateResponse

Domain Rules Reference
	• BR-AI-001, BR-AI-002 from /docs/domain/ai.spec.md
	• BR-USER-003 from /docs/domain/user.spec.md
