# Live-Session Findings (BUG-022…BUG-030) — Reproduction Before Remediation Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans and test-driven-development. The owner explicitly requires the reproduction stage BEFORE any fix; this overrides the usual one-test/one-fix interleaving. Execute only the dispatched task. The coordinator reviews the RED evidence before dispatching remediation.

- Status: done
- Branch: plan/session-2026-09-21-repro
- Review: 2026-09-22 | clean | R1,R2,R3,R4

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

**De-duplication note (close-out R2, owner ruling 2026-09-22: no duplication accepted).**
`log-set.tool.unit.test.ts` no longer declares its own `InvokableTool` / `makeTrainingService` /
`makeConfig` / `makeDeps`: they moved to `src/infra/ai/tools/__tests__/log-set-test-support.ts`, which both
it and `log-set.tool.repro.test.ts` import (the repro keeps only its echo-the-setData step).
`training-service-hardening.unit.test.ts` lost its factories (`makeSessionSet`, `makeExerciseWithDetails`,
`makeSession`, `createMocks`) to `src/domain/training/services/__tests__/training-service-test-support.ts`;
`format-exercise-summary.repro.test.ts` builds on them instead of its own `makeExercise`/`switchAwayFrom`
and dropped its two control tests (the domain fact is proven by the hardening suite). The
"defect is in the text" guard is now one line inside the probe: it asserts the status the domain wrote
(`skipped`) before reading the text. Same assertions, same RED (see the re-run rows below).

