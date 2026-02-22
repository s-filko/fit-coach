Domain: Conversation (keyed by userId + phase)

Terms
	- ConversationTurn: a single exchange { role: 'user' | 'assistant' | 'system' | 'summary', content: string, timestamp }
	- ConversationContext: ordered list of turns for a (userId, phase) pair, with optional summarySoFar, lastActivityAt, and phase-specific context
	- Phase: logical scope of a conversation ('registration' | 'chat' | 'session_planning' | 'training'); determines routing and context structure
	- SlidingWindow: policy that keeps only the last maxTurns turns when building the prompt
	- PhaseTransition: explicit reset or startNewPhase when app state changes (e.g. registration complete, session planning start, training start/end)
	- SessionPlanningContext: additional context for 'session_planning' phase { recommendedSessionId?: string }
	- TrainingContext: additional context for 'training' phase { activeSessionId: string }
	- LLMConversationResponse: structured LLM output { message: string, phaseTransition?: { toPhase, reason?, sessionId? } }
	- PhaseTransitionFlag: instruction from LLM to change conversation phase based on user intent

Invariants
	- INV-CONV-001: Context identity is (userId, phase); each pair has at most one active context
	- INV-CONV-002: Turns within a context are strictly chronologically ordered
	- INV-CONV-003: getMessagesForPrompt never returns more than maxTurns turns (default 20)
	- INV-CONV-004: Domain port has no dependency on LangChain or infra; types are ChatMsg / ConversationTurn only

Business Rules
	- BR-CONV-001: Every LLM call must include prior conversation turns from the current phase context [INV-CONV-001]
	- BR-CONV-002: After each successful LLM response, both user message and assistant response are appended as a turn [INV-CONV-002]
	- BR-CONV-003: getMessagesForPrompt applies a sliding window (last maxTurns); returns ChatMsg[] in chronological order [INV-CONV-003]
	- BR-CONV-004: If summarySoFar is present, it is prepended before the sliding window messages
	- BR-CONV-005: On phase transition, a [PHASE_ENDED] marker is appended to the old phase (history preserved, never deleted); a system note is injected into the new phase. getContext returns null for ended phases. [INV-CONV-001]
	- BR-CONV-006: After idle exceeding a configured threshold, context may be summarized or reset with a recap (post-MVP)
	- BR-CONV-007: If appendTurn fails after a successful LLM call, the system accepts the missing turn as best-effort for MVP
	- BR-CONV-008: Phase 'session_planning' includes sessionPlanningContext { recommendedSessionId? } for storing draft recommendations
	- BR-CONV-009: Phase 'training' includes trainingContext { activeSessionId } stored alongside turns
	- BR-CONV-010: Phase transitions follow the flow: chat → session_planning (on recommendation request) → training (on session start) → chat (on session complete)
	- BR-CONV-011: Phase-specific context is set on phase entry and cleared on phase exit
	- BR-CONV-012: LLM responses must be structured JSON with { message, phaseTransition? } format when jsonMode is enabled
	- BR-CONV-013: LLM controls phase transitions via phaseTransition flag in response; ChatService executes the transition
	- BR-CONV-014: Phase transition reason is logged for debugging and analytics but not shown to user
	- BR-CONV-015: Phase transitions must be validated before execution to ensure data consistency
	- BR-CONV-016: Transition session_planning → training requires valid sessionId and active workout plan
	- BR-CONV-017: Transition training → session_planning is blocked; user must complete or cancel training first
	- BR-CONV-018: Transition training → chat auto-completes the active session if not already completed

Ports
	- IConversationContextService (CONVERSATION_CONTEXT_SERVICE_TOKEN)
	- getContext(userId, phase): ConversationContext | null [BR-CONV-001]
	- appendTurn(userId, phase, userContent, assistantContent): void [BR-CONV-002]
	- getMessagesForPrompt(ctx, options?): ChatMsg[] [BR-CONV-003][BR-CONV-004]
	- reset(userId, phase, options?): void [BR-CONV-005]
	- summarize(userId, phase): void [BR-CONV-006]
	- startNewPhase(userId, fromPhase, toPhase, systemNote, options?): void [BR-CONV-005]

Rules:
- One file per domain (<=50 lines).
- Must match apps/server/src/domain/conversation/ports/conversation-context.ports.ts.
