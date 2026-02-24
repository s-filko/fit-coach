FEAT-0009 Conversation Context

x-status: Accepted

User Story

As a user, I want the AI coach to remember what I said earlier in the conversation, so that I don't have to repeat myself and the coach can maintain a coherent dialogue across messages.

Scenarios
	- S-0057: Given a user in registration phase with no prior turns, When the user sends the first message, Then the LLM receives only the system prompt and the current message; after the response a turn is appended [BR-CONV-001][BR-CONV-002]
	- S-0058: Given a user with 5 prior turns in phase 'registration', When the user sends a new message, Then the LLM receives the system prompt, the 5 prior turns, and the current message [BR-CONV-001][BR-CONV-003]
	- S-0059: Given a user with 25 prior turns in phase 'chat', When the user sends a message, Then only the last 20 turns (sliding window) are included in the prompt [BR-CONV-003]
	- S-0060: Given a user completing registration (profileStatus changes to 'complete'), When the complete_registration tool is called, Then pendingTransition is set and PostgresSaver checkpointer persists the new phase on the next graph invocation [BR-CONV-005]
	- S-0061: Given a user with context in phase 'chat', When the user has been idle for more than the configured threshold, Then on the next message the context may be summarized or reset with a recap [BR-CONV-006]
	- S-0062: Given an LLM call that succeeds but appendTurn fails, When the next request arrives, Then the missing turn is absent from context; system accepts this as best-effort for MVP [BR-CONV-007]
	- S-0063: Given a user sends a message, When the orchestrator processes it, Then context is loaded, messages are built, LLM is called, turn is appended, and the response is returned; the API contract remains unchanged [BR-CONV-001][BR-CONV-002]
	- S-0064: Given phase 'registration' context with turns, When getMessagesForPrompt is called, Then messages are returned in chronological order as ChatMsg[] [BR-CONV-003]

Acceptance Criteria
	- AC-0107: Every LLM call includes prior conversation turns from the current phase (up to maxTurns limit)
	- AC-0108: Turns are persisted after each successful LLM response (user message + assistant response)
	- AC-0109: Phase transitions update state.phase in LangGraph checkpointer; conversation history is NOT reset — new phase reads from its own (userId, phase) history in conversation_turns
	- AC-0110: API contract for POST /api/chat remains unchanged: { data: { content, timestamp } }
	- AC-0111: Sliding window defaults to 20 turns; configurable via options
	- AC-0112: Context is keyed by (userId, phase); different phases maintain independent histories
	- AC-0113: DB-backed implementation fully operational; IConversationContextService simplified to 2 methods (appendTurn + getMessagesForPrompt)

API Mapping
	- POST /api/chat -> ConversationGraph.invoke() [persist.node.ts calls IConversationContextService.appendTurn(); agentNodes call getMessagesForPrompt()]
	- No new public API endpoints; conversation context is internal

Domain Rules Reference
	- BR-CONV-001..BR-CONV-007 from /docs/domain/conversation.spec.md
	- BR-AI-001, BR-AI-004 from /docs/domain/ai.spec.md
