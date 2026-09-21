# Live-Session Findings (BUG-022…BUG-030) — Reproduction Before Remediation Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans and test-driven-development. The owner explicitly requires the reproduction stage BEFORE any fix; this overrides the usual one-test/one-fix interleaving. Execute only the dispatched task. The coordinator reviews the RED evidence before dispatching remediation.

- Status: planned
- Branch: plan/session-2026-09-21-repro

**Goal (owner, 2026-09-22):** "агент пишет тесты которые повторяют эти ошибки (если еще не написаны);
когда мы видим что ошибка тестом отлавливается, только потом начинаем фикс." Turn the 2026-09-21
live-session findings into failing tests against unchanged production code, and state plainly which
findings no deterministic test can catch.

**Source of truth for the findings:** `docs/BUGS.md` BUG-022…BUG-030 (session
`fa293e20-e1ac-4ae6-8787-1ac1ab1dff06`, dev, model `google/gemini-3.8-flash`). Each carries the run
ids and DB rows that were observed; reproduce the *behaviour*, not the transcript.

**Coverage checked 2026-09-22 (before writing this plan):**
- `log-set.tool.unit.test.ts` never mentions `durationSeconds` — BUG-023 is untested.
- `tool-policy.unit.test.ts:67-76` **asserts the current order** (`sorted[2].name === 'delete_last_sets'`),
  i.e. the defect behind BUG-027 is pinned by a green test. The repro must demonstrate the harm; the
  existing expectation is changed only at remediation, never in this plan.
- `training-service-hardening.unit.test.ts:227-248` covers the domain side of BUG-025 (0 sets →
  `skipped`), but nothing covers the text `formatExerciseSummary` produces for that case.
- `previousSession` appears in several tests; none of them exercises the selection rule behind BUG-030.

**Architecture:** production stays untouched for the whole plan. Exercise real services, tools,
graph wiring and repositories; stub only external model/Telegram I/O. RED probes live in
`*.repro.test.ts`, outside the default green suites, and are promoted to ordinary
`*.unit.test.ts` / `*.integration.test.ts` when their fix lands.

**Acceptance / coverage:**

| ID | Finding | Observable evidence to produce | Classification |
|---|---|---|---|
| AC-LSR-1 | BUG-023 | A 45-second plank logged through `log_set` stores a duration, not `{"type":"functional_reps","reps":45}`; the exercise summary renders `45s` | Deterministic — tool + summary |
| AC-LSR-2 | BUG-025 | Auto-completing an exercise with 0 sets yields text that says skipped and asks for no RPE analysis; today it says `completed` and asks for an RPE trend over an empty list | Deterministic — `formatExerciseSummary` |
| AC-LSR-3 | BUG-027 | A single batch containing `delete_last_sets` + the corrected `log_set` calls leaves the corrected sets in place; today priority ordering writes them first and the deletion removes them | Deterministic — executor over real DB |
| AC-LSR-4 | BUG-030 | With three recent leg sessions and one old session sharing the `session_key`, the previous-session block cites the most recent one and carries its date; today it cites the old one and no date | Deterministic — real DB |
| AC-LSR-5 | BUG-029 | Rows of one run read back in the order they were produced | Deterministic — transcript |
| AC-LSR-6 | BUG-022 (loss half) | A run whose graph throws still leaves the user's message in `conversation_turns` | Deterministic — adapter |
| AC-LSR-7 | BUG-022/024/026/028 (behaviour half) | No deterministic test exists: these are model outputs. Produce eval-case drafts with explicit expectations and a written statement of what each would catch — no model is run in this plan | Eval-only — stated, not faked |
| AC-LSR-8 | — | Every repro file fails for the stated reason on unchanged production; existing suites stay green; the production diff is empty | Delivery gate |

## Global Constraints

- Owner instruction: genuinely failing tests on unchanged production first, coordinator review, then
  fixes in a separate plan. No `skip`, no `test.failing`, no inverted assertions, no manufactured RED.
  A finding whose test unexpectedly passes is reported as **unconfirmed** — never weaken the test.
- No live LLM (`RUN_LLM_EVALS` / `EVALS_FULL_RUN` never set), no Telegram, no dev/prod data, no
  deploy, push or merge. Real-DB tests use the existing local `fitcoach_test` database only, with the
  existing fixture cleanup; one worker owns it at a time.
