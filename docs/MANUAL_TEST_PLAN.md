# FitCoach — Manual End-to-End Test Plan

> **IMPORTANT — KEEP THIS DOCUMENT CURRENT**
>
> Update this plan whenever new API endpoints, conversation phases, training tools, or
> DB schema changes are introduced. Any agent executing this plan needs the full context
> contained here — do not rely on implicit knowledge.
>
> Owner: any engineer touching API routes, training domain, or conversation graph.
>
> **Bug tracking:** All bugs found during test runs go into [`docs/BUGS.md`](BUGS.md).
> Every run must end with a bug report section — see the protocol at the bottom of this file.

---

## Prerequisites

### Server
```bash
cd apps/server && npm run dev
# Server runs on http://localhost:3000
```

### Environment variables (apps/server/.env)
```
BOT_API_KEY=dev-key
DB_HOST=localhost
DB_PORT=5432
DB_USER=postgres
DB_PASSWORD=postgres
DB_NAME=fitcoach_dev
```

### API key header (used in every /api/* request)
```
X-Api-Key: dev-key
```

### DB verification queries
All SQL runs against `fitcoach_dev`. Use psql:
```bash
psql -U postgres -d fitcoach_dev
```

### How to get exercise IDs (needed throughout tests)
```sql
SELECT id, name, exercise_type FROM exercises
WHERE name IN ('Barbell Bench Press','Barbell Back Squat','Pull-ups','Running')
ORDER BY name;
```
Note the IDs — referred to as `$BENCH_ID`, `$SQUAT_ID`, `$PULLUP_ID`, `$RUN_ID` below.

---

## Architecture Quick Reference

| Layer | Notes |
|-------|-------|
| POST /api/user | Create/upsert user by provider |
| POST /api/chat | All conversation (registration, chat, training) |
| Conversation phases | `registration` → `chat` → `session_planning` → `training` → `chat` |
| Training tools | `log_set`, `complete_current_exercise`, `finish_training`, `delete_last_sets`, `update_last_set` |
| Session lifecycle | `planning` → `in_progress` → `completed` / `skipped` |
| Exercise lifecycle | `pending` → `in_progress` → `completed` / `skipped` |

---

## SCENARIO 1 — User Registration

### 1.1 Create user via API

**Request:**
```bash
curl -s -X POST http://localhost:3000/api/user \
  -H "Content-Type: application/json" \
  -H "X-Api-Key: dev-key" \
  -d '{
    "provider": "telegram",
    "providerUserId": "test_user_001",
    "username": "testcoach",
    "firstName": "Alex",
    "lastName": "Tester",
    "languageCode": "en"
  }' | jq .
```

**Expected response:**
```json
{
  "data": { "id": "<uuid>" }
}
```

**Save the userId:**
```bash
USER_ID="<uuid from response>"
```

**DB verification:**
```sql
SELECT id, username, first_name, profile_status
FROM users WHERE id = '<USER_ID>';
-- Expected: profile_status = 'registration'

SELECT provider, provider_user_id
FROM user_accounts WHERE user_id = '<USER_ID>';
-- Expected: provider='telegram', provider_user_id='test_user_001'
```

---

### 1.2 Complete registration via chat

The bot guides the user through registration when `profile_status = 'registration'`.
Send each message and verify the bot collects required fields.

**Step 1 — Start chat (triggers registration flow):**
```bash
curl -s -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -H "X-Api-Key: dev-key" \
  -d "{\"userId\": \"$USER_ID\", \"message\": \"Hi\"}" | jq .data.content
```
**Expected:** Bot asks for age/gender/height/weight/fitness level/goal.

