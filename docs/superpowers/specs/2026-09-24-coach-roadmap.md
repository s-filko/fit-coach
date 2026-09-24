# Roadmap — Session planning redesign and load advisor

> **Status: accepted by the owner 2026-09-24; no plan written yet.** Acceptance covers the
> step order, the units and the rules in section 2; decisions tagged **[proposed]** in the two
> design specs still need the owner's confirmation per the gates in section 5. This document
> is self-contained: a fresh session starts here and needs nothing from the brainstorm that
> produced it. It orders two design specs into small, independently verifiable steps and
> groups them into plan-sized units.

## 0. Start here (fresh session)

1. Read `docs/STATE.md` (orientation, repo rules), then this file top to bottom.
2. Read the two design specs only for the unit you are about to plan:
   - `docs/superpowers/specs/2026-09-24-session-planning-redesign-design.md` (units U1–U8)
   - `docs/superpowers/specs/2026-09-24-load-advisor-design.md` (units U9–U14)
   Decisions there are tagged **[owner]** (settled) or **[proposed]** (confirm with the owner
   before relying on it — one question at a time, recommendation first).
3. Pick the first unit whose status (section 6) is `next` and whose gate (section 5) is open.
4. Turn that unit — and only that unit — into a plan file via `superpowers:writing-plans`:
   `docs/superpowers/plans/<unit-slug>.md`, `- Status: planned`, `- After: <previous slug>`,
   AC ids per `docs/DOCUMENTATION_GUIDE.md`, each task citing its AC and verification command.
5. Execute via the `delegate-implementation` skill; close via `close-out-review`. Review,
   `Status:` transitions, merge and deploy are never delegated (`docs/ORCHESTRATION.md`).
6. After the dev deploy, run the unit's **live check** (section 3) with the owner. Only a
   passed live check marks the unit `done` in section 6 and opens the next one.

## 1. Why this exists (one paragraph)

The owner's goal: the coach behaves like a good human coach (governing principle, planning
spec §1). Today `session_planning` is a gate before training (no logging until a plan is
agreed — BUG-022), agreement and start are one tool call (BUG-015), history is looked up by
template key (BUG-005/030), and the coach sees fragmented history. The owner's hard
constraint for the fix: **no big-bang refactor.** Many small steps, each proven in practice
on dev before the next, each reversible — so that a mistake is caught at the step that made
it, not after twenty steps are stacked on top.

## 2. Rules for every step (non-negotiable)

1. **One step = one hypothesis** of the form "after this, X observably happens instead of Y".
2. **Red before green.** The automated check is written first and fails on unchanged `dev`
   for the stated reason (the repo's reproduction-before-remediation practice,
   `session-2026-09-21-repro`). Red files are `*.repro.test.ts`, promoted to ordinary tests
   when the fix lands.
3. **Two checks per step:** automated (unit / integration / scenario over the real test DB —
   deterministic, scripted model, no live LLM) **and** a live check on dev (the owner sends
   ≤5 messages to `@MyFitAiCoachDevBot`; the expected reply is written in the plan before the
   deploy).
4. **Reversible by configuration.** Behaviour changes ship as a new prompt version or behind
   an env flag; rollback is a config change, never a revert under pressure.
5. **The line stops on a failed live check.** Diagnose; never stack the next step on top.
6. **Data-shape fixes go early** — history accrues from the day they land.
7. **Economy** (owner rules in memory): one review per phase, no micro-plans (a unit is one
   plan, not one plan per step), tight worker specs, no model-backed eval runs unless the
   owner asks; the live check is the owner's ≤5 messages.

Commands: `cd apps/server && npm run check-all`, `npm run test:unit`,
`npm run test:integration`, `npm run test:scenarios` (real test DB), repro glob
`RUN_DB_TESTS=1 npx jest --testMatch='**/*.repro.test.ts'`. Deploy:
`ssh filko.dev "cd /srv/docker/fitcoach && ./deploy/deploy.sh dev"` (push first).

## 3. Steps

