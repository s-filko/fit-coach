# Stale Session Auto-Close — a forgotten workout closes on return; the model can reopen it (BUG-053)

- Status: planned
- Branch: `plan/stale-session-autoclose`, cut from `dev`.
- Source: BUG-053 (`docs/BUGS.md` on `plan/plan-and-tool-fixes`; cause read from dev run `cf44f1fe`): a workout left
  `in_progress` (phone died, never finished) is still open days later; the next «привет» enters `training` with it,
  the context labels it `# Today`, and the coach continues it.
- Owner decisions (2026-10-08): **auto-close** — no extended window ("продлить тренировку на 6 часов ради дописать —
  это затычка"); the model gets a **tool to reopen** a closed workout when the user says it is a continuation or wants
  to add/correct sets. Technically not a wall, practically an old open session is not continued.
- Executor: orchestrator session on the Orca host; GLM workers; Opus close-out review; live check on the local stand.
  Server code in `apps/server/src` (paths relative to it), commands from `apps/server`.

## 0. Rules for the worker

Same as `plan-and-tool-fixes.md` § 0: base on `origin/dev` (check `git merge-base --is-ancestor origin/dev HEAD`), red
first with the failing line recorded in § 3, one commit per task `fix(<area>): … (stale-session-autoclose T<N>)`, no
attribution lines, tool texts state facts only (no instructions, no "always/never"), no prompt-file edits, no durable
spec edits (the orchestrator applies the owner-approved BR text in T4), escalate instead of guessing.

## 1. Tasks

### T1 — Close a stale in_progress session on the user's next message (AC-SSA-1)

`prepare.node.ts:69-71` keeps a session open forever ("NO idle timeout … the model decides"), against
INV-TRAINING-005 / BR-TRAINING-011.

Do:
- In `prepare`, phase `training` with `activeSessionId`: if the session is `in_progress` and idle longer than
  `SESSION_TIMEOUT_MS` (2 h, `domain/training/session-timing.ts`) — idle measured from
  `max(last_activity_at, reopened_at)` (T2) — complete it through the training service (the existing timeout
  auto-close path: `status = completed`, `auto_close_reason = 'timeout'`, `completed_at` = last activity, INV-TRAINING-006)
  and route this message to `chat` **without** a canned reply: the chat phase answers the user's message itself
  (no `session_ended_return_to_chat` catalog text for this case).
- Replace the "NO idle timeout" comment with the rule it now follows.
- A planning-status session is untouched (only `in_progress`).

Verify: unit tests on `prepare` — training + session idle 3 days → service close called, transition to chat, no catalog
AIMessage; idle 30 min → stays in training; reopened 10 min ago with old `last_activity_at` → stays. DB-backed: a
scenario/integration test that an idle session is `completed` with `auto_close_reason = 'timeout'` and
`completed_at = last_activity_at` after one message. `npm run test:unit`, `npm run test:integration`,
`npm run test:scenarios`.

### T2 — `reopen_workout`: the model can return the last closed workout to training (AC-SSA-2)

Do:
- Migration (via `npm run drizzle:generate`, never push): `workout_sessions.reopened_at timestamptz null`.
- Service method `reopenLastSession(userId)`: the user's most recent `completed` session (any close reason) →
  `status = in_progress`, `completed_at = null`, `auto_close_reason = null`, `reopened_at = now`; refuses (typed
  domain error) when another session is active or there is no completed session. `last_activity_at` is not touched, so
  sets logged into it follow BR-TRAINING-030 (retro-dated to the session's last activity).
- Tool `reopen_workout` (no arguments) in the `chat` and `session_planning` phases: calls the service and transitions to
  `training` with that session as `activeSessionId` (mirror `start_training_session`'s transition/hand-off). Reply text —
  facts only, e.g. `Workout of Sun Oct 4 reopened (started 09:54, last activity 11:31; 8 of 9 exercises logged).`
  Description — what it does, no usage advice: "Reopens the user's most recent finished workout so sets can be added or
  corrected; the sets already logged are kept."
- Existing `log_set` / `update_last_set` / `delete_last_sets` / `finish_training` work on the reopened session unchanged;
  it closes again by `finish_training` or by T1.

Verify: unit tests for the service (reopen, refuse with an active session, refuse with none) and the tool (transition to
training, factual reply); integration test on the migration + `reopenLastSession`; `npm run test:unit`,
`npm run test:integration`, `npm run test:scenarios`, `npm run db:local:migrate` dry on the test DB per CLAUDE.local.md.

### T3 — The chat context marks an auto-closed workout (AC-SSA-3)

The chat context already lists recent sessions (`chat-context.v1.ts` `buildRecentSessionsSection`: name, time ago,
duration, exercises). Add the fact that a session was closed automatically, e.g.
`- upper_a — 3 days ago, closed automatically after inactivity: …`. Fact only; no instruction. This changes a context
block the model reads → it goes through `prompt-doctor` with T2's tool (baseline vs candidate on the eval set, guard
cases below) before acceptance; new block version per BR-LLM-008 if the block is versioned.

Guard cases for the eval: (1) «привет» the day after an auto-closed workout → a greeting, no continuation; (2) «я
вчера не дописал планку, 2 по 45 сек» → `reopen_workout` then `log_set`; (3) «продолжаем» within the same day after an
auto-close → reopen; (4) a normal new-workout request → `session_planning`, no reopen.

### T4 — Spec (orchestrator, after the owner approves the wording)

Proposed, shown to the owner before any edit of `docs/domain/training.spec.md`:
- INV-TRAINING-005 → "An in_progress session idle more than 2 hours (idle from max(last_activity_at, reopened_at)) is
  completed automatically at the user's next message, before the phase runs; completed_at = last_activity_at."
- BR-TRAINING-011 → "Sessions auto-close after 2 hours inactivity, lazily on the user's next message (no scheduled job)
  [INV-TRAINING-005]."
- BR-TRAINING-030 → add "…including a session returned by reopen_workout".
- New BR: "reopen_workout returns the user's most recent completed session to in_progress (reopened_at = now), keeping
  its sets; refused when another session is active; it closes again by finish_training or INV-TRAINING-005."

## 2. Close

Suites (`check-all`, unit, `DB_PORT=5999` unit, integration, scenarios — DB suites one at a time) → close-out review
(four Opus zones) → live check on the stand: a workout with sets, `last_activity_at` moved back 3 h in
`fitcoach_local`, «привет» → chat greeting and the session `completed/timeout`; «я не дописал планку» → reopen + log,
set dated to the last activity; evidence in § 3. Merge, deploy and the dev data stay with the owner (the open dev
session `9a24d418` closes itself on the owner's next message after deploy).

## 3. Worker log (append; newest last)
