# FitCoach — Bug Tracker

> This file tracks bugs found during manual and automated testing.
> Each entry must include: root cause, logs/DB evidence, impact, and fix status.
> Do NOT close a bug without a confirmed fix and regression test.

---

## BUG-001 — Empty API response when LLM calls `request_transition` without accompanying text

**Status:** Open  
**Severity:** High  
**Found during:** Manual test run 2026-03-12, Scenario 3.1  
**Component:** `apps/server/src/infra/ai/graph/nodes/chat.node.ts`, `apps/bot/handlers.ts`

### Description

When the user sends a message that triggers a phase transition (e.g. "I want to train today"), the chat-phase LLM calls `request_transition` as a tool but returns no accompanying text. The server returns `{ data: { content: "" } }`. The Telegram bot then calls `bot.sendMessage(chatId, "")` which Telegram API rejects with `400 Bad Request: message text is empty`. The bot's catch block sends "Sorry, there was an error while communicating with the coach. Please try again in a minute." to the user.

### Root cause

The chat node prompt instructs the LLM:

```
ALWAYS use this tool — never describe workouts yourself from chat.
```

The LLM interprets this as "call the tool only, no text needed". LangGraph's `extractNode` reads the last `AIMessage.content` which is `""` (tool-only response) and sets `responseMessage = ""`. The API route returns this as-is with no guard.

### Flow

```
User: "I want to train today"
  → chat subgraph agent node
  → LLM calls request_transition({ toPhase: "session_planning" }) — NO text
  → tools node executes request_transition, writes to pendingTransitions
  → agent node re-runs LLM (second call)
  → LLM returns "" (empty, or sometimes another tool-only response)
  → extractNode sets responseMessage = ""
  → API returns { data: { content: "" } }
  → bot calls bot.sendMessage(chatId, "") → Telegram 400 error
  → bot catch: sends "Sorry, there was an error..."
```

### Log evidence

Server log shows `responseLength: 536` on the SECOND call (after the retry message "Let's start training") — meaning the first call that returned `""` produced no log entry for response content, only a `request completed` with `statusCode: 200`.

Bot log would show a Telegram API 400 error on `sendMessage` with empty text, followed by the error fallback message.

### DB evidence

No `conversation_turns` row is written for empty responses — `persist.node.ts` skips persistence when `!responseMessage`. Confirms the response was indeed empty.

### Impact

- **User experience:** User writes "I want to train" and receives "Sorry, there was an error" — high frustration, breaks trust in the product.
- **Reliability:** Affects every first message in a phase transition from chat → session_planning and chat → plan_creation.
- **Silent failure:** Server returns 200 OK, so no alerting fires. The error is invisible at the infrastructure level.

### Additional finding

The problem is wider than `request_transition` in chat phase. At least 6 instances of `responseLength: 0` were found in a single test run, including **training phase** — LLM calls `log_set` (tool-only response) and returns no text. Any tool-only response without accompanying text creates an empty `responseMessage`.

### Fix plan

**Root cause:** LLM treats tool call as sufficient response and omits text. This is a model behavior issue, not a code bug. Two layers:

1. **Prompt fix** — in every subgraph that has tools (chat, session_planning, plan_creation, registration), add rule:
   ```
   When you call a tool, you MUST ALWAYS include a natural text reply in the same message.
   The user cannot see tool calls — they only see your text. Silent tool calls are invisible to them.
   ```

2. **Bot guard** — in `apps/bot/handlers.ts` before `sendHtml` (lines 92 and 128):
   ```typescript
   if (!aiResponse?.trim()) {
     log.warn({ userId, chatId }, 'Empty AI response — skipping send');
     return;
   }
   ```
   This is not a UX fix — it prevents Telegram API 400 errors. The user sees nothing (silence), which is better than "Sorry, there was an error."

3. **Training phase** — resolved architecturally. In the dynamic tools + prompt approach (BUG-008 fix), the prompt restructuring ensures LLM always produces text. If we proceed to Dual LLM (Plan B), the trainer LLM has no tools and always generates text.

### Regression test

After fix: send "I want to train today" — expect a non-empty text response AND `session_planning` phase transition in the same turn. Verify `conversation_turns` row is persisted with non-empty content. Verify no Telegram 400 errors in bot logs.

---

---

## BUG-002 — `skip_exercise` skips the currently `in_progress` exercise, not the named one

