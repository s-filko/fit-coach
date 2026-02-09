# Conversation Context — Architecture Extension

How to implement conversation context (message history) **in a universal and practical way** with the current stack (LangChain, Fastify, Drizzle, domain/infra), following modern LLM application practices.

---

## 1. Fit with Your Stack

### LangChain

- You already use: `ChatOpenAI`, `HumanMessage`, `SystemMessage` from `@langchain/core` / `@langchain/openai`.
- **Important:** LangChain does not persist history between requests. It only accepts an array of messages and invokes the model. Storage is your responsibility.
- LangChain provides **`BaseChatMessageHistory`** (getMessages, addUserMessage, addAIChatMessage, clear). You can use it **in infra** as one possible storage backend (e.g. an implementation that writes to the DB). The domain must not depend on LangChain: the contract is your port with types `ChatMsg[]` / `ConversationTurn[]`.

### Summary for Libraries

- **Domain:** only your types and ports (no LangChain).
- **Infra LLM:** unchanged — receives `ChatMsg[]`, converts to `HumanMessage`/`SystemMessage`, calls `model.invoke([systemPrompt, ...messages])`. No signature change.
- **Infra context:** implementation of the “conversation context” port — your own store (DB/memory) or an adapter over LangChain `BaseChatMessageHistory` if desired.

---

## 2. Principles for Extending the Architecture

- **Single contract for context:** all flows (registration, chat, training) use the same port — load context, get messages for prompt, append turn, reset/summarize/start new phase.
- **LLM is unaware of storage:** the LLM service still receives a ready-made message list and system prompt; loading and saving history happen **before** and **after** the LLM call in one place (orchestrator).
- **Context keyed by (userId + phase):** the same abstraction for any stage; phase is set by the caller (e.g. `registration`, `chat`, `training`).
- **Testability:** port in domain; tests use a stub (in-memory or mock).

---

## 3. Where It Lives in the Project

### Domain (framework-agnostic)

New conversation-context module, no imports from infra or LangChain:

```
domain/
  conversation/           # or keep under user if context is always user-scoped
    ports/
      conversation-context.ports.ts   # types + IConversationContextService
      index.ts                        # re-export
```

In **conversation-context.ports.ts**:

- Types: `ConversationTurn`, `ConversationContext` (turns, summarySoFar?, phase, lastActivityAt?).
- Interface: `IConversationContextService` with methods:
  - `getContext(userId, phase): Promise<ConversationContext | null>`
  - `appendTurn(userId, phase, userContent, assistantContent): Promise<void>`
  - `getMessagesForPrompt(ctx, options?): ChatMsg[]` — sliding window (last N turns), optionally summary at the start.
  - `reset(userId, phase, options?): Promise<void>`
  - `summarize(userId, phase): Promise<void>` — optional, add later.
  - `startNewPhase(userId, fromPhase, toPhase, systemNote, options?): Promise<void>` — optional.
- Repository port (if you separate storage): `IConversationContextRepository` — get/save by (userId, phase). The infra service then uses this repository and implements window/summarization logic.

`ChatMsg` already exists in `domain/user/ports` (prompt.ports.ts) — reuse it or re-export from a shared place so the conversation domain does not depend on user; prefer a single shared type and import in conversation.

### Infra

Implementation of the port and, if needed, the repository:

```
infra/
  conversation/            # or infra/db/repositories + infra/conversation/ for the service
    conversation-context.repository.ts   # IConversationContextRepository impl (Drizzle)
    conversation-context.service.ts      # IConversationContextService impl
  db/
    schema.ts              # add table/columns for context (see below)
```

- **Repository:** load/save context entity (turns: JSONB, summarySoFar, updatedAt, etc.) by (userId, phase). CRUD only; no “how many turns to return” rules.
- **Service:** uses repository; implements `getMessagesForPrompt` (last N turns, and summary if present as first segment or separately); calls repository in appendTurn, reset, startNewPhase, summarize.

**Storage model — full history in one table (recommended):**

Use a single table that stores the **complete** dialogue (every user message and every assistant response) as rows. One source of truth for both:

- **Business logic / context for LLM:** the context service queries “last N turns” for the given (user_id, phase) and passes them to `getMessagesForPrompt`. No separate “context blob” to keep in sync.
- **History, analysis, debug:** the same table holds the full thread. Support or analytics can query deeper (e.g. full conversation, search, anomaly investigation) without a second store.

Example shape: `conversation_turns` with `user_id`, `phase`, `role`, `content`, `created_at`, and optionally `turn_index` or `session_id`. Append-only: each turn is one or two rows. The context service uses `ORDER BY created_at DESC LIMIT 2*maxTurns` (or equivalent) to feed the prompt; everything else stays for audit and analysis.

**Summary and system events — same table:**

Use the same `conversation_turns` table and extend `role` (or add `message_type`) to:

