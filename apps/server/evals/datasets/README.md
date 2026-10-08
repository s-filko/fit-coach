# Eval datasets

One JSONL file per dataset, one case per line, validated by `evals/schema/case.schema.ts`
(schema: `docs/PROMPT_EVAL_FRAMEWORK.md` §3).

## Case count

P0 ships **at least 10 cases per phase** (`LLM_CORE_REFACTOR_PLAN.md` § P0 item 5) — enough
to record a `v0` baseline. `PROMPT_EVAL_FRAMEWORK.md` BR-EVAL-004's target of 30 per phase
(≥10 should-act, ≥10 should-not-act, ≥10 adversarial) is reached incrementally as later
refactor phases add cases. The gap is deliberate, not an unmet acceptance criterion.

## Rules

- BR-EVAL-001: a case is immutable once a baseline references it. Fix by adding a new case
  and setting `"deprecated": true` on the old one.
- BR-EVAL-002: every BUGS.md entry of class "LLM did the wrong thing" gets at least one case
  tagged with its id before it is marked Fixed.
- BR-EVAL-003: fixtures contain no real user data.

## Datasets

| File | Cases | Source |
|---|---|---|
| `chat/transitions.jsonl` | CH-0001..CH-0011 | BUG-011; CH-0011 curated from an exported run |
| `chat/no-set-logging.jsonl` | CH-0007..CH-0010 | BUG-009 |
| `training/set-logging.jsonl` | TR-0001..TR-0006 | BUG-008, ADR-0011 |
| `training/no-false-confirmation.jsonl` | TR-0007..TR-0010 | BUG-006, BUG-009 |
| `registration/field-extraction.jsonl` | RG-0001..RG-0006 | MANUAL_TEST_PLAN-1.2 |
| `registration/no-premature-complete.jsonl` | RG-0007..RG-0010 | BUG-009 class |
| `plan_creation/basics.jsonl` | PC-0001..PC-0010 | PC-1, search discipline (renamed from id-reuse.jsonl in P4 Task 1 — the stem moved to the seeded id-reuse dataset) |
| `session_planning/one-question-first.jsonl` | SP-0001..SP-0010 | SP-1 |
| `memory/facts.jsonl` | MF-0001..MF-0004 | AC-1361 (P6 Task 6, authored not run) |

## Frozen by baseline v0

Every case listed above is referenced by `evals/baselines/v0/*.json`. Per BR-EVAL-001 a
referenced case is **immutable**: to change what a case asserts, add a new case with a new
id and set `"deprecated": true` on the old one. Editing a frozen case silently invalidates
every comparison made against v0.

Re-run a comparison with:

    RUN_LLM_EVALS=1 npm run evals -- --level L1 --phase <phase> --samples 3 --baseline compare --baseline-version v0

## v2 mini-freeze (2026-09-18, refactor-p4-episode-memory Task 2)

