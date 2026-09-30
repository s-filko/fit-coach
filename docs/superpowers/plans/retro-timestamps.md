# Retro Timestamps (BUG-043) — Investigation, Red Tests, Fix Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans and superpowers:test-driven-development. Red tests first
> (T2), fix second (T3). Execute only the dispatched task. T1 (this document) changed no production code.

- Status: in progress
- Branch: plan/retro-timestamps
- After: —

**Goal:** a live workout that starts after a long idle gap must get live timestamps: sets stamped "now", activity
advancing, `completed_at >= started_at`, duration never negative — without breaking the deliberate catch-up logging
of a finished workout (owner ruling 2026-09-20, pinned by `c-catch-up-logging`).

**Source:** `docs/BUGS.md` § BUG-043. Dev session `1a136380-245c-42ad-b26c-64cb47996b8e` (`upper_b_20260929`):
`started_at` 07:28:06.376, `last_activity_at` 07:28:06.299 (never moved), all 16 sets `created_at` 07:33:06.299,
`completed_at` 07:28:06.299 (< `started_at`), `duration_minutes` −1; real training 10:21–11:33 UTC.

## Findings

### Root cause chain (verified in code, `apps/server`)

1. **Session goes `in_progress` at plan acceptance** (BUG-044, out of scope): `TrainingService.startSession`
   (`training.service.ts:110`) / `beginSession` (`:130`) / `session-lifecycle.handler.ts:26` write
   `startedAt = new Date()`; `last_activity_at` comes from the column default `now()` at row creation
   (`schema.ts:488`). The app-clock `startedAt` lands a few ms *after* the DB-clock `last_activity_at`
   (07:28:06.376 vs .299) — the seed of the `−1` below.
2. **No activity for 3 h.** `lastActivityAt` is written only by `sessionRepo.updateActivity`
   (`workout-session.repository.ts:318`), called from `addExerciseToSession` (`training.service.ts:136`),
   `logSet` (`:148`), the create branch of `ensureCurrentExercise` (`:240`) and `completeCurrentExercise` (`:319`).
   **Chat messages never touch it** — nothing under `src/infra/ai/graph` calls it (confirmed by grep), so 3 h of
   conversation left it frozen.
3. **`log_set` classifies the first live set as retro** (`log-set.tool.ts:73-76`): `now − lastActivityAt >
   SESSION_TIMEOUT_MS` (2 h, `format-exercise-summary.ts:5`). It never asks whether the session had any sets, so a
   session that never began is treated as "a finished workout being catch-up-logged".