Legend — **Hyp**: hypothesis. **Red**: the check that must fail today. **Live**: the owner's
dev check. **Rollback**: how to turn it off.

### Stage 0 — Safety net (no production change)

Existing assets to reuse, not rebuild:
- `tests/integration/scenarios/previous-session.repro.test.ts` — BUG-030 red (AC-LSR-4).
- `evals/datasets/drafts/session-2026-09-21.jsonl` — LS-0001 (BUG-022), LS-0002 (BUG-024),
  … drafts, never run.
- `evals/datasets/session_planning/one-question-first.jsonl` (10 cases) — **pins the "ask
  one question first" rule that R3.4 removes**; must be rewritten deliberately in U7, not
  silently broken.
- `evals/datasets/session_planning/transitions.jsonl` — SP-0005 (BUG-015).
- `tests/integration/scenarios/scripted-model.ts` — the deterministic scenario harness.

| ID | Step | Red (automated) |
|---|---|---|
| R0.1 | Deterministic scenario: in `session_planning` the user reports sets ("второй подход повторил 110×12"); scripted model calls `log_set` | after the run `session_sets` holds the set — **fails today** (`log_set` does not exist in the phase) |
| R0.2 | Deterministic block test: last bench a week ago, **yesterday** a hard session on overlapping muscles (e.g. overhead press → triceps/front delts); training context for today's bench | the rendered training context names yesterday's load — fails today (training sees one `session_key`-matched session only) |
| R0.3 | Integration test for the `findRecentByUserId` status filter (`workout-session.repository.ts:126`): a `skipped` and an unfinished session must not count as recent, nor drive `daysSinceLastWorkout` | fails today; file the BUG entry in `docs/BUGS.md` |
| R0.4 | Update LS-0001's expectation for the post-R2.1 world: `log_set` is **required**, but in the `training` hop, and the reply must not claim anything unlogged | eval-draft only (no run) |

### Stage 1 — Data correctness

| ID | Step | Hyp | Automated | Live | Rollback |
|---|---|---|---|---|---|
| R1.1 | Status filter in recent-history queries (callers: `session-planning-context.builder.ts:32`, `chat.spec.ts:46`) | history and "days since" count only real workouts | R0.3 green | "что я делал на этой неделе?" → only real workouts | revert (pure query fix) |
| R1.2 | One set formatter for every history block (today two: `session-planning-recent-history.v1.ts` drops non-strength data, `training-workout-overview.v1.ts` `formatSetData` does not); absolute date + "N days ago"; no template labels (`sessionKey`) in blocks | cardio/isometric visible in planning; dates unambiguous | block unit tests + prompt snapshots updated deliberately | "что я делал на прошлой неделе по кардио?" → correct distance/time | new block versions |
| R1.3a | **Level 2 — exercise level, keyed by muscles** (owner). For the current exercise in `training`: every recent exercise that loaded **any** of its muscles (primary or secondary, labelled), newest first, dated. The same exercise is the **load anchor**; others are fatigue context only (kg do not transfer until R4.1). Replaces `findLastCompletedByUserAndKey` (`training.spec.ts:105`) | yesterday's overlapping load never hidden; BUG-030 gone | AC-LSR-4 and R0.2 green | yesterday heavy shoulders/triceps, today bench → last bench numbers with date **and** yesterday named | block version |
| R1.3b | **Level 1 — overview, what to train today.** In `session_planning`: the last 2–3 whole sessions in order + per-muscle status over a recent window (last trained, sets, primary/secondary) | today's focus is chosen from the whole picture | block tests | "что сегодня?" → reasoning cites the right sessions and neglected muscles | block version |
| R1.4 | Set kind (warm-up / working) in `log_set` + migration | warm-ups stop polluting working-set data | unit + integration | log a warm-up then a working set → stored with different kinds | column is additive; prompt version |

R1.3a/b realise the two levels already sketched in `docs/PLAN-muscle-centric-history.md`
(2026-03, never implemented, paths stale). Fix its three flaws: level-2 lookup by **primary**
muscles only (misses secondary load — the R0.2 case); similar exercises' kg shown next to the
exact one (invites wrong transfer); level-1 aggregate is all-time, not windowed. On adoption
that document is rewritten or deleted — never kept beside the new design.