**Status:** Open  
**Severity:** Medium  
**Found during:** Manual test run 2026-03-12, Scenario 9  
**Component:** `apps/server/src/infra/ai/graph/tools/training.tools.ts`, `apps/server/src/infra/ai/graph/nodes/training.node.ts`

### Description

User asked to skip "Dumbbell Row". The LLM called `skip_exercise` but the exercise that was marked `skipped` in the DB was Lat Pulldown (ID 23, which was the currently `in_progress` exercise), not Dumbbell Row (ID 16, the next pending exercise). The `skip_exercise` tool operates on the current `in_progress` exercise without accepting an explicit `exercise_id` parameter.

### Root cause

The `skip_exercise` tool has no `exercise_id` parameter — it calls `trainingService.skipCurrentExercise(sessionId)` which always acts on whatever is currently `in_progress`. When the user says "skip Dumbbell Row" but Lat Pulldown is `in_progress`, the wrong exercise gets skipped.

The prompt does not instruct the LLM to first call `next_exercise` to advance to the target exercise before calling `skip_exercise`.

### Flow

```
User: "Skip the Dumbbell Row, back is tired"
  → LLM sees Lat Pulldown is in_progress, Dumbbell Row is next
  → LLM calls skip_exercise (no exercise_id parameter available)
  → skip_exercise skips current in_progress = Lat Pulldown (ID 23)
  → DB: exercise_id=23 status='skipped' ← WRONG, should be exercise_id=16
```

### DB evidence

```
session_exercises after skip:
  exercise_id=23 (Lat Pulldown), status='skipped'   ← skipped wrong exercise
  exercise_id=14 (Lateral Raise),  status='in_progress'
```

Dumbbell Row (ID 16) never appeared in session_exercises at all.

### Impact

- User asks to skip exercise X, but exercise Y (currently active) gets skipped instead.
- Affects any scenario where user wants to skip a *future* exercise while the *current* one is still in progress.
- Training data is incorrect — wrong exercise is marked skipped in history.

### Fix plan

Add optional `exercise_id` parameter to `skip_exercise` tool. Logic by state:

- **`exercise_id` provided, exercise exists in `session_exercises` as `in_progress`** → mark `skipped`
- **`exercise_id` provided, exercise exists as `completed`** → return error "exercise already completed"
- **`exercise_id` provided, exercise NOT in `session_exercises`** (still in plan only) → do nothing in DB, return OK. No reason to create a record for something that was never started.
- **`exercise_id` not provided** → current behavior: skip whatever is `in_progress`

Files to change:
1. [`training.tools.ts`](apps/server/src/infra/ai/graph/tools/training.tools.ts) — add `exercise_id: z.number().optional()` to schema
2. [`service.ports.ts`](apps/server/src/domain/training/ports/service.ports.ts) — update signature: `skipExercise(sessionId, opts?: { exerciseId?: number; reason?: string })`
3. [`training.service.ts`](apps/server/src/domain/training/services/training.service.ts) — implement lookup + state-based logic

### Regression test

1. Exercise A is `in_progress`. Ask to skip exercise B (in plan but not started). Verify: A stays `in_progress`, B has no `session_exercises` record, LLM confirms skip.
2. Exercise A is `in_progress`. Ask to skip exercise A by ID. Verify: A is `skipped`.
3. Exercise A is `completed`. Ask to skip A. Verify: error returned.

---

---

## BUG-003 — Full LLM request payload not logged; impossible to replay empty-response incidents

**Status:** Open  
**Severity:** Medium  
**Found during:** Manual test run 2026-03-12, investigation of BUG-001  
**Component:** `apps/server/src/infra/ai/llm.service.ts`, LangGraph node invocations in `apps/server/src/infra/ai/graph/`

### Description

When a `responseLength: 0` incident occurs (LLM returns empty content), there is no way to replay the exact request to OpenRouter to reproduce or verify the fix. The server logs contain `systemPrompt` and `lastUserMessage` but not the full `messages` array (conversation history). The complete HTTP payload that was sent to OpenRouter is never written to the log.

### Root cause

Two separate LLM invocation paths exist:

1. **`LLMService.generateWithSystemPrompt`** → calls `invokeModel` which builds `httpPayload` and logs it under `'LLM request prepared'` in dev mode.
2. **LangGraph nodes** (chat, training, session-planning subgraphs) → call the LangChain model **directly** via `model.invoke()` or `model.bindTools().invoke()`, bypassing `LLMService.invokeModel` entirely. No `httpPayload` is constructed or logged.

