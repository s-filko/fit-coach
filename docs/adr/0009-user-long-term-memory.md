# ADR 0009: User Long-Term Memory (Persistent Facts)

**Status**: PROPOSED  
**Date**: 2026-02-24  
**Deciders**: Product + Engineering

---

## Context

The AI coach accumulates valuable user-specific knowledge during conversations that is currently lost between sessions. Users naturally share permanent facts about themselves at any point in the conversation:

- Physical constraints: *"I can't do barbell squats — my back can't handle it"*
- Preferences: *"I like alternating exercises for the same muscle group — pull-ups one time, lat pulldown another"*
- Physiological patterns: *"My DOMS always peaks the day after a workout, not immediately"*
- Coaching preferences: *"I like when you remind me what I did last time on this exercise before starting a new session"*

These facts are:
1. **Permanent** — they don't change session to session (unlike current workout state)
2. **Cross-phase** — relevant in registration, chat, plan creation, and training phases
3. **High-signal** — knowing them upfront makes coaching significantly more personalized
4. **Currently lost** — conversation history is capped (maxTurns), so old facts disappear

Without persistent memory, the coach repeats questions, ignores stated constraints, and fails to adapt the coaching style the user explicitly asked for.

---

## Decision

Implement a **passive always-on memory extraction layer** that listens to every conversation turn, extracts persistent user facts, stores them in a dedicated `user_facts` table, and injects the relevant facts into every phase prompt.

### Core Principles

- **Passive extraction** — no explicit user action required. Memory is extracted automatically from natural conversation.
- **LLM-driven extraction** — a small dedicated LLM call classifies whether a turn contains a storable fact.
- **Atomic facts** — each memory is a single, short, rephrased fact in third-person coach notation. No raw quotes.
- **Deduplication** — before storing, check for semantic overlap with existing facts and skip or replace.
- **Always injected** — all stored facts are prepended to every phase system prompt in a `## User Facts` section.
- **No UI required** — fully transparent to the user. Facts are extracted and used silently.

---

## Fact Categories

| Category | Description | Example (stored form) |
|---|---|---|
| `physical_constraint` | Body limitations, injuries, medical restrictions — **always respected, never overridden** | "Cannot do barbell squats — lower back injury" |
| `exercise_preference` | Preferred exercises, styles, variations, personal names for equipment | "Prefers alternating exercises per muscle group across sessions (e.g. pull-ups / lat pulldown)"; "Calls the calf raise machine 'the blue machine'" |
| `exercise_dislike` | Exercises or muscle groups the user dislikes — **use as motivation anchor, not avoidance** | "Dislikes leg day"; "Does not enjoy isolation exercises" |
| `physiological_pattern` | Personal recovery, response patterns | "DOMS peaks day 2 after training, not day 1" |
| `coaching_preference` | How the user wants to be coached | "Wants previous set history shown before starting each exercise in a session" |
| `schedule_constraint` | Availability, training days, timing | "Can only train Mon/Wed/Fri, works late on Tuesdays" |
| `equipment` | Available equipment, gym access | "Has access to full gym, no home equipment" |
| `nutrition_preference` | Dietary notes relevant to coaching | "Does not eat meat, high-protein plant-based diet" |

---

## Architecture

### Extraction: `remember_fact` tool in every subgraph

Memory extraction is built into the main LLM call — no separate LLM invocation needed.
Each phase subgraph exposes a `remember_fact` tool alongside its phase-specific tools.
The LLM decides autonomously whether a fact is worth storing and calls the tool only when needed.

```
[Any phase subgraph — agentNode]
  │
  ├── model.bindTools([...phaseTools, remember_fact])
  │
  ├── LLM sees conversation + user message
  │   → decides: is there a permanent fact here?
  │   → if yes: calls remember_fact({ fact, category })
  │   → if no: responds with text, no tool call
  │
  └── ToolNode executes remember_fact
        → dedup check against existing user_facts
        → INSERT into user_facts if new
        → returns confirmation string to LLM
```

