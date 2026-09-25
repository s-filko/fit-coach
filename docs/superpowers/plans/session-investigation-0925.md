# Live Session 2026-09-25 — Investigation and Red Tests Before Remediation Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans and superpowers:test-driven-development. The owner requires
> investigation → reproduction → red tests → **owner approval** → fix. This plan covers only the red tests. Execute
> only the dispatched task; no production code changes.

- Status: in progress
- Branch: plan/session-investigation-0925

**Goal (owner, 2026-09-25, verbatim):** «найти, воспроизвести, понять, почему она в текущих тестах не отловилась …
Надо, чтобы все тесты, которые должны были ее поймать, они в итоге поймали. Мы правим тесты. И потом, после моего
одобрения, мы только начинаем фиксить.» Second item: when the user reports the first set of the next exercise, the
reply must answer that set first; the recap of the previous exercise goes at the end, short.

**Source session:** dev, user `60af022f`, 2026-09-25 07:58–09:33 UTC, 69 runs (`d2aafb82` … `7e130549`), session
`e9e76f10-9b3b-4c2b-811d-5f0b5fdf3722` (`upper_a_20260925`), model `glm-5.3-flash`. Evidence was read from
`conversation_turns`, `conversation_runs`, `llm_calls` + `prompt_blobs`, `session_sets` on 2026-09-25.

## Findings (investigation, step 1)

| ID | Finding | Evidence | Class |
|---|---|---|---|
| F1 | The training tool-error budget (`llmErrorBudget: 1`, contract: "per run", `tool-policy.ts:43`) counts `llm_error` ToolMessages over the **whole** `state.messages` history (`tool-executor.ts:207`), and fires even when the current batch has **zero** errors. After two errors (07:59 `start_training_session` placeholder UUID in session_planning + 08:13 RPE failure) every later tool run ended with `tool_error_budget_exhausted`, skipping the post-tool model call | 17 runs delivered "Couldn't save the data after several attempts…"; in 15 of them the tool result says `Set N logged` (e.g. `cef69b0d`, `800a54e6`, `e7bc068d`). `llm_calls` shows one call per such run. Cleared only at 09:26, when budget compaction summarised the error turns away | code |
| F2 | `log_set` / `update_last_set` accept fractional RPE (`z.number().min(1).max(10)`), `session_sets.rpe` is `integer` → "рпе 9-10" → `rpe: 9.5` → INSERT fails; raw SQL reaches the model as `LLM_ERROR` | `0c4ddb4b`, `dcccd492`; afterwards the model dropped RPE from every call — no RPE stored for the session | code |
| F3 | The catalog fallback is English for a user who writes Russian: `langOf` uses only Telegram `language_code` (`en` for the owner) | all 17 fallback replies in English | code |
| F4 | Exercise-transition reply order: the auto-complete text (`format-exercise-summary.ts:46`) and training prompt rule 4a/4b (`prompts/phases/training/v3.ts:34`) order "SUMMARIZE the completed exercise … THEN announce the next exercise", although the transition is triggered by the user reporting a set of the **next** exercise. With F1 the recap arrived one turn late, as the answer to «что?»/«??»/«.» | `7853c472`, `92351633`, `cca871bd`, `7a29f509`; owner: «ты отвечаешь мне на старые сообщения?» (`bd290bd8`) | spec (prompt + tool text) |
| F5 | Training sees no exercise history: previous session is resolved by exact `session_key` (BUG-030, open); `upper_a_20260925` matches nothing, while lat pulldown / row / lateral raise / pushdown sets exist on 09-15 and 09-20. Model: «по верху данных в истории не сохранилось», «я не знаю, когда был прошлый раз» | `b973079a`, `bfb4141b`, `86789f66`; budget reports show no `training.previous_session` block until the finish run | code (BUG-030) |
| F6 | No current time in the training prompt (BUG-032, fixed on `plan/transition-handoff`, not on dev); same-day episode summaries are labelled only `training (today)` — their order and time are unknowable | `## Previous episodes` of `7e130549` | code (BUG-032 + label) |
| F7 | Budget compaction has no low-water mark: `planCompaction('budget')` removes the minimum oldest turns until the history fits (`compact.ts` budget loop), so near the 8000 cap almost every run compacts 2–4 exchanges. 9 summariser calls in 30 min; fragments carry stale "Open items: set 3 not saved" into `## Previous episodes` to the end of the session and push useful summaries out. The summariser input has `exerciseId` UUIDs only (`Set 2 logged: 12 reps @ 55 kg.` names no exercise) → the lat pulldown was summarised as "row" | summaries at 09:03:22, 09:04:17, 09:04:58, 09:10:18, 09:21:09, 09:24:54, 09:25:04, 09:27:45; `req_7a29f509` | code + unguarded |
| F8 | Conversational misses: «как ты определил?» misread three times (`30dbec39`…`35e0cec3`); target reps drift 8-10 → 12 → 13 under pressure («А, точно — цель 12 … это я тебе говорил», `86c47a10`); «скорее всего разведочный был лёгким» (`92351633`) | quotes above | model (unguarded: no "answer the latest question / never re-state a target to please" rule) |
| F9 | The 2.33 km treadmill warm-up was never logged (plan row stays `—`) | `d2aafb82`, session plan | known (BUG-022/024, U5) |

