# Stale Session Auto-Close — a forgotten workout closes on return; the model edits a finished workout in place (BUG-053)

- Status: in progress
- Branch: plan/stale-session-autoclose
- Cut from `dev` (the § 0 base rule keeps the branch on the origin/dev merge-base).
- Source: BUG-053 (`docs/BUGS.md` on `plan/plan-and-tool-fixes`; cause read from dev run `cf44f1fe`): a workout left
  `in_progress` (phone died, never finished) is still open days later; the next «привет» enters `training` with it,
  the context labels it `# Today`, and the coach continues it.
- Owner decisions (2026-10-08): **auto-close** — no extended window ("продлить тренировку на 6 часов ради дописать —
  это затычка"); a forgotten set is added by **editing the finished workout in place** (T5: `edit_last_workout`, the
  workout stays completed) — not by reopening it (T2's `reopen_workout` was built, then superseded: reopening leaves
  the workout open and a new workout then conflicts with it). Technically not a wall, practically an old open session
  is not continued.
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
  `SESSION_TIMEOUT_MS` (2 h, `isStale` in `domain/training/session-timing.ts`, idle from `last_activity_at`),
  `prepare` only DETECTS it (ADR-0013 §4.1) and requests a transition to `chat` with reason `session_timeout`, routed
  to `commit`: commit's session lifecycle handler completes the session through the existing timeout auto-close path
  (`status = completed`, `auto_close_reason = 'timeout'`, `completed_at` = last activity, INV-TRAINING-006) and the
  run hands off to `chat` in the same run **without** a canned reply: the chat phase answers the user's message itself
  (no `session_ended_return_to_chat` catalog text for this case).
- Replace the "NO idle timeout" comment with the rule it now follows.
- A planning-status session is untouched (only `in_progress`).

Verify: unit tests on `prepare` — training + session idle 3 days → service close called, transition to chat, no catalog
AIMessage; idle 30 min → stays in training; fresh activity → stays. DB-backed: a
scenario/integration test that an idle session is `completed` with `auto_close_reason = 'timeout'` and
`completed_at = last_activity_at` after one message. `npm run test:unit`, `npm run test:integration`,
`npm run test:scenarios`.

### T2 — `reopen_workout` — **superseded by T5** (owner 2026-10-08): the model can return the last closed workout to training (AC-SSA-2)

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
вчера не дописал планку, 2 по 45 сек» → `edit_last_workout` add; (3) «продолжаем» within the same day after an
auto-close → `edit_last_workout` add or a text answer, no reopen (there is none); (4) a normal new-workout request → `session_planning`, no reopen.

### T5 — `edit_last_workout` replaces `reopen_workout` (AC-SSA-5)

Owner decision (2026-10-08, after reviewing T2): do not reopen a finished workout to add a forgotten set — reopening
leaves it open (back in training, idle clock restarted) and a new workout then conflicts with it. Instead one tool edits
the most recent FINISHED workout in place; the workout stays closed and the conversation stays where it is. Shape like
`manage_fact` (one tool, an action field).

Do:
- Tool `edit_last_workout` (chat, session_planning and training phases) with `action`: `add` (exercise + sets:
  reps / weight / durationSeconds / distanceKm, same validation and weight rules as `log_set`), `update` (exercise +
  optional setNumber, default the last set of that exercise + new values; same conversions as `update_last_set`),
  `delete` (exercise + setNumber); calling it with an exercise and no change returns that exercise's sets in the last
  finished workout. Target = the user's most recent `completed` session only.
- Sets added get the retro timestamp of that workout (last activity + offset, BR-TRAINING-030 logic); the session's
  `completed_at`, `duration_minutes`, `last_activity_at` and `status` do not change. An exercise not in that workout is
  added to it.
- Reply — facts only: what changed and the exercise's sets in that workout after the change, e.g.
  `Bench Press, Sun Oct 4: 8×55, 10×55 (set 2 updated: 8 → 10)`. Description — what it does, no advice.
- Remove T2's `reopen_workout`, `reopenLastSession`, the `reopened_at` column and its migration, the idle base
  `max(last_activity_at, reopened_at)` (back to `last_activity_at`) and the chat → training matrix edge; T3's chat-context
  marker stays. Journeys c-catch-up-logging and retro-timestamps use `edit_last_workout` add instead of reopen.

