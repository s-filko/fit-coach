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

### T2 — weight-recommendation journeys (worker, 2026-10-07)

- **(D) The load-plan engine does not exist on this branch.** Coach-simplification-i1 Task 3 (commit `2f3b22be`,
  merged into dev 2026-10-04) deleted `domain/training/load-plan`, `get_load_plan`, the LOAD PLAN context row and the
  `LOAD_PLAN_*` flags; dev, this branch and both sibling plan branches carry none of it. Per the coordinator's ruling
  (worker ask, 2026-10-07): T2 was built against the current facts-only architecture — a compact TEST-ONLY oracle
  (`evals/lib/weight-oracle.ts`) computes the expected load from the seeded history by the rules still stated in
  `docs/domain/training.spec.md` (BR-TRAINING-036/038/041/042/043/045, cited in its comments). The oracle is the
  measurement yardstick for T3, never product code; the plan's `LOAD_PLAN_SUGGESTION=true LOAD_PLAN_PLANNER_REBIND=true
  LOAD_PLAN_BREAKS=true` command-line flags do nothing on this branch (no code reads them) and were not added.
- **(D) The break pattern's rule is owner-unconfirmed.** A 3-week gap → BR-TRAINING-038's `return` tier → the first
  workout back one step down (matching the deleted engine's `gap-tier.ts`), with the coordinator's ~10 %-lighter
  alternative (rounded to the equipment step) as an additional acceptable load: expected 97.5, acceptable [90, 97.5].
- The scripted layer asserts the `# History` rows the request actually carries (dates, sets, loads used) — the dated
  facts a live coach needs — plus the persisted report set at the oracle-computed load; the scripted reply text is
  built from the verdict, so the number is computed, never hand-typed. Live-number checking is T3's, against
  `nLoadExpectations()` (`evals/scenarios/n-load-shared.ts`): {exercise, direction: up|hold|down|ask, expectedKg,
  acceptableKg} per case. The six journeys run on the test setup's two fixed barbell exercises (scripted
  `start_training_session` needs fixed ids); distinctness lives in the histories, and every run seeds a fresh user.
  Selectable live as the `n-load` group (`--scenario n-load`), not in the default L3 run (call ceiling, like
  fact-lifecycle).
- Computed loads: up → **82.5** (bench, 2-for-2 via capacity); miss → **97.5** (squat, below floor even by capacity);
  early stop → **hold 80** (bench, RPE 7); break → **97.5** acceptable [90, 97.5] (squat, 21 d); uneven → **hold 80**
  (bench, drop-off 6 > 4, no norm); no history → **ask**.
- Red first, recorded: oracle — `evals/lib/__tests__/weight-oracle.unit.test.ts:11:33 - error TS2307: Cannot find
  module '../weight-oracle'` (1 suite failed, 179 passed); journeys — first run failed on
  `n-load-shared.ts:137:5 - error TS2741: Property 'facts' is missing` and, after that fix, 6 ×
  `✕ consumed the whole script (no fallback answer leaked in)` (leftover checked mid-queue — harness bug, fixed to
  check after the run). The pinned `# History` row expectations passed unchanged-code rendering on the first green
  run (characterization pins; T2 changes no product code).
- Verify: `npm run check-all` → 0 errors; `npm run test:unit` → `Test Suites: 182 passed, 182 total`,
  `Tests: 1816 passed, 1816 total`; `npm run test:scenarios` → `Test Suites: 24 passed, 24 total`,
  `Tests: 1 todo, 452 passed, 453 total` (was 392 + 1 todo; +60 from this task).
- Operational note for the orchestrator: the plan-and-tool-fixes worker's DB-suite wrapper (PID 1338826/1338827) is
  self-deadlocked — its `while pgrep -f "node .*jest"` matches its own shell's command line, so it never reaches its
  `flock /tmp/fitcoach-testdb.lock` stage. This task's DB runs took the same lock and released it.

### T1 (i–m only) — the weight-logging journeys (worker, 2026-10-07)

