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

### Fix plan

Two-layer fix (defence in depth):

1. **Server — prompt fix** in `apps/server/src/infra/ai/graph/nodes/chat.node.ts`:
   - Update `request_transition` rules to require LLM to always include a natural text reply alongside the tool call.
   - Example: `"ALWAYS call this tool AND include a short natural reply in the same message. Do NOT stay silent."`

2. **Bot — guard** in `apps/bot/handlers.ts` line 128:
   - Add `if (!aiResponse.trim()) { log.warn(...); return; }` before `sendHtml`.
   - Prevents Telegram 400 error in any future empty-response scenario.

### Regression test

After fix: send "I want to train today" — expect a non-empty text response AND `session_planning` phase transition in the same turn. Verify `conversation_turns` row is persisted with non-empty content.

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

Two options:

1. **Add `exercise_id` parameter to `skip_exercise` tool** — when provided, service advances to that exercise then skips it. Requires changes to tool schema, `ITrainingService`, and `TrainingService.skipCurrentExercise`.
2. **Prompt fix** — instruct LLM: "If the user wants to skip an exercise that is not currently `in_progress`, first call `next_exercise` with the target `exercise_id`, then call `skip_exercise`." This is simpler but relies on LLM compliance.

Option 1 is more robust (matches the pattern of `next_exercise` already accepting `exercise_id`).

### Regression test

Log a set for exercise A. Ask to skip exercise B (the next one). Verify DB: exercise A = `in_progress` (or `completed`), exercise B = `skipped`. Exercise A must NOT be skipped.

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

In `apps/server/src/infra/ai/llm.service.ts`, add **conditional payload logging on empty response** inside `invokeModel`:

After `let content = response.content as string;` (line ~196), add:

```typescript
if (!content || content.trim().length === 0) {
  effectiveLog.warn(
    {
      requestId,
      model: this.model.model,
      replayPayload: httpPayload,  // full OpenRouter-ready JSON
    },
    'LLM returned empty content — full request payload logged for replay',
  );
}
```

This only logs the full payload when the response is empty — avoiding log bloat for normal requests.

For graph nodes that bypass `LLMService`, the same guard should be added at the `extractNode` level in each subgraph: when `responseMessage === ''`, log the last N messages from state so the payload can be reconstructed.

### Regression test

After fix: trigger a tool-only LLM response (via unit test mock). Verify that `logs/server.log` contains a `replayPayload` field with the full messages array. Verify that `curl -X POST https://openrouter.ai/api/v1/chat/completions -d "$(cat replayPayload.json)"` returns a valid response.

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

## BUG-005 — LLM получает `null` как историю упражнений при смене `sessionKey`

**Status:** Open  
**Severity:** High  
**Found during:** Manual test run 2026-03-12, проверка БД после "странного ответа"  
**Component:** `apps/server/src/infra/ai/graph/subgraphs/training.subgraph.ts`, `apps/server/src/infra/db/repositories/workout-session.repository.ts`, `apps/server/src/infra/ai/graph/nodes/training.node.ts`

### Description

LLM сказал "по упражнению Barbell Bench Press данных за прошлые тренировки нет" — хотя в БД есть 4 сета (40kg×10, 50kg×8, 50kg×8, 40kg×14) из сессии 2026-02-22. Бот предложил "установить базовую точку" и начать с 40-50 кг, не используя имеющуюся историю. Рекомендация не противоречила фактическим данным случайно — но причина "правильного" веса была не в анализе истории, а в общем здравом смысле LLM.

### Root cause

В `training.subgraph.ts` история предыдущей сессии ищется строго по `sessionKey`:

```typescript
const previousSession = session.sessionKey
  ? await workoutSessionRepo.findLastCompletedByUserAndKey(userId, session.sessionKey)
  : null;
```

Текущая сессия имеет `session_key = 'upper_a_v_shape_express'` (новый план), а предыдущая сессия с Bench Press — `session_key = 'upper_a'` (старый план). Метод `findLastCompletedByUserAndKey` возвращает `null`, и LLM получает секцию `=== PREVIOUS SESSION ===` без данных.