Verify: unit (each action, the weight rules, the factual reply, the view call, refusal when there is no finished
workout); integration (the session stays completed, times unchanged, retro timestamps on added sets); scenarios green.

### T4 — Spec (orchestrator, after the owner approves the wording)

Proposed, shown to the owner before any edit of `docs/domain/training.spec.md`:
- INV-TRAINING-005 → "An in_progress session idle more than 2 hours (from last_activity_at) is completed at the user's
  next message; completed_at = last_activity_at; no scheduled job."
- BR-TRAINING-011 → "Sessions auto-close after 2 hours inactivity, lazily at the user's next message (no scheduled job)
  [INV-TRAINING-005]."
- BR-TRAINING-030 → rewritten: "Sets added to a finished workout (edit_last_workout) are dated last_activity_at + 5 min
  and do not change the workout's status, times or duration."
- New BR: "edit_last_workout adds, updates or deletes sets in the user's most recent completed workout only; the workout
  stays completed; a row gaining its first set becomes completed, a row losing its last set becomes skipped."
- To be amended (FEAT-0010): S-0114, AC-0207 and BR-TRAINING-024 still promise a daily 3 AM cron that never existed —
  they are named here as to-be-amended with the lazy auto-close above.

## 2. Close

Suites (`check-all`, unit, `DB_PORT=5999` unit, integration, scenarios — DB suites one at a time) → close-out review
(four Opus zones) → live check on the stand: a workout with sets, `last_activity_at` moved back 3 h in
`fitcoach_local`, «привет» → chat greeting and the session `completed/timeout`; «я не дописал планку» → `edit_last_workout` add,
the set dated to the last activity and the session still `completed`; evidence in § 3. Merge, deploy and the dev data stay with the owner (the open dev
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

### T2 — `reopen_workout`: the model can return the last closed workout to training (AC-SSA-2) — 2026-10-08, worker

Red first (failing lines recorded before implementation):
- `src/domain/training/__tests__/session-timing.unit.test.ts:45` (also `:53`, `:60`) — TS2353: `reopenedAt` does not exist in `autoCloseIdleSince`'s input type.
- `src/domain/training/services/__tests__/training-service-reopen.unit.test.ts:8` — TS2305: no exported member `NoCompletedSessionError`; `:47`/`:71`/`:82` — `reopenLastSession` does not exist on `TrainingService`; `:36`/`:80` — `findLastCompletedByUserId` not on the repo port.
- `src/infra/ai/tools/__tests__/reopen-workout.tool.unit.test.ts:10` — TS2305 `NoCompletedSessionError`; `:18` — TS2307: module `../reopen-workout.tool` not found.
- `src/domain/conversation/__tests__/transitions.unit.test.ts` — ✕ 'BR-CONV-015: matches today's guard matrix verbatim', ✕ 'BUG-053 T2: allows chat → training with an active session', ✕ 'BUG-053 T2: chat → training without a session is still blocked'.

Code:
- Migration `0024_panoramic_adam_destine.sql` (`npm run drizzle:generate`): `workout_sessions.reopened_at timestamptz null`; `schema.ts` + `types.ts` (`reopenedAt: Date | null`) follow. Applied to the shared test DB with `NODE_ENV=test npx drizzle-kit migrate` under the flock.
- `session-timing.ts`: `autoCloseIdleSince` now returns `max(last_activity_at, reopened_at)` (activity via `lastActivityOf`'s fallbacks); `isStale` untouched (retro-dating keeps the last-activity base, BR-TRAINING-030).
- `workout-session.repository.ts`: `findTimedOut`/`autoCloseTimedOut` use the same base — `greatest(last_activity_at, reopened_at) < cutoff` (Postgres GREATEST ignores NULLs) — so a just-reopened workout is not closed at the next sweep; new `findLastCompletedByUserId` (most recent `completed`, any close reason, `completed_at` DESC) on the repo + port.
- `training.service.ts` + port: `reopenLastSession(userId)` — timeout sweep first (a stale leftover never refuses the reopen), typed refusals `ActiveSessionExistsError` (live session, INV-TRAINING-002) and the new `NoCompletedSessionError` (nothing completed); the write sets `status = in_progress`, `completed_at = null`, `auto_close_reason = null`, `reopened_at = now` and deliberately not `last_activity_at` (BR-TRAINING-030).
- `infra/ai/tools/reopen-workout.tool.ts` (+ index export): no arguments, calls the service, returns `{ pendingTransition: training/'workout_reopened', activeSessionId }`; the result states facts only — `Workout <name> (<weekday mon day>) reopened (started HH:MM, last activity HH:MM; N of M exercises logged).` — times in the user's timezone via `maybeCtxOf`. Wired into the chat and session_planning tool lists (`chat.spec.ts`, `session-planning.spec.ts`).

(D) TRANSITION_MATRIX gained `chat → training` (owner decision 2026-10-08, coordinator ruling '(a), narrowly' on ask of 2026-10-08): only `reopen_workout` can take the edge — the chat `request_transition` schema still excludes 'training' (pinned by a new test), and BR-CONV-016's no-active-session guard still blocks a sessionless chat → training (pinned). The BR-CONV-015 amendment goes to T4's spec texts for owner approval before merge.

Journeys re-enabled ('restored in T2 via reopen_workout' blocks from T1):
- `c-catch-up-logging` (scenario + test): step 9's script is `reopen_workout` → 3× `log_set` → the ruling's reply (the chat → training hand-off, so the deterministic layer sets `TRANSITION_HANDOFF_TARGETS=training,session_planning` in beforeAll); the T1-era text-only assertions were replaced by the restored ones — stale `# Today` fact line, retro sets + timestamps (last activity + `RETRO_SET_OFFSET_MS`), same-session check, plus new reopen facts (in_progress again, `auto_close_reason`/`completed_at` cleared, `reopened_at` set, reopen before log_set in the run row). Steps 10–11 (advance +3.75 h, `finish_training`, completed AT the last activity, duration 11) restored verbatim with their assertions.
- `retro-timestamps` (test): the gym turn (+180 m) now scripts `reopen_workout` then the first `log_set` — prepare's auto-close fires on the empty session, the reopen returns it, the first set is a late start (`started_at` re-anchors), and all 16 sets + finish + AC-RT-3/AC-RT-4 assertions are restored verbatim; `TRANSITION_HANDOFF_TARGETS` set in beforeAll.
- Pins updated for the new tool lists: `phase-specs.unit.test.ts` (chat, session_planning), `handoff.unit.test.ts` (registration → training is the blocked example now), test-support/fixtures gained `reopenedAt`.
- New: `training-service-reopen.unit.test.ts` (3 cases), `reopen-workout.tool.unit.test.ts` (4 cases incl. factual-text and no-instruction checks), `tests/integration/services/reopen-workout.integration.test.ts` (5 cases: migration round-trip, both refusals, the `max()` idle base keeping a just-reopened workout open while an old reopening closes it with `completed_at = last_activity_at`, newest-completed wins).

Verification (from `apps/server`; DB suites under `flock /tmp/fitcoach-testdb.lock`):
- `npm run check-all` → 0 errors (lint + format:check + tsc --noEmit).
- `npm run test:unit` → Tests: 1826 passed, 1826 total (Suites: 185/185).
- `npm run test:integration` → Tests: 669 passed, 1 todo, 670 total (Suites: 56/56).
- `npm run test:scenarios` → Tests: 399 passed, 1 todo, 400 total (Suites: 24/24).

### T3 — The chat context marks an auto-closed workout (AC-SSA-3) — 2026-10-08, worker (code part; the prompt-doctor eval of this line runs in the orchestrator's live measurement, journeys g/h)

Red first (failing lines recorded before implementation):
- `src/infra/ai/prompts/blocks/__tests__/chat-context.v2.unit.test.ts:11` — TS2307: Cannot find module '../chat-context.v2'.
- `tests/integration/scenarios/stale-session-autoclose.integration.test.ts` — ✕ 'AC-SSA-3: the chat prompt marks the workout as closed automatically (the fact, in the recent-sessions list)' (1 failed, 7 passed).

Code:
- New block version `chat-context.v2.ts` (BR-LLM-008, the active-plan/user-facts v2 precedent): same id `chat.context`, version 'v2', depths [5,3,1]; `chat.spec.ts` renders V2; v1 stays untouched (its byte-identity proof tests still pass). No registry change: like the other phase-specific blocks, `chat.context` is not stamped by `promptVersionsForPhase`.
- The fact: on a `auto_close_reason = 'timeout'` line the recent-sessions list carries `closed automatically after inactivity` between the time and the duration — `- upper_a — 3 days ago, closed automatically after inactivity, 97 min: …`. `manual`/`new_session_started`/null show no marker — a reopened-then-finished session's reopen cleared the reason, so it is unmarked by construction. Without a timeout-closed session the render is v1 byte for byte (pinned by a test).
- v1's `buildChatContextText` gained an injectable recent-sessions section builder (default = v1's own), so v2 reuses the whole text without duplicating it; existing callers (the legacy CHAT_V1 phase module) are unchanged.
- Loader: `findRecentByUserIdWithDetails` already selects `auto_close_reason` (all columns) — verified end to end by the scenario's seen assertion.
- Snapshots: none updated — the eval fixtures' sessions carry `autoCloseReason: null`/`manual`, so every pinned assembly renders v2 == v1 (the byte-identity-without-timeout test pins this).

Tests: `chat-context.v2.unit.test.ts` (6 cases: the marker and its position, manual/new_session_started/null, reopened-then-finished, byte-identity without a timeout close, the section builder, id/version pins); the stale-session scenario gained the AC-SSA-3 seen assertion — the chat prompt of the «привет» run after the auto-close carries the marked line.

Verification (from `apps/server`; DB suites under `flock /tmp/fitcoach-testdb.lock`):
- `npm run check-all` → 0 errors (lint + format:check + tsc --noEmit).
- `npm run test:unit` → Tests: 1832 passed, 1832 total (Suites: 186/186).
- `npm run test:scenarios` → Tests: 400 passed, 1 todo, 401 total (Suites: 24/24).

### Review fixes — the code-level blocking findings of the close-out review — 2026-10-08, worker

Report: `data/investigations/2026-10-08-review-stale-session-autoclose.md`. The T4 spec texts stay owner-gated (untouched here).

Red first (failing lines recorded before implementation):
- `src/infra/ai/tools/__tests__/reopen-workout.tool.unit.test.ts:103` — `expect(outcome).toMatchObject({ ok: false, kind: 'user_error' })` — Received `"kind": "llm_error"`; same diff at `:117` (NoCompletedSession case).
- `src/infra/ai/prompts/blocks/__tests__/chat-context.v2.unit.test.ts:112` — TS2554: Expected 3 arguments, but got 4 (`buildRecentSessionsSection(…, { markAutoClosed: true })`).
- The INV-002 guard reuse and the Branch header fix change no behaviour — the existing green pins cover them (reopen unit tests, v1 byte-identity tests), so no red line applies.

Changes:
- R2 `training.service.ts` — `reopenLastSession` calls the private `assertNoActiveSession` (the one place the INV-TRAINING-002 refusal is written) instead of the inline sweep+check+throw copy.
- R2 `chat-context.v2.ts` — the copied `buildRecentSessionsSectionV2` is deleted; v1's `buildRecentSessionsSection` gained `opts.markAutoClosed` (the `buildActivePlanSection({ omitTargetWeights })` precedent) and v2's render delegates to it through `buildChatContextText`'s section injection; v1's output stays byte-identical (its tests prove it). Barrel export of the v2 builder removed with the function.
- R1 `reopen-workout.tool.ts` — `ActiveSessionExistsError`/`NoCompletedSessionError` return `userError(err.message)` (ADR-0013 §6: a valid call the business rule says no to — the model relays it; `llm_error` stays for model-fixable argument errors); factual texts unchanged; the two unit refusals now pin the kind.
- R4 plan header — the `- Branch:` line is the bare branch name (`state.mjs` parses the whole rest of the line); the "cut from `dev`" prose moved to its own bullet; `node scripts/state.mjs --write` regenerated the AUTO block (the false "branch no longer exists" warning is gone) and `--check` passes.

Class-closing search (same shapes elsewhere):
- Inline INV-002 guard copies: every other `findActiveByUserId` use in the service is the guard helper itself (`:525`) or a lookup that returns instead of refusing (`getActiveSession:286`; the plan-repo variants are a different aggregate) — `reopenLastSession` was the only copy.
- Business refusals mapped to `llmError` in tools: of the 14 `llmError(` sites in `src/infra/ai/tools`, only reopen-workout mapped typed domain refusals; `get-exercise-history`'s `ExerciseNotFoundError` → llmError is deliberate and documented on the spot (the model recovers via `search_exercises` — a prior close-out's ruling). The remaining sites wrap generic catch messages in tools this branch did not touch (finish-training, delete-last-sets, update-last-set, log-set, complete-current-exercise, set-session-place) — pre-existing shape, left as is.