## Why the current tests did not catch it (step 3)

- **F1** — `tool-executor.unit.test.ts` "AC-1332: llm_error budget exhaustion" feeds a prior error with no run
  boundary and only checks that the catalog message appears; no test has an earlier run's error followed by a
  successful batch. No scenario has a failing tool call followed by another run.
- **F2** — every scenario and the smoke use integer RPE or none; `log-set.tool.unit.test.ts` mocks the repository, so the
  Zod schema and the column type are never exercised together.
- **F3** — every persona (`b-full-workout`, `smoke`, …) has `languageCode: 'ru'`; the owner's account is `en`.
- **F4** — the expected behaviour itself is wrong: the prompt and tool text prescribe summary-first, and the smoke reads
  the reply against that rule.
- **F5** — `b-full-workout` seeds its history with `sessionKey: 'upper_a'`, the same key the scripted session uses, so
  the exact-key lookup succeeds by construction; the real model mints date-suffixed keys. The existing red
  `previous-session.repro.test.ts` covers BUG-030 but no journey asks "when / how much last time" during training.
- **F6** — covered by `transition-handoff` Task 7 tests (not on dev); nothing checks episode labels.
- **F7** — scenarios are far shorter than the 8000-token history budget; `compact.unit.test.ts` checks one call, never
  a sequence of runs; nothing checks that the summariser can name the exercise of a logged set.
- **F8** — model behaviour; no eval case exists for these turns.

## Acceptance (this plan mints AC-SI-*)

| ID | Finding | Red test must show on unchanged production |
|---|---|---|
| AC-SI-1 | F1 | (a) an `llm_error` from an earlier run (a `HumanMessage` after it) does not count toward this run's budget; (b) a batch with zero errors never ends the run with `tool_error_budget_exhausted`; (c) DB scenario: run N `log_set` fails, run N+1 `log_set` succeeds → the delivered reply is the scripted model text, not the catalog message |
| AC-SI-2 | F2 | `log_set` with `rpe: 9.5` over the real test DB saves the set, returns no `LLM_ERROR`, and the stored RPE is not null |
| AC-SI-3 | F3 | a user with `languageCode: 'en'` who writes Russian gets the catalog fallback in Russian |
| AC-SI-4 | F4 | the auto-complete tool text and the current training prompt instruct: confirm the set the user just reported first; recap of the finished exercise last and brief; no "announce the next exercise" when the user already started it |
| AC-SI-5 | F7 | (a) after one budget compaction, N following runs that each add one ordinary turn do not compact again (low-water mark); (b) the summariser input for a logged set names the exercise; (c) same-day `## Previous episodes` entries carry a local time |
| AC-SI-6 | F4, F5, F8 | eval-case drafts in `evals/datasets/drafts/session-2026-09-25.jsonl` (no model run); smoke scenario gains the steps that would have exposed F1–F5 (RPE "9-10", a Russian writer with `languageCode: 'en'`, a training-phase "когда был прошлый раз и сколько жал?") — edited, **not run** |
| AC-SI-7 | — | every repro fails for the stated reason; default suites (`test:unit`, `test:integration`, `test:scenarios`) stay as they were; production diff empty |

## Global Constraints