Привязка к `sessionKey` нарушается при любом пересоздании или переименовании плана.

### Flow

```
Пользователь: начинает тренировку Upper A (новый шаблон)
  → session.sessionKey = 'upper_a_v_shape_express'
  → findLastCompletedByUserAndKey(userId, 'upper_a_v_shape_express') → null
     (нет completed сессий с таким ключом)
  → buildTrainingSystemPrompt(..., null)
  → промпт: previousSession секция отсутствует
  → LLM: "данных нет — установим базовую точку"
     (реальные данные: Bench Press @ 40–50 kg, 4 сета, 18 дней назад — не видны LLM)
```

### DB evidence

```sql
-- Текущая сессия
session_key = 'upper_a_v_shape_express'  -- новый ключ, нет истории

-- Сессия с реальными данными по Bench Press (18 дней назад)
session_key = 'upper_a'                  -- старый ключ
-- 4 сета: 40kg×10, 50kg×8, 50kg×8, 40kg×14
```

`findLastCompletedByUserAndKey('upper_a_v_shape_express')` → `null`.  
`findLastCompletedByUserAndKey('upper_a')` → сессия с данными (но не вызывается).

### Impact

- LLM не видит реальную историю упражнений пользователя при любом изменении плана (переименование, пересоздание, первое использование нового шаблона).
- Рекомендации по прогрессивной перегрузке основаны на "общем знании" LLM, а не на персональных данных пользователя.
- Нарушается ключевая ценность продукта — персонализированный коучинг на основе истории.
- Баг незаметен: сервер работает штатно, LLM не жалуется — просто молча использует не те данные.

### Fix plan

Заменить поиск по `sessionKey` на умный поиск по **мышечным группам упражнений** из текущего плана.

**Новый метод репозитория** `findExerciseHistoryForSession(userId, exerciseIds, opts)`:
- для каждого `exerciseId` из плана:
  - **Exact match**: найти последние N сетов этого же упражнения из любых completed сессий
  - **Similar by muscles**: найти упражнения с теми же primary мышцами → последние M сетов

**Приоритет:**
1. Exact match (тот же exerciseId), сортировка по свежести
2. Similar by primary muscles, сортировка по свежести

**Новый тип** `ExerciseContextHistory` в `types.ts`.

**Обновить** `buildTrainingSystemPrompt` в `training.node.ts` — заменить `previousSession: WorkoutSessionWithDetails | null` на `exerciseHistory: ExerciseContextHistory`, обновить секцию промпта на `=== EXERCISE HISTORY ===` с разбивкой по упражнению.

**Файлы для изменения:**
1. `apps/server/src/domain/training/types.ts` — новые типы
2. `apps/server/src/domain/training/ports/repository.ports.ts` — новый метод в `IWorkoutSessionRepository`
3. `apps/server/src/infra/db/repositories/workout-session.repository.ts` — реализация
4. `apps/server/src/infra/ai/graph/subgraphs/training.subgraph.ts` — вызов нового метода
5. `apps/server/src/infra/ai/graph/nodes/training.node.ts` — новая секция промпта

### Regression test

После фикса: запустить тренировку с `sessionKey`, которого не было раньше. Убедиться, что промпт содержит `=== EXERCISE HISTORY ===` с данными по упражнениям из прошлых сессий с другим `sessionKey`. Проверить, что LLM ссылается на конкретные веса из истории.

---

---

## BUG-006 — LLM вызывает `finish_training` без явного намерения пользователя (fallback после ошибки `skip_exercise`)

**Status:** Open  
**Severity:** Critical  
**Found during:** Manual test run 2026-03-12, тренировка filko  
**Component:** `apps/server/src/infra/ai/graph/nodes/training.node.ts`, `apps/server/src/infra/ai/graph/tools/training.tools.ts`

