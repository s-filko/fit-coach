# Training Phase: Architectural Analysis & Fix Plan

> **Status summary:** Most fixes are implemented. See `[DONE]` / `[SUPERSEDED]` / `[NOT DONE]` markers below.

## Versions: prod vs local

- `origin/main` (prod): commit `f291441`
- `origin/dev`: 1 commit ahead (docs only)
- Local `dev`: 6 commits ahead of main (5 unpushed)
- Delta in training-related files: **cosmetic refactoring only** (`prompt-directives`, client name in prompt). No training pipeline fixes between prod and local.
- **All bugs described below exist in both prod and local** — training subgraph code is identical.

## Incident Forensics — March 3rd (exact data from prod DB)

### Conversation timeline (key moments)

**Moment 1 — Tricep Pushdown: LLM jumped to next exercise after 1 set**

User: "32 - 12 reps, very easy" (this was the FIRST set)
LLM: logged as "Set 3", completed the exercise, moved to Lateral Raise
User: "that was the first set"
LLM: logged 2 more sets trying to "fix" (Sets 5-8 created)
User: "I haven't done the second set yet"
LLM: "sorry, now everything is correct"

**Moment 2 — Lateral Raise: LLM logged 1 set, closed exercise AND logged Bicep Curl — all in one response**

User: "on the lateral raise machine I did first set, 2.5 per side, 10 reps"
LLM in ONE response: logged Lateral Raise set 1 + COMPLETED Lateral Raise + logged Bicep Curl set 1
User: "I only did 1 set"
LLM: logged another set instead of understanding

**Moment 3 — Bicep Curl: total chaos with set counting**

User: "second set 14 reps at 20 kg"
LLM: "Set **5** saved" (instead of 2)
User: "I'm not done, there will be one more set"
LLM: logged "Set **6**" (no data from user!)
User: "sorry but I said two sets and you logged 6 instead of 2"
User: "no, the first was 15 kg and the second 20 kg"
LLM: logged "Set **7**" and "Set **8**" — even more duplicates

### Duplicate pattern by `session_sets.created_at` timestamps

```
Tricep Pushdown (target: 3 sets):
  Set 1: 04:05:17.364 — 32kg x12 ← real
  Set 2: 04:05:17.388 — 32kg x12 ← duplicate (gap 24ms, same LLM response)
  Set 3: 04:05:52.357 — 32kg x12 ← phantom (LLM "correcting")
  Set 4: 04:05:52.371 — 32kg x12 ← duplicate (gap 14ms)
  Set 5: 04:06:19.943 — 32kg x12 ← phantom (LLM "correcting" again)
  Set 6: 04:06:19.957 — 32kg x12 ← duplicate (gap 14ms)
  Set 7: 04:06:19.980 — 32kg x12 ← duplicate (gap 23ms)
  Set 8: 04:06:19.994 — 32kg x12 ← duplicate (gap 14ms)
  Set 9: 04:07:55.966 — 38kg x12 ← real
  Set10: 04:09:53.478 — 38kg x9  ← real

Dumbbell Bicep Curl (target: 3 sets):
  Set 1: 04:12:38.625 — 12kg x12 ← phantom (logged simultaneously with Lateral Raise set 1!)
  Set 2: 04:13:08.156 — 12kg x12 ← phantom
  Set 3: 04:21:18.828 — 12kg x12 ← phantom
  Set 4: 04:21:38.685 — 12kg x12 ← phantom
  Set 5: 04:23:39.229 — 20kg x14 ← real
  Set 6: 04:24:16.249 — 20kg x14 ← duplicate (LLM response to "I'm not done")
  Set 7: 04:25:51.601 — 15kg x10 ← real
  Set 8: 04:25:51.612 — 20kg x14 ← duplicate (gap 11ms, batch with set 7)
  Set 9: 04:27:40.028 — 20kg x10 ← real
```

Duplicates with gap < 100ms = single LLM response with multiple tool_calls.
Duplicates with gap 20-40s = LLM re-called log_set in the next turn due to user's corrective message.

## Failure Patterns

**P1. LLM prematurely calls `complete_current_exercise`** — after 1 set when target=3. Current CRITICAL RULE "at least one set" is too weak.

**P2. LLM logs for different exercises in one response** — logs Lateral Raise, completes it, and immediately logs Bicep Curl. User never asked for this.

**P3. LLM interprets corrections as commands to log** — "that was the first set" triggers more log_set calls. "I only did 1" triggers more log_set calls.

**P4. LLM cannot correct mistakes** — no delete/update tool exists, so every "correction" attempt creates more phantom sets.