The graph nodes use their own logging (`log.debug('LLM invoke', { systemPrompt, lastUserMessage, historyCount })`) but never log the full messages array.

### Log evidence

```
[14:14:03] DEBUG: LLM response
  module: "llm"
  responseLength: 0       ← empty, but no payload logged
  response: ""
```

`LLM request prepared` message never appears in `logs/server.log` — confirming `httpPayload` path is never reached.

### Impact

- When BUG-001 or any tool-only empty response occurs, it cannot be reproduced deterministically.
- Cannot send the exact same request to OpenRouter to verify whether the bug is prompt-related or model-related.
- Fix verification relies on hope that the model will exhibit the same behavior again.
- Makes debugging of LLM regressions significantly harder in production.

### Fix plan

Centralize LLM payload logging via `LLMLogHandler` in [`model.factory.ts`](apps/server/src/infra/ai/model.factory.ts). This callback is already registered on the shared `ChatOpenAI` instance and receives **all** LLM calls — both graph-based and `LLMService`-based.

In debug mode, log the full replay payload for every LLM call:
- `messages` array (full conversation)
- `tools` (if bound)
- `model` name
- `temperature`
- `replayPayload` — ready-to-send JSON for `curl` to OpenRouter

Format: ndjson in `logs/server.log` (pino), field `replayPayload` containing the complete request. Can be extracted and replayed with:
```bash
cat logs/server.log | jq 'select(.replayPayload) | .replayPayload' > replay.json
curl -X POST https://openrouter.ai/api/v1/chat/completions -H "Authorization: Bearer $KEY" -d @replay.json
```

This is not conditional on empty responses — in debug mode, every call is logged. Weight is not a concern in debug mode. Enables testing the same request with different models.

Files to change:
1. [`model.factory.ts`](apps/server/src/infra/ai/model.factory.ts) — expand `LLMLogHandler` to capture and log full payload

### Regression test

After fix: send any message, verify `logs/server.log` contains a `replayPayload` entry with full messages array. Extract it, send to OpenRouter, verify valid response.

---

---

## BUG-004 — Dead code: `generateStructured`, `AIContextService`, `AI_CONTEXT_SERVICE_TOKEN`

**Status:** Open  
**Severity:** Low  
**Found during:** Manual test investigation 2026-03-12 (BUG-003 root cause analysis)  
**Component:** `apps/server/src/infra/ai/llm.service.ts`, `apps/server/src/domain/ai/ports.ts`

### Description

Three dead code items exist that are defined but never used anywhere:

**1. `LLMService.generateStructured`** (`llm.service.ts` lines 41–106)  
Implemented method + declared in `domain/ai/ports.ts` interface. Zero callers in the codebase. Was likely a precursor to structured JSON output before the graph approach was adopted.

**2. `AIContextService` interface + `AI_CONTEXT_SERVICE_TOKEN`** (`domain/ai/ports.ts` lines 7, 33–37)  
Interface with methods `buildContext`, `extractUserIntent`, `generatePersonalizedResponse`. Never registered, never injected, never called.

**3. `LLMService` itself is on the way out** (`register-infra-services.ts` line 61–62 has a TODO):
```typescript
// TODO: remove LLMService when TrainingService.getNextSessionRecommendation is migrated to graph
```
All 5 graph subgraphs (`chat`, `training`, `session-planning`, `plan-creation`, `registration`) call `getModel().bindTools().invoke()` directly — bypassing `LLMService` entirely. The only remaining caller of `generateWithSystemPrompt` is `TrainingService.getNextSessionRecommendation`.

### Root cause

Evolutionary drift: the architecture migrated from `LLMService`-based invocation to direct `model.invoke()` inside LangGraph nodes (via `model.factory.ts`), but dead code was not cleaned up.

### Impact

- `generateStructured` creates a false impression that structured output goes through `LLMService` — it doesn't.
- `AIContextService` interface adds noise to the domain ports.
- The `invokeModel`/`httpPayload` logging in `LLMService` (referenced in BUG-003 fix plan) will never fire for graph-based calls, making BUG-003 fix incomplete without also addressing graph nodes directly.
- Increases cognitive load when reading the codebase.

### Fix plan

Three options in order of preference:

1. **Delete dead code now** — remove `generateStructured` from `llm.service.ts` and `ports.ts`; remove `AIContextService` and `AI_CONTEXT_SERVICE_TOKEN` from `ports.ts`. Low risk, no behavior change.