- `user` — user message  
- `assistant` — model reply  
- `system` — system event (e.g. “User completed registration. Starting training.” or “User started exercise 2.”). Stored as a row so the timeline is complete; the context service includes it in the prompt as a system or synthetic user message when building “last N” for the LLM.  
- `summary` — optional; one row per summarization. `content` holds the summarized text that replaces older user/assistant turns for context. When present, `getMessagesForPrompt` returns the **latest** summary row (by created_at) plus the last N `user`/`assistant` (and optionally `system`) rows after it, so the prompt has “summary of older conversation” + recent dialogue in order.

Chronological order is preserved; analytics and debug see full history including when summaries were created and when system events were injected. No second table: one schema, one source of truth.

Alternative patterns (e.g. one row per phase with a JSONB array of turns, or a separate “context cache” table) are possible, but a single full-history table is simple and covers both needs.

Other options (if you prefer not to keep full history in the same table):

- **Option A (blob per phase):** table `conversation_context` (user_id, phase, turns JSONB, summary_so_far text, updated_at). Simpler schema, but full history is in JSONB; querying “all messages for user” or “last 100 turns” is less natural.
- **Option B:** section in existing `user_context` (ADR-0004) under a key, e.g. `conversationByPhase[phase]`.

LangChain is optional here. If you later use `BaseChatMessageHistory`, implement a class that reads/writes your DB and implements addUserMessage/addAIChatMessage/getMessages; then the conversation-context service can use this adapter instead of a raw repository, converting BaseMessage ↔ your Turn/ChatMsg.

### App (routes, orchestration)

Current flow: route → userService → (registrationService | llmService). Add “load context” and “save turn” steps.

- **Where to call:** in the same place that currently calls the LLM (e.g. `chat.routes.ts` or a service that encapsulates “handle one chat message”). So the orchestrator is either the route or a thin “chat orchestration” domain service that calls userService, conversationContextService, registrationService, llmService.
- **Typical flow per request:**
  1. Determine `phase` (e.g. from `user.profileStatus`: while not complete → `registration`, else `chat`; for training → separate phase).
  2. `ctx = await conversationContextService.getContext(userId, phase)` (or create empty context if null).
  3. `historyMessages = conversationContextService.getMessagesForPrompt(ctx, { maxTurns: 20 })`.
  4. Build messages for LLM: `messages = [...historyMessages, { role: 'user', content: message }]`.
  5. Call existing LLM method (e.g. `generateResponse(messages, isRegistration)` or `generateRegistrationResponse(messages, context)`). Signatures stay the same — only `messages` now contains history + current.
  6. After receiving the response: `await conversationContextService.appendTurn(userId, phase, message, response)`.
  7. On phase change (e.g. registration complete): call `startNewPhase` or `reset` as per policy (see ADR-0005).

Context stays universal: same port and flow for registration, chat, and future training; only `phase` and which system prompt / LLM method differ.

---

## 4. Modern LLM Application Practices

- **Layered separation:** domain defines “what is needed for the prompt” (context interface); infra handles “how we store and slice the window”. The LLM layer only “how to send to the model”.
- **Sliding window:** for the first iteration, `getMessagesForPrompt(ctx, { maxTurns: 20 })` without summarization is enough. Add `summarize` and `summarySoFar` in the prompt when you need longer sessions or hit context limits.
- **Session/phase boundaries:** state transitions (registration → chat, start training) handled explicitly: reset or startNewPhase with a short system note so the model gets a clear context switch.
- **Request-scoped, no global singleton:** load and save context within a single request (or transaction) so the app can scale across instances.

---

## 5. Implementation Checklist

1. **Domain:** add `domain/conversation` (or a module under user), define types and `IConversationContextService` (+ `IConversationContextRepository` if needed).
2. **Infra:** implement repository (table or JSONB in user_context) and context service; register in DI.
3. **DB schema:** migration for context storage (user_id, phase, turns, summary_so_far, updated_at or equivalent in JSONB).
4. **Route/orchestrator:** at the LLM call site — load context, getMessagesForPrompt, call LLM with (history + current message), appendTurn after response. Derive phase from current user/app state.
5. **Optional:** time-based policies (e.g. reset with short recap after long idle) and `summarize` when turn count exceeds a threshold.

**Operational notes (orchestrator and failures):**

- **Single orchestrator:** LLM is called in two places today (route for chat, RegistrationService for registration). Use one orchestration point: load user → derive phase (in one place) → load context → build messages → call registration or LLM → append turn. Route only calls this orchestrator.
- **Idempotency:** Retries can duplicate a turn; use an idempotency key per request (skip append if key seen) or document for MVP.
- **Failure after LLM before append:** If the process dies after response but before appendTurn, the next request lacks that turn; retry/recovery or accept for MVP.
- **Transactions:** If profile update and append must be atomic, run both in one DB transaction; else document best-effort.
- **API_SPEC:** When adding history, update the "All conversations are stateless" note to stateful (server-side conversation history).

This keeps the extension universal, maintainable, and aligned with your layered architecture and ADR-0005.
