# Smoke Test Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans + superpowers:test-driven-development.
> Execute only your task. **No live model call** in any worker task — the one live run is the
> orchestrator's (Task 4).

- Status: in progress
- Branch: plan/smoke-test

**Goal:** one command, `npm run smoke`, that seeds a realistic hand-written history into
`fitcoach_test`, plays a fixed user script of one workout start → finish against the live model,
checks every step and prints the whole conversation — the orchestrator's replacement for the
owner's manual bot check.

**Spec:** `docs/superpowers/specs/2026-09-25-smoke-test-design.md` (decisions D1–D7).

**Architecture:** extend the existing L3 path, never fork it — `evals/schema/scenario.schema.ts`
(`past`), `evals/lib/scenario-world.ts` (seeding), `evals/levels/l3.ts` (live run + checks),
`evals/lib/reporter.ts` (output). The smoke is one scenario module, `evals/scenarios/smoke.scenario.ts`.

## Global Constraints

- Commands from `apps/server`. Every `RUN_DB_TESTS=1` run goes through
  `/Users/filko/orca/workspaces/fit_coach/db-test-lock.sh <cmd>` (tasks run in parallel worktrees).
- No `RUN_LLM_EVALS=1` run by workers. Existing scenarios and their tests must stay green:
  `npm run test:scenarios` exit 0.
- `npm run check-all` clean at the end of each task. Docs English-only.

## Acceptance

| ID | Evidence |
|---|---|
| AC-SM-1 | A scenario `past` can declare a catalog of exercises with muscle groups (primary/secondary), workouts with a status (`completed` default, `skipped` allowed; `exercises: []` = completed-but-empty), and duration/distance sets; seeding writes them — proven by a DB integration test |
| AC-SM-2 | `npm run smoke` runs only the `smoke` scenario through L3 on `fitcoach_test`, refuses any other DB, and prints per step: the user text, the coach's delivered reply, tools called, phase after, each check pass/fail; the same content is written to `evals/reports/smoke-<ISO>.md` (gitignored) |
| AC-SM-3 | `evals/scenarios/smoke.scenario.ts` parses (`ScenarioSchema`), is registered in `loadScenarios`, and its seeded world contains the history of spec § 4 incl. the empty session — proven by a seed-only DB test (no model) |
| AC-SM-4 | One live run by the orchestrator; transcript read; verdict recorded in `## Review` (U1's live check) |

---

### Task 1: Seed realism (AC-SM-1) — Sonnet

**Files:** `evals/schema/scenario.schema.ts` (`ScenarioPastSchema`, `WorkoutSchema`,
`WorkoutSetSchema`), `evals/lib/scenario-world.ts` (`resolveExerciseIds`, workout/set insert),
new test `tests/integration/scenarios/scenario-world-seed.integration.test.ts`.

- Add optional `past.catalog: Array<{ name; exerciseType; category?; muscles: Array<{ group:
  MuscleGroup; involvement: 'primary' | 'secondary' }> }>`. Catalog entries are inserted with their
  muscle rows (`exercise_muscle_groups`); names not in the catalog keep today's generic fallback;
  the four setup exercises keep their ids. Reuse the domain `MuscleGroup` / exercise-type unions
  from `src/domain/training/types.ts` (import, never redeclare).
- `WorkoutSchema.status?: 'completed' | 'skipped'` (default `completed`; `skipped` → no
  `completedAt`). `exercises: []` with `completed` is the completed-but-empty case.
- `WorkoutSetSchema` becomes a union: today's strength shape (unchanged, stays the default) plus
  `{ durationSeconds }` and `{ distanceMeters, durationSeconds? }`, mapped onto the existing
  `setData` variants of `src/domain/training/types.ts` (find the exact shapes there).
- Red first: the integration test seeds a `past` with one catalog exercise (2 muscles), one
  skipped workout, one empty completed workout, one plank duration set, one run distance set, and
  asserts the rows. Then implement. Existing scenario modules must parse and seed unchanged.
- Verify: `db-test-lock.sh env RUN_DB_TESTS=1 NODE_ENV=test npx jest --testMatch='**/scenario-world-seed.integration.test.ts'`
  → green; `db-test-lock.sh npm run test:scenarios` exit 0; `npm run test:unit` exit 0.

### Task 2: `npm run smoke` + readable report (AC-SM-2) — GLM

**Files:** `package.json` (script), `evals/run.ts` and/or `evals/levels/l3.ts` (a transcript
section in the L3 output), `evals/lib/reporter.ts`, `evals/reports/` (already gitignored —
`evals/reports/.gitignore`), `evals/datasets/README.md` (new § Smoke), unit tests next to the
reporter.

- Script: `"smoke": "DB_NAME=fitcoach_test RUN_LLM_EVALS=1 tsx --env-file-if-exists=.env evals/run.ts --level L3 --scenario smoke"`.
  The DB guard already refuses non-test DBs (`scenario-db-guard.ts`) — keep it on this path.
- L3 output gains, per user step: `#N user: …`, `coach: …` (delivered), `tools: …`,
  `phase: …`, then the step's check lines ✓/✗ with the existing failure detail; a summary line
  `passed X / failed Y / known-bug Z`. Written to stdout and to `evals/reports/smoke-<ISO>.md`
  (for every L3 run, not only smoke — one formatter). Pure formatting function with unit tests on
  a fabricated `ScenarioRunResult` + `CheckResult[]`; no model call, no DB.
- README § Smoke: what it is (spec link), the command, the call cost (≈ user steps × 1–3 calls),
  "how to add a bug": edit `smoke.scenario.ts` (fixture and/or steps) so a run shows the bug, add
  the permanent red test as usual, fix, re-run the smoke.
- `scenario: 'smoke'` does not exist until Task 3 — `loadScenarios('smoke')` failing with a clear
  "unknown scenario" is acceptable in this task.
- Verify: `npm run test:unit` exit 0 (incl. the new formatter tests); `npm run check-all` clean.

### Task 3: The smoke scenario (AC-SM-3) — Sonnet, after Task 1 is merged

**Files:** new `evals/scenarios/smoke.scenario.ts`, `evals/levels/l3.ts` (`loadScenarios`
registration), new `tests/integration/scenarios/smoke-seed.integration.test.ts`.

- History per spec § 4, modelled on the owner's dev pattern (upper/lower split; e.g. bench,
  overhead press, lat pulldown, seated row, leg press, leg extension, leg curl, plank, treadmill;
  weights in the 50–110 kg range), ~3 weeks back from T0, 6–8 completed workouts + one
  **completed-but-empty** session between the last real workout and T0 (BUG-031), declared through
  Task 1's `catalog` with real muscle mappings. An active upper/lower plan.