### Stage 2 — The transition is answered by the right phase

Gate: the owner asked to walk through the run-graph loop (planning spec §8) before it is
built. Do that first, in plain language, with the R0.1 scenario as the example.

| ID | Step | Hyp | Automated | Live | Rollback |
|---|---|---|---|---|---|
| R2.0 | Provider probe, 1–3 calls each on Gemini via OpenRouter and on Z.AI: history containing tool calls for tools absent from the current tool set (memory rule: provider docs first, then a tiny probe) | go / no-go known before any graph change | — | — | — |
| R2.1 | Loop `commit → route` **only for → `training`**, max 1 hop, no revisit; the user receives only the last phase's reply; `commit` projection made incremental; one run row with a phase path | sets reported while planning are logged in the same turn | R0.1 green; no duplicate transcript rows; existing scenarios green | in planning: "сделал 2 подхода 110×12" → training opens, both sets in `session_sets`, no unlogged claim | env flag off = today's graph |
| R2.2 | Extend the loop to chat → `session_planning` | "что делать сегодня?" is answered with the analysis in the same turn | scenario | ask from chat → analysis in one reply | flag |
| R2.3 | Streaming delivery (`interim`/`final`) on `/api/bot/chat` + bot reader, **final-only** at first | zero behaviour change; the channel works | adapter + bot tests | normal conversation unchanged | client opt-in header |
| R2.4 | Interim message from a cheap LLM per transition intent template (profile `LLM_PROFILE_INTERIM_*`); on failure send nothing | the user sees one in-language progress line before the answer | template snapshots; language / no-claims eval drafts | one transition in RU and one in EN | flag |

### Stage 3 — Planning decoupled from starting

| ID | Step | Hyp | Automated | Live | Rollback |
|---|---|---|---|---|---|
| R3.1 | `propose_session(full JSON)` saves the proposal as the single `planning` row of `workout_sessions` (partial unique index, like `uq_workout_sessions_one_in_progress_per_user`); ID and constraint validation move here | the proposal survives a pause and compaction | scenario: propose → inactivity compaction → row intact | agree at noon, "погнали" in the evening → the agreed plan | prompt version |
| R3.2 | `start_training()` without arguments; agreement no longer starts | BUG-015 loses its basis | SP-0005 intent re-expressed as a scenario; green | "план ок, пойду вечером" → no session opened; later "погнали" → opened | prompt version |
| R3.3 | `chat → training` allowed; a session may have no plan; invariant "never refer to a plan the user did not request" | spontaneous training works, no invented plan later | scenario + transition-matrix unit tests | "я в зале, делаю что хочу" → logging works; next day no "we had a plan" | matrix flag |
| R3.4 | `session_planning` prompt vN: no forced single question, no off-topic guard; `one-question-first.jsonl` rewritten deliberately | fewer turns to a proposal | snapshots; dataset rewrite reviewed by the owner | "что сегодня? 40 минут" → a proposal right away | previous prompt version |
| R3.5 | Verbatim data sections + deterministic post-check that every exercise's numbers in the reply equal the stored JSON; one regeneration on mismatch | the reply never misstates the plan's numbers | post-check unit tests | reply numbers vs `session_plan_json` | flag |
| R3.6 | Planning on request inside `training` (shared blocks + `propose_session` writing via the unused `trainingService.updateSessionPlan`), today's load included | "did chest, what next?" is grounded | scenario | after chest: "что дальше?" → reasoned rest-of-session | spec flag |

### Stage 4 — Load advisor (cheapest value first)