2. **Migrate `getNextSessionRecommendation` to graph** (TODO from `register-infra-services.ts`) — after migration, `LLMService` and `generateWithSystemPrompt` can also be deleted. BUG-003 fix (payload logging) then belongs in the graph node, not in `LLMService`.

3. **Keep `LLMService` but route all graph nodes through it** — reverse direction: move logging/retry logic back into a shared service. More work, but centralises observability. Not recommended given current trajectory.

Recommended: do option 1 immediately (safe cleanup), then option 2 as a separate task.

### Regression test

After deletion: `npx tsc --noEmit` must pass with zero errors. No runtime behavior changes.

---

---

## BUG-005 — LLM cannot see exercise history: lookup by session template instead of muscles

**Status:** Open
**Severity:** Critical
**Found during:** Manual test run 2026-03-12, DB check after unexpected LLM response
**Component:** `apps/server/src/infra/ai/graph/subgraphs/training.subgraph.ts`, `apps/server/src/infra/db/repositories/workout-session.repository.ts`, `apps/server/src/infra/ai/graph/nodes/training.node.ts`, `apps/server/src/infra/ai/graph/subgraphs/session-planning.subgraph.ts`

### Description

LLM said "no previous data for Barbell Bench Press" despite DB containing 4 sets (40kg×10, 50kg×8, 50kg×8, 40kg×14) from session 2026-02-22. Bot suggested "establishing a baseline" while ignoring existing history.

This is a symptom of a deeper architectural problem: the system uses `sessionKey` (workout template name) as the unit of history identification. But `sessionKey` is a planning tool, not a stable identifier. Users change plans, do partial sessions, train arbitrary muscles — and history resets to null.

**The correct unit of identification is the muscle group, not the template.**

### Root cause

In `training.subgraph.ts`:
```typescript
const previousSession = session.sessionKey
  ? await workoutSessionRepo.findLastCompletedByUserAndKey(userId, session.sessionKey)
  : null;
```

`findLastCompletedByUserAndKey` matches strictly by `sessionKey`. Any plan change (rename, recreate, new template) returns `null`.

Even when keys match, LLM sees the entire template's exercises — not the specific exercise in context of the user's full muscle history.

Situations where history breaks:
- Bench Press exists in both `upper_a` and `upper_b` — `upper_b` history cannot see Bench Press from `upper_a`
- User changed plan — new `sessionKey`, history reset
- User said "just arms today" — no template, `sessionKey = null`, no history available

### Flow

```
User starts training Upper A (new template)
  → session.sessionKey = 'upper_a_v2'
  → findLastCompletedByUserAndKey(userId, 'upper_a_v2') → null
  → buildTrainingSystemPrompt(..., null)
  → LLM: "no data — let's establish a baseline"
     (real data: Bench Press @ 50kg, 18 days ago — invisible to LLM)
```

### DB evidence

```sql
-- Current session
session_key = 'upper_a_v2'  -- new key, no history

-- Session with real Bench Press data (18 days ago)
session_key = 'upper_a'     -- old key
-- 4 sets: 40kg×10, 50kg×8, 50kg×8, 40kg×14
```

### Impact

- LLM cannot see personal history when plan changes
- Progressive overload recommendations based on LLM general knowledge, not user data
- Core product value (personalized coaching) is broken
- Bug is invisible: server works, LLM doesn't complain — silently uses wrong data
- "Just arms today" scenario: no history available at all

### Fix plan

> **Full implementation plan:** [`docs/PLAN-muscle-centric-history.md`](PLAN-muscle-centric-history.md)

Replace `sessionKey` lookup with **muscle-centric history**. Two context levels:

**Level 1 — Session planning** (deciding WHAT to train): muscle fatigue/recovery across all groups, both primary and secondary involvement. JSON format in prompt. LLM sees which muscles are rested vs recently trained.

**Level 2 — Training** (deciding HOW to train current exercise): muscle dynamics for the current `in_progress` exercise. Lookup by primary muscles of the exercise, not by exercise ID or session key. Returns exact match (same exercise) + similar (same primary muscles), sorted by freshness. JSON format in prompt. Updates on each message based on current `in_progress` exercise.

No "previous session" block. `previousSession` parameter removed from prompt builder.

### Regression test