- Steps (fixed Russian user lines): "привет, хочу потренироваться" → a planning answer → "давай
  верх, погнали" → 3–5 set reports over 2–3 exercises ("жим 80 на 8" style) → "всё, закончил" →
  "что я делал на этой неделе?". `expect` per step: `phaseAfter`, `tools.must` (`log_set`,
  `finish_training`), `persisted` set counts, and on the last step `delivered.mustNotMatch` for the
  empty session's marker (its weekday/date as the history block renders it). No `script` entries
  (live only).
- Seed-only test: seed the smoke `past` into `fitcoach_test` (no model), assert the empty
  session exists with 0 sets and the catalog muscles are there; `ScenarioSchema.parse` passes.
- Verify: `db-test-lock.sh env RUN_DB_TESTS=1 NODE_ENV=test npx jest --testMatch='**/smoke-seed.integration.test.ts'`
  → green; `db-test-lock.sh npm run test:scenarios` exit 0.

### Task 4: First live run (orchestrator — not delegated) (AC-SM-4)

- [ ] Merge Tasks 1–3 on `plan/smoke-test`; all suites exit 0.
- [ ] `npm run smoke` once; record calls in `evals/COST_LEDGER.md`; read the transcript; verdict
  per step in `## Review`. The last step's reply is U1's live check → roadmap § 6 U1 `done`.
- [ ] Close-out review (one combined agent), `Status: done`, merge, push. No deploy needed
  (evals tooling only) unless the diff touches `src/`.

## Review

2026-09-25 — one combined reviewer covering R1–R4 (owner economy rule). Verdict **blocked** (1 blocking).
Orchestrator acceptance before review: check-all, unit 1213, integration 570, scenarios 355 — exit 0.
Live runs (Task 4): run 1 — scenario defects + exit 134 + course-check ZodError (local `.env` lacked
`LLM_STRUCTURED_OUTPUT_MODE=json_object`, added 2026-09-25); run 2 — 34/0, still exit 134; run 3
after `70d901e3` — 34/0, exit 0, no `libc++abi`. U1's live check judged from run 2/3 transcripts
(see plan `coach-baseline` § Review). Run 1 reproduced BUG-022 live (`BUGS.md`).

Deviations: Task 1's "import the domain unions" became the DB enums' `enumValues` (`db6c0a94`) — zod
needs runtime values; the domain unions are types only. The BUG-031 `delivered.mustNotMatch` was
removed (L3 does not evaluate `seen`; an English block label never occurs in a Russian reply) —
BUG-031 is judged from the transcript (D5).

Blocking:
1. R3 `evals/lib/__tests__/reporter.unit.test.ts:43`, `tests/integration/scenarios/scenario-world-seed.integration.test.ts:85`
   — SUPERPOWERS_INTEGRATION rule 4: the suites proving AC-SM-2 / AC-SM-1 carry no AC id in
   `describe`/`it` names. *(closure pending)*

Advisory:
2. R3 `evals/run.ts:239` — `dbPoolMayBeOpen` is set only after `runL3` returns `'ran'`; a throw
   mid-run leaves the pool open (exit only after pg's idle timeout, or never with a checked-out
   client); a rejecting `pool.end()` runs cleanup twice ("Called end on pool more than once").
3. R3 `evals/schema/scenario.schema.ts:173` — a set with both `reps` and `durationSeconds` matches
   the duration branch and `reps` is stripped silently; `.strict()` branches would reject it.
4. R1 `scenario.schema.ts:3` — infra dependency via DB enums (recorded above as a deviation).
5. R2 `scenario.schema.ts:139` — category list and `InvolvementSchema` values hand-copied (category
   also in `search-exercises.tool.ts:36`, `types.ts:64`, `exercises.seed.ts:15`); pre-existing copies.
6. R2 `evals/lib/scenario-world.ts:125` — `toSetData` returns `Record<string, unknown>` with literal
   type strings instead of the domain `SetData` / `setDataTypes`; shapes match today, drift would
   not be caught at compile time.
7. R3 `l3.ts`, `reporter.ts` — evaluation semantics unchanged (confirmation, no action).
8. R4 `evals/datasets/README.md:115-138` — § Smoke omits: model from `.env` and the Z.AI
   `json_object` requirement; the shared `fitcoach_test` and `db-test-lock.sh`; the report file
   name is `<scenarioId>-<ISO>.md` for every L3 run.
9. R4 — no durable-layer gap (confirmation, no action).

Meta: CLI teardown paths untested beyond the live success path (rule candidate); zones do not
state the severity of a missing AC id in a test name (prompt defect).