## Root Causes (by criticality)

### Cause 1: LLM generates multiple log_set calls in one response with identical data

LLM receives "32 - 12 reps very easy" and generates **2 log_set tool_calls** with identical arguments. `sequentialToolNode` executes both (gap ~24ms). Duplicate appears in DB.

**Why no protection:** `sequentialToolNode` does not check for duplicates. `logSetWithContext` does not check for duplicates. `setNumber = MAX+1` is atomic, but that is exactly what allows duplicates to accumulate.

**Level:** Infrastructure. Fix with guardrail in `sequentialToolNode`.

### Cause 2: LLM interprets corrective messages as logging commands

User: "that was the first set" (correction).
LLM sees CURRENT PROGRESS with already-logged sets, but instead of responding "understood, already recorded" — calls log_set again with data from CONVERSATION HISTORY.

**Why:** The prompt has a rule "Call log_set ONLY for sets explicitly reported in the user's current message", but LLM interprets "that was the first set" as an implicit set report referencing data from previous context.

**Why this is architectural, not just prompt-engineering:** LLM has no correction tool. The only action for "fixing" is to add another log_set. No `delete_set`, no `edit_set`. LLM is forced to "re-log correctly", creating even more duplicates.

**Level:** Missing correction tool + insufficient prompt rules.

### Cause 3: `getMessagesForPrompt` does not filter by phase — [NOT DONE]

**File:** [drizzle-conversation-context.service.ts](apps/server/src/infra/conversation/drizzle-conversation-context.service.ts)

```typescript
.where(eq(conversationTurns.userId, userId))  // phase ignored!
```

In the March 3rd incident, all 44 recent messages were from the `training` phase, so this bug was NOT a direct cause. However, it is a **latent bug**: if the user had a long `chat`/`plan_creation` conversation before training, part of the 40-message window would be occupied by irrelevant history, displacing important training context.

**Level:** Latent, easy fix. Still pending.

### Cause 4: Tool call ordering does not guarantee log_set before complete_current_exercise — [DONE]

**File:** [training.subgraph.ts](apps/server/src/infra/ai/graph/subgraphs/training.subgraph.ts)

Fixed via `TOOL_PRIORITY` map and `sortToolCallsByPriority()`.

### Cause 5: No guard against excessive set count

`logSetWithContext` does not check `setNumber` against `targetSets`. Tricep Pushdown had target=3 but 10 sets were recorded without a single warning. LLM sees CURRENT PROGRESS with growing set count but lacks context that this is an anomaly.

**Level:** Missing business rule in service layer. **Decision: intentionally NOT implemented** — the LLM should be transparent about what was logged, and the user decides. The correction tools (`delete_last_sets`, `update_last_set`) handle mistakes.

## Fix Plan (execution order)

### Phase 1: Infrastructure Guards (prevent worst damage)

#### Fix 2: Deterministic tool call ordering — [DONE]

**File:** [training.subgraph.ts](apps/server/src/infra/ai/graph/subgraphs/training.subgraph.ts)

Priority map: `log_set` (0) → `complete_current_exercise` (1) → `delete_last_sets`/`update_last_set` (2) → `finish_training` (3). Within `log_set` — sort by `order` field.

Implemented as `TOOL_PRIORITY` constant + `sortToolCallsByPriority()` exported function with unit tests.

#### Fix 3: Pre-execution validation for duplicate log_set calls — [DONE]

**File:** [training.subgraph.ts](apps/server/src/infra/ai/graph/subgraphs/training.subgraph.ts)

Implemented as `findDuplicateLogSets()` — rejects all duplicate log_set calls (identical args including `order`) before execution. Returns `ToolMessage` with `LLM_ERROR_PREFIX` so LLM can self-correct.

#### Fix 7: Transparent exercise switching in ensureCurrentExercise — [DONE]

**Files:** [training.service.ts](apps/server/src/domain/training/services/training.service.ts), [service.ports.ts](apps/server/src/domain/training/ports/service.ports.ts), [training.tools.ts](apps/server/src/infra/ai/graph/tools/training.tools.ts)

`ensureCurrentExercise` returns `EnsureExerciseResult` with `autoCompleted` metadata. `logSetWithContext` propagates `autoCompleted`. Tool handler formats rich summary including all sets performed.

Additionally, `completeCurrentExercise` returns enriched `AutoCompletedExercise` with per-set details (`CompletedSetDetail`) so the LLM can provide coaching analysis.

### Phase 2: Correction Tools (give LLM a way out of errors) — [DONE]

