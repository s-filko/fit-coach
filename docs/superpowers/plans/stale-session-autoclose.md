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

### T1 — Close a stale in_progress session on the user's next message (AC-SSA-1) — 2026-10-08, worker

Red first (failing lines recorded before implementation):
- `src/infra/ai/graph/__tests__/stale-session-autoclose.unit.test.ts:85` — `expect(autoClose).toHaveBeenCalledTimes(1)`: the close was never called (0 times).
- same file `:141` — the close's rejection: "Received promise resolved instead of rejected".
- `src/domain/training/__tests__/session-timing.unit.test.ts:7` — TS2305: no exported member 'autoCloseIdleSince'.

Code (one path, no new domain rules):
- `domain/training/session-timing.ts`: `autoCloseIdleSince` — the one idle-moment helper for the auto-close (`lastActivityOf`'s fallback chain); T2 extends it to `max(last_activity_at, reopened_at)`. Kept separate from `isStale` on purpose: retro-dating (BR-TRAINING-030) keeps measuring from the last activity, so the two bases diverge in T2.
- `domain/training/ports/training-service.ports.ts` + `services/training.service.ts`: `autoCloseTimedOutSessions(userId)` exposed on the port (was private) — the existing timeout auto-close verbatim: finish reconciliation, then the repo close (`status = completed`, `auto_close_reason = 'timeout'`, `completed_at` = last activity clamped to `started_at`, INV-TRAINING-006). At most one in_progress session exists per user (INV-TRAINING-002), so the user-scoped call closes exactly the session prepare verified.
- `infra/ai/graph/nodes/prepare.node.ts`: training + `in_progress` + idle > `SESSION_TIMEOUT_MS` (from `ctx.now` through `autoCloseIdleSince`) → close via the service, then a direct phase write to `chat` + `activeSessionId = null`, NO canned reply — the run continues to `route` and the chat agent answers the user's message itself. Planning sessions untouched. The "NO idle timeout" comment replaced with the INV-TRAINING-005 rule it now follows.

(D) The stale-close routes to chat by a direct phase write (the registration-sync shape), not a `pendingTransition` through commit: commit → END would end the run with the user's message unanswered (the plan forbids the `session_ended_return_to_chat` text for this case), and the commit → route hop fires only for `TRANSITION_HANDOFF_TARGETS` (unset on the stand, `training,session_planning` in the smoke env — chat is never a target). Cost: the run row reads `phase_in = chat`, `transition = null`; the prepare log line ('Stale session auto-closed — answering in chat') carries the fact.
(D) No new per-session close method: the repo owns the timeout write fields; a per-session service variant would duplicate them, and the repo is outside T1 ownership. The user-scoped existing path is equivalent under INV-TRAINING-002.

Journey collisions (coordinator ruling on ask `msg_dcda235f03e3`, 2026-10-08): journey C and retro-timestamps pinned the pre-BUG-053 >2 h catch-up behaviour the owner's 2026-10-08 decision supersedes. Rewritten to the new rule; reopen-dependent steps parked verbatim under `restored in T2 via reopen_workout` (no knownBug marks):
- `evals/scenarios/c-catch-up-logging.scenario.ts` — step 9: script is text-only (`CATCH_UP_T1_TEXT`); expectations `tools.mustNot: [log_set]`, session `completed` + `hasCompletedAt`, `phaseAfter chat` (were: 3× `log_set`, retro `seen` markers in `# Today`, session `in_progress`, phase training). Steps 10–11 (advance +3.75 h, `finish_training`) and the 3× log_set catch-up script parked verbatim in the marked block. liveOnly markers kept exported for T2/T3's L3 re-eval.
- `tests/integration/scenarios/c-catch-up-logging.integration.test.ts` — step 9 now asserts: `auto_close_reason = 'timeout'`; `completed_at` = the last pre-pause activity (set 2, the 11–12.5 min window); no tool ran, no new session; the reconcile outcome (bench keeps its 2 sets, planned Pull-ups gets an empty skipped row — set-kind D7); phase chat. The old assertions (stale `# Today` fact line, retro sets and timestamps, the whole step-11 finish block) are parked in the file's marked comment.
- `tests/integration/scenarios/retro-timestamps.integration.test.ts` — journey truncated to the gym arrival (+180 m): the empty session (2 h 55 m idle) closes with `auto_close_reason = 'timeout'`, `completed_at` = the clamped last activity (the BUG-043 clamp shows here: a never-started session's `started_at` can exceed `last_activity_at` by ~1 s of harness drift — asserted as `max()` of the two, still the creation moment), no set persisted, phase chat, text-only reply. The 16-live-sets + finish steps and the AC-RT-3/AC-RT-4 assertions are parked verbatim (T2's reopen + late start restores the journey).
- `src/infra/ai/graph/__tests__/conversation.graph.unit.test.ts` — the old rule's pin ('in_progress session: no auto-close', a 3 h-idle session) rewritten into the new rule through the real graph (auto-close called, phase chat, `activeSessionId` null, delivered = the chat agent's text) plus a within-timeout control; `autoCloseTimedOutSessions` added to the fixture's training service.
- New: `src/infra/ai/graph/__tests__/stale-session-autoclose.unit.test.ts` (5 prepare cases incl. the 2 h boundary and close-failure propagation), `src/domain/training/__tests__/session-timing.unit.test.ts` (pins the helper's base for T2), `tests/integration/scenarios/stale-session-autoclose.integration.test.ts` (journey B setup → one set → +3.5 h → «привет»: completed/timeout, `completed_at = last_activity_at`, phase chat, scripted chat reply, no catalog text, no tools).

Note for T2: extend `autoCloseIdleSince` to `max(last_activity_at, reopened_at)` (its unit tests pin the base) and re-enable the two parked blocks together with `reopen_workout`.

Verification (from `apps/server`; DB suites under `flock /tmp/fitcoach-testdb.lock` — the shared test DB is also used by another worker):
- `npm run check-all` → 0 errors (lint + format:check + tsc --noEmit).
- `npm run test:unit` → Tests: 1813 passed, 1813 total (Suites: 183/183).
- `npm run test:integration` → Tests: 630 passed, 1 todo, 631 total (Suites: 55/55).
- `npm run test:scenarios` → Tests: 365 passed, 1 todo, 366 total (Suites: 24/24).
- Caveat: before the flock instruction arrived (mid-run), my unlocked DB runs raced the other worker once — one c-catch-up run failed 40 tests transiently; everything above was re-verified under the lock.