**Why this approach:**
- Zero additional LLM calls — memory is free (uses the main call's context)
- LLM already has full conversation context — better judgment than a separate classifier
- Same pattern as all other tools — no new infrastructure needed
- When scale requires it, extraction can be moved to a background job queue without changing the interface (`IUserFactsService` stays the same)

### Injection Flow

```
[Any phase subgraph — agentNode]
  │
  ├── contextService.getMessagesForPrompt() — existing conversation history
  │
  ├── userFactsService.getFactsForPrompt(userId) — NEW
  │   Returns: string[] of fact strings, formatted for prompt
  │
  └── System prompt = [phase system prompt] + [## User Facts section] + [history]
```

### DB Schema

```sql
CREATE TABLE user_facts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category    TEXT NOT NULL,   -- FactCategory enum value
  fact        TEXT NOT NULL,   -- rephrased, concise, coach-notation fact
  source_turn_id UUID,         -- optional: which conversation_turn triggered this
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX ON user_facts(user_id);
```

### Interfaces

```typescript
// domain/user/ports/user-facts.ports.ts

export type FactCategory =
  | 'physical_constraint'   // hard constraint — never override
  | 'exercise_preference'   // soft preference — apply when choice exists
  | 'exercise_dislike'      // motivational cue — acknowledge, do not avoid
  | 'physiological_pattern'
  | 'coaching_preference'
  | 'schedule_constraint'
  | 'equipment'
  | 'nutrition_preference';

export interface UserFact {
  id: string;
  userId: string;
  category: FactCategory;
  fact: string;
  createdAt: Date;
}

export interface IUserFactsService {
  store(userId: string, fact: string, category: FactCategory): Promise<void>;
  update(factId: string, fact: string): Promise<void>;
  getAll(userId: string): Promise<UserFact[]>;
  getFactsForPrompt(userId: string): Promise<string[]>;
}
```

### `remember_fact` Tool

Zod schema:
```typescript
z.object({
  fact: z.string().describe(
    'Concise fact in third-person coach notation. E.g. "Cannot do barbell squats — lower back injury"'
  ),
  category: z.enum([...FactCategory values...]),
  replaces_fact_id: z.string().uuid().optional().describe(
    'If this fact contradicts or updates an existing one, provide its ID to replace it.'
  ),
})
```

The tool:
1. If `replaces_fact_id` provided — updates the existing fact in `user_facts`
2. Otherwise — inserts new fact
3. Returns `"Noted: [fact]"` or `"Updated: [old] → [new]"` as ToolMessage

**Deduplication is handled by the LLM, not by code.**
The `## User Facts` section is always present in the system prompt — the LLM already sees all existing facts before deciding to call `remember_fact`. The prompt instructs it:

```
## Memory
If the user shares a permanent fact about themselves (physical constraint, preference,
physiological pattern, coaching preference) — call remember_fact ONLY if:
- This fact is NOT already covered in the User Facts section above, OR
- It CONTRADICTS an existing fact — in that case provide replaces_fact_id to update it.

Do NOT store: temporary state (today's weight, today's workout progress, one-time events).
```

No vector search needed — a user accumulates at most ~50 facts total, and the LLM reading
the full list has far better semantic understanding than any similarity metric.

### Prompt Injection Format

```
## User Facts (permanent — always apply)
- [physical_constraint] Cannot do barbell squats — lower back injury
- [exercise_dislike] Dislikes leg day
- [exercise_preference] Calls the calf raise machine "the blue machine"
- [coaching_preference] Wants previous set history shown before each exercise
- [physiological_pattern] DOMS peaks day 2, not day 1
```

Injected after the phase-specific system prompt instructions, before conversation history.

### Fact Category Behavior Rules (injected into all phase prompts)

```
## User Facts — How to apply them

[physical_constraint] — HARD RULE. Never suggest, never include in plan, never override.
  Always substitute with a safe alternative. No exceptions.

[exercise_dislike] — MOTIVATIONAL CUE. Do NOT avoid the session or exercise.
  Instead, acknowledge the dislike and use it to engage and motivate.
  Example: "I know you're not a fan of leg day — but this is exactly what drives
  the hormonal response that grows your shoulders too. Let's make it count."
  Never silently skip a planned session because of a dislike fact.

[exercise_preference] — SOFT PREFERENCE. Apply when there is a choice between
  equal alternatives. Do not over-index — vary exercises for stimulus diversity
  while respecting the preference.
  If the user has given personal names to equipment — always use those names.

[coaching_preference] — Apply to coaching style in all interactions.

[physiological_pattern] — Apply to recovery estimates and session timing advice.
```

### Temporary Session Context

Some user statements are time-bound and must NOT be stored as permanent facts:
- *"today I'm not in the mood for heavy exercises"*
- *"severe DOMS from yesterday"*
- *"I'm a bit tired today"*

These are handled by the existing conversation history mechanism — they live in `conversation_turns` and are visible to the LLM via `getMessagesForPrompt()` for as long as they remain within the sliding window. No separate storage needed.

**However, the LLM must be explicitly instructed to act on them.** Each phase prompt (especially `session_planning` and `training`) must include:

```
CONTEXT AWARENESS:
Always read the recent conversation history before responding.
If the user mentions temporary state (fatigue, soreness, mood, minor injury today)
— adapt your response immediately: suggest lighter alternatives, reduce volume,
acknowledge the state before proceeding.
Do NOT call remember_fact for temporary states.
```

This is a **prompt engineering requirement**, not an architectural one. It must be verified during testing of Steps 6 and 7 (session_planning and training subgraphs): the LLM should demonstrably adapt session recommendations when the user mentions soreness or fatigue earlier in the conversation.

---

## Integration with LangGraph (ADR-0007)

- **No new graph node needed** — `remember_fact` is just another tool in each subgraph's `bindTools([...phaseTools, remember_fact])`.
- **`agentNode` in each subgraph**: calls `userFactsService.getFactsForPrompt(userId)` and prepends result to system prompt.
- **`IUserFactsService`** registered in DI container, injected into each subgraph's deps alongside existing deps.
- **Plan Creation constraint enforcement**: plan creation prompt explicitly instructs the LLM to never include exercises that conflict with stored `physical_constraint` facts.
- **Scalability path**: if extraction volume grows, `remember_fact` tool can enqueue a background job instead of writing synchronously — `IUserFactsService` interface stays the same, only the implementation changes.

---

## Implementation Plan (within ADR-0007 migration)

This feature is implemented **after Step 7 (Training subgraph)**, as it touches all phases:

- **Step 9.5** (between cleanup and done):
  1. DB migration: `user_facts` table
  2. `IUserFactsService` interface + `UserFactsService` implementation (`store`, `getFactsForPrompt`)
  3. `remember_fact` tool implementation (dedup + insert)
  4. Add `remember_fact` to `bindTools([...])` in all 5 subgraph `agentNode`s
  5. Add `## Memory` instruction to all 5 phase system prompts
  6. Inject `getFactsForPrompt` result into all 5 `agentNode` system prompts
  7. Unit tests: `remember_fact` tool (mock service, dedup logic), `getFactsForPrompt`, prompt injection
  8. Integration test: say constraint → next invocation prompt contains it

---

## Consequences

**Positive:**
- Coaching quality improves significantly over time — the coach "remembers" the user
- Physical constraints are automatically respected in plan generation
- No repeated questions about already-stated preferences
- Coaching style adapts to stated preferences without manual configuration

**Negative / Risks:**
- False positives (storing temporary state as facts) — mitigated by explicit "do NOT store" prompt instructions
- Contradicting facts (user changes their mind) — handled via `replaces_fact_id` in the tool schema; LLM identifies the conflict and replaces the old fact
- Prompt injection: user tries to inject instructions as "facts" — mitigated by category enum constraint and fixed prompt structure; `remember_fact` only stores the `fact` string field, not executable instructions

---

## Alternatives Considered

| Alternative | Why Rejected |
|---|---|
| Separate LLM call after every turn | Extra cost per turn (~95% wasted on turns with no facts) |
| Batch job (cron) | Load spikes when many users; latency between fact mention and storage |
| Background job queue (PostgreSQL SKIP LOCKED) | Good for scale, but adds infrastructure complexity; premature for current user count. Scalability path documented above. |
| Store raw conversation quotes | Too verbose, hard to use in prompts, no dedup |
| User-editable fact list (UI) | Requires explicit user action, friction, out of scope |
| Vector DB (embeddings) for semantic search | Overkill; user has <50 facts total. LLM reading the full list has better semantic understanding than cosine similarity. |
| Code-level string dedup (ILIKE, Levenshtein) | Language-agnostic matching fails across synonyms and languages. LLM dedup is more accurate. |
| Store facts in `users` table as JSONB | Schema pollution, no per-fact metadata |

---

## References

- ADR-0007: LangGraph Migration (graph topology this integrates into)
- ADR-0005: Conversation Context Session (conversation_turns table)
- FEAT-0009: Conversation Context