1. Change plan, start training — LLM sees history from previous plans.
2. Say "just arms today" (ad-hoc, no sessionKey) — LLM sees biceps/triceps history.
3. Do exercise A in template 1 and template 2 — history merges correctly.
4. During session planning — bot mentions muscles that haven't been trained recently.
5. At start of each exercise — bot gives specific weight recommendation based on last 2-3 performances.

---

---

## BUG-006 — LLM calls `finish_training` without user intent (fallback after `skip_exercise` error)

**Status:** Open  
**Severity:** Critical  
**Found during:** Manual test run 2026-03-12, real training session  
**Component:** `apps/server/src/infra/ai/graph/nodes/training.node.ts`, `apps/server/src/infra/ai/graph/tools/training.tools.ts`

### Description

User wrote "let's skip, what else?" meaning Cable Crunch (next planned exercise). LLM called `skip_exercise`, got error `No exercise currently in progress` (all previous exercises were `COMPLETED`, none active), and on the next turn called `finish_training` on its own. Session closed without user request.

User did not ask to end training. They wanted to skip a specific exercise and see what's left. Result: session closed, Cable Crunch dropped from history, subsequent sets (Cable Crunch and Chest-Supported Row) went to chat phase where `log_set` is unavailable — **data lost**.

### Root cause

Two interacting failures:

1. **`skip_exercise` lacks `exercise_id`** (BUG-002) — cannot target a specific exercise.
2. **Prompt allows `finish_training` as fallback** — after `skip_exercise` error and seeing `CURRENT EXERCISE = No exercise currently in progress`, LLM concludes "everything is done + user wants to skip → training is over" and calls `finish_training`. This is state interpretation, not explicit user request.

The prompt says:
```
7. Session complete: When all exercises are done or user says "done" / "finished" → call finish_training.
```

"When all exercises are done" is sufficient for LLM to call `finish_training` when no exercise is `in_progress` — without the user saying "done".

### Flow

```
16:08:47 User: "let's skip, what else?"
  → LLM: CURRENT EXERCISE = No exercise currently in progress
  → LLM calls skip_exercise (no exercise_id)
  → skip_exercise ERROR: No exercise currently in progress

  → LLM receives error + sees all exercises COMPLETED
  → LLM: "error + all done → call finish_training"
  → finish_training executed
  → session.status = 'completed', completed_at = 16:08:50

16:11:03 User: "decided to do crunches..."
  → System already in chat phase
  → Chat LLM says "✅ Set 1 logged @ 59 kg" — BUT log_set unavailable
  → Data lost, user misled
```

### Log evidence

```
[16:08:50] ERROR: skip_exercise failed
  message: "No exercise currently in progress"

[16:08:50] WARN: Tool errors detected
  errors: ["LLM_ERROR: No exercise currently in progress"]

[16:08:55] LLM response (second invoke with error in context):
  "❌ Cable Crunch was NOT recorded since we decided to skip it.
   ✅ Training completed successfully!"
```

`finish_training` has no AUDIT log — its invocation is only visible by `session.status` change in DB.

### DB evidence

```sql
workout_sessions:
  id = '7c9818cb-...'
  status = 'completed'
  completed_at = '2026-03-12T00:08:50.731Z'

-- Cable Crunch (exercise_id=49) never appeared in session_exercises
-- Chest-Supported Row (exercise_id=20) — only 1 set out of planned 4
-- All subsequent sets in chat phase: NOT saved
```

### Impact

- **Data loss**: Cable Crunch sets and additional Chest-Supported Row sets not saved.
- **False confirmations**: chat-phase LLM says `✅ Set logged` without real `log_set` — user believes data is saved (see BUG-009).
- **Trust broken**: user did not end training, but it ended — surprise that breaks trust.
- **Cannot continue**: after `finish_training`, returning to training phase requires a new session.
- **Chain**: BUG-002 (no `exercise_id`) → BUG-006 (fallback `finish_training`) → BUG-009 (false `✅` in chat).

### Fix plan

`finish_training` is **irreversible**: session closes, phase changes, no more sets can be logged. The trigger for BUG-006 is the chain: BUG-002 error → LLM fallback. Fix is three layers:

**1. Fix BUG-002** — `skip_exercise(exercise_id)` eliminates the error that triggers the fallback. Once LLM can skip a specific exercise without error, it has no reason to call `finish_training`.

