Domain: AI

Terms
	• ChatMsg: structured user message with role/content

Invariants
	• INV-AI-001: Chat processing is stateless per request (no memory)

Business Rules
	• BR-AI-001: AI responses are generated from request messages without persisting conversation state
	• BR-AI-002: If user.profileStatus !== 'complete', chat uses registration flow; otherwise normal chat. Response schema is unchanged (content + timestamp only).

Additional
	• BR-AI-003: Parsing should accept input in any language; response language is determined by user.languageCode
	• BR-AI-004: Conversation maintains helpful context while progressing registration (do not drop prior answers)
	• BR-AI-005: When field/units confidence is low, ask a short clarifying question before persisting

Ports
	• LLMService (LLM_SERVICE_TOKEN)
	• generateResponse(messages: ChatMsg[], isRegistration?): string [BR-AI-001]
	• generateRegistrationResponse(messages: ChatMsg[], context?): string [BR-AI-001]
	• getDebugInfo(): record — optional debug data
	• clearHistory(): void — clears in-memory debug history

Rules:
- One file per domain (≤ 50 lines).
- Matches apps/server/src/domain/ai/ports.ts.
