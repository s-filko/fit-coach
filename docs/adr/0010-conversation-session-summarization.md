# ADR 0010: Conversation Thread Summarization

**Status**: PROPOSED  
**Date**: 2026-03-01  
**Deciders**: Product + Engineering  
**Supersedes**: Extends ADR-0005 (sliding window → thread-based history with summarization)

---

## Context

LLM system prompts include directives that control response style (formatting, name usage, tone). However, conversation history (last 20 turn pairs from `conversation_turns`) often contains old responses that followed **previous** directive versions. The LLM copies patterns from history, ignoring updated instructions. This creates a feedback loop:

1. Old responses use outdated style (e.g., user's name in every message)
2. New responses copy the pattern from history
3. New responses are saved to history, reinforcing the pattern
4. Prompt directive changes have no effect

The root cause: **raw conversation history has more influence on LLM behavior than system prompt instructions** when the history is long enough.

Additionally, the current implementation does not distinguish between conversation threads. A user might have a training session at 9:00, leave for 3 hours, and return at 12:00 for a completely different topic — but the LLM treats it as one continuous conversation, losing important context from the training when an unrelated chat happens in between.

---

## Decision

Introduce **conversation threads** and **per-thread summarization** to replace the current flat sliding window.

### Terminology

- **Thread** — a block of continuous conversation, bounded by inactivity timeout. Not to be confused with **workout session** (`workout_sessions` table) which is a training session.
- **Thread summary** — a factual summary of one completed thread, created by a dedicated LLM call.

### Core Principles

- **Time-based thread boundary** — if no user message for >= `THREAD_TIMEOUT` (default: 3 hours), the next message starts a new thread.
- **Per-thread summarization** — when a new thread starts, all messages from the previous thread are compressed into a standalone summary via a dedicated LLM call. Each thread produces exactly one summary.
- **No rolling summary** — each summary is independent, covering only its own thread. This avoids contextual drift that occurs when summaries are recursively summarized (a known problem documented in LLM memory literature).
- **Last N summaries in prompt** — the 3 most recent thread summaries are included in the prompt, ordered from oldest to newest. This ensures context from recent training sessions is not lost even if unrelated chat threads happen in between.
- **Facts only, no style** — the summarization prompt extracts factual content (what was discussed, decisions made, user state) and explicitly strips response formatting and stylistic patterns.
- **Raw messages for current thread** — messages within the current thread are passed to the LLM as-is, preserving full conversational context.
- **No semantic topic detection** — thread boundaries are determined purely by time gap. Topic-based detection may be added later.

### Relationship to Other ADRs

- **ADR-0005** (Conversation Context): This ADR extends the `summarize()` and `summary` role already specified but not implemented. The `conversation_turns` table and `IConversationContextService` interface are preserved.
- **ADR-0009** (User Long-Term Memory): Permanent user facts are stored in `user_facts` and always injected into prompts. Thread summarization handles conversational context only — not permanent facts.
- The three systems are complementary and independent:
  - `user_facts` = permanent facts, always present, extracted by LLM tool call (ADR-0009)
  - `conversation_thread_summaries` = recent thread context, last 3 threads, auto-generated on thread boundary
  - Raw `conversation_turns` (current thread) = immediate context, temporary state

### Design Rationale

This approach combines two well-established LLM memory patterns:

- **SummaryBufferMemory** (summary + raw recent messages) — the recommended default for 80% of LLM applications per industry consensus. We use time-based thread boundaries instead of token limits, which better reflects real user behavior.
- **Entity Memory** (`user_facts`, ADR-0009) — for permanent facts that must never be lost.

Per-thread summaries (vs. rolling) were chosen because:
1. Rolling summaries degrade over time — each round of "summarize the summary" loses nuance (documented as "contextual drift")
2. Independent summaries are simpler to reason about, debug, and delete
3. Training context from 2 threads ago is preserved even if an unrelated chat thread happened in between

---

## Architecture

### Thread Detection and Summarization Flow

```
[getMessagesForPrompt(userId)]
  |
  +-- SELECT MAX(created_at) FROM conversation_turns
  |     WHERE user_id = ? AND summarized = false
  |
  +-- IF now() - lastActivity > THREAD_TIMEOUT
  |     +-- summarizeThread(userId)
  |     |     +-- Load unsummarized turns from conversation_turns
  |     |     +-- LLM call: summarize(turns) -> standalone summary
  |     |     +-- INSERT into conversation_thread_summaries
  |     |     +-- UPDATE conversation_turns SET summarized = true
  |     |        WHERE user_id = ? AND summarized = false
  |     +-- Generate new thread_id for the incoming message
  |
  +-- Load last 3 summaries from conversation_thread_summaries (ORDER BY created_at DESC LIMIT 3)
  +-- Load unsummarized turns (current thread)
  +-- Return: { summaries: [...], messages: [...] }
```

### Prompt Composition (per subgraph)

```
[SystemMessage: phase-specific system prompt]
[SystemMessage: "=== PREVIOUS CONTEXT ===\n" + summary1 + "\n---\n" + summary2 + "\n---\n" + summary3]
[HumanMessage/AIMessage: raw turns from current thread]
[HumanMessage: current user message]
```

Only the "PREVIOUS CONTEXT" block is new. Summaries are ordered oldest-to-newest. If no summaries exist, the block is omitted.

### DB Schema Changes

**Modify `conversation_turns`:**
- Add `thread_id UUID` — groups messages into a conversation thread
- Add `summarized BOOLEAN NOT NULL DEFAULT false` — marks turns included in a summary

**New table `conversation_thread_summaries`:**

```sql
CREATE TABLE conversation_thread_summaries (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  thread_id   UUID NOT NULL,
  summary     TEXT NOT NULL,
  turn_count  INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX ON conversation_thread_summaries(user_id, created_at DESC);
```

Multiple rows per user — one per completed thread. No UNIQUE constraint on `user_id`.

### Thread ID Assignment

- On each incoming message, check time gap from last turn
- Gap > `THREAD_TIMEOUT` → generate new UUID as `thread_id`, trigger summarization of previous thread
- Gap <= `THREAD_TIMEOUT` → reuse `thread_id` from the last turn

### Summarization Prompt

```
You are summarizing a fitness coaching conversation for internal context.

INPUT:
- Conversation messages from one session

OUTPUT — a concise summary (max 150 words) containing ONLY:
1. Topics discussed (training, nutrition, plans, goals)
2. Decisions made (plan chosen, exercises swapped, session scheduled)
3. User state mentioned (fatigue, soreness, mood, injuries)
4. Training feedback (weights felt heavy/light, pain, RPE impressions)
5. Open questions or unfinished topics

DO NOT include:
- Greetings, pleasantries, or filler
- Response formatting or style patterns
- How the coach addressed the user (by name, tone, emoji usage)
- Exact phrasing of coach responses

Write in the same language as the conversation.
```

### Interface Changes

**`IConversationContextService`** — modify `getMessagesForPrompt` return type:

```typescript
export interface ConversationHistory {
  summaries: string[];
  messages: ChatMsg[];
}

export interface IConversationContextService {
  appendTurn(userId: string, phase: ConversationPhase, userContent: string, assistantContent: string): Promise<void>;
  getMessagesForPrompt(userId: string, phase: ConversationPhase, options?: GetMessagesOptions): Promise<ConversationHistory>;
}
```

Subgraphs adapt to the new return type: if `summaries` is non-empty, prepend as a SystemMessage before raw history.

---

## Configuration

| Variable | Default | Description |
|---|---|---|
| `CONVERSATION_THREAD_TIMEOUT_MS` | `10800000` (3h) | Inactivity gap that triggers a new thread |
| `CONVERSATION_SUMMARY_MAX_WORDS` | `150` | Max words per thread summary |
| `CONVERSATION_SUMMARY_COUNT` | `3` | Number of recent thread summaries included in prompt |

---

## Phase 0: Session Gap Prompt Hint (pre-summarization)

Before implementing full thread summarization, a lightweight step can deliver the most visible UX improvement with minimal code changes: **detect the time gap since the last message and inject a behavioral directive into the system prompt**.

### Problem

When a user returns after hours or days, the LLM continues the conversation from exactly where it left off — mid-topic, no greeting, as if no time has passed. This feels unnatural. A human trainer would greet the client, ask how they're doing, and only reference past topics if relevant.

### Approach

1. **Detect time gap** — in `getMessagesForPrompt` (or a dedicated method), query `MAX(created_at)` from `conversation_turns` for the user. Calculate `gap = now() - lastMessageTime`.
2. **Inject prompt hint** — in `buildChatSystemPrompt` (and other subgraph prompt builders), add a conditional directive based on the gap:
   - Gap < 3 hours: no change (ongoing conversation).
   - Gap 3h–24h: "The user hasn't written for several hours. Start fresh — greet naturally, don't continue the previous topic directly. You may reference past context if relevant."
   - Gap > 24h: "The user hasn't written since [date]. This is a new conversation. Greet them, ask how they're doing. Use history only as background knowledge, not as a conversation to continue."
3. **Reduce history window** — when the gap is large, pass fewer history pairs to the LLM (e.g. last 3–5 instead of 20). This reduces the influence of stale messages on LLM behavior and saves tokens.

### Relationship to Full Implementation

This phase is a **complement**, not an alternative, to the full thread summarization described above. When threads and summarization are implemented:
- The prompt hint becomes redundant — thread boundaries naturally reset the conversation flow.
- The history trimming becomes redundant — only current-thread messages are loaded.

Phase 0 provides immediate value and can be shipped independently. It reuses the same `CONVERSATION_THREAD_TIMEOUT_MS` configuration variable for the gap threshold.

---

## Consequences

**Positive:**
- Prompt directive changes take effect immediately for new threads — old stylistic patterns are not inherited
- History is always relevant (current thread only) — less noise, better LLM responses
- Temporary user state (fatigue, soreness) naturally expires when a new thread starts
- Training context preserved across unrelated chat threads (last 3 summaries)
- Token usage reduced — 3 short summaries + few raw messages vs 40 raw messages
- No contextual drift — each summary is independent, no recursive summarization
- Simple mental model: like a human trainer remembering the last few conversations

**Negative / Risks:**
- Extra LLM call on thread boundary — adds latency to the first message of a new thread (~2-5s). Acceptable since it happens at most a few times per day per user.
- Summary quality depends on LLM — mitigated by simple factual extraction (no creative summarization needed)
- If summarization fails, fallback to raw sliding window (graceful degradation)
- Context older than 3 threads is lost — acceptable because permanent facts are in `user_facts` (ADR-0009) and training data is in dedicated tables

---

## Alternatives Considered

| Alternative | Why Rejected |
|---|---|
| Rolling summary (one cumulative summary per user) | Contextual drift — each re-summarization loses nuance. Training context can be overwritten by unrelated chat. |
| Post-process LLM responses (strip name, fix formatting) | Addresses symptoms, not root cause. Each new pattern deviation requires a new fix. |
| Reduce history window (e.g., 5 pairs) | Loses too much context. User references to earlier messages would be missed. |
| Inject reminder messages into history | Increases token count without solving the pattern inheritance problem. |
| Few-shot examples in system prompt | Helps but does not prevent pattern copying from 20+ historical examples. |
| Topic-based session detection via LLM | Extra LLM call per message. Time-based is sufficient for MVP; topic detection can be layered on later. |
| Limit summaries by total word count | Adds complexity without clear benefit. Fixed count (3) is simpler and predictable. |
| Knowledge graph (Zep-style) | Overkill for current scale. Can be considered when user base grows. |

---

## References

- ADR-0005: Conversation Context Session (extended by this ADR)
- ADR-0009: User Long-Term Memory (complementary, independent system)
- ADR-0007: LangGraph Gradual Migration (graph topology)
- Industry pattern: SummaryBufferMemory (LangChain) — summary + raw recent messages
- Research: SECOM (ICLR 2025) — segment-level memory construction
- Research: "Lost in the Middle" (TACL 2024) — LLM accuracy degradation in long context