**2. Prompt Rule 7 rewrite** in `training.node.ts` — `finish_training` is never a fallback:
```
7. Session complete — finish_training is IRREVERSIBLE. There are exactly two cases:
   (A) ALL exercises COMPLETED/SKIPPED → suggest finishing, WAIT for explicit confirmation
   (B) User makes UNAMBIGUOUS session-level request ("end training", "done for today")
   NEVER call after a tool error. NEVER call because no exercise is in_progress.
   Ambiguous words ("done", "finished") → always clarify: set, exercise, or session?
```

**3. AUDIT log** in [`training.tools.ts`](apps/server/src/infra/ai/graph/tools/training.tools.ts):
```typescript
log.info({ audit: 'finish_training', userId, sessionId }, 'AUDIT: training finished');
```

Note: `finish_training` stays always available as a tool (not restricted by dynamic tools). User can legitimately end training at any time. The protection is in the prompt, not in tool availability.

### Regression test

1. Log 1 set, write "skip the next one" — session does NOT end, LLM asks clarifying question.
2. Complete all exercises, write "what's next?" — LLM suggests finishing, waits for "yes" — only then `finish_training`.
3. Complete all exercises, write "done" — LLM asks "you mean the session, or this exercise?"
4. After session ends, write "did another set" — LLM explains session is closed, does NOT write `✅`.

---

## BUG-007 — Cannot retrospectively add exercises after session ends

**Status:** Deferred
**Severity:** High
**Found during:** Manual test / user feedback
**Component:** `apps/server/src/infra/ai/graph/subgraphs/chat.subgraph.ts`, `apps/server/src/infra/ai/graph/nodes/chat.node.ts`, `apps/server/src/domain/training/services/training.service.ts`

### Description

After a training session ends, the user cannot add exercises or sets that were performed but not recorded. The system either stays silent, or chat LLM writes "✅ Recorded!" (hallucination) while data is physically not saved — chat phase has no tools for DB writes.

This violates a basic UX principle: **system limitations should not be visible to the user**. A person tells their trainer "forgot to log planks" — the trainer logs it. The system should not reply "session is closed."

### Root cause

- Chat phase intentionally has no training data tools (separation of concerns).
- No mechanism to transition to a state where retrospective logging is possible.
- Chat LLM without tools can hallucinate confirmation of data recording (see BUG-009).

### Flow

```
User: "forgot to log planks, 3 sets"
Chat LLM: "✅ Recorded!" (hallucination — data NOT saved)
```
or
```
User: "forgot to log planks"
Chat LLM: "Sorry, session is already closed" (unacceptable UX)
```

### DB evidence

`session_sets` contains no records for retrospectively mentioned exercises.

### Impact

- Training data lost
- User trust broken
- Incorrect history for progressive overload

### Fix plan

> **Status: Deferred.** Skipping for now — focus on higher-priority bugs first. Implementation plan exists at [`docs/PLAN-retrospective-subgraph.md`](PLAN-retrospective-subgraph.md).

Planned approach: minimal `retrospective` subgraph with `log_retro_set` and `done` tools, triggered via `request_transition(toPhase='retrospective')` from chat phase.

### Regression test

1. End session, write "forgot to log planks 3×60 sec" — bot records and confirms.
2. Add multiple exercises retrospectively — all saved.
3. Write "that's all" — bot returns to chat phase.
4. Verify DB: `session_sets` contains added records linked to completed session.

---

## BUG-008 — LLM hallucinates sets and ignores user's actual message (tool calls prioritized over dialogue)

**Status:** Open
**Severity:** Critical
**Found during:** Manual test run 2026-03-12, real training session (user: Sergey/filko)
**Component:** `apps/server/src/infra/ai/graph/nodes/training.node.ts`, `apps/server/src/infra/ai/graph/subgraphs/training.subgraph.ts`

### Description

During a real training session the LLM repeatedly called `log_set` with fabricated data when the user did NOT report any set. The LLM also completely ignored the user's actual message — no response to questions, comments, or requests. The conversation felt broken: the user says one thing, the bot responds about something entirely different.

### Confirmed incidents (session `7c9818cb`, user Sergey)

**Incident 1 — Phantom batch logging + ignored comment:**
```
USER: "это было ближе к разминочному, достаточно легко"
      (commenting on how the previous set felt — NOT reporting new data)

EXPECTED: "Раз было легко, давай добавим 5-10 кг на следующий подход. Готов?"

ACTUAL:   ✅ Set 2: 10 reps @ 40 kg | RPE 5    ← fabricated
          ✅ Set 3: 10 reps @ 50 kg | RPE 7    ← fabricated
          "У тебя остался 4-й подход..."
```
User had to reply: "я не делал больше сеты, это был только один и я отдыхаю"