Verification (from `apps/server`; DB suites under `flock /tmp/fitcoach-testdb.lock`):
- `npm run check-all` → 0 errors (lint 0 errors, format:check clean, tsc --noEmit).
- `npm run test:unit` → Tests: 1832 passed, 1832 total (Suites: 186/186).
- `npm run test:integration` → Tests: 670 passed, 1 todo, 671 total (Suites: 56/56).
- `npm run test:scenarios` → Tests: 400 passed, 1 todo, 401 total (Suites: 24/24).
- `node scripts/state.mjs --check` → state check: OK.

### T5 — `edit_last_workout` replaces `reopen_workout` (AC-SSA-5) — 2026-10-08, worker

Red first (before implementation):
- `src/infra/ai/tools/__tests__/edit-last-workout.tool.unit.test.ts:22` — TS2307: module `../edit-last-workout.tool` not found.
- `src/domain/training/services/__tests__/training-service-edit-finished.unit.test.ts` — suite FAIL (`getLastFinishedSession` / `deleteSet` / `finishedSession` / `setNumber` do not exist; exact TS lines not captured).
- ✕ 'BR-CONV-015: matches today's guard matrix verbatim' (chat → training edge still present), ✕ phase-specs tools lists for chat / session_planning / training (no `edit_last_workout`), ✕ handoff 'rejects when evaluateTransition would block it' (chat → training still allowed).