- Commit: `56696947` (Task 1, pre-P4 code), throwaway worktree, direct Z.AI coding route, glm-5.3.
- Scope: `plan_creation/id-reuse` only, n=1 (5 cases, 13 requests incl. tool rounds; 14889 in / 2853 out tokens; weekly quota 30182 → 28347 = −1835 credits, which also includes the orchestrating Claude Code session's own consumption).
- Baseline: `evals/baselines/v2/plan_creation.json` (tagged `dataset: id-reuse`).
- `no_redundant_search`: **5/5 passed** pre-P4 — the plan's "expected low" was wrong; the gate "≥ +15 pp" is therefore vacuous against this baseline and the meaningful post-P4 question is "no regression below 5/5" (owner to re-scope AC-1344).

## L3 — live training-journey scenarios (owner-launched only)

`--level L3` runs the SAME journey modules the deterministic layer runs
(`evals/scenarios/*.scenario.ts`) through the same DB-backed runner, but with
the **real model** — no scripted `@infra/ai/model.factory` mock. It ignores
`script`, skips `seen` (only a scripted model can observe its own input), and
evaluates per step and per assertion: `delivered` (including `liveOnly`
entries — the reply wording only a real model produces, e.g. journey C's
catch-up reply), `tools` (from the `conversation_runs` row), `phaseAfter`,
and `persisted` (the DB session snapshot — the plane that proves the model
itself chose the right action). Assertions tagged `knownBug` are reported as
`KNOWN … [known bug BUG-018/AC-CC-N]` and never counted as regressions.

The clock: a Date-only fake clock (`toFake: ['Date']`, timers stay real)
makes `advance` steps (e.g. journey C's +3.5 h pause) jump exactly like the
deterministic layer's `jest.setSystemTime`.

Manual launch (the owner's red button; never run by a plan task or CI):

    DB_NAME=fitcoach_test RUN_LLM_EVALS=1 npm run evals -- --level L3
    DB_NAME=fitcoach_test RUN_LLM_EVALS=1 npm run evals -- --level L3 --scenario c-catch-up-logging

- `DB_NAME=fitcoach_test` on the command line is required: the evals script
  reads `.env`, whose `DB_NAME` points at `fitcoach_dev`, and the runner
  refuses anything not ending in `_test`. A CLI variable wins over `--env-file`.
- Gates (§7a): refuses without `RUN_LLM_EVALS=1` (prints "skipped"), and
  enforces the shared call ceiling — `planCallCount(user steps × samples)`
  against `EVALS_CALL_CEILING` (default 30), overridable only by the
  `EVALS_FULL_RUN=1` red button. All four journeys are 26 user steps, so
  `--samples 1` (the L3 default) fits the default ceiling; `--samples 2`
  does not.
- Budget it like an L1 run (§7a): argue the question, the call count, and
  why nothing cheaper answers it before launching; log the spend in
  `evals/COST_LEDGER.md` afterwards (L3 does not meter per-request itself).
- Requires the local Postgres container (`docker compose up -d db` from the
  repo root) — each journey seeds a random throwaway user, nothing is reset.

### The fact-lifecycle journeys and the course-check comparison (AC-FL-7)

Six more journeys (`fl-a` … `fl-f`, course-check plan Task 3) cover long-term
review dates, "it's fine now", short states, recurrence, advisory plans and
"what do you remember". They are NOT in the default run — they add 14 user
steps and a plain L3 run would cross the call ceiling — so select them by
group or id:

    DB_NAME=fitcoach_test RUN_LLM_EVALS=1 npm run evals -- --level L3 --scenario fact-lifecycle
    DB_NAME=fitcoach_test RUN_LLM_EVALS=1 npm run evals -- --level L3 --scenario fl-e-advisory-plan

To compare the course check, run the group twice on the same journeys and set
the two reports side by side — the layer is switched by the run's environment
(the runner wires the graph from it):

    COURSE_CHECK_ENABLED=true  DB_NAME=fitcoach_test RUN_LLM_EVALS=1 npm run evals -- --level L3 --scenario fact-lifecycle
    COURSE_CHECK_ENABLED=false DB_NAME=fitcoach_test RUN_LLM_EVALS=1 npm run evals -- --level L3 --scenario fact-lifecycle

What is compared is the DATABASE plane (`persisted.facts` / `persisted.plans`:
status, archive reason, closure stamp, dates, confirmations, links) plus tools
and phase — never the coach's prose. Live, the model chooses its own dates and
durabilities, so a date expectation can fail on a legitimate model choice;
read the detail before calling it a regression. The deterministic layer
(`tests/integration/scenarios/fact-lifecycle.integration.test.ts`) already runs
every journey with the check on AND off against a scripted model.

### The coach-quality journeys, the judge and the prompt version (coach-quality-proof)

Two more groups, selected like the fact-lifecycle one and NOT in the default run (the call ceiling):

- `n-load` — seven weight-recommendation journeys (`n-load-up`, `-miss`, `-early-stop`, `-break`, `-uneven`, `-ask`,
  `-gravitron`). The expected next load is computed by the weight oracle (`evals/lib/weight-oracle.ts`) from the seeded
  history, never hand-typed; `nLoadExpectations()` is what the judge's extracted load is compared against. After a miss
  both one step down and the same load with a stated lower rep target and its reason are accepted.
- `new-journeys` — `g`…`m`, the 2026-10 findings (greeting after an open session, reopening a forgotten set, weight
  shorthand, bodyweight, unknown weight, correction, no false log).

Multi-sample runs of a group cross the call ceiling, so they need the red button:

    EVALS_FULL_RUN=1 DB_NAME=fitcoach_test RUN_LLM_EVALS=1 npm run evals -- --level L3 --scenario n-load --samples 3

Every L3 run also writes, next to each transcript, a **requests sidecar** `<transcript>.md.requests.json`
(`evals/lib/write-requests-sidecar.ts`): per run id, the coach call's resolved SYSTEM message (profile and rules —
`llm_calls` keeps it as a hash only), its USER message with the `<context>` block (today, history, NOW) and every tool
call with arguments. The coach call is the last call whose request carries a `<context>` block, not simply the last
stored call. The sidecar is the durable copy: `llm_calls` rows die at the next DB reset of the test database.
`npm run backfill:sidecars -- <reports-dir>… [--force]` regenerates sidecars for existing transcripts where the rows
still exist (it merges into an existing sidecar, never dropping entries) and prints how many runs it resolved.

The **judge** scores each coach reply on `evals/rubrics/coach-quality.md`:

    npm run judge:coach-quality -- --transcript evals/reports/<scenario>-<ISO>.md [--transcript …] [--out-dir <dir>]
    npm run judge:coach-quality -- --dry-run          # two canned replies through a stub CLI — no DB, no model

- `JUDGE_CMD` — the judge CLI (default `claude-glm -p --model glm-5.3`); the prompt goes on stdin, one JSON verdict on
  stdout. `JUDGE_FALLBACK_CMD` — judges once a reply the primary refused or mangled; without it that reply is recorded
  unjudged (and an unjudged n-load ask is counted in the hit-rate line: `x/y judged, z unjudged`).
- Output (default `evals/reports/judge/`): `coach-quality-<stamp>.verdicts.jsonl` (appended per reply), `.json` and the
  summary `.md`.
- The judge is shown what the coach knew (the system message), the `<context>` request, the tool calls and the
  delivered reply, and is told that the clock is the request's fake clock, not the real date.

The training prompt version under test is chosen by the run's environment: `PROMPT_VERSION_TRAINING=v14` or `=v15`
selects a candidate coach prompt; unset keeps v13, the default and the baseline. One run is always one version.

## Smoke — one live workout over the test DB

`npm run smoke` is the one-command L3 run of the `smoke` scenario (spec:
`docs/superpowers/specs/2026-09-25-smoke-test-design.md`): it seeds a
hand-written realistic history into `fitcoach_test`, plays a fixed user
script (greeting → planning → one workout — including a range-RPE set "рпе
9-10" (F2) and a mid-training "when last did I bench" over the seeded history
(F5/BUG-030), by a Russian-writing persona on an `en` account (F3) — → finish
→ a history question) against the real model, checks every step, and prints
the whole conversation.
It exists to replace the owner's manual check in the Telegram bot — same
gates as L3 (`RUN_LLM_EVALS=1`, `_test` DB only, shared call ceiling).

    npm run smoke

- Model: whichever provider `apps/server/.env` routes to (not `.env.test` —
  `npm run smoke` loads `.env` itself, matching the L3 command above) — this
  is a matter of env vars, not code. On the Z.AI route the model needs
  `LLM_STRUCTURED_OUTPUT_MODE=json_object` in `.env` (Z.AI has no
  `json_schema` support; the course-check call fails with a `ZodError`
  without it — the first live run hit exactly this).
- DB: it seeds the shared local `fitcoach_test` — the Postgres container
  from the repo root must be up (`docker compose up -d db`) first, same as
  any L3 run. If another worktree may be running `RUN_DB_TESTS=1` tests
  concurrently (all worktrees share this one database, reset per jest run),
  run the smoke through the same lock those use:
  `/Users/filko/orca/workspaces/fit_coach/db-test-lock.sh npm run smoke`.
- Cost: ≈ user steps × 1–3 model calls (one agent call per user turn plus
  tool hops), inside the standard `EVALS_CALL_CEILING` gate; record the run
  in `evals/COST_LEDGER.md` afterwards like any L3 run.
- Flag: the script sets `TRANSITION_HANDOFF_TARGETS=training,session_planning`
  in its own env (process env wins over `--env-file`), so the smoke always
  exercises the U5 same-run hand-off (AC-TH-7).
- Output: the per-step transcript (user text, delivered coach reply, tools
  called, phase after, each check ✓/✗) goes to stdout AND to
  `evals/reports/<scenarioId>-<ISO>.md` (gitignored) — `smoke-<ISO>.md` for
  this scenario; every L3 run writes one, named after whichever scenario ran,
  not only the smoke.
- How to add a bug (D3/D4): edit `evals/scenarios/smoke.scenario.ts` (the
  history fixture and/or the user steps) so a run shows the bug, pin it with
  a permanent red test as usual (`*.repro.test.ts` / the regular suites — the
  smoke itself protects nothing), fix, then re-run the smoke to confirm.