**Incident 2 — Phantom set on a question + question ignored:**
```
USER: "или может штанга в наклоне?"
      (asking which exercise to choose — a question, NOT set data)

EXPECTED: "Оба варианта хороши — штанга даёт больше нагрузки, тренажёр безопаснее. Что выбираешь?"

ACTUAL:   ✅ Set 1: 10 reps @ 40 kg | RPE 7    ← fabricated from thin air
          "Зафиксировал как замену рычажной тяги..."
```
User had to reply: "хотя гантели безопаснее будет без страховки? и я ещё не начинал!"

**Incident 3 — Wrong set number (side effect of phantom sets):**
```
USER: "первый подход 17.5 кг на 12 повторов"

EXPECTED: ✅ Set 1: 12 reps @ 17.5 kg

ACTUAL:   ✅ Set 2: 12 reps @ 17.5 kg    ← wrong number due to phantom Set 1
```
User had to reply: "я сказал первый а не второй"

### Root cause

Three interacting problems in the training prompt (`training.node.ts`):

**1. Rule 5 creates a "gap-filling" instinct:**
```
Rule 5: If the user asks to move on but CURRENT PROGRESS shows 0 sets,
        call log_set first, then next_exercise.
```
This teaches the LLM: "incomplete progress = must log something." When the user comments or asks a question, the LLM interprets it as "moving forward" and fills gaps with data from CONVERSATION HISTORY.

**2. Rule 8 is too weak against data inference:**
Rule 8 says "NEVER call any tool based on data from CONVERSATION HISTORY." But it does not prohibit using HISTORY data as **arguments** when the LLM decides (incorrectly) that a tool call is warranted. The LLM sees "40 kg, 10 reps" in history and uses it to fabricate a new set.

**3. Prompt structure prioritizes tools over dialogue:**
```
Rule 2: After each set → Call log_set first. Then acknowledge...
```
The ordering "tool first, response second" trains the LLM to prioritize finding something to log over understanding what the user actually said. The correct priority should be:
1. Parse user intent: is this a question? comment? set data? request?
2. Respond to the user's actual message
3. Only call tools if explicit set data is present

**4. CONVERSATION HISTORY is included as a SystemMessage:**
Despite the "memory only" label, the LLM uses historical set data to extrapolate missing arguments for `log_set`. The boundary between "context for understanding" and "data for tool arguments" is not enforced.

### Flow (generic pattern)

```
User sends a message that is NOT set data (question, comment, feeling)
  → LLM sees: CURRENT PROGRESS has incomplete sets
  → LLM sees: CONVERSATION HISTORY has reps/weight from a past message
  → Rule 5 instinct: "progress incomplete + user talking = must log"
  → LLM fabricates log_set call using data from HISTORY
  → LLM DOES NOT respond to the user's actual question/comment
  → User sees phantom "✅ Set logged" for something they never did
  → User confused, has to correct manually
```

### DB evidence

Session `7c9818cb` (user Sergey, real training):
- Barbell Bench Press Set 2 and Set 3 created at `23:29:21` — 0.3s apart — fabricated
- Chest-Supported Row Set 1 created at `23:53:37` — logged when user asked a question

### Impact

- **Silent data corruption**: phantom sets in training history skew progressive overload
- **Broken dialogue**: user asks a question, gets a set confirmation instead of an answer
- **Destroyed trust**: user feels the bot is "stupid" and stops wanting to use it
- **Manual cleanup needed**: user has to repeatedly correct phantom sets ("я не делал!", "я сказал первый!")
- **Cascading errors**: wrong set numbers lead to more confusion downstream

### Fix plan

**Plan A — Dynamic tools + prompt hardening** (implement first, test on real training):

**1. Dynamic tool availability** — in `agentNode` of [`training.subgraph.ts`](apps/server/src/infra/ai/graph/subgraphs/training.subgraph.ts), filter tools based on session state before each `model.bindTools().invoke()`:

| Condition | Unavailable tools |
|---|---|
| No `in_progress` exercise | `log_set` |
| 0 sets logged for current exercise | `delete_last_sets`, `update_last_set` |

`finish_training`, `next_exercise`, `skip_exercise` — always available.

This prevents the main BUG-008 scenario: LLM physically cannot call `log_set` when there's no active exercise.

