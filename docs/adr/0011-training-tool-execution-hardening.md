# ADR 0011: Training Tool Execution Hardening

**Status**: PROPOSED  
**Date**: 2026-03-05  
**Deciders**: Product + Engineering  
**Extends**: ADR-0007 (LangGraph migration — training tools, Phase 5)

---

## Context

After deploying the training phase with LangGraph tool calling (ADR-0007, Phase 5), a production incident on March 3, 2026 revealed systemic issues in the training pipeline. A single workout session accumulated 23 sets in the database when only 13 were actually performed. The user spent more time correcting the bot than training.

### Observed failure patterns

**P1. Premature exercise transitions.** LLM called `next_exercise` after 1 set when the target was 3-4, then logged a phantom set for the next exercise — all in a single response.

**P2. Cross-exercise logging.** LLM generated `log_set` + `next_exercise` + `log_set` (for the new exercise) in one tool call batch. Due to non-deterministic execution order, the second `log_set` could land on the wrong exercise.

**P3. Correction-triggered phantom sets.** When the user said "that was my first set" (correcting a miscount), the LLM interpreted this as a new set report and called `log_set` again — creating duplicates. Without deletion tools, every correction attempt produced more phantom data.

**P4. No correction capability.** The LLM had no way to delete or update a logged set. The only available action was `log_set`, so "fixing" a mistake meant adding more incorrect records.

### Root causes in code

1. **`sequentialToolNode` sorting** ([training.subgraph.ts](../apps/server/src/infra/ai/graph/subgraphs/training.subgraph.ts)): only sorts `log_set` calls relative to each other (by `order` field). `next_exercise`, `skip_exercise`, `finish_training` are not ordered, so they can execute before `log_set` in the same batch.

2. **No batch deduplication**: if the LLM generates two `log_set` calls with identical `(exerciseId, reps, weight)` in one response, both execute (gap ~20ms).

3. **Silent exercise switching**: `ensureCurrentExercise` switches the `in_progress` exercise without closing the previous one, leading to multiple exercises in `in_progress` simultaneously. Neither LLM nor user see the switch.

4. **No correction tools**: ADR-0007 defined `log_set`, `next_exercise`, `skip_exercise`, `finish_training` — but no tools for deleting or updating sets.

5. **Insufficient prompt rules**: the system prompt's CRITICAL RULES did not distinguish between new set reports and correction messages.

6. **No audit logging**: `TrainingService` had zero log statements for any mutation, making post-incident analysis dependent on raw DB queries.

---

## Decision

Harden the training tool execution layer with eight categories of changes:

### 1. Deterministic tool call ordering

Assign execution priority to all training tools:

| Priority | Tools |
|----------|-------|
| 0 (first) | `log_set` |
| 1 | `next_exercise`, `skip_exercise` |
| 2 | `delete_last_sets`, `update_last_set` |
| 3 (last) | `finish_training` |

Within `log_set` calls, sort by the existing `order` field. This guarantees sets are logged before any exercise transition occurs in the same batch.

### 1b. Transparent exercise switching (ensureCurrentExercise)

`ensureCurrentExercise` currently switches the `in_progress` exercise silently when `log_set` targets a different `exerciseId`, leaving multiple exercises in `in_progress` simultaneously.

**Fix:** When `exerciseId` differs from the current `in_progress` exercise:
- Auto-complete the current exercise (`completed` if it has logged sets, `skipped` if 0 sets)
- Open the requested exercise as `in_progress`
- Return metadata about the switch: `{ autoCompleted: { exerciseId, exerciseName, setsLogged } }`
- Propagate through `logSetWithContext` to the tool response: `"Exercise 'Lateral Raise' auto-completed (4 sets). Set 1 logged for 'Bicep Curl': 10 reps @ 25 kg."`

The existing code already re-opens `completed`/`skipped` exercises when `log_set` targets them — Fix 1b adds proper closing of the *previous* exercise. No separate `reopen_exercise` tool is needed.

### 2. Pre-execution validation for duplicate log_set calls

Before executing tool calls, check all `log_set` calls for exact argument equality. If any two calls have identical arguments (including `order` or lack thereof), **reject ALL duplicate log_set calls** — none of them execute. Return a `ToolMessage` with an error explaining the issue and how to fix it (add unique `order` values, or send a single call).

The LLM sees the rejection in the next `agent → tools` cycle and self-corrects: either by sending a single call (it was a bug) or by adding proper `order=1, order=2` fields (legitimate multiple sets with the same weight). This ensures **zero incorrect records** are written to the database — the LLM decides intent, not the server.

Validation applies **only within a single LLM response**. Identical sets across different turns are allowed (user may perform multiple sets with the same weight).

### 3. Correction tools

Two new tools extend the training toolset:

**`delete_last_sets(exerciseId, count?)`**
- Physically deletes the `count` most recent sets (by descending `set_number`) for the specified exercise
- `exerciseId` is required — eliminates risk of cross-exercise deletion
- `count` defaults to 1, capped at 10
- LLM does not specify `setNumber` — the server resolves `MAX(set_number)` and deletes top-down
- Validation: `exerciseId` must belong to the current session; `count` must not exceed actual set count
- Returns details of deleted sets for LLM to relay to the user
- **Status after deleting ALL sets:** if all sets are removed, exercise status is set to `in_progress`. If subsequently closed without new sets (via `next_exercise` or `skip_exercise`), it becomes `skipped`