#### Fix 6a: delete_last_sets tool — [DONE]

Implemented: tool + `TrainingService.deleteLastSets` + `SessionSetRepository.deleteById`. Returns deleted set details. Audit logging included.

#### Fix 6b: update_last_set tool — [DONE]

Implemented: tool + `TrainingService.updateLastSet`. setData merge logic (`{ ...existingSetData, ...updates }`) preserves unmodified fields. Returns before/after diff. Audit logging included.

#### complete_current_exercise: add optional exerciseId parameter — [SUPERSEDED]

**Original plan:** Add `exerciseId` to navigate to a specific exercise.

**What happened:** `exerciseId` parameter was added to `complete_current_exercise` (previously `next_exercise`), then removed during a later iteration. The tool was renamed to `complete_current_exercise` with an empty schema. Exercise navigation is handled entirely by `log_set` (auto-completes previous exercise via `ensureCurrentExercise` on switch) and explicit completion via `complete_current_exercise` (no exerciseId — always acts on current in_progress). The `startNextExercise` method was also removed as dead code.

### Phase 3: Prompt + Business Guards (teach LLM correct behavior)

#### Fix 5: Prompt rewrite — message classification + confirmation protocols — [DONE with modifications]

**File:** [training.node.ts](apps/server/src/infra/ai/graph/nodes/training.node.ts)

Implemented as RULE 0 (conversation priority) + RULE 1-10 + anti-patterns section. Key differences from plan:

- **Deletion protocol simplified:** No explicit confirmation step required before `delete_last_sets`. LLM uses judgment.
- **Update protocol simplified:** Same — no mandatory confirmation.
- **RULE 6 softened:** LLM may use contextually obvious values from recent dialogue (e.g. user said "bench 80 kg" then "did 8" — 80 kg is clearly implied). Plan originally required all data in current message only, but user feedback confirmed this was too strict for natural dialogue.
- **One-exercise-at-a-time rule removed:** `log_set` for a different exercise auto-completes the previous one via `ensureCurrentExercise`. This is intentional and works well.

#### ~~Fix 4: targetSets guard~~ REMOVED

Not needed. Correct decision, confirmed by testing.

### Phase 4: Latent Bugs

#### Fix 1: Phase filter in getMessagesForPrompt — [NOT DONE]

**File:** [drizzle-conversation-context.service.ts](apps/server/src/infra/conversation/drizzle-conversation-context.service.ts)

Add `eq(conversationTurns.phase, phase)` to WHERE clause. Latent bug, simple fix. Still pending.

### Cross-cutting: Audit Logging (Fix 8) — [DONE]

All mutating tool operations have `log.info({ audit: ... })` with full before/after data:

- `log_set` → `{ userId, sessionId, exerciseId, setNumber, setData, rpe, autoCompleted }`
- `delete_last_sets` → `{ userId, sessionId, exerciseId, count, deletedSets }`
- `update_last_set` → `{ userId, sessionId, exerciseId, setNumber, before, after }`
- `complete_current_exercise` → `{ userId, sessionId, exerciseId, setsLogged }`
- `finish_training` → `{ userId, sessionId }`
- dedup skip → `warn` level: `{ userId, duplicateIds }`

**Note:** `skipCurrentExercise` audit line from original plan is obsolete — `skip_exercise` tool was fully removed.

### Cross-cutting: Tests (Fix 9) — [DONE]

Unit tests written:
- `training.subgraph.unit.test.ts`: `sortToolCallsByPriority`, `findDuplicateLogSets`
- `training.tools.unit.test.ts`: `delete_last_sets`, `update_last_set`, `complete_current_exercise`
- `training-service-hardening.unit.test.ts`: `ensureCurrentExercise` auto-complete, `deleteLastSets`, `updateLastSet`
- `prompt-directives.unit.test.ts`: `composeDirectives`, `toolReplyDirective`

Integration test: `training.service.integration.test.ts`

## What We Do NOT Change

- `setNumber` in DB (atomic `MAX+1`) — correct implementation
- `sequentialToolNode` as a concept — correct, only improving it
- Graph/subgraph architecture — correct
- `TOOL EXECUTION RESULTS` mechanism — correct
- `buildToolResultsInjection` — correct
- `agentNode` general flow — correct (re-reads session from DB on every call)

## Pending Items

- **Fix 1 (phase filter)** — latent bug, not yet implemented
- **`skip_exercise` references in this document** — historical, tool was fully removed
- **`startNextExercise` references** — historical, method was removed as dead code