Code:
- Removed: `reopen_workout` tool, `reopenLastSession`, `NoCompletedSessionError`, `reopened_at` (schema, type, migration `0024`, its snapshot and journal entry), the idle base `max(last_activity_at, reopened_at)` (back to `last_activity_at` in `session-timing.ts` and the repo), the chat → training matrix edge and its tests.
- `edit_last_workout` (chat, session_planning, training): `action` add | update | delete; no action = the exercise's sets (no exercise = the whole workout). Target = most recent `completed` session (`getLastFinishedSession`). `add` → `logSetWithContext` (new `finishedSession` option: no exercise-status changes, no activity bump, a new exercise row is `completed`) with `createdAt` = last activity + `RETRO_SET_OFFSET_MS`; set-data mapping and weight carry-over moved from `log-set.tool.ts` to shared `set-input.ts`. `update` → `updateLastSet` (new optional `setNumber`). `delete` → new `deleteSet`. Replies state facts only.
- Journeys: `c-catch-up-logging` (scenario + test): catch-up adds 3 pull-ups with `edit_last_workout`, workout stays completed/timeout, sets at last activity + 5 min; the finish step is gone. `retro-timestamps`: the gym turn adds one set with `edit_last_workout`; the 16-live-set journey and AC-RT-3/AC-RT-4 live assertions have no path any more (a finished workout is not reopened) and were removed.
- (D) Test DB: `ALTER TABLE workout_sessions DROP COLUMN reopened_at` applied inside the lock (the test DB has no drizzle migrations table).