**`update_last_set(exerciseId, updates)`**
- Updates the most recent set (MAX `set_number`) for the specified exercise
- Accepts partial updates: `{ rpe?, feedback?, weight?, reps? }`
- LLM does not specify `setNumber` — server resolves the last set
- **setData merge:** `weight` and `reps` live inside the jsonb `setData` column. `TrainingService.updateLastSet()` reads the existing `setData`, merges only the changed fields (`{ ...existingSetData, ...updates }`), and writes back. This prevents `update_last_set({ weight: 15 })` from losing the `reps` value
- Returns before/after diff for LLM to relay to the user

Both tools follow the same architectural pattern as existing tools: thin wrappers that call `TrainingService` methods, which in turn call repository methods.

### 3b. next_exercise with optional exerciseId

Current `next_exercise` has an empty schema and always picks the first `pending` exercise. Add an optional `exerciseId` parameter:

- If `exerciseId` is provided: complete the current exercise, then find the specified exercise in the session and set it to `in_progress` (reopening it if it was previously `completed` or `skipped`). If not found in session, create it from the plan.
- If `exerciseId` is omitted: current behavior (first `pending` exercise in plan order).

This enables the user to navigate back to a previously completed exercise ("let's go back to Lateral Raise") without having to log a set first. Combined with Fix 1b (auto-complete on switch), exercise navigation is fully transparent.

### 4. Prompt hardening

Add three protocol sections to the training system prompt:

**Message Classification** — before calling any tool, the LLM must classify the user's message as: (A) new set report, (B) correction, (C) question/chat, (D) exercise transition, (E) session end. Only type A triggers `log_set`. Type B uses `delete_last_sets` or `update_last_set`. If ambiguous, ask the user before calling any tool.

For type A (new set report): if the exercise name does not match the current in-progress exercise, is unclear, or the user names an unknown exercise — do NOT log. Ask one clarifying question first: "Hammer Strength Bicep Curl, 15 kg x 10 — first set, correct?" Never silently substitute one exercise for another.

**One Exercise At A Time** — never log a set for an exercise that is not `in_progress`. Never call `next_exercise` + `log_set` for the new exercise in the same response.

**Deletion/Update Protocols** — before calling `delete_last_sets` or `update_last_set`, the LLM must list the affected sets with full details from CURRENT PROGRESS and wait for explicit user confirmation.

### 5. Transparent set confirmation (no server-side set count guard)

No server-side guard on set count. The LLM must always clearly report what was logged ("Logged set 4: 10 reps @ 30 kg") and show current progress. If the user disagrees, they will say so — Fix 5 (message classification) catches corrections, Fix 6a/6b provides correction tools. The server never second-guesses the user's intent to do more sets than planned.

### 6. Structured audit logging

All mutations in `TrainingService` are logged via `createLogger('training')` at `info` level with structured data:

- `logSet`: userId, sessionId, exerciseId, setNumber, setData
- `deleteLastSets`: userId, sessionId, exerciseId, deleted set details
- `updateLastSet`: userId, sessionId, exerciseId, before/after diff
- `completeCurrentExercise`: userId, sessionId, exerciseId
- `skipCurrentExercise`: userId, sessionId, exerciseId, reason
- `ensureCurrentExercise` (auto-complete): userId, sessionId, prevExerciseId, newExerciseId, setsLogged, newStatus

Dedup rejections in `sequentialToolNode` are logged at `warn` level.

Format: pino ndjson (one structured JSON line per event). Enables full mutation timeline reconstruction during incidents.

---

## Architecture

### Tool execution flow (after hardening)

```
LLM response with tool_calls
       │
       ▼
  ┌─────────────┐
  │ Sort by      │  Fix 2: deterministic ordering
  │ priority map │  (log_set → transition → correction → finish)
  └──────┬──────┘
         │
         ▼
  ┌──────────────┐
  │ Validate      │  Fix 3: reject identical log_set calls
  │ log_set batch │  Return error → LLM retries with correction
  └──────┬───────┘
         │
         ▼
  ┌──────────────────┐
  │ Execute           │  Existing: sequential execution
  │ sequentially      │  log_set → ensureCurrentExercise (Fix 7:
  │                   │  auto-complete on switch) → TrainingService
  │                   │  → Repository → DB
  └──────┬───────────┘
         │
         ▼
  ToolMessage results → back to LLM
  (includes auto-complete notices from Fix 7)
```

### Affected files

