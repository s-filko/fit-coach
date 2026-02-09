ADR-0005 Conversation Context (Session)

Context

Each /api/chat call currently sends only the current user message to the LLM with no prior dialogue. The AI coach cannot maintain a coherent multi-turn conversation, cannot reference earlier answers, and loses context between messages. A conversation context mechanism is needed that is universal (usable at any phase), controllable (reset, summarize, phase transition), and scoped by situation (userId + phase).

Decision

Introduce a Conversation Context abstraction with the following design:

Model
- Identity: (userId, phase). Phase aligns with profileStatus or app-defined state (e.g. 'registration', 'chat', 'training').
- Turn: { role: 'user' | 'assistant' | 'system' | 'summary', content: string, timestamp }.
- Context object: phase, turns (ordered), optional summarySoFar, optional lastActivityAt.
- Storage: conversation_turns table (one row per message, append-only) keyed by (user_id, phase, role, content, created_at). Roles 'system' and 'summary' stored in the same table for complete timeline.

Port (domain interface)
- IConversationContextService (CONVERSATION_CONTEXT_SERVICE_TOKEN) in domain/conversation/ports/:
  - getContext(userId, phase): ConversationContext | null [BR-CONV-001]
  - appendTurn(userId, phase, userContent, assistantContent): void [BR-CONV-002]
  - getMessagesForPrompt(ctx, options?): ChatMsg[] [BR-CONV-003][BR-CONV-004]
  - reset(userId, phase, options?): void [BR-CONV-005]
  - summarize(userId, phase): void [BR-CONV-006]
  - startNewPhase(userId, fromPhase, toPhase, systemNote, options?): void [BR-CONV-005]
- Implementation in infra/conversation/ (in-memory for MVP, DB-backed later).

Prompt integration
- Orchestrator flow per request: determine phase -> load context -> getMessagesForPrompt(ctx, {maxTurns:20}) -> build [history + current message] -> call LLM -> appendTurn -> on phase change call startNewPhase or reset.
- LLM service signature unchanged: receives ChatMsg[] and system prompt; does not manage storage.

Token management
- MVP: sliding window only (last 20 turns) [BR-CONV-003]. No summarization.
- Later: when turns exceed threshold, call summarize(); getMessagesForPrompt returns summary + recent turns [BR-CONV-004].

Consequences

- API contract unchanged: POST /api/chat remains {data: {content, timestamp}} [AC-0110].
- Adds one context load and one append per request; negligible latency for in-memory; DB-backed adds one SELECT + one INSERT.
- Phase transitions (registration -> chat, etc.) handled explicitly by caller via startNewPhase [BR-CONV-005].
- In-memory implementation sufficient for MVP (single-instance); DB-backed required for multi-instance or persistence across restarts.
- Testing: in-memory or stub IConversationContextService allows unit tests without DB.
- appendTurn failure after successful LLM call is best-effort for MVP [BR-CONV-007].

References
- docs/features/FEAT-0009-conversation-context.md
- docs/domain/conversation.spec.md
- docs/CONVERSATION_CONTEXT_ARCHITECTURE.md (implementation guide)
- docs/ARCHITECTURE.md (Conversation Context section)
- ADR-0004 User Profile and Context Storage