| ID | Step | Hyp | Automated | Live | Rollback |
|---|---|---|---|---|---|
| R4.0 | Research: cited sources for every progression rule (load spec §2) | rules are sourced, not invented | — | owner reads | — |
| R4.1 | Catalog tags: progression model + movement pattern (~15 values), LLM-assisted, human-reviewed | applicability is data | coverage test (every exercise tagged) | owner spot-checks 20 exercises | additive columns |
| R4.2 | Pure functions: working weight, e1RM trend (≤12 reps), weeks at weight, data sufficiency per metric | the numbers are right | unit tests on fixtures | **the owner verifies the numbers against his own real history** | not wired yet |
| R4.3 | Those facts as a block for the current exercise — no analyst yet | "какой вес?" cites correct numbers and trend | block tests | "делаю жим, какой вес?" → correct last load, date, trend | block version |
| R4.4 | Recommendation log: "recommended → done" pairs, written from here on | data accrues | integration | rows appear after a workout | additive table |
| R4.5 | Cold-start protocol: probe set, calibration calc in code (N done + M in reserve → load for the target range) | a first-time exercise always gets a number and converges in 2–3 sets | calc unit tests + scenario | a new exercise → probe → adjusted next set | prompt version |
| R4.6 | Analyst sub-agent (framework steps 0–4, 7) behind a flag, **compared against R4.3** | better than facts alone — or dropped | eval set, target-rep hit rate | A/B on the owner's own workouts | flag |
| R4.7 | In-the-moment overreach signal in `log_set` | "not your weight" caught with facts | unit + scenario | 70×5 at target 10–12 → coach suggests a lighter next set | flag |
| R4.8 | Athlete-profile parameters (progression rate, fatigability), then self-correction from R4.4 | recommendations adapt to the person | unit on fixtures | only once enough R4.4 data exists | flag |

## 4. Units (one unit = one plan file)

| Unit | Slug (proposed) | Steps | After |
|---|---|---|---|
| U1 | `coach-baseline` | R0.1–R0.4, R1.1 | — |
| U2 | `history-formatting` | R1.2 | U1 |
| U3 | `muscle-centric-history` | R1.3a, R1.3b (+ retire `PLAN-muscle-centric-history.md`) | U2 |
| U4 | `set-kind` | R1.4 | U1 |
| U5 | `transition-handoff` | R2.0–R2.2 | U1 |
| U6 | `interim-delivery` | R2.3–R2.4 | U5 |
| U7 | `session-proposal` | R3.1–R3.5 (may split at R3.3/R3.4 if the plan is too large) | U5 |
| U8 | `planning-in-training` | R3.6 | U3, U7 |
| U9 | `load-facts` | R4.0–R4.3 | U3, U4 |
| U10 | `recommendation-log` | R4.4 | U9 |
| U11 | `cold-start` | R4.5 | U9 |
| U12 | `load-analyst` | R4.6 | U9, U10 |
| U13 | `overreach-signal` | R4.7 | U9 |
| U14 | `athlete-profile` | R4.8 | U10 + weeks of data |

Priority: U1 → U5 (BUG-022, Critical) and U3 → U4 → U2 → U7 → U6 → U9 → U10 → U11 → U8 →
U13 → U12 → U14. U4 and U10 are cheap and make stored data trustworthy — never let them slip
far, their value compounds with time.

## 5. Gates (owner decisions a unit needs before its plan is written)

| Unit | Needs |
|---|---|
| U3 | window size for level 1 (e.g. 14 days) and for level 2 "recent" (e.g. 72 h fatigue / 8 weeks anchor) |
| U5 | the owner walkthrough of the loop (planning spec §8); R2.0 result |
| U6 | interim timing: parallel with the second hop, sent only if ready first (recommended) vs sequential |
| U7 | proposal lifetime (e.g. end of the user's local day); off-topic guard: drop (recommended) or soften; does a next-day "погнали" re-check recovery |
| U9 | load spec open questions 1–2 (when the analyst runs; code candidate + analyst adapts) |
| U12 | load spec open question 3 (where strategy memory lives) |
| any | recording the governing principle in `docs/PRODUCT_VISION.md` (durable spec — owner approval) |

## 6. Status

| Unit | Status |
|---|---|
| U1 | next |
| U2–U14 | not started |

Update this table when a unit's live check passes; mirror the change in `docs/STATE.md`.