| File | Changes |
|------|---------|
| `apps/server/src/infra/ai/graph/subgraphs/training.subgraph.ts` | Tool ordering, batch dedup validation, dedup audit log |
| `apps/server/src/infra/ai/graph/tools/training.tools.ts` | `delete_last_sets`, `update_last_set` tool definitions; `next_exercise` exerciseId param; auto-complete notice in `log_set` response |
| `apps/server/src/infra/ai/graph/nodes/training.node.ts` | Prompt rewrite (message classification, protocols) |
| `apps/server/src/domain/training/services/training.service.ts` | `deleteLastSets()`, `updateLastSet()` methods; `ensureCurrentExercise` auto-complete + return type; `startNextExercise` exerciseId param; audit logging |
| `apps/server/src/domain/training/ports/service.ports.ts` | `EnsureExerciseResult` type; `startNextExercise` signature update |
| `apps/server/src/infra/db/repositories/session-set.repository.ts` | `deleteById()` method |
| `apps/server/src/infra/conversation/drizzle-conversation-context.service.ts` | Phase filter in `getMessagesForPrompt` |

### Relationship to other ADRs

- **ADR-0007** (LangGraph migration): this ADR extends the training tool set and hardens the execution layer introduced in Phase 5. `TrainingService` method pattern is preserved.
- **ADR-0010** (Conversation thread summarization): the phase filter fix (cause 5) is an interim solution. When ADR-0010 is implemented, thread-scoped messages will naturally replace the phase filter. The two are compatible.
- **ADR-0008** (Centralized logging with Grafana Loki): audit logs use the same `createLogger()` / pino ndjson format. Compatible with Loki ingestion.

---

## Consequences

**Positive:**
- Duplicate sets from single LLM responses are impossible (batch dedup validation)
- Cross-exercise logging from tool ordering bugs is impossible (deterministic sort)
- Exercise status leaks are impossible — auto-complete ensures exactly one `in_progress` exercise at a time (Fix 1b)
- LLM can correct mistakes instead of compounding them (delete/update tools)
- User confirmation required before destructive actions (deletion protocol)
- Exercise navigation is flexible — user can go back to any exercise via `next_exercise(exerciseId)` or implicit switch via `log_set`
- Full mutation audit trail for incident investigation (structured logging)

**Negative / Risks:**
- Pre-execution validation rejects all duplicate log_set calls and forces LLM to retry, adding one extra LLM call. Mitigation: this only triggers when LLM sends identical calls (a bug pattern), costing one retry cycle but preventing incorrect data. Legitimate identical sets pass on retry with unique `order` values.
- Prompt rules (message classification, protocols) depend on LLM compliance. Mitigation: server-side guards (dedup, ordering, auto-complete) provide hard protection regardless of LLM behavior.
- `delete_last_sets` with `count > 1` removes multiple sets atomically. Mitigation: max cap of 10; deletion protocol requires explicit user confirmation before execution.
- Auto-complete on switch may close an exercise the user intended to return to. Mitigation: the exercise can be reopened immediately by targeting it with `log_set` or `next_exercise(exerciseId)`. The auto-complete notice in the tool response makes the switch visible.

---

## Execution Order

```
Phase 1: Infrastructure guards
  Fix 2 (tool ordering) → Fix 3 (batch dedup validation)
  Fix 7 (ensureCurrentExercise auto-complete on switch)

Phase 2: Correction tools + exercise navigation
  Fix 6a (delete_last_sets) + Fix 6b (update_last_set)
  next_exercise(exerciseId) parameter

Phase 3: Prompt + business guards
  Fix 5 (prompt rewrite — message classification, protocols)

Phase 4: Latent bugs
  Fix 1 (phase filter in getMessagesForPrompt)

Cross-cutting:
  Fix 8 (audit logging) — woven into each fix
  Fix 9 (tests) — written alongside each fix
```

Dependencies: Fix 3 depends on Fix 2 (ordering must be correct before dedup). Fix 5 depends on Fix 6a/6b and Fix 7 (prompt references correction tools and auto-complete behavior). All other fixes are independent.

---

## Alternatives Considered

| Alternative | Why Rejected |
|---|---|
| Soft delete (mark sets as `deleted=true`) instead of hard delete | Adds complexity without benefit for MVP. `setNumber` recomputation would require filtering deleted rows everywhere. Hard delete keeps `MAX(set_number) + 1` logic clean. |
| Expose set UUIDs in prompt for precise deletion | UUIDs are 36 chars each, expensive in tokens. LLM might hallucinate IDs. `delete_last_sets(exerciseId, count)` is simpler and doesn't require LLM to track IDs. |
| Use `(exerciseId, setNumber)` as deletion key | LLM has demonstrated unreliable set counting. Requiring it to specify exact setNumbers for deletion risks deleting wrong sets. "Delete last N" is safer. |
| Allow LLM to call `delete_last_sets` without user confirmation | Destructive action without confirmation is risky. Deletion protocol adds one round-trip but prevents accidental data loss. |
| Fix only the prompt (no server-side guards) | Prompt rules depend on LLM compliance, which is not guaranteed. Server-side dedup and ordering provide hard protection. Defense in depth. |

---

## References

- ADR-0007: LangGraph Gradual Migration (training tools, Phase 5)
- ADR-0008: Centralized Logging with Grafana Loki
- ADR-0010: Conversation Thread Summarization
- Incident data: `docs/PLAN-training-phase-fix.md` (forensics and implementation plan)
