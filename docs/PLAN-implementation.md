# Implementation Plan

## Phase 1 — Bug Fixes + Dynamic Tools

All quick fixes plus BUG-008 Plan A. These are interdependent — dynamic tools and prompt changes solve multiple bugs at once.

### 1.1 Dead code removal (BUG-004) — [DONE]

Removed `generateStructured` from `llm.service.ts` and `ILLMService` interface. Removed `AIContextService` and `AI_CONTEXT_SERVICE_TOKEN` from `domain/ai/ports.ts`. Also removed dead `startNextExercise` method from `ITrainingService` and `TrainingService`.

### 1.2 Replay payload logging (BUG-003) — [DONE]

`LLMLogHandler` in `model.factory.ts` logs full replay payload (messages, tools, model, temperature) for every LLM call in debug mode. ndjson format in `logs/server.log`, field `replayPayload`.

### 1.3 Bot empty response guard (BUG-001) — [DONE]

Added `if (!aiResponse?.trim())` guard before `sendHtml` in `apps/bot/handlers.ts`. Logs warn, skips send.

### 1.4 skip_exercise (BUG-002) — [SUPERSEDED]

**Original plan:** Add optional `exercise_id` to `skip_exercise` tool schema.

**What happened:** After analysis, `skip_exercise` was deemed unnecessary in all practical scenarios. The tool was fully removed from code, tests, and documentation. Exercise transitions are handled by `log_set` (auto-completes previous exercise on switch) and `complete_current_exercise` (explicit completion). Skip requests are acknowledged in text with no DB write needed for unstarted exercises.

### 1.5 `finish_training` audit log (BUG-006) — [DONE]

Added `log.info({ audit: 'finish_training', userId, sessionId })` in `training.tools.ts`. Rule 7 in prompt rewritten to require explicit user confirmation.

### 1.6 Dynamic tools + prompt hardening (BUG-008, BUG-006, BUG-001) — [PARTIALLY DONE]

**Prompt changes — DONE:**
- RULE 0 (conversation priority — classify intent before calling tools)
- Rule 5 rewritten (never invent data, ask if 0 sets)
- Rule 6 softened (allow contextually obvious values from recent dialogue, e.g. weight just discussed)
- Rule 8 rewritten (tools triggered by user data only, not system state alone)
- Anti-patterns section added
- Rule 7 rewritten for `finish_training` (BUG-006: never as fallback, explicit confirmation only)
- `toolReplyDirective` added to all tool-using subgraphs via `composeDirectives`

**Dynamic tools — PARTIALLY DONE:**
- `delete_last_sets` / `update_last_set` hidden when 0 sets — DONE
- `log_set` hidden when no `in_progress` exercise — IMPLEMENTED THEN REVERTED (broke first-set logging because `logSetWithContext` creates the exercise on the fly)

**Programmatic guard — REMOVED:**
- Guard rejecting `log_set` + `complete_current_exercise` in same response was implemented then removed. `TOOL_PRIORITY` handles execution order deterministically, making the guard unnecessary and user-hostile.

### 1.7 Chat hallucination guard (BUG-009) — [DONE]

Anti-hallucination rule added to `chat.node.ts`: "You do NOT have log_set... NEVER write '✅', 'logged', 'saved', 'recorded'..."

`toolReplyDirective` added to `prompt-directives.ts` and composed into all tool-using subgraphs.

### Phase 1 — Validation — [DONE]

Manual testing performed: multiple training sessions via API. Bugs BUG-001, BUG-003, BUG-004, BUG-006, BUG-008, BUG-009, BUG-010 verified fixed. Chaotic non-linear testing performed. `skip_exercise` fully removed.

---

## Phase 2 — Muscle-Centric History (BUG-005) — [NOT STARTED]

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
- **BUG-011 — Chat LLM does not transition to training phase**: intermittent, needs prompt strengthening or programmatic check.