- The worker edits test files, new eval-draft files and this plan's checkboxes/evidence only. No
  production code, no migrations, no durable specs, no `docs/STATE.md`, no `docs/BUGS.md`, no
  `Status:` lines. Escalate instead of improvising.
- RED files are named `*.repro.test.ts` and run via explicit `--testMatch` commands recorded in the
  evidence table: exact command, exit code, failing assertion, baseline SHA.
- Compilation, fixture or DB-connection failures are **not** reproduction: repair the test setup
  without touching production, or escalate.
- Baseline: `fc5d0073` on `dev`. Recheck HEAD before starting.

---

### Task 1: Set-shape defects (AC-LSR-1, AC-LSR-2)

**Files:** `apps/server/src/infra/ai/tools/__tests__/log-set.tool.repro.test.ts`,
`apps/server/src/infra/ai/tools/__tests__/format-exercise-summary.repro.test.ts`.
Read `log-set.tool.ts`, `format-exercise-summary.ts`, `set-data.types.ts` and the existing
`log-set.tool.unit.test.ts` first.

- [x] **AC-LSR-1**: log a plank hold of 45 s the way the training prompt describes a bodyweight
  exercise, and assert the stored `setData` carries a duration. Include the positive control that
  a cardio duration still works today, so the failure isolates the isometric path.
- [x] **AC-LSR-2**: build the auto-complete summary for an exercise with 0 sets (the shape
  `ensureCurrentExercise` produces when it marks `skipped`) and assert the text does not claim
  `completed` and does not ask for an RPE trend.
- [x] **Verify:** `cd apps/server && npx jest --testMatch='**/__tests__/**/*.repro.test.ts'` — record
  the exact failures in the evidence table below.

### Task 2: Correction batch destroys the corrected sets (AC-LSR-3)

**Files:** `apps/server/src/infra/ai/graph/__tests__/tool-ordering.repro.test.ts` (or an
integration file if the executor needs the real DB). Read `tool-executor.ts`, `tool-policy.ts`,
`phases/training.spec.ts`, `delete-last-sets.tool.ts` and the existing `tool-policy.unit.test.ts`.

- [x] **AC-LSR-3**: seed an exercise with two wrong sets; execute ONE batch that deletes them and logs
  the four corrected sets (the shape RULE 10 currently forbids); assert the session ends with exactly
  the corrected sets. Today the priority order writes first and deletes after, so the corrected sets
  disappear — that is the RED to capture.
- [x] Do **not** modify `tool-policy.unit.test.ts:67-76`; it pins the present order and belongs to the
  remediation step. Note in the evidence table that it will have to change.
- [x] **Verify:** the repro `--testMatch` command; plus `npm run test:unit` to show existing suites stay green.

### Task 3: "Previous session" selection and dating (AC-LSR-4)

**Files:** `apps/server/tests/integration/scenarios/previous-session.repro.test.ts`. Read
`phases/training.spec.ts:95-112`, `workout-session.repository.ts`
(`findLastCompletedByUserAndKey`), `prompts/blocks/training-workout-overview.v1.ts:120-143` and the
existing scenario harness.

- [ ] **AC-LSR-4**: seed one user with leg sessions on three recent dates (distinct `session_key`s, as
  real sessions have) plus one much older session whose `session_key` equals today's; build the
  training context; assert the previous-session block reflects the most recent leg session and states
  its date. Today it reflects the old one and prints no date.
- [ ] **Verify:** `RUN_DB_TESTS=1 npx jest --testMatch='**/tests/integration/**/*.repro.test.ts'`.

### Task 4: The transcript loses order and loses messages (AC-LSR-5, AC-LSR-6)

**Files:** `apps/server/src/infra/conversation/__tests__/transcript-order.repro.test.ts`,
`apps/server/src/infra/ai/graph/__tests__/failed-run-transcript.repro.test.ts`. Read
`drizzle-transcript.service.ts`, `conversation-run.adapter.ts:123-157`, `commit.node.ts`.