### Description

Пользователь написал "давай пропустим что еще?" имея в виду Cable Crunch (следующее плановое упражнение). LLM вызвал `skip_exercise`, получил ошибку `No exercise currently in progress` (т.к. все предыдущие упражнения были `COMPLETED`, активного не было), и в следующем turn самостоятельно вызвал `finish_training`. Сессия завершилась без явного запроса пользователя.

Пользователь не просил завершать тренировку. Он хотел пропустить конкретное упражнение и узнать, что осталось. В результате тренировка была закрыта, Cable Crunch выпал из истории, а все последующие сеты (Cable Crunch и Chest-Supported Row) ушли в chat-фазу, где `log_set` недоступен, и были **потеряны**.

### Root cause

Два взаимосвязанных сбоя:

1. **`skip_exercise` не принимает `exercise_id`** (BUG-002) — не может перейти к упражнению и пропустить его.
2. **LLM-промпт не запрещает `finish_training` как fallback** — получив ошибку от `skip_exercise` и увидев `CURRENT EXERCISE = No exercise currently in progress`, LLM делает вывод "раз всё завершено и пользователь хочет пропустить → тренировка окончена" и вызывает `finish_training`. Это интерпретация состояния, а не явный запрос.

Промпт гласит:
```
7. Session complete: When all exercises are done or user says "done" / "finished" → call finish_training.
```

Фраза "when all exercises are done" достаточна для LLM, чтобы вызвать `finish_training` при отсутствии активного упражнения — без слова "done"/"finished" от пользователя.

### Flow

```
16:08:47 User: "давай пропустим что еще?"
  → LLM: CURRENT EXERCISE = No exercise currently in progress
  → LLM вызывает skip_exercise (нет exercise_id)
  → skip_exercise ERROR: No exercise currently in progress

  → LLM получает ошибку + видит все упражнения COMPLETED
  → LLM: "раз ошибка и всё завершено — вызову finish_training"
  → finish_training выполнен
  → session.status = 'completed', completed_at = 16:08:50

16:11:03 User: "решил сделать скручивания..."
  → Система уже в chat-фазе
  → LLM из chat-фазы говорит "✅ Сет 1 записан @ 59 кг" — НО log_set недоступен
  → Данные потеряны, пользователь введён в заблуждение
```

### Log evidence

```
[16:08:50] ERROR: skip_exercise failed
  message: "No exercise currently in progress"

[16:08:50] WARN: Tool errors detected
  errors: ["LLM_ERROR: No exercise currently in progress"]

[16:08:55] LLM response (после второго LLM invoke с ошибкой в контексте):
  "❌ Скручивания на верхнем блоке НЕ были записаны, так как мы решили их пропустить.
   ✅ Тренировка успешно завершена!"
```

`finish_training` не имеет собственного AUDIT-лога — факт его вызова виден только по смене `session.status` в БД.

### DB evidence

```sql
workout_sessions:
  id = '7c9818cb-...'
  status = 'completed'
  completed_at = '2026-03-12T00:08:50.731Z'  -- 16:08:50 MSK

-- Cable Crunch (exercise_id=49) в session_exercises вообще не появился
-- Chest-Supported Row (exercise_id=20) — только 1 сет из плановых 4
-- Все последующие сеты в chat-фазе: НЕ сохранены
```

### Impact

- **Потеря данных**: сеты Cable Crunch и дополнительные сеты Chest-Supported Row не сохранены.
- **Ложные подтверждения**: chat-фаза LLM говорит `✅ Сет записан` без реального `log_set` — пользователь уверен что данные сохранены.
- **Недоверие к системе**: пользователь не завершал тренировку, но она завершилась — сюрприз, нарушающий доверие.
- **Невозможность продолжить**: после `finish_training` вернуться в training-фазу нельзя без новой сессии.
- **Цепочка**: BUG-002 (`skip_exercise` без `exercise_id`) → BUG-006 (fallback `finish_training`) → BUG-006b (ложное `✅` в chat-фазе).