- Red tests live in `*.repro.test.ts` (outside the default suites, so pre-commit stays green) and are promoted into
  the named home test at fix time. No `skip`, no `test.failing`, no inverted assertions. A test that unexpectedly
  passes is reported **unconfirmed**, never weakened.
- No production code, migrations, durable specs, `docs/STATE.md`, `docs/BUGS.md`, `Status:` lines.
- No live model (`RUN_LLM_EVALS`/`EVALS_FULL_RUN` never set; `npm run smoke` is not run), no dev data, no ssh.
- Every `RUN_DB_TESTS=1` command goes through `/Users/filko/orca/workspaces/fit_coach/db-test-lock.sh <cmd>`.
- Reserved to the orchestrator: push, merge, ssh, deploy, `npm run db:*`, `docker compose`, branch/worktree deletion.
- Baseline: `29ade08e` (`dev`).

## Tasks

Tasks touch disjoint files and run in parallel, one worktree each (`session-investigation-0925-tN`, branch
`task/session-investigation-0925-tN`), merged into the plan branch by the orchestrator.

### Task 1 — F1, F2, F3: error budget, fractional RPE, fallback language (AC-SI-1, -2, -3)

Files (create only): `apps/server/src/infra/ai/graph/__tests__/tool-error-budget.repro.test.ts` (AC-SI-1a/b, AC-SI-3
at executor level), `apps/server/tests/integration/scenarios/set-error-recovery.repro.test.ts` (AC-SI-1c, AC-SI-2 —
real DB via `runScenario` + `scripted-model.ts`, persona `languageCode: 'en'` writing Russian, training already in
progress). Home tests at promotion: `tool-executor.unit.test.ts` (AC-1332 block), `log-set` integration, the scenario.

- [ ] Write the repros; run each and record command, exit code, failing assertion.
- [ ] Verify: `cd apps/server && npx jest src/infra/ai/graph/__tests__/tool-error-budget.repro.test.ts` and
  `/Users/filko/orca/workspaces/fit_coach/db-test-lock.sh bash -c 'RUN_DB_TESTS=1 NODE_ENV=test npx jest --testMatch="**/set-error-recovery.repro.test.ts"'` → red for the stated reasons; `npm run test:unit` green.

### Task 2 — F4: reply to the current set first, recap last (AC-SI-4)

Files (create only): `apps/server/src/infra/ai/tools/__tests__/exercise-transition-order.repro.test.ts`. Drive the
real auto-complete path (`log_set` for a different exercise, via `log-set-test-support.ts`) and the current training
prompt from the prompt registry. Home tests at promotion: `log-set.tool.unit.test.ts`, the prompt snapshot.

- [ ] Verify: `cd apps/server && npx jest src/infra/ai/tools/__tests__/exercise-transition-order.repro.test.ts` → red; `npm run test:unit` green.

### Task 3 — F7: compaction churn, nameless summariser input, episode time labels (AC-SI-5)

Files (create only): `apps/server/src/infra/ai/graph/nodes/__tests__/compaction-churn.repro.test.ts` (5a over
`planCompaction` with the real estimator, 5c over the episode block renderer) and, if 5b needs the real `log_set`
over the DB, `apps/server/tests/integration/services/summariser-exercise-names.repro.test.ts`. Home tests:
`compact.unit.test.ts`, `compact.node.unit.test.ts`.

- [ ] Verify: the repro files' jest commands (DB one through the lock) → red; `npm run test:unit` green.

### Task 4 — eval drafts and smoke steps (AC-SI-6)

Files: `apps/server/evals/datasets/drafts/session-2026-09-25.jsonl` (new; same shape as `session-2026-09-21.jsonl`:
F4 recap order at `e7bc068d`, F5 "когда был прошлый" at `86789f66`, F8 ×2 at `35e0cec3` and `86c47a10`, each with
the expected behaviour and what it catches), `apps/server/evals/scenarios/smoke.scenario.ts` (+ `evals/datasets/README.md`
§ Smoke if it lists the steps). Smoke is edited, never run.

- [ ] Verify: `npm run test:unit` green (L0 dataset/scenario schema checks) and, through the lock, the smoke-seed test
  `tests/integration/scenarios/smoke-seed.integration.test.ts` green.

## Evidence (filled by workers)

| AC | Command | Exit | Failing assertion | SHA |
|---|---|---|---|---|