**Second de-duplication pass (R2 re-run).** `training-service-log-set-with-context.unit.test.ts` was the last
hand-rolled copy of that shape; it now uses `training-service-test-support.ts` for everything:
`makeSessionSet({ setNumber })` (the one factory; the file's positional variant is gone), `createMocks()`
(its `mockSessionRepo` / set / exercise repository literals are gone — one factory remains) and
`makeSessionExercise(...)`, a new export of the same module. The latter is the row-only layer:
`makeExerciseWithDetails` now composes `makeSessionExercise()` plus its optional catalog/sets layer, so the
two are genuinely one shape (values of `makeExerciseWithDetails` unchanged). The file's default resolved
session for `findByIdWithDetails` was dead — every test spies `ensureCurrentExercise` and `logSet`, and
`logSet` never reads it — so it was dropped rather than carried into the shared factory; the three tests
assert exactly what they asserted before. `grep` shows one `makeSessionSet`, one session-repository mock
literal and one `makeSessionExercise` under `services/__tests__/`.


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

**De-duplication note.** `tool-ordering.repro.test.ts` now gets its `TrainingService` from the new
integration factory `tests/helpers/training-service.ts` (`buildRealTrainingService()`, optional
`sessionRepo` override) — see the Task 3 note for the other callers.


### Task 3: "Previous session" selection and dating (AC-LSR-4)

**Files:** `apps/server/tests/integration/scenarios/previous-session.repro.test.ts`. Read
`phases/training.spec.ts:95-112`, `workout-session.repository.ts`
(`findLastCompletedByUserAndKey`), `prompts/blocks/training-workout-overview.v1.ts:120-143` and the
existing scenario harness.

- [x] **AC-LSR-4**: seed one user with leg sessions on three recent dates (distinct `session_key`s, as
  real sessions have) plus one much older session whose `session_key` equals today's; build the
  training context; assert the previous-session block reflects the most recent leg session and states
  its date. Today it reflects the old one and prints no date.
- [x] **Verify:** `RUN_DB_TESTS=1 npx jest --testMatch='**/tests/integration/**/*.repro.test.ts'`.

**De-duplication note.** `previous-session.repro.test.ts` uses `buildRealTrainingService()` instead of
hand-wiring six repositories. The same factory replaced the copies in
`tests/integration/services/training.service.integration.test.ts` and
`tests/integration/scenarios/review-training.integration.test.ts` (both its main wiring and the
`blindService` variant, through the `sessionRepo` override) — five hand-built copies became one. Not routed
(deliberately): production `register-infra-services.ts`.


### Task 4: The transcript loses order and loses messages (AC-LSR-5, AC-LSR-6)

**Files:** `apps/server/src/infra/conversation/__tests__/transcript-order.repro.test.ts`,
`apps/server/src/infra/ai/graph/__tests__/failed-run-transcript.repro.test.ts`. Read
`drizzle-transcript.service.ts`, `conversation-run.adapter.ts:123-157`, `commit.node.ts`.

- [x] **AC-LSR-5**: write one run's rows and read them back the way a reader does
  (`ORDER BY created_at`); assert they come back in the order produced. Today every row shares one
  timestamp and the order is arbitrary — make the assertion deterministic (e.g. assert the read order
  equals the produced order for a run whose rows are distinguishable), not dependent on luck.
- [x] **AC-LSR-6**: a graph that throws must still leave the user's message in `conversation_turns`.
- [x] **Verify:** the repro `--testMatch` commands.

**De-duplication note.** `failed-run-transcript.repro.test.ts` no longer mocks `@infra/ai/model.factory`
itself: it uses the shared `scripted-model.ts`, which gained the missing capability —
`failNextChat(error)` (throw once, cleared by `reset()`, queued answers untouched). The other scenario
tests are unaffected (`npm run test:scenarios` green). `transcript-order.repro.test.ts` was already free of
the duplicated wiring (it needs no `TrainingService`).


### Task 5: What no deterministic test can catch (AC-LSR-7)

**Files:** `apps/server/evals/datasets/drafts/session-2026-09-21.jsonl` (drafts, not a live run) and a
short note in this plan.

- [x] For BUG-022 (false "logged" confirmation in `session_planning`), BUG-024 (warm-up never logged),
  BUG-026 (invented provenance explanation), BUG-028 (rule numbers and wrong language): write one eval
  case each — input, session state, and the expectation in the framework's shape
  (`PROMPT_EVAL_FRAMEWORK.md`). State for each what a deterministic test could and could not verify.
- [x] **Do not run any model.** Whether these are ever executed is the owner's call (cost).
- [x] **Verify:** `npm run test:unit` stays green; the drafts parse (a `node --experimental-strip-types`
  or existing lint/parse path is enough).

#### Task 5 result — drafts and what each can and cannot catch (AC-LSR-7)

`apps/server/evals/datasets/drafts/session-2026-09-21.jsonl` — four L1-shaped cases (`EvalCaseSchema`),
tagged `draft`, authored not run. The runner only scans the five phase directories (`EVAL_PHASES`) plus
what `--phase <dir>` names, so `drafts/` is never part of a sweep; loading it needs an explicit
`--phase drafts --dataset session-2026-09-21` **and** `RUN_LLM_EVALS=1`. Nothing was run (`RUN_LLM_EVALS` /
`EVALS_FULL_RUN` unset). Cost if the owner ever runs it: 4 cases × n=1 = 4 coach calls (+ tool rounds), which
still needs the written §7a argument. `judge` entries `LS-J1…J4` are **proposed** criteria — they do not exist
in `PROMPT_EVAL_FRAMEWORK.md` §5.1 (and the repo has no L2 judge implementation yet); they are defined below
and become real only when the owner adopts them. Seed messages are reconstructed from what the bugs record
(see each case) — replace them with the exported turns of the named run before promotion.

| Case | Finding | Input (from the bug) | Deterministic gate in the case | Proposed judge criterion |
|---|---|---|---|---|
| LS-0001 | BUG-022 | phase `session_planning`; three earlier human turns of the failed runs (450/454/458) sit in the seed; input "второй подход повторил" (run `6d2be9db`) | `mustNotMatch` a positive claim of saving (`записал/зафиксировал/сохранил/внёс/занёс`, `logged/recorded/saved`, negation-guarded); `tools.mustNot log_set`; language ru | **LS-J1** the reply neither states nor implies the reported sets were recorded (5 = says plainly that nothing is stored yet / how it will be; 1 = "зафиксировал"-class claim or an oblique equivalent) |
| LS-0002 | BUG-024 | phase `training`, active session `lower_a`; seed "начинаю с пробежки на беговой дорожке"; input "закончил 2км за 13:45" | `tools.must log_set` with `args.distanceKm = 2` | **LS-J2** the warm-up is logged with its distance and time (825 s) before any confirmation; a text-only echo scores 1 |
| LS-0003 | BUG-026 | phase `chat`; seed carries the `search_exercises` result with the real catalog ids of Leg Extension / Leg Curl, the recap request, and an AI recap whose shape the bug describes (ids for five exercises, none for those two); input "не все записи имеют айди" (run `c7d071ed`) | `mustNotMatch` the live wording of the invented mechanism (`справочник`, `обращался напрямую`, `в этой ветке`, `не подтянулись`, `в эту сводку истории`) | **LS-J3** when challenged on provenance the reply states what is in context (or "у меня этого нет") and offers no explanation of why data is missing that is not visible in context |
| LS-0004 | BUG-028 | phase `training`, two `log_set` @ 120 kg seeded as tool traffic; input "ты не записал все, первых два подхода 110 вторых 2 120 по 12, все рпе в конце 9" (run `ef7f3998`) | `language ru` (Cyrillic-ratio heuristic), `telegram_html`, `mustNotMatch` rule numbers / protocol wording (`Rule N`, `per (our) protocol`, `по правилу`, `по протоколу`, `правило №N`) | **LS-J4** single-language reply in the user's language, no rule numbers, no "per protocol" register (also scores TR-3 for the correction itself) |

Regex sanity was checked without any model: each gate flags the live wording quoted in its bug and lets a
plain honest wording through (`node` one-off, recorded in the evidence table).

**What a deterministic test could and could not verify**

- **LS-0001 (BUG-022).** *Could:* the rendered `session_planning` prompt (L0, no model) carries the
  "never state or imply that performed sets were recorded" rule once it is written; the phase's tool set has
  no `log_set` (already structural); a scripted-model scenario can prove that *if* a `log_set` follows the
  transition the rows exist in `session_sets`. *Could not:* whether the model, given "второй подход повторил",
  claims or hints that something was saved — that is a property of a sampled reply. The `mustNotMatch` gate is
  only a floor (a paraphrase such as "всё учтено" passes it); the judge closes the gap.
- **LS-0002 (BUG-024).** *Could:* the training prompt carries the pre-session-work rule; a scripted `log_set`
  with `exerciseName` + `distanceKm` persists a `cardio_distance` row (the persistence path works — journey C
  already exercises it). *Could not:* whether the model chooses to call `log_set` for a warm-up report. Only a
  live run distinguishes "logged" from "narrated". Note the live warm-up was reported while the phase was
  `session_planning` (no `log_set` there); this case pins the training-phase half (report at session start),
  the planning-phase half falls under LS-0001's remediation ("logged after the transition").
- **LS-0003 (BUG-026).** *Could:* the assembled model input contains the Leg Extension / Leg Curl ids
  (`assembledInput` is already captured by L1 and `user-facts-block-present`-style checks exist), and the
  prompt carries the provenance rule. *Could not:* recognise an invented mechanism in general. The regexes
  match this one live wording; a fresh fabrication with different words passes. Only a judged run (or the owner
  reading it) sees "explains why data is missing without evidence".
- **LS-0004 (BUG-028).** *Could:* the language heuristic and rule-number regexes on a reply; a prompt-render
  check that the rule "never mention rule numbers or protocol wording" is present. *Could not:* bilingual
  replies with a dominant Cyrillic ratio pass the heuristic; paraphrases of "per our protocol" pass the
  regexes; whether a reply *reads* as an excuse for a round-trip is a judgement. BUG-027's fix removes RULE 10
  and with it most of this leak — the case stays as a guard for the register and the language.

---

## Evidence table (filled by the workers)

| AC | Command | Exit | Failing assertion | Baseline SHA |
|---|---|---|---|---|
| AC-LSR-1 | `cd apps/server && NODE_ENV=test npx jest --testMatch='**/__tests__/**/*.repro.test.ts'` — `log-set.tool.repro.test.ts` | 1 | `stores a 45-second plank, logged the documented bodyweight way…` fails at `expect(storedSetData()).toMatchObject({ duration: 45 })`: received `{"type":"functional_reps","reps":45}`. Positive control (`durationSeconds:1200` → `cardio_duration`) passes. Input is `{exerciseName:'Plank', reps:45}` — the only path the `log_set` description documents for bodyweight ("reps only"); a fix must either teach the tool/prompt a hold path or resolve isometric exercises tool-side. | `dcf989bb` |
| AC-LSR-2 | same command — `format-exercise-summary.repro.test.ts` | 1 | Two failures on the string from real `TrainingService.ensureCurrentExercise` (0 sets → `skipped`) fed to `formatExerciseSummary`: `not.toMatch(/completed/i)` (received `Exercise 'Seated Calf Raise Machine' completed.`) and `not.toMatch(/RPE/)` (received `…list the sets, analyze RPE trend…` after an empty `Sets performed:`). Attribution to the TEXT (not the domain classification) is guarded inside each probe by re-reading the status the domain wrote (`update('se-seated', {status:'skipped'})`); the two stand-alone control tests were removed in the de-duplication pass (see Task 1 note). | `dcf989bb` |
| AC-LSR-3 | `cd apps/server && RUN_DB_TESTS=1 NODE_ENV=test npx jest --testMatch='**/tests/integration/**/*.repro.test.ts'` — `tests/integration/services/tool-ordering.repro.test.ts` (real executor + `buildTrainingToolPolicy` + real `log_set`/`delete_last_sets` + real `TrainingService` and repositories over `fitcoach_test`; nothing stubbed) | 1 | `one batch [delete_last_sets, 4 x log_set] leaves exactly the corrected sets` fails at `expect(await storedSets(sessionId)).toEqual(CORRECTED_SETS)`: two seeded wrong sets (10×100) survive and the two 120×12 corrected sets are gone — final state `[10×100, 10×100, 12×110, 12×110]` vs expected `[12×110, 12×110, 12×120, 12×120]`. Control passes: the same deletion and the same four `log_set` calls sent as two batches in that order leave exactly the corrected sets. **Remediation note:** `tool-policy.unit.test.ts:67-76` (`should sort correction tools after transitions but before finish`, asserts `sorted[0]=log_set`, `sorted[2]=delete_last_sets`) pins the present order and must change together with the fix; `tool-executor.unit.test.ts` (AC-1332 ordering) uses `TRAINING_TOOL_PRIORITY` and should be rechecked. Not touched here. | `57a42c8e` (Task 1 commit on top of `dcf989bb`; no production change) |
| AC-LSR-4 | `cd apps/server && RUN_DB_TESTS=1 NODE_ENV=test npx jest --testMatch='**/tests/integration/**/previous-session.repro.test.ts'` — `tests/integration/scenarios/previous-session.repro.test.ts` (real `buildTrainingSpec().loadContext` + real repositories over `fitcoach_test`; block rendered by `TRAINING_PREVIOUS_SESSION_V1` with pinned `now` 2026-09-21; explicit fixture dates) | 1 | 3 failures, 1 control green. (a) selection: `expect(previous?.sessionKey).toBe('hist_20260916_lower')` — received `"lower_a"` (the 2026-02-20 session). (b) block content: `toContain('Barbell Bench Press')` fails — the block shows only the old session's Back Squat 52/59/66/66 and Pull-ups. (c) dating, independent of selection: the block rendered for the session it was given (2026-02-20) does not match its own date (`/2026-02-20\|20\.02\.2026\|Feb… 20\|20 Feb/`). Control passes: the block header is `=== PREVIOUS SESSION (same template — 213d ago) ===`. **Nuance for BUG-030:** the block already prints a *relative* age (`213d ago`) — it does not print no time at all; what is missing is the calendar date, so the date fix should add it next to (not instead of) the age. **Fixture deviation:** `fitcoach_test` seeds only four exercises (`setup.ts`), so Back Squat / Bench Press stand in for Leg Extension / Leg Curl, and keys keep the live `..._lower` names. | `c395d7ce` (Task 2 on `57a42c8e`, `dcf989bb`; no production change) |
| AC-LSR-5 | `cd apps/server && RUN_DB_TESTS=1 NODE_ENV=test npx jest --testMatch='**/tests/integration/services/transcript-order.repro.test.ts'` — `tests/integration/services/transcript-order.repro.test.ts` (real `DrizzleTranscriptService.appendRunMessages` → real `evals/lib/export-query` `fetchRunsSince`; formulation B, agreed with the coordinator) | 1 | `expect(await readByReader()).toEqual(produced)` fails: the reader returns the run reversed (`ai:step-10 final reply, tool_result:step-09…, … , ai:, human:step-01 user message`) instead of `human:step-01 …, ai:, tool_call:tool_a, …, ai:step-10 final reply`. Soundness preconditions pass before it: the ordinary `UPDATE` rewrite (reverse produced order, `SET content = content`) moved the physical order, and sorting the rows by the produced position the test stores restores the produced sequence. **Root cause, measured:** `SELECT count(DISTINCT created_at), count(*) FROM conversation_turns WHERE run_id = $1` → **1 distinct of 10** rows for a run written through the real append path (one INSERT statement → one `now()`); `id` is a random uuid, so nothing else carries order. **Why plain read-back cannot be the probe:** on a freshly written table Postgres returns tied rows in insertion order — a first plain probe (10 rows, also with 12 other runs around it) PASSED, so the read-order assertion alone would fail only by luck of physical layout; the probe removes that luck instead (no elevated privileges, no `VACUUM FULL`). Any fix that persists order (seq column, distinct timestamps) turns it green. | `6d74f836` |
| AC-LSR-6 | `cd apps/server && RUN_DB_TESTS=1 NODE_ENV=test npx jest --testMatch='**/tests/integration/scenarios/failed-run-transcript.repro.test.ts'` — `tests/integration/scenarios/failed-run-transcript.repro.test.ts` (real `registerInfraServices` wiring: real graph, adapter, repositories, PostgresSaver; only the ChatModel is replaced — it answers, or throws once) | 134 (see note) | `a run that fails inside the graph leaves its user message in the transcript` fails at `expect(await humanTurnTexts(failedUserId)).toContain('накинул 10кг и сделал еще подход на 12')` — `Received array: []`. Preconditions pass first: `runScenario` rejects, and `conversation_runs.outcome = 'core_error'` (the failed run IS recorded, its message is not). Control passes: a completed run leaves its user message in `conversation_turns`. **Exit-code note:** exit 134 is a native abort at process shutdown (`libc++abi: terminating due to uncaught exception of type std::__1::system_error: mutex lock failed`) that the untouched `harness.integration.test.ts` produces identically (all its tests pass, exit 134) — pre-existing, caused by the ONNX embedding pipeline that `registerInfraServices` loads; the jest report itself is `1 failed, 1 passed`. | `6d74f836` |
| AC-LSR-7 | `cd apps/server && node -e "const l=require('fs').readFileSync('evals/datasets/drafts/session-2026-09-21.jsonl','utf8').split('\\n').filter(Boolean);l.forEach(x=>JSON.parse(x));console.log(l.length,'lines, each valid JSON')"` and `npx tsx <scratch>/parse-drafts.ts` (`parseCases` from `evals/schema/case.schema.ts` + compile of every `mustNotMatch` with the runner's `(?i)` translation) | 0 | `4 lines, each valid JSON`; `4 cases parse against EvalCaseSchema: LS-0001, LS-0002, LS-0003, LS-0004`; `all mustNotMatch patterns compile`. Regex sanity (node one-off, no model): LS-0001 / LS-0003 / LS-0004 gates flag the live wording quoted in BUG-022/026/028 and pass a plain honest wording. No model was run (`RUN_LLM_EVALS`, `EVALS_FULL_RUN` unset). Eval-only by nature — stated, not faked; see "Task 5 result". | `0b4ca1dc` |
| — | **De-duplication re-run (2026-09-22)**: `cd apps/server && NODE_ENV=test npx jest --testMatch='**/__tests__/**/*.repro.test.ts'` and `RUN_DB_TESTS=1 NODE_ENV=test npx jest --testMatch='**/tests/integration/**/*.repro.test.ts'` | 1 / 134 (native shutdown abort, as before) | Every probe fails at the SAME assertion with the SAME received value as before the refactor: AC-LSR-1 `toMatchObject({duration:45})` ← `{type:functional_reps, reps:45}`; AC-LSR-2 `not.toMatch(/completed/i)` and `not.toMatch(/RPE/)` ← "Exercise 'Seated Calf Raise Machine' completed. … analyze RPE trend …"; AC-LSR-3 `toEqual(CORRECTED_SETS)` ← `[10×100, 10×100, 12×110, 12×110]`; AC-LSR-4 selection `'lower_a'` vs `'hist_20260916_lower'`, block lacks `Barbell Bench Press`, block lacks its own date; AC-LSR-5 `toEqual(produced)` ← reader returns the run reversed; AC-LSR-6 `toContain('накинул 10кг…')` ← `[]` (preconditions: run rejected, `core_error`). Controls still green (AC-LSR-1 cardio duration, AC-LSR-3 two-batch, AC-LSR-4 relative age, AC-LSR-6 completed run). 6 failed / 3 passed in the DB command, 3 failed / 1 passed in the unit command (was 3 / 3: the two AC-LSR-2 controls were removed). Also green: `npm run test:unit` (121 suites, 1151 tests), `npm run test:scenarios` (7 suites, 338 passed, 1 todo; exit 134 = the known shutdown abort), `training.service.integration.test.ts` (8 passed). Production diff vs `dcf989bb` (`apps/server/src` outside `__tests__`, `apps/bot`, `apps/webapp`): empty. | `d5e01229` |
| — | `cd apps/server && npm run test:unit` | 0 | 121 suites / 1151 tests green; `git diff` shows no production change (repro files only). Re-run after Task 2 with the same result. | `dcf989bb` / `57a42c8e` |

## Review

Close-out review 2026-09-22, four zones (R1, R2, R3, R4), each dispatched cold and isolated.
First pass: **blocked** — three blocking findings in R2. All were closed (`05ab64c7`), R2 was re-run
alone, confirmed the fixes genuine and raised one further duplicate, which was closed too
(`5c5ebe30`). **Final verdict: clean.** R1, R3 and R4 returned no blocking findings; R4's single
finding was closed during the first pass.

### Blocking

- **R2 | `apps/server/src/infra/ai/tools/__tests__/log-set.tool.repro.test.ts:18-46` | DRY
  (`docs/CONTRIBUTING_AI.md` "Principles & Boundaries")** — "`makeTool()` (with its own
  `InvokableTool` type) reinvents the exact plumbing already sitting in the sibling file
  `log-set.tool.unit.test.ts:16-51` (`InvokableTool` type, `makeTrainingService`, `makeConfig`,
  `makeDeps`) — both build `buildLogSetTool({ trainingService })`, wrap it as an invokable tool, and
  construct the same `RunnableConfig` shape."
- **R2 | `apps/server/tests/integration/scenarios/failed-run-transcript.repro.test.ts:27-40` | DRY** —
  "This file hand-rolls a second `jest.mock('@infra/ai/model.factory', …)` that duplicates the shape
  `scripted-model.ts:115-147` already provides and documents as 'a shared jest mock of
  `@infra/ai/model.factory` used by every deterministic scenario test'. The only capability missing
  from the shared helper is failure injection (throw-once); that gap belongs in `scripted-model.ts`
  … so every scenario test keeps one source of truth for what the model mock can do, not two
  independently mocking the same module path."
- **R2 | `apps/server/src/infra/ai/tools/__tests__/format-exercise-summary.repro.test.ts:25-59,77-103`
  | DRY** — "The two 'control' tests here … duplicate assertions
  `training-service-hardening.unit.test.ts:220-248` and `:157-217` already make … and the
  `makeExercise`/`switchAwayFrom` helpers reinvent that file's `makeExerciseWithDetails`/`createMocks`
  … The genuinely new assertions in this file (the `formatExerciseSummary` text checks) don't need the
  domain-level control tests re-proven here."

  *Coordinator's dissent, recorded for the owner and not acted on:* the third finding is the weakest
  of the three. The plan requires each probe to carry controls that isolate the defect (AC-LSR-8 and
  the Global Constraints), and R3 verified these controls do exactly that — they separate "the domain
  classifies 0 sets as skipped" from "the text still says completed". The overlap with the domain
  suite is real; whether it is duplication or deliberate isolation is the owner's call. The first two
  findings I consider correct as stated, and the second one improves the shared harness rather than
  the probe.

### Closed during review

- **R4 | `docs/superpowers/plans/session-2026-09-21-repro.md:5` |
  `docs/SUPERPOWERS_INTEGRATION.md:123-124`** — the header still read `- Status: planned` on this
  branch after five task commits. Correct as stated: the orchestrator had set `in progress` on `dev`
  (`5cf11f7f`) but not on the branch. Fixed here; a merge preview showed the line produced no
  conflict either way.

### Advisory (owner decides whether they enter `docs/BACKLOG.md`)

- **R1** — `format-exercise-summary.repro.test.ts:78-86` constructs `TrainingService` with 7
  constructor args, 4 of them stubs: "surfaces (does not introduce) a wide constructor on production
  `TrainingService` — pre-existing". The backlog already carries a `ITrainingService` decomposition entry.
- **R2** — `tool-ordering.repro.test.ts:57-64` and `previous-session.repro.test.ts:134-141` hand-build
  `TrainingService` with the same six-repository wiring as two existing integration tests: "this plan
  adds its 4th and 5th copy. Worth a backlog entry: a shared `buildRealTrainingService()`
  integration-test factory."
- **R3** — the AC-LSR-7 evidence cites a schema-parse probe run from an ephemeral scratch path;
  "consider committing the schema-parse probe … so AC-LSR-7's fuller verification is re-runnable by a
  reviewer without reconstructing it."
- **R4** — `apps/server/TESTING.md:42` calls itself the single source of truth for test naming and
  does not yet know the `*.repro.test.ts` suffix this plan introduces.

### What R3 confirmed (the point of the plan)

All six probes fail for the reason the plan and the bug state, on unchanged production; no inverted
assertions, no `skip`/`test.failing`, no rigged fixtures; every control passes and isolates its
defect; the AC-LSR-5 heap-order rewrite is sound and its two soundness preconditions are asserted in
the test rather than claimed in prose; `test:unit` 121 suites / 1151 tests green; the production diff
is empty.


### Second pass (2026-09-22, R2 alone)

The owner's ruling closed all three findings without exception: "я не терплю дубли, дубли это то что
потом аукнется как дистрактор и как поддержка непонятно чего и ради чего". The coordinator's dissent
on the third finding is therefore withdrawn — and R2's re-review judged the fix "a genuine
improvement, not just compliance".

What moved (`05ab64c7`): the `log_set` plumbing into `log-set-test-support.ts` (shared with the unit
test); `failNextChat(error)` into `scripted-model.ts`, so the probe uses the one shared model mock;
the domain fixture factories into `training-service-test-support.ts`, with the two duplicated control
tests replaced by an in-probe guard; and `buildRealTrainingService()` in `tests/helpers/`, collapsing
five hand-built wirings into one.

R2's re-review found one duplicate the first pass had missed — `training-service-log-set-with-context.unit.test.ts`
still hand-rolled `makeSessionSet` and the `mockSessionRepo` literal that the new support module was
created to own. Closed in `5c5ebe30`: the file dropped from ~140 to ~40 lines, `makeExerciseWithDetails`
now composes `makeSessionExercise`, and the assertions are byte-identical to before the migration
(verified by diffing every `it(`/`expect(` line against `dcf989bb`).

**Proof re-verified by the coordinator after each de-duplication commit**, since refactoring the
scaffolding is exactly how a reproduction can be lost without anyone noticing: unit probes 3 failed /
1 passed, DB probes 6 failed / 3 passed — same test names, same assertions, same received values;
`test:unit` 1151 green; `test:scenarios` 338 green; production diff outside `__tests__` empty.

A third R2 pass was not dispatched: the remaining check is mechanical (one `makeSessionSet`, one
session-repo mock literal under `services/__tests__/`) and was verified directly by grep.