Verification (from `apps/server`; DB suites under `flock /tmp/fitcoach-testdb.lock`):
- `npm run check-all` → 0 errors (1281 warnings, pre-existing kind).
- `npm run test:unit` → Tests: 1837 passed, 1837 total (Suites: 186/186).
- `npm run test:integration` → Tests: 640 passed, 1 todo, 641 total (Suites: 56/56).
- `npm run test:scenarios` → Tests: 370 passed, 1 todo, 371 total (Suites: 24/24).

### Review pass 2 — R1–R4 of the Opus close-out review — 2026-10-08, worker

Red first: `stale-session-autoclose.unit.test.ts` ✕ 'in_progress idle 3 days → a session_timeout transition to chat goes to commit' (prepare still closed the session itself and went to `route`); `commit.node.unit.test.ts` ✕ 'review R1: a session_timeout transition to chat hops with the flag off'; `session-lifecycle.handler.unit.test.ts` ✕ 'review R1: reason session_timeout → the timeout auto-close'; `training-service-edit-finished.unit.test.ts` ✕ 'a set added to a skipped row makes the row completed' and ✕ 'deleting the last set … makes it skipped'. The real-repository tests (skipped row, delete-last, NULL `completed_at`) were written with the fix, not run red.

Code:
- R1: `prepare` only detects the stale session and returns `goto: 'commit'` with `pendingTransition { toPhase: 'chat', reason: 'session_timeout' }` (no canned reply). The session lifecycle handler (commit) performs `autoCloseTimedOutSessions`; `isAcceptedHandoff` treats the reason as a forced hand-off (any `TRANSITION_HANDOFF_TARGETS`), so chat answers the user's message in the same run. (D) a handler failure is logged by commit and the run continues (the existing handler contract) — the session then stays `in_progress` until the next sweep.
- R2: `prepare` uses `isStale`; `autoCloseIdleSince` deleted (its tests moved to `isStale` / `lastActivityOf`).
- R3: a row gaining its first set in a finished workout ends `completed` (also from `skipped`); `deleteSet` on a completed session makes a row that lost its last set `skipped`; `findLastCompletedByUserId` filters `completed_at IS NOT NULL` (NULLs sort first on DESC). c-catch-up asserts the Pull-ups D7 row is `completed`.
- R4: plan title, owner decisions, T1, T3 guard cases, T4 texts, § 2 swept; branch-filed BACKLOG entries for reopen dropped, doc-drift item updated; chat-context.v2 test header.