**Step 2 — Provide profile data (adjust to match bot's questions):**
```bash
# Age
curl -s -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" -H "X-Api-Key: dev-key" \
  -d "{\"userId\": \"$USER_ID\", \"message\": \"28\"}" | jq .data.content

# Gender
curl -s -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" -H "X-Api-Key: dev-key" \
  -d "{\"userId\": \"$USER_ID\", \"message\": \"male\"}" | jq .data.content

# Height
curl -s -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" -H "X-Api-Key: dev-key" \
  -d "{\"userId\": \"$USER_ID\", \"message\": \"180\"}" | jq .data.content

# Weight
curl -s -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" -H "X-Api-Key: dev-key" \
  -d "{\"userId\": \"$USER_ID\", \"message\": \"80\"}" | jq .data.content

# Fitness level
curl -s -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" -H "X-Api-Key: dev-key" \
  -d "{\"userId\": \"$USER_ID\", \"message\": \"intermediate\"}" | jq .data.content

# Fitness goal
curl -s -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" -H "X-Api-Key: dev-key" \
  -d "{\"userId\": \"$USER_ID\", \"message\": \"build muscle and improve strength\"}" | jq .data.content
```

**DB verification (after registration complete):**
```sql
SELECT profile_status, age, gender, height, weight, fitness_level, fitness_goal
FROM users WHERE id = '<USER_ID>';
-- Expected: profile_status = 'complete', all fields populated
```

---

## SCENARIO 2 — Workout Plan Creation

### 2.1 Request a workout plan

```bash
curl -s -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" -H "X-Api-Key: dev-key" \
  -d "{\"userId\": \"$USER_ID\", \"message\": \"I want to create a workout plan\"}" | jq .data.content
```
**Expected:** Bot enters `plan_creation` phase, asks questions or generates a plan.

### 2.2 Confirm the plan

Engage with the bot's plan creation questions. When plan is confirmed:

```bash
curl -s -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" -H "X-Api-Key: dev-key" \
  -d "{\"userId\": \"$USER_ID\", \"message\": \"Yes, this plan looks good, save it\"}" | jq .data.content
```

**DB verification:**
```sql
SELECT id, name, status
FROM workout_plans WHERE user_id = '<USER_ID>' ORDER BY created_at DESC LIMIT 1;
-- Expected: status = 'active', plan_json contains sessionTemplates array
```

Save the plan id:
```bash
PLAN_ID="<uuid from query>"
```

---

## SCENARIO 3 — Full Training Session (Happy Path)

### 3.1 Start a training session

```bash
curl -s -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" -H "X-Api-Key: dev-key" \
  -d "{\"userId\": \"$USER_ID\", \"message\": \"I want to train today\"}" | jq .data.content
```
**Expected:** Bot enters `session_planning` phase, asks about available time/energy/mood or proposes a session.

### 3.2 Confirm session

```bash
curl -s -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" -H "X-Api-Key: dev-key" \
  -d "{\"userId\": \"$USER_ID\", \"message\": \"Looks good, let's start\"}" | jq .data.content
```
**Expected:** Bot confirms session start, displays workout plan with exercise IDs, transitions to `training` phase.

**DB verification:**
```sql
SELECT id, status, session_key, session_plan_json->>'sessionName' AS session_name
FROM workout_sessions
WHERE user_id = '<USER_ID>' AND status = 'in_progress'
ORDER BY created_at DESC LIMIT 1;
-- Expected: status = 'in_progress', session_plan_json populated
```

Save session id:
```bash
SESSION_ID="<uuid from query>"
```

---

### 3.3 Log first exercise — Set 1

```bash
curl -s -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" -H "X-Api-Key: dev-key" \
  -d "{\"userId\": \"$USER_ID\", \"message\": \"Bench press set 1 done: 10 reps at 80kg, RPE 7\"}" | jq .data.content
```
**Expected response contains:** `"Set 1 logged: 10 reps @ 80 kg | RPE 7"`

**DB verification:**
```sql
SELECT se.exercise_id, se.status, ss.set_number, ss.set_data, ss.rpe
FROM session_exercises se
JOIN session_sets ss ON ss.session_exercise_id = se.id
WHERE se.session_id = '<SESSION_ID>'
ORDER BY ss.set_number;
-- Expected: 1 row, set_data->>'reps' = '10', set_data->>'weight' = '80', rpe = 7
```

---

### 3.4 Log Set 2 and Set 3 in one message (bulk logging)

```bash
curl -s -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" -H "X-Api-Key: dev-key" \
  -d "{\"userId\": \"$USER_ID\", \"message\": \"Did two more sets: set 2 was 8 reps at 82.5kg RPE 8, set 3 was 8 reps at 82.5kg RPE 9\"}" | jq .data.content
```
**Expected:** Bot logs both sets. Response confirms Set 2 and Set 3.
**Critical check:** LLM must use `order` field (order=1 for set 2, order=2 for set 3) so they execute in order.

**DB verification:**
```sql
SELECT ss.set_number, ss.set_data, ss.rpe
FROM session_exercises se
JOIN session_sets ss ON ss.session_exercise_id = se.id
WHERE se.session_id = '<SESSION_ID>'
ORDER BY ss.set_number;
-- Expected: 3 rows, set_number 1,2,3 with correct weights and rpe values
```

---

### 3.5 Move to next exercise

```bash
curl -s -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" -H "X-Api-Key: dev-key" \
  -d "{\"userId\": \"$USER_ID\", \"message\": \"Done with bench press, moving to squats\"}" | jq .data.content
```
**Expected:** Bot calls `complete_current_exercise`, acknowledges completion, tells user about next exercise.

**DB verification:**
```sql
SELECT exercise_id, status FROM session_exercises WHERE session_id = '<SESSION_ID>' ORDER BY order_index;
-- Expected: first exercise status = 'completed', second exercise status = 'in_progress' or 'pending'
```

---

### 3.6 Log squat sets

```bash
# Set 1
curl -s -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" -H "X-Api-Key: dev-key" \
  -d "{\"userId\": \"$USER_ID\", \"message\": \"Squat set 1: 5 reps at 100kg\"}" | jq .data.content

# Set 2
curl -s -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" -H "X-Api-Key: dev-key" \
  -d "{\"userId\": \"$USER_ID\", \"message\": \"Set 2: 5 reps 100kg\"}" | jq .data.content
```

---

### 3.7 Finish training

```bash
curl -s -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" -H "X-Api-Key: dev-key" \
  -d "{\"userId\": \"$USER_ID\", \"message\": \"I'm done for today, great session!\"}" | jq .data.content
```
**Expected:** Bot calls `finish_training`, confirms session complete with summary.

**DB verification:**
```sql
SELECT status, completed_at, duration_minutes
FROM workout_sessions WHERE id = '<SESSION_ID>';
-- Expected: status = 'completed', completed_at IS NOT NULL

SELECT se.exercise_id, se.status, COUNT(ss.id) AS sets_logged
FROM session_exercises se
LEFT JOIN session_sets ss ON ss.session_exercise_id = se.id
WHERE se.session_id = '<SESSION_ID>'
GROUP BY se.exercise_id, se.status;
-- Expected: all exercises completed, correct set counts
```

---

## SCENARIO 4 — Training History

### 4.1 Ask for training history via chat

```bash
curl -s -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" -H "X-Api-Key: dev-key" \
  -d "{\"userId\": \"$USER_ID\", \"message\": \"Show me my recent training history\"}" | jq .data.content
```
**Expected:** Bot summarises completed sessions with exercises and set counts.

### 4.2 Verify history in DB

```sql
SELECT ws.id, ws.status, ws.completed_at,
       COUNT(DISTINCT se.id) AS exercises,
       COUNT(ss.id) AS total_sets
FROM workout_sessions ws
LEFT JOIN session_exercises se ON se.session_id = ws.id
LEFT JOIN session_sets ss ON ss.session_exercise_id = se.id
WHERE ws.user_id = '<USER_ID>' AND ws.status = 'completed'
GROUP BY ws.id
ORDER BY ws.completed_at DESC;
-- Expected: at least 1 completed session with exercises and sets
```

---

## SCENARIO 5 — Second Training Session (Progressive Overload)

Start another training session after scenario 3. The bot should reference the previous session data in its coaching recommendations.

```bash
curl -s -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" -H "X-Api-Key: dev-key" \
  -d "{\"userId\": \"$USER_ID\", \"message\": \"Let's train again\"}" | jq .data.content
```
**Expected:** During exercise coaching, bot references previous session performance (last time you did 3×10 @ 80kg, suggesting 82.5kg today).

**DB verification (during training):**
```sql
SELECT ws.id, ws.status FROM workout_sessions
WHERE user_id = '<USER_ID>' AND status = 'in_progress';
-- Expected: exactly 1 active session
```

---

## SCENARIO 6 — ADR-0011 Hardening: Correction Tools

### 6.1 Delete a wrongly logged set

First log a set with wrong weight:
```bash
curl -s -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" -H "X-Api-Key: dev-key" \
  -d "{\"userId\": \"$USER_ID\", \"message\": \"Set 1 done: 10 reps 60kg\"}" | jq .data.content
```

Then correct it by asking to delete:
```bash
curl -s -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" -H "X-Api-Key: dev-key" \
  -d "{\"userId\": \"$USER_ID\", \"message\": \"Wait, that was wrong. Delete the last set please\"}" | jq .data.content
```
**Expected:** Bot calls `delete_last_sets`, response includes "Deleted 1 set(s)".

**DB verification:**
```sql
-- Count sets before and after — should be 1 fewer
SELECT COUNT(*) FROM session_sets ss
JOIN session_exercises se ON ss.session_exercise_id = se.id
WHERE se.session_id = '<SESSION_ID>';
```

---

### 6.2 Update a wrongly logged set weight

Log a set with wrong weight:
```bash
curl -s -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" -H "X-Api-Key: dev-key" \
  -d "{\"userId\": \"$USER_ID\", \"message\": \"Set done: 8 reps at 75kg\"}" | jq .data.content
```

Correct the weight:
```bash
curl -s -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" -H "X-Api-Key: dev-key" \
  -d "{\"userId\": \"$USER_ID\", \"message\": \"Actually it was 80kg not 75, please correct\"}" | jq .data.content
```
**Expected:** Bot calls `update_last_set`, response includes "Before" and "After" with weight change.

**DB verification:**
```sql
SELECT ss.set_data FROM session_sets ss
JOIN session_exercises se ON ss.session_exercise_id = se.id
WHERE se.session_id = '<SESSION_ID>'
ORDER BY ss.created_at DESC LIMIT 1;
-- Expected: set_data->>'weight' = '80'
```

---

### 6.3 Auto-complete on exercise switch

Mid-session, log a set for a different exercise without explicitly calling complete_current_exercise:
```bash
curl -s -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" -H "X-Api-Key: dev-key" \
  -d "{\"userId\": \"$USER_ID\", \"message\": \"Actually I'm doing pull-ups now: set 1, 8 reps\"}" | jq .data.content
```
**Expected:** Response includes "auto-completed" or "auto-skipped" notice for the previous exercise.

**DB verification:**
```sql
SELECT exercise_id, status FROM session_exercises
WHERE session_id = '<SESSION_ID>' ORDER BY order_index;
-- Expected: previous exercise status = 'completed' or 'skipped', new exercise status = 'in_progress'
```

---

## SCENARIO 7 — Negative / Edge Cases

### 7.1 Missing API key → 401

```bash
curl -s -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"userId": "any", "message": "hi"}' | jq .
```
**Expected:**
```json
{ "error": { "message": "Missing X-Api-Key" } }
```
**Status code:** 401

---

### 7.2 Invalid API key → 403

```bash
curl -s -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -H "X-Api-Key: wrong-key" \
  -d '{"userId": "any", "message": "hi"}' | jq .
```
**Expected:**
```json
{ "error": { "message": "Invalid API key" } }
```
**Status code:** 403

---

### 7.3 Empty message → 400

```bash
curl -s -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -H "X-Api-Key: dev-key" \
  -d "{\"userId\": \"$USER_ID\", \"message\": \"\"}" | jq .
```
**Expected:** 400 validation error.

---

### 7.4 Unknown user ID

```bash
curl -s -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -H "X-Api-Key: dev-key" \
  -d '{"userId": "00000000-0000-0000-0000-000000000000", "message": "hi"}' | jq .
```
**Expected:** 200 with error message from graph, or 500 if user not found causes unhandled error.
**Acceptable:** 500 with `error.message = "Processing failed"`.

---

### 7.5 Upsert idempotency — same provider user creates only one user

```bash
# Create user first time
curl -s -X POST http://localhost:3000/api/user \
  -H "Content-Type: application/json" -H "X-Api-Key: dev-key" \
  -d '{"provider":"telegram","providerUserId":"dup_test_002","firstName":"Dup"}' | jq .data.id

# Create same user again
curl -s -X POST http://localhost:3000/api/user \
  -H "Content-Type: application/json" -H "X-Api-Key: dev-key" \
  -d '{"provider":"telegram","providerUserId":"dup_test_002","firstName":"Dup Updated"}' | jq .data.id
```
**Expected:** Both calls return the same UUID. No duplicate in DB.

**DB verification:**
```sql
SELECT COUNT(*) FROM user_accounts
WHERE provider = 'telegram' AND provider_user_id = 'dup_test_002';
-- Expected: 1
```

---

### 7.6 Health check

```bash
curl -s http://localhost:3000/health | jq .
```
**Expected:**
```json
{ "status": "ok" }
```
**Status code:** 200

---

## SCENARIO 8 — Conversation History & Context

### 8.1 Verify conversation turns are stored

After any chat exchange:
```sql
SELECT phase, role, LEFT(content, 80) AS content_preview, created_at
FROM conversation_turns
WHERE user_id = '<USER_ID>'
ORDER BY created_at DESC LIMIT 10;
-- Expected: rows for 'user' and 'assistant' roles in the correct phase
```

### 8.2 Verify context is maintained across messages

Send two related messages:
```bash
curl -s -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" -H "X-Api-Key: dev-key" \
  -d "{\"userId\": \"$USER_ID\", \"message\": \"My name is Alex\"}" | jq .data.content

curl -s -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" -H "X-Api-Key: dev-key" \
  -d "{\"userId\": \"$USER_ID\", \"message\": \"What's my name?\"}" | jq .data.content
```
**Expected:** Second response references "Alex".

---

## SCENARIO 9 — Session Skip

### 9.1 Skip current exercise

During training:
```bash
curl -s -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" -H "X-Api-Key: dev-key" \
  -d "{\"userId\": \"$USER_ID\", \"message\": \"Skip bench press today, my shoulder hurts\"}" | jq .data.content
```
**Expected:** Bot calls acknowledges the skip with reason.

**DB verification:**
```sql
SELECT exercise_id, status, user_feedback FROM session_exercises
WHERE session_id = '<SESSION_ID>'
ORDER BY order_index;
-- Expected: skipped exercise has status = 'skipped'
```

---

## Pass / Fail Criteria

| Scenario | Pass Condition |
|----------|----------------|
| S1 — Registration | `profile_status = 'complete'` in DB after conversation |
| S2 — Plan creation | `workout_plans` row with `status = 'active'` exists |
| S3 — Training session | Session `status = 'completed'`, all sets in DB match what was reported |
| S4 — History | Bot references previous session data during next session warmup |
| S5 — Second session | Bot references previous weights in coaching |
| S6.1 — Delete set | Set count in DB decreases by 1 after delete request |
| S6.2 — Update set | `set_data->>'weight'` corrected in DB |
| S6.3 — Auto-complete | Previous exercise `status = 'completed'` after exercise switch |
| S7.1 — No API key | 401 |
| S7.2 — Wrong API key | 403 |
| S7.3 — Empty message | 400 |
| S7.5 — Upsert idempotency | Exactly 1 user_accounts row for same provider+providerUserId |
| S8 — Context | Bot remembers information from earlier in conversation |
| S9 — Skip exercise | `session_exercises.status = 'skipped'` |

---

## SCENARIO 10 — ADR-0011 LLM-in-the-Loop Checks

These scenarios require a real LLM and cannot be automated. Run them manually after any changes to `training.tools.ts`, `training.node.ts`, or `training.subgraph.ts`.

> For each check: start a fresh training session (Scenario 3.1–3.2), then trigger the scenario described.

### M1 — LLM corrects wrong weight using update_last_set

1. Log a set: `"Set 1 done: 8 reps at 70kg"`
2. Say: `"Wait, it was 75kg not 70"`
3. **Expected:** LLM calls `update_last_set`, response contains "Before" / "After" diff. No second `log_set` call.
4. **Fail if:** response says "Set 2 logged" or DB gains a new set row.

**DB check:**
```sql
SELECT COUNT(*) FROM session_sets ss
JOIN session_exercises se ON ss.session_exercise_id = se.id
WHERE se.session_id = '<SESSION_ID>';
-- Expected: count stays the same (1), weight updated to 75
```

---

### M2 — LLM deletes phantom set using delete_last_sets

1. Log a set: `"Set done: 10 reps 80kg"`
2. Say: `"That was wrong, I didn't actually do that set, please remove it"`
3. **Expected:** LLM calls `delete_last_sets(count=1)`, response confirms deletion. No new set logged.
4. **Fail if:** LLM apologises but doesn't call the tool, or calls `log_set` instead.

**DB check:**
```sql
SELECT COUNT(*) FROM session_sets ss
JOIN session_exercises se ON ss.session_exercise_id = se.id
WHERE se.session_id = '<SESSION_ID>';
-- Expected: 0 sets remaining
```

---

### M3 — LLM does not re-log sets from CONVERSATION HISTORY

1. Complete a full set logging exchange (e.g. log 2 sets).
2. Send a new unrelated message: `"How am I doing today?"`
3. **Expected:** LLM responds with encouragement or progress summary. No `log_set` tool calls triggered.
4. **Fail if:** DB gains new set rows after the unrelated message.

**DB check:**
```sql
SELECT COUNT(*) FROM session_sets ss
JOIN session_exercises se ON ss.session_exercise_id = se.id
WHERE se.session_id = '<SESSION_ID>';
-- Expected: count does not increase after the unrelated message
```

---

### M4 — Auto-complete notice appears when LLM switches exercise

1. Log 2 sets for exercise A (e.g. bench press).
2. Say: `"Moving on to squats now — set 1: 100kg × 5"`
3. **Expected:** LLM calls `log_set` with the squat exerciseId. Response includes "auto-completed" or "auto-skipped" for bench press.
4. **Fail if:** No notice about the previous exercise, or bench press remains `in_progress` in DB.

**DB check:**
```sql
SELECT exercise_id, status FROM session_exercises
WHERE session_id = '<SESSION_ID>' ORDER BY order_index;
-- Expected: bench press = 'completed', squat = 'in_progress'
```

---

### M5 — LLM uses order field for bulk set logging

1. Say: `"Just did 3 sets of bench press: 10@80kg, 8@82.5kg, 7@85kg"`
2. **Expected:** LLM calls `log_set` three times with `order=1`, `order=2`, `order=3`. Sets appear in DB in correct order.
3. **Fail if:** Sets appear in wrong order, or only 1-2 sets are logged.

**DB check:**
```sql
SELECT ss.set_number, ss.set_data FROM session_sets ss
JOIN session_exercises se ON ss.session_exercise_id = se.id
WHERE se.session_id = '<SESSION_ID>'
ORDER BY ss.set_number;
-- Expected: 3 rows in ascending set_number order with correct weights (80, 82.5, 85)
```

---

---

## Bug Reporting Protocol

Every test run must conclude with a **Bug Report** section. This is mandatory — do not skip even if no bugs are found.

### Format for each bug found

Record every bug in [`docs/BUGS.md`](BUGS.md) with the following structure:

**Required fields:**
- **Root cause** — exact line of code or prompt text responsible, not just a symptom description
- **Flow** — step-by-step trace from user action to broken outcome
- **Log evidence** — relevant lines from `logs/server.log` or `logs/bot.log` (use `tail -n N logs/server.log | cat`)
- **DB evidence** — SQL query + result proving the broken state (or confirming no state change when there should be one)
- **Impact** — who is affected, how often, what the user experiences
- **Fix plan** — where to fix (file + line), what change, which layer(s)
- **Regression test** — how to verify the fix did not break and will not regress

### Severity levels

- **Critical** — data loss, silent corruption, security issue, or complete feature failure for all users
- **High** — user-facing error or broken UX flow (e.g. empty response, wrong error message)
- **Medium** — incorrect but non-breaking behaviour (wrong text, missing field)
- **Low** — cosmetic or edge case with minimal user impact

### End-of-run summary table

After all scenarios, produce a summary table:

| Bug ID | Scenario | Severity | Component | Status |
|--------|----------|----------|-----------|--------|
| BUG-001 | S3.1 | High | chat.node.ts, handlers.ts | Open |

If no bugs found, write: "No bugs found in this run."

---

## Changelog

| Date | Change | Author |
|------|--------|--------|
| 2026-03-12 | Initial creation — full flow from registration to history | AI assistant |