**2. Prompt hardening** — rewrite rules in [`training.node.ts`](apps/server/src/infra/ai/graph/nodes/training.node.ts):

```
RULE 0 (CONVERSATION PRIORITY):
Your primary job is to UNDERSTAND and RESPOND to the user's message.
Before calling ANY tool, classify the message:
  - QUESTION → answer it, do NOT call any tool
  - COMMENT / FEELING ("was easy", "heavy") → acknowledge and advise, do NOT call log_set
  - SET DATA (contains explicit reps + weight/duration) → call log_set
  - ACTION REQUEST ("skip", "next", "finish") → call the appropriate tool
If in doubt whether the message contains set data, ASK — do not guess.
```

Rewrite Rule 5 — never invent data:
```
Rule 5: If the user asks to move on but CURRENT PROGRESS shows 0 sets,
        ASK them to report the set data first.
        NEVER invent or infer set data from CONVERSATION HISTORY.
```

Add anti-patterns section with explicit negative examples.

**3. Programmatic guard** in `sequentialToolNode` — reject `log_set` combined with `skip_exercise` or `next_exercise` in the same response.

**Plan B — Dual LLM Architecture** (if Plan A fails):

If phantom sets still appear after Plan A, proceed to [`docs/PLAN-dual-llm-training.md`](PLAN-dual-llm-training.md) — separate Parser LLM (intent + extraction) from Trainer LLM (dialogue only).

### Regression test

1. Log Set 1. Say "это было легко" — bot should respond with advice, NOT log another set.
2. Say "или может штанга в наклоне?" — bot should answer the question, NOT log a set.
3. Say "пропусти следующее" — only `skip_exercise` called, no `log_set`.
4. Say "давай дальше" — only `next_exercise` called, no `log_set`.
5. Verify DB: no sets with identical data within seconds of each other.
6. Verify: after fix, the bot never says "✅ Set logged" unless the user's message contained explicit numeric data.

---

## BUG-009 — Chat LLM hallucinates "Set logged" confirmation without actual `log_set`

**Status:** Open
**Severity:** Critical
**Found during:** Manual test run 2026-03-12, after BUG-006 triggered premature session close
**Component:** `apps/server/src/infra/ai/graph/nodes/chat.node.ts`

### Description

After a training session ends (via `finish_training` or timeout), the user continues reporting sets in chat phase. The chat LLM responds with "✅ Set 1 logged @ 59 kg" — but chat phase has no `log_set` tool. Data is not saved. User believes their workout data is recorded.

This is the most dangerous type of bug: **silent data loss with false confirmation**. The user has no way to know the data was not saved.

### Root cause

Chat phase LLM has no training tools (by design). When user reports set data, the LLM has no way to save it — but it also has no instruction that it **cannot** save. Without explicit prohibition, the LLM generates a plausible confirmation message mimicking training phase behavior.

### Flow

```
User (in chat phase after session ended): "did cable crunches, 59 kg, 12 reps"
  → Chat LLM has no log_set tool
  → Chat LLM generates: "✅ Set 1 logged @ 59 kg, 12 reps. Great work!"
  → Data NOT saved to DB
  → User believes data is recorded
```

### DB evidence

`session_sets` has no record for the reported exercise after the session was closed.

### Impact

- **Silent data loss**: user's workout data silently discarded while showing success confirmation
- **False trust**: user sees ✅ and moves on, never checks DB
- **Incorrect training history**: missing sets affect progressive overload recommendations

### Fix plan

Add explicit prohibition to chat phase prompt in [`chat.node.ts`](apps/server/src/infra/ai/graph/nodes/chat.node.ts):

```
You do NOT have a log_set tool. You CANNOT save workout data.
If user reports sets or exercises after a training session has ended:
- Acknowledge what they did
- Explain warmly that the session is already closed
- Offer to start a new session if they want to continue training
NEVER write "✅" or "Recorded" or "Logged" — you cannot save sets from chat.
```

### Regression test

1. End training session. Write "did 3 sets of planks @ 60 sec". Verify: bot does NOT say "✅ Recorded", instead explains session is closed.
2. Verify DB: no new `session_sets` rows after session close.

---

<!-- Template for new bugs:

## BUG-XXX — Short title

**Status:** Open / Fixed / Won't fix
**Severity:** Critical / High / Medium / Low
**Found during:** [test name, date]
**Component:** [file paths]

### Description

### Root cause

### Flow

### Log evidence

### DB evidence

### Impact

### Fix plan

### Regression test

-->