Verification (from `apps/server`; DB suites under `flock /tmp/fitcoach-testdb.lock`):
- `npm run check-all` → 0 errors.
- `npm run test:unit` → Tests: 1840 passed, 1840 total (Suites: 186/186).
- `npm run test:integration` → Tests: 645 passed, 1 todo, 646 total (Suites: 56/56).
- `npm run test:scenarios` → Tests: 372 passed, 1 todo, 373 total (Suites: 24/24).

## Review

Close-out review 2026-10-08 — pass 1 by a GLM reviewer session (four zones, owner order: everything on GLM until the
weekly GLM reset) over the T1–T3 code; pass 2 by Opus over the T5 code (`d2c739f2`). Raw findings of pass 1:
`data/investigations/2026-10-08-review-stale-session-autoclose.md` (local, gitignored). Pass-1 findings that concerned
the reopen path (`reopen_workout`, `reopened_at`, the chat → training edge) are void: T5 removed that code. Still
standing from pass 1 and fixed: the shared recent-sessions builder and the Branch header (`5005d057`).

Pass 2 (Opus) — blocking:

1. `R1 | prepare.node.ts:105-117 | ADR-0013 §4.1 | prepare completed the session itself (a side effect that belongs to
   commit)` — fixed in `957a5593` (prepare requests a `session_timeout` transition; the lifecycle handler at commit
   closes it; forced same-run hand-off to chat).
2. `R2 | prepare.node.ts:107-110 | DRY | duplicated isStale(); pass-through autoCloseIdleSince` — fixed in `957a5593`.
3. `R3 | training.service.ts:225 | AC-SSA-5 | edit_last_workout add into a skipped row left it skipped; deleting the last
   set left a completed row empty; findLastCompletedByUserId picked a NULL completed_at first` — fixed in `957a5593`.
4. `R4 | plan, BACKLOG | stale text for the reopen design` — fixed in the docs commit of this pass (plan swept, BACKLOG
   entries for the reopen path dropped). **Open, owner-gated (T4):** the durable spec texts in § 1 T4 (INV-TRAINING-005,
   BR-TRAINING-011/030, the new `edit_last_workout` BR, FEAT-0010 cron lines) — the orchestrator applies them.

Advisories → `docs/BACKLOG.md` § stale-session-autoclose close-out review advisories (doc drift: FEAT-0010 cron lines,
training.spec port list, ARCHITECTURE.md prepare map, API_SPEC training flow, BACKLOG.md:391).

Suites after the fixes (`957a5593`): check-all 0 errors; unit 1840/1840; integration 645 + 1 todo; scenarios 372 + 1 todo.

### T4 — spec texts applied (orchestrator, 2026-10-08)

Owner-approved in chat 2026-10-08 ("в остальном ок" for auto-close; "ок" for edit_last_workout). Applied:
`docs/domain/training.spec.md` INV-TRAINING-005, BR-TRAINING-011, BR-TRAINING-049 (sets added to a finished workout; BR-TRAINING-030 kept unchanged — it still defines in-progress retro-logging),
new BR-TRAINING-048 (048, not 047: `plan/plan-and-tool-fixes` adds 047); `docs/features/FEAT-0010-training-session-management.md`
S-0114, AC-0207, BR-TRAINING-024 (no scheduled job). ADR-0013 needs no amendment: the close now executes in commit
(review pass 2, item R1). Owner-gated, not applied: ADR-0011 (training correction tool set) does not list
edit_last_workout yet.
