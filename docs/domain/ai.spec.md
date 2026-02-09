Domain: AI

Terms
	• ChatMsg: structured user message with role/content

Invariants
	• INV-AI-001: LLM service receives a ready-made ChatMsg[] and system prompt; it does not manage conversation storage or history [BR-CONV-001]

Business Rules
	• BR-AI-001: AI responses are generated from conversation context (prior turns + current message) loaded by the orchestrator [BR-CONV-001][BR-CONV-003]
	• BR-AI-002: If user.profileStatus !== 'active', chat uses registration/onboarding flow; otherwise normal chat. Response schema is unchanged (content + timestamp only).
	• BR-AI-003: Parsing should accept input in any language; response language is determined by user.languageCode
	• BR-AI-004: Conversation context preserves prior answers across turns within a phase; sliding window ensures token budget [BR-CONV-003]
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