### Fix plan

`finish_training` — **необратимое действие**: после него данные сессии закрыты, фаза сменена, новые сеты логировать невозможно. Поэтому вызов допустим только в двух сценариях:

Допустимы ровно три сценария завершения:

- **A. Инициация LLM + явное подтверждение** — LLM видит что все упражнения `COMPLETED`/`SKIPPED`, предлагает завершить ("Все упражнения выполнены — завершаем тренировку?"), получает явное "да" / "завершай" → вызывает `finish_training`.
- **B. Явный однозначный запрос пользователя** — фразы типа "завершай тренировку", "заканчиваем на сегодня", "тренировка окончена" — контекстно однозначно о тренировке, не о сете/упражнении. Даже тогда LLM может переспросить для страховки.
- **C. Таймаут** — пользователь перестал отвечать, сессия автоматически закрывается через N часов через существующий механизм `autoCloseTimedOut`. Это не LLM-решение, это инфраструктурный сценарий.

Фразы "закончил", "всё", "done", "готово" — **неоднозначны**: относятся к сету, упражнению или тренировке в зависимости от контекста. LLM обязан уточнить, не интерпретировать в пользу завершения тренировки.

Во всех остальных случаях (ошибка инструмента, неактивное упражнение, неоднозначная фраза) — LLM обязан уточнить намерение, а не завершать.

**Реализация — четыре слоя:**

**1. Обновить правило 7 в промпте** `training.node.ts`:
```
7. Session complete — finish_training is IRREVERSIBLE. Once called, the session closes permanently
   and no more sets can be logged. There are exactly two cases where you may call it:

   (A) ALL exercises in CURRENT PROGRESS are COMPLETED or SKIPPED → suggest finishing:
       "Все упражнения выполнены! Завершаем тренировку на сегодня?"
       Then WAIT. Only call finish_training after explicit confirmation: "да", "завершай", "yes", "погнали" etc.

   (B) User makes an UNAMBIGUOUS, SESSION-LEVEL request: "заканчиваем тренировку", "тренировку завершай",
       "на сегодня всё с тренировкой" — even then, prefer to confirm once.

   NEVER call finish_training:
   - After a tool error or because no exercise is in_progress
   - When user says "закончил", "всё", "done", "готово" — these are AMBIGUOUS (set? exercise? session?)
     → always clarify: "Ты имеешь в виду тренировку в целом, или этот подход/упражнение?"
   - As a fallback when you don't know what to do next

   Note: sessions also close automatically after inactivity timeout — that is handled by infrastructure,
   not by you.
```

**2. Добавить `exercise_id` в `skip_exercise`** (BUG-002 fix) — чтобы LLM мог пропустить конкретное упражнение без попадания в состояние ошибки, которое провоцирует fallback.

**3. Добавить AUDIT-лог для `finish_training`** — сейчас вызов не трассируется. Добавить в `training.tools.ts`:
```typescript
log.info({ audit: 'finish_training', userId, sessionId }, 'AUDIT: training finished');
```

**4. Защита в chat-фазе от галлюцинации `✅`** — добавить в промпт chat-субграфа:
```
You do NOT have a log_set tool. If user reports workout sets after the training phase ended —
tell them warmly that the session is closed and offer to start a new one.
NEVER write "✅ Сет записан" — you cannot save sets from chat.
```

### Regression test

1. Залогировать 1 сет, написать "пропустим следующее" — сессия НЕ завершается, LLM задаёт уточняющий вопрос.
2. Выполнить все упражнения, написать "что дальше?" — LLM предлагает завершить, ждёт "да" — только после этого `finish_training`.
3. Выполнить все упражнения, написать "закончил" — LLM задаёт уточняющий вопрос ("Тренировку завершаем?"), `finish_training` только после подтверждения.
4. После завершения тренировки написать "сделал ещё подход" — LLM объясняет что сессия закрыта, не пишет `✅`.

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