- [ ] **AC-LSR-5**: write one run's rows and read them back the way a reader does
  (`ORDER BY created_at`); assert they come back in the order produced. Today every row shares one
  timestamp and the order is arbitrary — make the assertion deterministic (e.g. assert the read order
  equals the produced order for a run whose rows are distinguishable), not dependent on luck.
- [ ] **AC-LSR-6**: a graph that throws must still leave the user's message in `conversation_turns`.
- [ ] **Verify:** the repro `--testMatch` commands.

### Task 5: What no deterministic test can catch (AC-LSR-7)

**Files:** `apps/server/evals/datasets/drafts/session-2026-09-21.jsonl` (drafts, not a live run) and a
short note in this plan.

- [ ] For BUG-022 (false "logged" confirmation in `session_planning`), BUG-024 (warm-up never logged),
  BUG-026 (invented provenance explanation), BUG-028 (rule numbers and wrong language): write one eval
  case each — input, session state, and the expectation in the framework's shape
  (`PROMPT_EVAL_FRAMEWORK.md`). State for each what a deterministic test could and could not verify.
- [ ] **Do not run any model.** Whether these are ever executed is the owner's call (cost).
- [ ] **Verify:** `npm run test:unit` stays green; the drafts parse (a `node --experimental-strip-types`
  or existing lint/parse path is enough).

---

## Evidence table (filled by the workers)

| AC | Command | Exit | Failing assertion | Baseline SHA |
|---|---|---|---|---|
| AC-LSR-1 | `cd apps/server && NODE_ENV=test npx jest --testMatch='**/__tests__/**/*.repro.test.ts'` — `log-set.tool.repro.test.ts` | 1 | `stores a 45-second plank, logged the documented bodyweight way…` fails at `expect(storedSetData()).toMatchObject({ duration: 45 })`: received `{"type":"functional_reps","reps":45}`. Positive control (`durationSeconds:1200` → `cardio_duration`) passes. Input is `{exerciseName:'Plank', reps:45}` — the only path the `log_set` description documents for bodyweight ("reps only"); a fix must either teach the tool/prompt a hold path or resolve isometric exercises tool-side. | `dcf989bb` |
| AC-LSR-2 | same command — `format-exercise-summary.repro.test.ts` | 1 | Two failures on the string from real `TrainingService.ensureCurrentExercise` (0 sets → `skipped`) fed to `formatExerciseSummary`: `not.toMatch(/completed/i)` (received `Exercise 'Seated Calf Raise Machine' completed.`) and `not.toMatch(/RPE/)` (received `…list the sets, analyze RPE trend…` after an empty `Sets performed:`). Controls pass: domain writes `skipped` for 0 sets; an exercise with sets still reads `completed`. | `dcf989bb` |
| AC-LSR-3 | `cd apps/server && RUN_DB_TESTS=1 NODE_ENV=test npx jest --testMatch='**/tests/integration/**/*.repro.test.ts'` — `tests/integration/services/tool-ordering.repro.test.ts` (real executor + `buildTrainingToolPolicy` + real `log_set`/`delete_last_sets` + real `TrainingService` and repositories over `fitcoach_test`; nothing stubbed) | 1 | `one batch [delete_last_sets, 4 x log_set] leaves exactly the corrected sets` fails at `expect(await storedSets(sessionId)).toEqual(CORRECTED_SETS)`: two seeded wrong sets (10×100) survive and the two 120×12 corrected sets are gone — final state `[10×100, 10×100, 12×110, 12×110]` vs expected `[12×110, 12×110, 12×120, 12×120]`. Control passes: the same deletion and the same four `log_set` calls sent as two batches in that order leave exactly the corrected sets. **Remediation note:** `tool-policy.unit.test.ts:67-76` (`should sort correction tools after transitions but before finish`, asserts `sorted[0]=log_set`, `sorted[2]=delete_last_sets`) pins the present order and must change together with the fix; `tool-executor.unit.test.ts` (AC-1332 ordering) uses `TRAINING_TOOL_PRIORITY` and should be rechecked. Not touched here. | `57a42c8e` (Task 1 commit on top of `dcf989bb`; no production change) |
| — | `cd apps/server && npm run test:unit` | 0 | 121 suites / 1151 tests green; `git diff` shows no production change (repro files only). Re-run after Task 2 with the same result. | `dcf989bb` / `57a42c8e` |
