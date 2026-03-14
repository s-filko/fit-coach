# Implementation Plan

## Phase 1 — Bug Fixes + Dynamic Tools

All quick fixes plus BUG-008 Plan A. These are interdependent — dynamic tools and prompt changes solve multiple bugs at once. Execute in this order:

### 1.1 Dead code removal (BUG-004)

Remove `generateStructured` from `llm.service.ts` and `ILLMService` interface. Remove `AIContextService` and `AI_CONTEXT_SERVICE_TOKEN` from `domain/ai/ports.ts`. Verify `tsc --noEmit`.

Files:
- `apps/server/src/infra/ai/llm.service.ts`
- `apps/server/src/domain/ai/ports.ts`

### 1.2 Replay payload logging (BUG-003)

Expand `LLMLogHandler` in `model.factory.ts` to log full replay payload (messages, tools, model, temperature) for every LLM call in debug mode. ndjson format in `logs/server.log`, field `replayPayload`.

Files:
- `apps/server/src/infra/ai/model.factory.ts`

### 1.3 Bot empty response guard (BUG-001)

Add `if (!aiResponse?.trim())` guard before `sendHtml` in both `/start` and general message handlers. Log warn, skip send.

Files:
- `apps/bot/handlers.ts`

### 1.4 `skip_exercise` with `exercise_id` (BUG-002)

Add optional `exercise_id` to tool schema. Service logic:
- `in_progress` → mark `skipped`
- `completed` → return error
- Not in `session_exercises` → return OK, no DB write

Files:
- `apps/server/src/infra/ai/graph/tools/training.tools.ts`
- `apps/server/src/domain/training/ports/service.ports.ts`
- `apps/server/src/domain/training/services/training.service.ts`

Tests:
- Unit test for skip by ID (3 states)

### 1.5 `finish_training` audit log (BUG-006)

Add `log.info({ audit: 'finish_training', userId, sessionId })` before `pendingTransitions.set(...)`.

Files:
- `apps/server/src/infra/ai/graph/tools/training.tools.ts`

### 1.6 Dynamic tools + prompt hardening (BUG-008, BUG-006, BUG-001)

**Dynamic tools** — in `agentNode`, filter tools before each `model.bindTools().invoke()`:

| State | Hide tools |
|---|---|
| No `in_progress` exercise | `log_set` |
| 0 sets for current exercise | `delete_last_sets`, `update_last_set` |

`finish_training`, `next_exercise`, `skip_exercise` — always available.

**Prompt changes** in `training.node.ts`:
- Add RULE 0 (conversation priority — classify intent before calling tools)
- Rewrite Rule 5 (never invent data, ask if 0 sets)
- Harden Rule 8 (ban HISTORY data as tool arguments)
- Add anti-patterns section
- Rewrite Rule 7 for `finish_training` (BUG-006: never as fallback, explicit confirmation only)

**Programmatic guard** in `sequentialToolNode` — reject `log_set` combined with `skip_exercise` or `next_exercise`.

Files:
- `apps/server/src/infra/ai/graph/subgraphs/training.subgraph.ts`
- `apps/server/src/infra/ai/graph/nodes/training.node.ts`

### 1.7 Chat hallucination guard (BUG-009)

Add rule to `chat.node.ts` prompt: "You cannot save sets. NEVER write '✅' or 'Recorded' or 'Logged'. If user reports sets after session ended — explain warmly, offer new session."

**Prompt for all tool-using subgraphs** (BUG-001): "When you call a tool, ALWAYS include a natural text reply. The user cannot see tool calls."

Files:
- `apps/server/src/infra/ai/graph/nodes/chat.node.ts`
- `apps/server/src/infra/ai/graph/nodes/session-planning.node.ts` (tool reply rule)
- `apps/server/src/infra/ai/graph/nodes/training.node.ts` (already in 1.6)

### Phase 1 — Validation

Run full test suite. Manual test: one real training session through Telegram bot. Check:
- No phantom sets (BUG-008)
- `skip_exercise` by name works (BUG-002)
- No premature `finish_training` (BUG-006)
- No empty responses (BUG-001)
- No false "✅ Recorded" in chat (BUG-009)
- Replay payload in logs (BUG-003)

If phantom sets still appear → proceed to Dual LLM (Plan B in `docs/PLAN-dual-llm-training.md`).

---

## Phase 2 — Muscle-Centric History (BUG-005)

Full plan: [`docs/PLAN-muscle-centric-history.md`](PLAN-muscle-centric-history.md)

Depends on Phase 1 (prompt changes in `training.node.ts` must be in place before rewriting history sections).

### 2.1 New types

Add `ExerciseSetHistory`, `ExerciseSessionHistory`, `MuscleGroupFatigue` to `domain/training/types.ts`.

### 2.2 Repository methods + SQL

Add `getMuscleGroupFatigue(userId)` and `getExerciseHistory(userId, exerciseId, primaryMuscles, opts)` to `IWorkoutSessionRepository` and implement with Drizzle. Integration tests.

### 2.3 Service methods

Add `getMuscleReadiness(userId)` and `getExerciseHistoryByMuscles(userId, exerciseId, primaryMuscles)` to `ITrainingService` and implement. Unit tests.

### 2.4 Training prompt — exercise history

In `training.subgraph.ts`: fetch history for current `in_progress` exercise's primary muscles on each message. In `training.node.ts`: replace `previousSession` with `exerciseHistory`, use JSON format in prompt.

### 2.5 Session planning prompt — muscle status

In `session-planning.subgraph.ts`: call `getMuscleReadiness`. In `session-planning.node.ts`: add `=== MUSCLE STATUS ===` section with JSON.

### 2.6 Cleanup

Remove `findLastCompletedByUserAndKey` from repository ports and implementation.

### Phase 2 — Validation

Manual test: change workout plan, start training — verify LLM sees exercise history from old plan. Verify session planning mentions under-trained muscle groups.

---

## Backlog

Not scheduled. Implement when needed.

- **BUG-007 — Retrospective subgraph**: plan at [`docs/PLAN-retrospective-subgraph.md`](PLAN-retrospective-subgraph.md). Deferred — rare scenario, can be addressed after core issues are fixed.
- **Dual LLM (Plan B for BUG-008)**: plan at [`docs/PLAN-dual-llm-training.md`](PLAN-dual-llm-training.md). Only if Phase 1 dynamic tools fail to prevent phantom sets.
- **Tech debt — migrate `getNextSessionRecommendation` to graph**: TODO in `register-infra-services.ts`. After migration, delete `LLMService` entirely.
- **ADR-0012**: document architectural decision (dynamic tools as Plan A, Dual LLM as Plan B). Write after Phase 1 validation confirms which approach works.
