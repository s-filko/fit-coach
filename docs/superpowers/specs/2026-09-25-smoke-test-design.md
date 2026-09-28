# Smoke Test — One Live Workout over the Test Database

> **Status: agreed with the owner 2026-09-25** (brainstorm in the orchestrator session). Working
> design document; the durable law it touches is `PROMPT_EVAL_FRAMEWORK.md` (L3) and
> `evals/datasets/README.md` § L3.

## 1. Goal (owner's words, 2026-09-25)

"Один универсальный тест, который мы будем расширять, типа смоук … модифицироваться каждый раз,
когда найдена бага, чтобы он эту багу повторил, а потом после фикса мы проверяем. Тест должен
включать сид БД с историей готовой и реалтайм чат … от начала до конца … проходим одну тренировку."

The orchestrator runs it **instead of the owner's manual check in the Telegram bot**: live model,
test database, no dev, no Telegram.

## 2. Decisions

| # | Decision | Source |
|---|---|---|
| D1 | User messages are a **fixed script**; only the coach's replies are live. A bug replays the same way every run. | owner |
| D2 | History is a **hand-written fixture**, modelled on the owner's real dev history (upper/lower split, real exercise names, real weights), never a copy of dev data. | owner |
| D3 | **The smoke is mutable.** Its fixture and script are edited freely whenever a new bug needs them. Protection of old bugs is **not** the smoke's job: that stays with the regular suites (`*.repro.test.ts`, unit, `test:integration`, `test:scenarios`), which are maintained and updated as usual and keep catching regressions as before. No trap/rollback machinery. | owner |
| D4 | Bug workflow: a found bug is (1) added to the smoke so a run shows it, (2) pinned by a permanent red test as today, (3) fixed, (4) confirmed by the next smoke run. | owner |
| D5 | Per-step checks reuse the existing L3 assertion kinds: tool calls, persisted rows, phase after the step, substrings in the delivered text. **No LLM judge is built.** The run prints the whole conversation; the orchestrator reads the coach's replies and reports its verdict. | orchestrator default, owner: "не париться" |
| D6 | Built on the existing L3 runner (`evals/levels/l3.ts`, `evals/lib/run-scenario.ts`, `scenario-world.ts`) — no second runner. | orchestrator |
| D7 | Model = whatever the local `apps/server/.env` routes to (today GLM via Z.AI); the dev model is a matter of env vars on the command line, not code. Cost: ≈ one agent call per user step plus tool hops; the call ceiling (`EVALS_CALL_CEILING`) applies. | orchestrator |

## 3. What exists and what is missing

Exists: the L3 runner over `fitcoach_test` (`DB_NAME=fitcoach_test RUN_LLM_EVALS=1 npm run evals --
--level L3 --scenario <id>`), scenario modules with `past` (user, plan, dated completed workouts,
facts) and `steps` (user text + `expect`), the full-workout journey `b-full-workout`.

Missing:
1. **Seed realism.** Seeded exercises are generic (no muscle groups — `scenario-world.ts`
   `resolveExerciseIds`), every seeded workout is `completed`, sets are strength-only. The coach
   plans by muscles and history, so the fixture must carry them.
2. **The smoke scenario itself** — history + one workout greeting → finish + a history question.
3. **One command and a readable report** — per step pass/fail and the full transcript.

## 4. First content

- History: ~3 weeks, upper/lower split, 6–8 real workouts with muscle-mapped exercises, one cardio
  and one plank (duration) entry, and **one completed-but-empty session** (BUG-031 — U1's live
  check, which this smoke replaces).
- Script: greeting → planning → start → 2–3 exercises logged → finish → "что я делал на этой
  неделе?". Checks: planning/training/chat phases, `log_set` and `finish_training` called, sets
  persisted, the empty session absent from the final reply.

## 5. Out of scope

LLM judge; agent-simulated user; a deterministic (scripted-model) twin of the smoke — the smoke
is live-only; CI.
