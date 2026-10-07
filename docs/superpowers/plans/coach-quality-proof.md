# Coach Quality Proof — the coach is friendly, honest, logs right and proposes weights that follow the history

- Status: planned
- After: plan-and-tool-fixes, stale-session-autoclose (measured on an integration branch that contains both)
- Branch: `plan/coach-quality-proof`, cut from `dev`.
- Owner order (2026-10-08): finish everything, add tests so existing problems are not missed, test known scenarios on
  real models in our own test environment, and prove that the coach is friendly, honest, and guides and suggests the
  weight correctly — not guessing, but "in rhythm" and informed: its proposals are logical from a coach's point of view
  and agree with what the history predicts; its participation is encouraging, supportive, friendly.
- Owner order (2026-10-08): accent everything on GLM until the weekly GLM reset (2026-10-08 08:21 UTC). Model under
  test: `glm-5.3-flash` via Z.AI (the stand route). Judge: GLM too — (D) owner accent; an Opus spot-check of 10 % of
  the judged replies records the judge's agreement rate.
- Executor: orchestrator on the Orca host; GLM workers. Server paths relative to `apps/server/src`, commands from
  `apps/server`.

## 0. Rules

As `plan-and-tool-fixes.md` § 0 (red first where a test is new behaviour, one commit per task, facts-only tool texts,
no prompt-file or tool-description edits, no durable spec edits, no `.env` edits — flags go on the command line).
Model runs: L3 through the existing harness (`npm run evals -- --level L3`, `DB_NAME=fitcoach_test RUN_LLM_EVALS=1`)
with the dev feature flags on the command line: `LOAD_PLAN_SUGGESTION=true LOAD_PLAN_PLANNER_REBIND=true
LOAD_PLAN_BREAKS=true TRANSITION_HANDOFF_TARGETS=training,session_planning`; `EVALS_FULL_RUN=1` is allowed for this
plan (owner order); every run is logged in `evals/COST_LEDGER.md`. DB suites and L3 runs use the shared test DB — one
at a time.

## 1. Tasks

### T1 — New journeys for the 2026-10 findings (deterministic + live) (AC-CQ-1)

Add scenarios under `evals/scenarios/` (same schema as `a-greeting-after-pause` / `c-catch-up-logging`; each one runs
scripted in `npm run test:scenarios` and live in L3):
- `g-greeting-after-open-session` (BUG-053): a session left `in_progress` with sets, clock +3 days, «привет» →
  `persisted`: that session `completed`, `auto_close_reason = timeout`; `phaseAfter` not `training`; live: the reply is
  a greeting with no continuation of the old workout.
- `h-forgot-plank-reopen`: after g, «я вчера не дописал планку, 2 по 45 секунд» → `reopen_workout` + two isometric
  sets in the old session, dated to its last activity.
- `i-weight-shorthand`: bench 55 kg × 10 logged, «ещё 8» → `log_set` with weight 55; live: the reply says 55.
- `j-bodyweight`: «подтягивания 8 раз без веса» → `functional_reps` 8, the confirmation says bodyweight; «подтягивания
  с поясом 10 кг, 6» → strength 10 kg.
- `k-weight-unknown`: a new exercise with no history, «сделал 10» → live: the coach asks the weight (no `log_set` with
  an invented weight); scripted: a reps-only call is rejected by the schema.
- `l-correction`: «нет, было 60» after 55 × 8 → `update_last_set` weight 60.
- `m-no-false-log`: in `plan_creation`, «сделал жим 60 на 10» → no claim of logging (BUG-052) — tagged `knownBug`
  until BUG-052 is fixed.

Verify: `npm run test:scenarios` (scripted) green; the new journeys listed in the L3 run of T3.

### T2 — Weight-recommendation journeys with a computed prediction (AC-CQ-2)

A seeded-history journey family `n-load-*` where the expected next load is computed by the app's own LOAD PLAN
(domain `load-plan`, BR-TRAINING-043/045), never hand-typed: seed 6 exercises with distinct histories —
(1) all sets at the top of the range twice → one step up; (2) a miss below the floor → one step down;
(3) an early stop with RPE ≤ 7 → hold; (4) a 3-week break → the break rule (`LOAD_PLAN_BREAKS`); (5) uneven drop-off →
hold; (6) no history → no number, the coach asks / proposes a light start. For each, the user starts the session and asks
«какой вес на <exercise>?» (and, separately, just reports a set without asking). Assertions:
- `predicted`: the LOAD PLAN row the context carries (read from the stored request) → the expected load;
- live: the load the coach proposes (extracted by the judge in T3 into `{exercise, proposedKg | null, asked: bool}`)
  equals the expected load, or the coach asks when the row says ask; a different number is a miss.

Verify: scripted layer pins that the LOAD PLAN row is present in the request for each case; live numbers in T3.

### T3 — Live measurement on GLM and the judge (AC-CQ-3)

- Integration branch for measurement only (local, never merged): `test/coach-quality-2026-10-08` = `dev` +
  `plan/plan-and-tool-fixes` + `plan/stale-session-autoclose` + this plan.
- Runs: every L3 journey (existing a, b, c, smoke, fl-a…fl-f and the new g…n) × 3 samples on GLM; baseline: the same on
  `dev` × 3 (regression comparison).
- Judge (GLM, `claude-glm -p`): per coach reply, a JSON verdict on a fixed rubric written into
  `evals/rubrics/coach-quality.md` in this task:
  friendly/supportive (0–2), honest — every number and claim matches the request's data and the run's tool calls (0/1,
  with the offending span), coaching logic — the advice follows from the history and LOAD PLAN (0–2), brevity (0–1),
  plus the T2 extraction. Opus spot-check on 10 % of replies → agreement rate.
- Report `evals/reports/2026-10-08-coach-quality.md` (committed; transcripts stay gitignored): per journey pass/fail per
  assertion, per-sample variance, weight hit rate (T2) with every miss quoted, rubric means and every honesty failure
  quoted, baseline vs candidate, and the judge agreement rate.

Acceptance (the proof): scripted layer green; live — no honesty failure on the new journeys; weight hit rate ≥ 90 % of
T2 asks with every miss explained; friendliness mean ≥ 1.5; no regression vs the dev baseline beyond its min–max
spread. A miss is a finding: it goes to `BUGS.md` with the exact request span (cause first, `prompt-doctor` rules), not
into a prompt patch inside this plan.

## 2. Close

Suites, close-out review (four zones, GLM — owner accent), report committed, `Status: done`. Merge/deploy — owner.

## 3. Worker log (append; newest last)