- Implemented `i-weight-shorthand`, `j-bodyweight`, `k-weight-unknown`, `l-correction`, `m-no-false-log` under
  `evals/scenarios/` (shared builder `weight-logging-shared.ts`: user + one-exercise plan + the chat → session_planning
  → training setup), wired as the L3 group `new-journeys` (selectable by id; NOT in the default run — call ceiling,
  like n-load; g/h join this group once plan/stale-session-autoclose merges). Deterministic layer:
  `tests/integration/scenarios/t1-weight-logging-journeys.integration.test.ts` (generic per-step plane + k's llm_error
  pin + m's BUG-052 `test.failing` reproduction). All five pin the merged BR-TRAINING-047 behaviour: the coach passes
  the weight (55 copied from today's row for «ещё 8»; 0 = bodyweight named in full in the confirmation; a reps-only
  call rejected by the schema with nothing stored; `update_last_set` Before/After through the shared formatter).
- Red first, recorded: run 1 — `t1-weight-logging-journeys.integration.test.ts:138:44 - error TS2345` (compile); run 2 —
  `Tests: 6 failed, 26 passed`, headline `j-bodyweight … step 3: session exercises — got
  [{"exercise":"Pull-ups","sets":[{"reps":8},{"reps":6,"weight":10}]}]` — a step's script leaked into the previous
  run because a tool-call script message without a trailing text-only message let the run continue into the next
  queued answer; every such step now ends with one (journey B's AC-CC-3 shape). Run 3 — `k-weight-unknown … step 3:
  session exercises — got []`: no `session_exercises` row exists before the first logged set; the pin is `exercises:
  []` (nothing stored — the meaningful half of the assertion).
- Verification interference, resolved by the coordinator: two mid-run schema resets on the shared test DB by the
  stale-session-autoclose worker's jest running WITHOUT the flock (`relation "workout_sessions" does not exist` at
  ~20:05, `relation "checkpoint_blobs" does not exist` at ~20:07 UTC); escalated (msg_0cb61646c378), the coordinator
  had that worker wrap its DB runs in `flock /tmp/fitcoach-testdb.lock`, and the retried runs were clean.
- Merge fallout fixed in passing (evals ownership): `b-full-workout.scenario.ts` step 10 still pinned the pre-T6
  rendering `— in progress: 8 reps`; T6 renders `— in progress: 8×bodyweight` (BR-TRAINING-047) — the pin was updated.
  The branch's scenario suite had never been run between the T6 merge and this task, so the stale pin survived the
  orchestrator's merge.
- Verify: `npm run check-all` → 0 errors; `npm run test:unit` → `Test Suites: 183 passed, 183 total`,
  `Tests: 1830 passed, 1830 total` (the merged tree itself confirmed green first: 183/1829 before any change);
  flock-wrapped `npm run test:scenarios` → `Test Suites: 25 passed, 25 total`, `Tests: 1 todo, 484 passed, 485 total`
  (+32 from the five journeys).

### T3 preparation — the rubric and the judge, no live run (worker, 2026-10-07)

- **Rubric** `evals/rubrics/coach-quality.md`: friendly/supportive 0–2, honest 0/1 with the offending span quoted,
  coaching logic 0–2 judged against the request's history facts and the weight oracle's expectation, brevity 0–1,
  plus the T2 extraction {exercise, proposedKg | null, asked} — with the exact JSON output contract the judge must
  answer (one object, fixed ranges, span a verbatim substring).
- **Transcripts now carry the run id**: `formatScenarioTranscript` (evals/lib/reporter.ts) prints `run: <runId>` per
  user step — the judge's join key into `llm_calls` (the stored request of the last model call of the run: the
  `<context>`-carrying user message, and every response's tool calls with arguments). The L3 md was previously
  run-id-less, so no stored-request evidence could be joined to a step.
- **Judge** `evals/judge/coach-quality-judge.ts` (`npm run judge:coach-quality`): reads the L3 transcripts
  (`--transcript <path>` repeatable, or `--reports-dir` + `--stamp`), judges every user step through env `JUDGE_CMD`
  (default `claude-glm -p --model glm-5.3`; prompt on stdin, reply on stdout; bad JSON retried exactly once), computes
  the T2 weight hits for the n-load ask steps against `nLoadExpectations()` (ask expects `asked`; otherwise
  `proposedKg` must be in `acceptableKg`; a wrong-exercise extraction does not score), and writes
  `evals/reports/judge/coach-quality-<stamp>.json` + `.md` (rubric means, every honesty failure quoted, hits/misses,
  unparseable outputs). `--dry-run` judges 2 canned replies through a stub JUDGE_CMD (printf) — no DB, no model.
- Red first, recorded: reporter — `reporter.unit.test.ts:24:19 - error TS2353: 'runId' does not exist in type
  '{ toolCalls: ... }'` (the transcript had no run line at all) → implemented → 9/9. Judge —
  `coach-quality-judge.unit.test.ts:16:8 - error TS2307: Cannot find module '../coach-quality-judge'` → implemented →
  2 real bugs the tests then caught red (the parser dropped the second line of a multi-line delivered reply; weightHit
  ignored an extraction naming another exercise) → 11/11.
- Dry-run verified offline: `npm run judge:coach-quality -- --dry-run --out-dir /tmp/coach-quality-dryrun` →
  "Replies judged: 2 of 2 steps (0 unparseable judge outputs)", "weight hit rate (T2) | 1 (1/1)",
  "✓ proposed 82.5 kg — up → any of [82.5] kg (2-for-2 … (BR-TRAINING-042))" — the canned verdict flows through the
  full spawn/parse/summarise path and the hit is computed against the REAL oracle expectation.
- Verify: `npm run check-all` → 0 errors; `npm run test:unit` → `Test Suites: 184 passed, 184 total`,
  `Tests: 1841 passed, 1841 total`. DB suites not needed (no runtime code touched; reporter's md is L3-only output —
  asserted only by its unit test). The live run itself (L3 × GLM + judge over its transcripts, Opus spot-check) stays
  with the orchestrator.

### Merge 7097dd10 + T1 g/h — the greeting and the forgotten plank (worker, 2026-10-07)

- **The merged tree was already green — STEP 1 needed no fix and no commit.** The predicted breakage (stale-session-
  autoclose fixtures calling `log_set` with reps and no weight) did not survive the orchestrator's conflict resolution
  (c-catch-up's scripts carry `weight: 0`). Pre-change verification on the merge: `check-all` 0 errors; unit 189/1869;
  flock `test:integration` 59 suites / 765 passed + 1 todo; flock `test:scenarios` 26 suites / 492 passed + 1 todo.
- Implemented `g-greeting-after-open-session` (BUG-053: a SEEDED three-day-old `in_progress` workout — the dev shape,
  where the stale-session-autoclose plan's own scenario reaches the open session in-run — closes at «привет»:
  completed, `auto_close_reason = timeout`, completed_at = last activity, phase chat, the chat prompt's
  "closed automatically after inactivity" fact, no tool) and `h-forgot-plank-reopen` (after g: `reopen_workout` +
  two isometric `log_set` 45 s in the OLD session — the plank seeded as the session's empty exercise, resolved by
  exact name; retro-dated per journey c's precedent). Both join the `new-journeys` L3 group (g…m, run order).
- Scenario-format extensions they needed (evals/schema + evals/lib): `workouts[].status: 'in_progress'`;
  `conversation.phase` (a `training` checkpoint pairs with the open workout as `activeSessionId` —
  `seedCheckpointState` enforces the pair); `persisted.session.autoCloseReason`; the L3 session projection carries
  `autoCloseReason` and `durationSeconds` (isometric sets).
- Red first, recorded: `greeting-and-reopen.integration.test.ts:138:31 - error TS2339: Property 'autoCloseReason'
  does not exist` → the extensions above → green. Two harness facts discovered on the way, both now pinned:
  (a) `LLM_ERROR: Unknown tool: log_set` — the same-run chat → training hand-off needs
  `TRANSITION_HANDOFF_TARGETS=training,session_planning` set in the test (journey c's beforeAll precedent; the plan's
  § 0 command line already carries it for L3); (b) every retro set stamps `last_activity_at + RETRO_SET_OFFSET_MS`
  (NOT chained +5/+10 — journey c's own assertion says so), so h's two plank sets share the retro stamp.
- Verify (after g/h): `npm run check-all` → 0 errors; `npm run test:unit` → `Test Suites: 189 passed, 189 total`,
  `Tests: 1869 passed, 1869 total`; flock `npm run test:integration` → `Test Suites: 60 passed, 60 total`,
  `Tests: 1 todo, 774 passed, 775 total`; flock `npm run test:scenarios` → `Test Suites: 27 passed, 27 total`,
  `Tests: 1 todo, 501 passed, 502 total` (+9 from g/h). One commit (STEP 1 produced no diff).

### Final merges afbc7a57 + b70ef617 — verification (worker, 2026-10-08)

- Verified the tree after the orchestrator merged the final plan-and-tool-fixes (f78ca5db — the log_set description
  now states the weight contract; its tool-surface snapshot update came WITH the commit) and the stale-session-
  autoclose review fixes (5005d057). **No merge-interaction breakage found — nothing to fix, no commit.** No journey
  pins the log_set description text; the snapshot was updated by the merge itself.
- One anomaly, environmental: the FIRST flock `test:integration` run reported `Tests: 1 failed, 1 todo, 773 passed,
  775 total` (the failing test's identity was not captured — the run was summary-filtered); with the tree unchanged,
  the two following runs were fully green while the live L3/judge pipeline (`coach-quality-judge.ts --transcript …`)
  was active on the same host. Verdict: shared-test-DB contention with the measurement run, not a code defect. If a
  stray integration failure appears during the L3 measurement window, re-run before diagnosing.
- Verify: `npm run check-all` → 0 errors; `npm run test:unit` → `Test Suites: 189 passed, 189 total`,
  `Tests: 1870 passed, 1870 total`; flock `npm run test:integration` → `Test Suites: 60 passed, 60 total`,
  `Tests: 1 todo, 774 passed, 775 total` (×2 runs); flock `npm run test:scenarios` → `Test Suites: 27 passed,
  27 total`, `Tests: 1 todo, 501 passed, 502 total`.

### Judge hardening — one refused reply never aborts the run (worker, 2026-10-08)

- The baseline run exposed it: the judge CLI (GLM via Z.AI) refused ONE reply (`API Error: [1301][System detected
  potentially unsafe or sensitive content…]`, non-zero exit), `execFileSync` threw, and the whole judge crashed —
  every verdict lost, because outputs were written only at the end.
- `judgeReplyVia` (evals/judge/coach-quality-judge.ts, injectable `JudgeSpawn` so unit tests stub the CLI): a failed
  CLI call is NOT retried on the same command (a content refusal is deterministic — the unit test pins one primary +
  one fallback call); bad output gets the existing one same-command JSON retry; then `JUDGE_FALLBACK_CMD` (env) judges
  the reply once; failing that the reply is recorded `{unjudged: true, reason}` and the run continues. Verdicts are
  appended to `coach-quality-<stamp>.verdicts.jsonl` AS THEY ARE PRODUCED (a crash loses nothing judged); the .json
  and .md summaries land at the end — rubric means over the judged replies only, with an explicit exclusion line,
  the unjudged replies with reasons, the fallback count, and exit code 1 when anything went unjudged.
- Red first, recorded: `coach-quality-judge.unit.test.ts:251:41 - error TS7006: Parameter 'cmd' implicitly has an
  'any' type` — the new tests could not compile against the missing `judgeReplyVia`/`summarizeRun`/`JudgeSpawn`/
  `Evidence` exports → implemented → 18/18.
- Dry runs (offline, stub CLIs): clean — `Replies judged: 2 of 2 steps; 0 unjudged.`; all-bad primary with
  `JUDGE_FALLBACK_CMD` — `Replies judged: 2 of 2 steps (2 via the fallback judge)`; CLI failure without a fallback —
  `Replies judged: 0 of 2 steps; 2 unjudged.` + `**Rubric means cover the 0 judged replies; 2 unjudged replies are
  excluded.**` (means render `—`, not NaN; script exit 1).
- Verify: `npm run check-all` → 0 errors; `npm run test:unit` → `Test Suites: 189 passed, 189 total`,
  `Tests: 1877 passed, 1877 total` (+7).

### Judge pipeline fixes for the real transcripts (worker, 2026-10-08)

- **The parser now reads the real files.** The observed empty evidence ('the client's message is empty…',
  `scenarioId ''`) had one cause: real L3 files open with run.ts's `# L3 transcript: <id> (<stamp>)` header line, which
  pushed the `## <scenarioId>` marker off line 0 where the parser looked. Fix: take the first `## ` line anywhere.
  Fixtures copied from BOTH real kinds — `evals/judge/__tests__/fixtures/candidate-b-full-workout.md` (this branch's
  reporter) and `baseline-b-full-workout.md` (dev + the run-id reporter patch) — with tests asserting non-empty user
  text, coach reply and run id for every step (9 user steps each).
- **The requests sidecar.** `llm_calls` in fitcoach_test is wiped by every jest DB-suite schema reset, so judging from
  the DB is fragile. New self-contained module `apps/server/evals/lib/write-requests-sidecar.ts`
  (`writeRequestsSidecar(transcriptPath, runIds)` → `<transcript>.requests.json`, `{ [runId]: { requestContext,
  toolCalls } | { error } }`, dynamic imports only — the orchestrator copies this ONE file into the baseline-dev
  worktree and wires the same call into its run.ts). run.ts now writes it right after each L3 scenario's transcript,
  reading llm_calls in the same process. The judge prefers the sidecar per run id and falls back to the DB
  (`parseRequestsSidecar` skips error/malformed entries — unit-tested).
- Red first, recorded: `✕ reads the scenario id (behind the L3-transcript header line)` ×2 (both fixture kinds;
  22 other assertions already passed — the steps themselves were parsed fine) → parser fix → 26/26.
- Offline end-to-end on the REAL candidate transcript with a file-based stub judge (no model): 9 prompts captured,
  the sidecar's `<context>` present in the one prompt its run id keys, '(stored request unavailable)' in the other 8
  (the DB fallback — no llm_calls rows for them in the test DB), `Replies judged: 9 of 9 steps; 0 unjudged.`, exit 0.
- Verify: `npm run check-all` → 0 errors; `npm run test:unit` → `Test Suites: 189 passed, 189 total`,
  `Tests: 1885 passed, 1885 total` (+8).

### T4 (AC-CQ-4) — weight progression through the training prompt (worker, 2026-10-08; steps 1-2 + 4 by the
### prompt-doctor procedure; 3/5/6 are the orchestrator's)

**Cause (steps 1–2, from the exact requests of the live ask-step runs — `print-transcript --run … --payloads`).**
n-load-up run `fcce70ad…` (ask step): the `<context>` carries every deciding fact — `- 2 days ago, Tuesday Oct 6:
10×80, 10×80, 10×80 (all RPE 8)`, `- 5 days ago …: 10×80 ×3 (all RPE 8)`, `- Loads used: 77.5, 80 kg.` — and the coach
answered «<b>80 кг</b> — как в прошлые два раза». n-load-miss run `0da3b5b6…`: the facts carry the miss (`6×100 ×3 (all
RPE 9)` after `9×100 ×3`), and the coach answered «С теми же <b>100 кг</b>… во вторник мешала только свежесть ног, не
вес». Hypothesis: **missing span Y causes behaviour Z** — the training prompt's ONLY load rule (v13) reads «When last
time topped the rep range with reps to spare, the try is the next load they have used; otherwise a rep or two more.» —
it anchors every try to a load ALREADY USED (above the top recorded load there is nothing "used" to pick, and "a rep or
two more" prescribes more reps at the same weight), and nothing in the request defines what a below-floor performance
means for the next load. With the growth step (BR-TRAINING-042) and the miss step (BR-TRAINING-043) absent from the
rules, holding is the reading the prompt invites. A contributing context span (secondary, same runs): the planning note
the model itself wrote at start («Цель — держать 3×10 на 80 кг…» / «Цель: 9+ повторов на 100 кг…») pins the old weight;
fixing the rule may not fully fix cases where the note dominates — that is what the candidate measurement decides.
Classification: prompt text (a rule gap, not wrong data) — prose class 4, the owner-chosen route.

**Candidate (step 4).** ONE sentence replaced in place (the existing rule changed, not a second added), as a BR-LLM-008
derivation `coach.v14.ts` (`deriveV14Template` fails loudly when the v13 needle is missing; the unit test asserts the
full line diff — exactly one bullet line, everything else v13 verbatim). The new sentence (positive terms, no bans, no
examples, no emphasis; the only numbers not in the context are the equipment-step rule, explicitly allowed):

> The next load follows the history: every set at the top of the range in two workouts in a row — one equipment step
> up (2.5 kg barbell, 2 per hand dumbbell, 5 stack); below the range’s floor — one step down; short of the floor only
> with reps in reserve — the same load; after a long break — lighter than before it.

**The switch.** Env `PROMPT_VERSION_TRAINING=v14` selects the candidate; anything else (or unset) keeps v13 — the
default and the baseline, byte-identical (read once at composition; one L3 run is always one version). The coach
section: **v13 2 496 chars (pin 2 500) → v14 2 684 chars (pin 2 700; the growth's stated reason: the owner-ordered
progression principle)**. The sentence replaced: 125 → 313 chars.

- Red first, recorded: `coach.v14.unit.test.ts:12:10 - error TS2307: Cannot find module '../coach.v14'` → implemented →
  then one honest red: the line-diff test first assumed the sentence was a whole line (it sits mid-bullet) — recomputed
  the expected line as v13's line with the sentence replaced.
- Verify: `npm run check-all` → 0 errors; `npm run test:unit` → `Test Suites: 190 passed, 190 total`,
  `Tests: 1892 passed, 1892 total` (+7: the v14 module, its line diff, the size pin, the loud-needle guard and the
  three env-selection cases); flock `npm run test:scenarios` (default v13) → `Test Suites: 27 passed, 27 total`,
  `Tests: 1 todo, 501 passed, 502 total`; the n-load suite under `PROMPT_VERSION_TRAINING=v14` → `Test Suites: 1
  passed, 1 total`, `Tests: 60 passed, 60 total` (the scripted layer proves the candidate composes end to end).
- Left to the orchestrator: steps 3/5/6 — the baseline (v13) and candidate (v14) live measurements, the blind judge,
  accept-or-revert (the acceptance bar of the plan's T3 rubric applies; the planning-note confound above is worth a
  look in the candidate transcripts).

### T2 addendum — n-load-gravitron, the counterweight progression (worker, 2026-10-08)

- Owner order 2026-10-08: the Gravitron ('Assisted Pull-ups (Gravitron)') is a catalog exercise whose plate weight is
  a COUNTERWEIGHT — less weight = harder = progress. New journey `n-load-gravitron`: history 30 kg (−8 d) → two
  consecutive workouts with every set 10×25 RPE 8 (−5 d, −2 d), range 8–10, stack equipment; the ask
  «какой вес ставить на гравитроне?». Oracle: direction up in DIFFICULTY = counterweight DOWN one stack step →
  expected **20**, acceptable **[20]** (the stack rule = 5, as the oracle already applies; the brief's 2.5-alternative
  does not apply). The miss branch mirrors (counterweight UP one step, pinned by a unit test); break/hold keep the
  same counterweight. `weight-oracle.ts` grew an explicit TEST-ONLY `assisted` flag derived from the exercise NAME
  containing 'Assisted' (`isAssistedExercise`) — the product itself has no such flag by owner decision; the meaning
  comes from the name. `nLoadExpectations()` includes the case automatically (direction up, expected 20) so T3's
  weight-hit computation covers it unchanged.
- Fixture note (outside `evals/**`, one row, following the established fixed-id convention the b/n-load journeys
  already rely on): `src/app/test/setup.ts` seeds 'Assisted Pull-ups (Gravitron)' (id `6b1d2f39-…`, compound, stack,
  strength, lats primary / biceps secondary) — the scripted `start_training_session` needs a fixed id.
- Red first, recorded: oracle — `weight-oracle.unit.test.ts:225:52 - error TS2353: 'exerciseName' does not exist in
  type 'Partial<OracleInput>'` → the assisted flag → 14/14. Journey — first run `Tests: 61 passed, 61 total`: the
  gravitron was in `N_LOAD_CASES` (its expectations entry ran) but NOT yet in the integration test's `JOURNEYS`
  list — added → 70/70 with every pinned `# History` row (dates, `Loads used: 25, 30 kg.`,
  `in progress: 10×20`) passing on the first scripted run.
- Verify: `npm run check-all` → 0 errors; `npm run test:unit` → `Test Suites: 190 passed, 190 total`,
  `Tests: 1895 passed, 1895 total` (+3); the n-load suite → `Test Suites: 1 passed, 1 total`,
  `Tests: 70 passed, 70 total`; flock `npm run test:scenarios` — quoted in the worker report.

### T4 second candidate — v15, load vs reps (worker, 2026-10-08)

- **v14 live result:** growth 2/3 (v13: 0/3). After a miss the coach held 100 kg and lowered the rep target 3/3 —
  reasoning recovery. **Owner decision 2026-10-08:** this is legitimate, not a fault: «не всегда понижение веса, мы так не
  будем расти; иногда нужно взять максимальный вес, новую планку поставить, сделать меньше повторов, потом повторы,
  потом подходы 3→4→5». So the miss case is a CHOICE, and the prompt's progression text must allow it.
- **Candidate (`coach.v15.ts`, BR-LLM-008 derivation from v14, `PROMPT_VERSION_TRAINING=v15`; default stays v13
  byte-identical):** v14's progression sentence replaced in place by one short paragraph (positive terms, no bans, no
  example replies, no emphasis). Verbatim:

> The next load follows the history, the plan's range and the client's goal: every set at the top of the range in two workouts in a row — one equipment step up (2.5 kg barbell, 2 per hand dumbbell, 5 stack); a little short of the floor — the same load, aim for the floor again; with a strength goal, a heavier load for fewer reps is a fair way to set a new mark, and then the reps come back and the sets grow 3→4→5; the load drops only when reps fell far below the range and it was not a deliberate heavy try; after a long break — lighter than before it. Say in one phrase which choice this is and why.

- **Size:** coach section v13 2 496 → v14 2 684 → **v15 2 971 chars** (pin 3 050; stated reason of the growth: the
  owner-ordered load-vs-reps principle). The paragraph is 600 chars (v14's sentence 313).
- (D) The assisted-counterweight sentence was NOT added: no measured fault shows the coach getting it wrong, and the
  brief says state it only if needed. Reason: no evidence of need; revisit if the Gravitron case misses live.
- **Oracle / judge:** after a miss the oracle verdict keeps the step down as `expectedKg` and adds `holdWithReason`
  (the working weight, mirrored for the assisted exercise). The judge extraction gained `reasonStated: bool`;
  `weightHit` accepts the hold only with `reasonStated: true`, rubric text updated.
- **Judge bugs (coordinator addendum, T3 file):** (1) `buildJudgePrompt` ended at the heading «The client's message» —
  the client text, the delivered reply and the tools were never appended (every live verdict said «reply empty»); now
  appended with a closing instruction. (2) The request context was the last stored call's user message, which can be a
  course-check/summariser call; `pickCoachContext` now takes the last call whose request carries a `<context>` block
  (sidecar and DB fallback both).
- Red first, recorded: `coach-quality-judge.unit.test.ts: error TS2305: Module '../coach-quality-judge' has no exported
  member 'buildJudgePrompt'` (and `pickCoachContext` missing in `write-requests-sidecar`); the field was renamed
  `reason_stated` → `reasonStated` to match the extraction's camelCase; a lint error (`no-nested-ternary`) in the version
  switch was replaced by a lookup table.
- Verify: `npm run check-all` → 0 errors; `npm run test:unit` → `Test Suites: 191 passed, 191 total`,
  `Tests: 1912 passed, 1912 total`; flock `npm run test:scenarios` (default v13) → `Test Suites: 27 passed, 27 total`,
  `Tests: 1 todo, 511 passed, 512 total`; n-load suite under `PROMPT_VERSION_TRAINING=v15` → `Test Suites: 1 passed,
  1 total`, `Tests: 70 passed, 70 total` (the whole scenarios folder under v15 also: 511 passed, 1 todo).
- Left to the orchestrator: live v15 measurement (3 runs, blind judge with the fixed judge prompt), accept-or-revert.