4. **The retro branch freezes the session.** `retroCreatedAt = lastActivityAt + RETRO_SET_OFFSET_MS` (5 min;
   `:79-81`, `format-exercise-summary.ts:7`) — a constant derived from the frozen value, hence 16 identical
   `created_at`s — and `skipActivityUpdate: isRetro` (`:90`) is honoured in `ensureCurrentExercise` (`:239`) and
   `logSetWithContext` (`:349`, direct `sessionSetRepo.create`, bypassing `logSet`'s `updateActivity`). The next
   `log_set` reads the same stale value → retro again. The confirmation appends `(retro-logged)` (`:114`).
5. **`finish_training` inherits the frozen value** (`finish-training.tool.ts:32-38`): `isStale` on the same
   `lastActivityAt` → `completedAt = lastActivityDate` → `completeSession` (`training.service.ts:245-260`) computes
   `floor((completedAt − startedAt)/60000)` = `floor(−77 ms / 60000)` = **−1** and `repository.complete` stores it
   (`:310`). Nothing clamps.
6. **The 2 h auto-close never ran on the training path.** `autoCloseTimedOutSessions` (`training.service.ts:548`)
   has three callers — `startSession` (planning branch, `:95`), `assertNoActiveSession` (`:508`, from `beginSession`
   and the non-planning start), `getActiveSession` (`:286`) — and the only non-test caller of `getActiveSession` is
   the webapp route `session.routes.ts:103`. No tool or graph node calls it mid-run. (Had it fired it would have
   closed the live session at 07:28 with duration 0 — a different wrong outcome; see Owner decisions D4.)

**Corrections to the brief's facts:** none — all confirmed. Additions: (a) the same negative-duration hazard exists
in `autoCloseTimedOut` (`workout-session.repository.ts:348-350`, `lastActivityAt − startedAt`, no clamp);
(b) `SESSION_TIMEOUT_MS` is defined 4× (`format-exercise-summary.ts:5`, `prompts/blocks/training-workout-overview.v1.ts:17`,
`prompts/phases/training/v1.ts:19`, `training.service.ts:32`) and `RETRO_SET_OFFSET_MS` is copied into the test
`c-catch-up-logging.integration.test.ts:47`.

### Every reader/writer of the four fields

| Field | Writers | Readers |
|---|---|---|
| `lastActivityAt` | column default (`schema.ts:488`); `updateActivity` (`repository:318`, callers above) | `log-set.tool.ts:73`, `finish-training.tool.ts:32`, `prompts/phases/training/v1.ts:109`, `training-workout-overview.v1.ts:297` (`TRAINING_STALE_SESSION_V1`), `repository.findTimedOut/autoCloseTimedOut` (`:326,343,349,356`), `transcript-reader.ts:197` |
| `startedAt` | `startSession:110`, `beginSession:130`, `session-lifecycle.handler.ts:26` | `completeSession:257`, `autoCloseTimedOut:348`, `load-facts.loader.ts:105,138` + `metrics.ts:276` (today's duration; falls back to the first set when null), `session-planning-recovery-timeline.v1.ts:18`, `session-planning-recent-history.v1.ts:22`, `chat-context.v1.ts:29`, `transcript-reader.ts:196` |
| `completedAt` | `repository.complete` (`:310`), `autoCloseTimedOut:356` | history/anchor queries (`repository:99-153,242-250,382-495`), `training-exercise-history.v1.ts`, `session-planning-context.builder.ts:41`, prompts `previousSession` (`v1.ts:137`, `training-workout-overview.v1.ts:319`) — all order or label by it, so a wrong `completedAt` misplaces the session in every "last time" lookup |
| `durationMinutes` | `completeSession:256`, `autoCloseTimedOut:348` | `finish-training.tool.ts:39,46`, `session-planning-recent-history.v1.ts:41`, `chat-context.v1.ts:32` |

### What the prompt layer does with it

`buildWorkoutOverview`/`TRAINING_STALE_SESSION_V1` (`training-workout-overview.v1.ts:231-247, 293-303`) emit a
`=== STALE SESSION ===` block when `now − lastActivityAt > 2 h`: "Retro-logging is active: any sets you log will be
timestamped to the original training time", plus a rule to ask "adding to the previous session or starting fresh?".
On 09-29 the block was rendered every turn (activity frozen) and told the model to treat the live workout as
retro — the prompt side of the same stickiness; after the fix the block disappears with the first live set because
it reads the same `lastActivityAt`. Prompt wording itself is out of scope.

## Why the tests did not catch it

- `c-catch-up-logging.integration.test.ts` (steps 9–11) is the **only** test that exercises retro logging and it
  pins the sticky behaviour as *correct* ("The pull-up sets were retro … the session stayed stale"): its session
  already has two real sets before the pause. No scenario has a session with **zero sets** and a long idle gap, and
  none follows a retro set with a live one. Its `finish_training` assertion (`durationMinutes 11`, `completedAt ==
  lastActivityAt`) only works because that session's `lastActivityAt` is after `startedAt`.
- `log-set.tool.unit.test.ts` — no case sets `lastActivityAt` older than 2 h (mocks return a fresh session); the
  retro branch, `retroCreatedAt`, `skipActivityUpdate` and `(retro-logged)` have no unit coverage at all.
- `finish-training.tool.unit.test.ts:61,117` — `lastActivityAt: new Date()` only; the `isStale` branch is never taken.
- `training.service.integration.test.ts` / `log-set.integration.test.ts` — no `completeSession` with
  `completedAt < startedAt`, no `skipActivityUpdate` case, no idle-session case; `training-service-test-support.ts`
  builds sessions with `startedAt`/`lastActivityAt` both `new Date()`.
- Every scenario runs on a scripted clock in minutes; none idles > 2 h between `start_training_session` and the
  first set, i.e. the 09-29 shape (plan accepted, gym 3 h later) never occurs.
- No invariant test anywhere states `completedAt >= startedAt` / `durationMinutes >= 0`.

## Design options (fix)

The constraint that shapes everything: after a gap, "the user reports an old workout" and "the user starts the
workout now" are indistinguishable from the timestamps alone. The catch-up ruling (2026-09-20) must stay.

- **A — "no prior sets ⇒ not a catch-up" + clamps (recommended).** A retro set requires idle > 2 h **and** the
  session already has ≥ 1 logged set (there is a real workout to catch up on). A session with zero sets is a late
  start: the first set is live (stamped now, advances `lastActivityAt`) and re-anchors `startedAt` to that moment,
  so duration is the real ~70 min. Everything after is live. Independently: `completeSession` and
  `autoCloseTimedOut` clamp `completedAt >= startedAt` and `duration >= 0`. One shared timing module replaces the 4
  duplicated constants. Fixes the 09-29 shape completely; keeps `c-catch-up-logging` green unchanged.
  Residual: a session with sets, a pause > 2 h, then a *live* continuation is still treated as catch-up (existing
  ruling; the STALE block already asks the user).
- **B — retro is model-declared** (`log_set` gets `performedEarlier`/`performedAt`); default live. Removes all
  inference, but needs a schema change plus a prompt-block rewrite (out of scope) and depends on the model flagging
  correctly — the same class of weakness BUG-044 showed.
- **C — chat messages count as activity.** Rejected: the catch-up message itself would reset the idle clock before
  the tool runs, killing legitimate retro logging; and a 07:58 "not going yet" message would still leave a 2 h 23 m
  gap at 10:21.
- **D — retro sets advance `lastActivityAt` to now while stamping from the last set.** Ends the freeze but makes
  the 2nd..Nth set of one catch-up message live (breaks `c-catch-up`'s three retro pull-ups) unless tracked per run.

**Recommendation: A.** Smallest change that fixes the observed defect, satisfies the ACs below, and leaves the
owner's ruling intact. B is the follow-up if catch-up-vs-live misclassification shows up again.

## Acceptance criteria (mints AC-RT-*)

| ID | Observable outcome |
|---|---|
| AC-RT-1 | (a) In a session with **no sets** and `lastActivityAt` > 2 h ago, `log_set` stamps the set at "now" (no `createdAt` override, no `skipActivityUpdate`) and `lastActivityAt` becomes ≈ now; (b) a second `log_set` right after is live too — **no `(retro-logged)`** in either confirmation; (c) **unchanged:** in a session that already has sets, a set after a > 2 h gap is still retro (`lastActivity + 5 min`), so `c-catch-up-logging` passes as is |
| AC-RT-2 | For every completion path — `finish_training` on a stale session, `TrainingService.completeSession`, `autoCloseTimedOut` — `completed_at >= started_at` and `duration_minutes >= 0`; a stale finish whose `lastActivityAt` precedes `startedAt` completes at `startedAt` with duration 0 |
| AC-RT-3 | DB-backed scenario in the 09-29 shape: session created and started, > 2 h idle, 16 sets over ~70 min (scripted clock), `finish_training` → set `created_at`s are distinct, increasing and match the scripted clock; `started_at` ≈ first set; `last_activity_at` ≈ last set; `completed_at` ≈ last set (`>= started_at`); `duration_minutes` = 70 ± 1 |
| AC-RT-4 | The `log_set` confirmation for a live set never contains "retro-logged"; it still does for AC-RT-1(c). The `STALE SESSION` block is absent from the prompt of the run after the first live set |
| AC-RT-5 | One home for `SESSION_TIMEOUT_MS` / `RETRO_SET_OFFSET_MS`: the four duplicates and the test-local copy import it; `grep -rn "SESSION_TIMEOUT_MS =" src` finds one definition |

## Owner decisions

- **D1 — BUG-044** (session starts at plan acceptance; `started_at` = first set). **Recommendation: separate
  plan.** T3 does only the minimal re-anchor needed for AC-RT-3: `startedAt = now` at the first set of a
  zero-set session idle > 2 h. Not implemented here: explicit start step, `startedAt` at plan acceptance, prompt
  changes.
- **D2 — literal "after one retro set a set logged now is not retro"** conflicts with the 2026-09-20 catch-up
  ruling for sessions **with** sets (a catch-up message logs several retro sets in a row; without a per-run marker
  or model-declared flag they are indistinguishable from live ones). **Recommendation:** keep catch-up sticky
  where the session has sets (AC-RT-1c) and fix the no-sets case (AC-RT-1a/b); revisit with option B only if
  needed. Owner to confirm.
- **D3 — data fix for `1a136380`** (real times from `conversation_turns`): orchestrator, needs ssh; recommendation:
  yes, once T3 is deployed, from the transcript.
- **D4 — run `autoCloseTimedOutSessions` on the training path?** Recommendation: **no** — it would close a
  planning-accepted session mid-wait with duration 0; the late-start rule of A is the safer answer. Log as backlog
  if the owner wants stale sessions closed proactively.
- **D5 — chat messages as activity:** recommendation **no** (option C above).

## Global Constraints

- T2 red tests live in `*.repro.test.ts` (outside default suites, so pre-commit stays green) and are promoted into
  their home suites in T3. No `skip`, no `test.failing`, no inverted assertions. A test that unexpectedly passes is
  reported **unconfirmed**, never weakened.
- No live model (`RUN_LLM_EVALS`/`EVALS_FULL_RUN` never set, no `npm run smoke`), no ssh, no dev data.
- Every `RUN_DB_TESTS=1` command goes through `/Users/filko/orca/workspaces/fit_coach/db-test-lock.sh <cmd>`
  (from `apps/server`).
- Reserved to the orchestrator: push, merge, ssh, deploy, `npm run db:*`, `docker compose`, branch/worktree
  deletion, durable specs, `docs/STATE.md`, `docs/BUGS.md`, `Status:` transitions.

## Tasks

### T2 — Red tests (AC-RT-1..4)

Files (create only): 
- `apps/server/src/infra/ai/tools/__tests__/retro-timestamps.repro.test.ts` — unit, mocked service per
  `log-set-test-support.ts` / `finish-training.tool.unit.test.ts`: (1) zero-set session, `lastActivityAt` 3 h old →
  `logSetWithContext` called without `createdAt`/`skipActivityUpdate: true`, confirmation lacks `retro-logged`
  (AC-RT-1a/1b/4); (2) control: session **with** a set + 3 h gap → retro args and marker present (AC-RT-1c, green
  on unchanged production — proves the ruling is preserved); (3) `finish_training` with `lastActivityAt` older than
  2 h and before `startedAt` → the `completedAt` handed to `completeSession` is `>= startedAt` (AC-RT-2).
- `apps/server/tests/integration/services/session-timing.repro.test.ts` — real DB, real `TrainingService`:
  `completeSession(id, undefined, completedAt < startedAt)` → stored duration `>= 0` and `completed_at >=
  started_at`; `autoCloseTimedOut` with `last_activity_at < started_at` → same; zero-set stale session first
  `logSetWithContext` advances `last_activity_at` and re-anchors `started_at` (AC-RT-1a, AC-RT-2).
- `apps/server/tests/integration/scenarios/retro-timestamps.repro.test.ts` — the 09-29 shape via `runScenario` +
  `scripted-model.ts` (pattern: `set-error-recovery.integration.test.ts`; setup steps from
  `b-full-workout.scenario`; scripted clock jumps +2 h 50 m after `start_training_session`, then 16 `log_set`
  calls spread over 70 min, then `finish_training`) (AC-RT-3, AC-RT-4). Scenario definition, if a new file is
  needed: `apps/server/evals/scenarios/retro-timestamps.scenario.ts`.

- [x] Write the repros; run each and record command, exit code and the failing assertion in Evidence; each must
  fail on unchanged production **for the stated reason** (retro args present / `(retro-logged)` / `completed_at`
  before `started_at` / duration −1), not on setup.
- [x] Verify: `cd apps/server && npx jest --testMatch='**/retro-timestamps.repro.test.ts' src/infra/ai/tools` (the default `testMatch` excludes `*.repro.test.ts`, so the flag is required);
  `/Users/filko/orca/workspaces/fit_coach/db-test-lock.sh bash -c 'RUN_DB_TESTS=1 NODE_ENV=test npx jest --testMatch="**/session-timing.repro.test.ts" --testMatch="**/retro-timestamps.repro.test.ts"'`
  → red for the stated reasons (the AC-RT-1c control green); `npm run test:unit` green.

### T3 — The fix, red tests promoted (AC-RT-1..5)

Files it may edit:
- create `apps/server/src/domain/training/session-timing.ts` (constants + `isRetroLog(session, now)` +
  completion clamp helper);
- `apps/server/src/infra/ai/tools/log-set.tool.ts`, `finish-training.tool.ts`, `format-exercise-summary.ts`
  (re-export or drop the constants), `prompts/blocks/training-workout-overview.v1.ts` and
  `prompts/phases/training/v1.ts` (constant import only — **no wording change**);
- `apps/server/src/domain/training/services/training.service.ts` (`completeSession` clamp, first-set re-anchor of
  `startedAt`, constant import; port `training-service.ports.ts` only if a signature changes);
- `apps/server/src/infra/db/repositories/workout-session.repository.ts` (`autoCloseTimedOut` clamp);
- tests: promote T2's files into `log-set.tool.unit.test.ts`, `finish-training.tool.unit.test.ts`,
  `training.service.integration.test.ts`, and a scenario `tests/integration/scenarios/` file; drop the local
  `RETRO_SET_OFFSET_MS` copy in `c-catch-up-logging.integration.test.ts` (import it).

- [ ] Implement option A; promote the repros (delete the `*.repro.test.ts` files); `c-catch-up-logging` untouched
  and green.
- [ ] Verify: `cd apps/server && npm run lint && npm run type-check && npm run test:unit`;
  `/Users/filko/orca/workspaces/fit_coach/db-test-lock.sh npm run test:scenarios` and
  `/Users/filko/orca/workspaces/fit_coach/db-test-lock.sh bash -c 'RUN_DB_TESTS=1 NODE_ENV=test npx jest tests/integration/services/training.service.integration.test.ts'`
  green; `grep -rn "SESSION_TIMEOUT_MS =" src` → one match (AC-RT-5); `node scripts/state.mjs --check` from repo root.

## Evidence (filled by workers)

| AC | Command | Exit | Failing assertion / result | SHA |
|---|---|---|---|---|
| AC-RT-1a/1b/4 (unit) | `npx jest --testMatch='**/retro-timestamps.repro.test.ts' src/infra/ai/tools` | 1 | 1 of 3 red for the AC-RT-1 case: first set of a zero-set session idle 3 h gets `createdAt` = `lastActivityAt + 5 min` (`expect(opts.createdAt).toBeUndefined()` fails; `isRetro: true` in the audit log). Control AC-RT-1c green | (this commit) |
| AC-RT-2 (unit, `finish_training`) | same command | 1 | red: `completedAt` handed to `completeSession` (`lastActivityAt`) is 77 ms before `startedAt` (`toBeGreaterThanOrEqual` fails) | (this commit) |
| AC-RT-1a, AC-RT-2 (DB service) | `db-test-lock.sh bash -c 'RUN_DB_TESTS=1 NODE_ENV=test npx jest --testMatch="**/session-timing.repro.test.ts"'` | 1 | 5/6 red: `completeSession` and `autoCloseTimedOut` with `completedAt`/`last_activity_at` before `started_at` store `completed_at < started_at` (×2) and `duration_minutes = -1` (×2); first set of a zero-set stale session leaves `started_at` at plan acceptance (3 h old). Control (a live set advances `last_activity_at`) green | (this commit) |
| AC-RT-3, AC-RT-4 (scenario) | `db-test-lock.sh bash -c 'RUN_DB_TESTS=1 NODE_ENV=test npx jest --testMatch="**/scenarios/retro-timestamps.repro.test.ts"'` | 1 | 7/8 red (the run-to-the-end test green): 1 distinct `created_at` for 16 sets (frozen retro stamp); `started_at` ≈ T0 not T0+180 m; `last_activity_at` never moved (≈ T0); `completed_at` < `started_at`; `duration_minutes = -1` (the 09-29 value); `retro-logged` seen by the model on 16/16 set steps; `=== STALE SESSION ===` still in the prompt of every later run | (this commit) |
| default suites | `cd apps/server && npm run test:unit` | 0 | 167 suites / 1716 tests green (repro files are outside the default `testMatch`) | (this commit) |

## Out of scope

- Data fix of dev session `1a136380` (orchestrator, ssh).
- BUG-044 proper (explicit start / `started_at` at plan acceptance), BUG-045 (phantom duplicate; "mark the
  just-logged set"), BUG-049 item 1.
- Prompt wording of the STALE SESSION block and the retro rules.
- Running the auto-close on the training path (D4).
