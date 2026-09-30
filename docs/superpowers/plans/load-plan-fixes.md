# Load Plan Fixes — zero-kg ladder, isometric holds, no-record with a reference (U9b follow-up) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans and
> test-driven-development. Red tests first (from the replay data below), then the code.

- Status: planned
- Branch: plan/load-plan-fixes
- After: load-plan

**Goal:** fix the three defects the live GLM replay of two real owner workouts exposed in U9b, before the owner's
next workout on dev (all three `LOAD_PLAN_*` flags are on there). Owner order 2026-10-01: «да в новой сессии» —
items 1–3 below, one branch, one combined review, dev deploy, then re-run the same replay on GLM as the check.

**Source:** live replay 2026-10-01 (orchestrator of `load-plan`, Sonnet worker, local `glm-5.3-flash` via the Z.AI
subscription, all three flags on). Report and raw artefacts (gitignored, local only):
`data/replay-2026-10-01/replay-report.md` (findings C1–C3, U1–U8, M1–M4), transcripts / per-call request+response /
`load_recommendations` rows in the same folder, the throwaway scenario builder and runner in `src/`
(`build.ts`, `run.ts`, `check.ts`), the dev export in `owner-history.json`. Smoke on GLM with the flags: 46/46.

## Scope (owner-approved 2026-10-01)

1. **Zero / wrong load on the return ladder (report C1).** `Lateral Raise Machine`: working weight printed 5 kg while
   every recent session used 2.5 kg; `gap_rebuild` "one step lower" with a 5 kg machine step gives
   `recommend: 0 kg`, `conservative: 0 kg`, stored as `candidate.load = 0`. The zero-LLM dev report showed the same
   shape (`conservative: 0 kg × 12`, BACKLOG 2026-10-01). Fix both: the working weight reflects the recent sessions
   (find why 5 kg won — window, basis, per-hand, or a restart ladder reading pre-gap history); no step down ever goes
   below one step / a positive load (floor, or print "no lighter option").
2. **Isometric holds cannot be logged (report C2).** `log_set` maps `durationSeconds` to `cardio_duration` for every
   exercise (described as "for cardio") and reps-only to `functional_reps`; Plank / Side Plank were stored as
   `functional_reps` with reps = seconds or as `cardio_duration` — never `isometric`. The owner does planks almost
   every workout. Add an isometric hold (seconds) path keyed by the exercise type; tool description updated. The
   owner's dev history already has 4 isometric sets stored with `reps` — a data correction is a separate,
   backed-up, owner-visible step (list it; do not run it silently).
3. **"No record" hides an existing last performance (report U2, U6).** Four of nine replayed exercises (row, Smith
   bench, reverse fly, calf) printed `recommend / conservative: no record — conservative start` although the
   `reference:` line carried the last performance (20 / 60 / 25 / 50 kg); the coach then invented numbers and a
   fake "conservative" (twice the same load). Training v11 demands "always show the conservative option", which
   the block cannot satisfy. Fix: with a reference present, Stage A insufficient-data still names a number — the
   reference's load as the candidate, one step down (floored per item 1) as conservative, confidence low, the
   reason saying why (few performances / old reference / break tier). With no reference at all, the block says so
   and v11 (or a new training version) says: when the block has no conservative option, do not invent one.

## Out of scope (route, do not fix here)

- Report C3 / U1 (`advised` written from the model's after-the-fact recollection) — BACKLOG (calibration data only).
- Leg-press confirmation through `e1rmTrend.flatRun` never confirms growth (report U7, (D) T1(c) of `load-plan`) —
  BACKLOG, next load-plan pass (needs per-session rep history in the loader).
- plan_creation says «Записал» with no tool call (report § 4) — **BUGS.md** entry (truthfulness, not U9b).
- Report U3 (RPE claimed, not in `log_set`), U4 («суммарно 30» logged as 10), U5 (prose arithmetic «44 тонны») —
  BACKLOG, unguarded (memory rule: weak model reveals, does not create).

## Acceptance criteria

| AC | Criterion | Verification |
|---|---|---|
| AC-LPF-1 | The lateral-raise shape (recent 2.5 kg sessions, 5 kg step, rebuild ladder) yields a positive working weight from the recent sessions and no 0 kg candidate or conservative; no step-down anywhere goes below the floor | domain unit tests on fixtures from `data/replay-2026-10-01/upper-*.json` |
| AC-LPF-2 | A plank / side plank reported in seconds is stored as an `isometric` set with its duration; cardio unchanged | `log-set.tool` unit tests + a scenario |
| AC-LPF-3 | An exercise with a reference but insufficient data prints a numeric `recommend:` (the reference load) and a lower `conservative:`; with no reference the block says there is no number and the prompt forbids inventing a conservative option | block v2 (or v3) unit tests + scenario |
| AC-LPF-4 | Re-run of the two-workout replay on GLM (local Z.AI only) shows no 0 kg, planks stored as isometric, numbers on the former no-record rows | replay runner in `data/replay-2026-10-01/src/`, report diff |

Verification (from `apps/server/`): `npm run check-all`, `npm run test:unit`, `DB_PORT=5999 npm run test:unit`
(CI parity, no DB), `db-test-lock.sh npm run test:integration`, `db-test-lock.sh npm run test:scenarios`,
`node scripts/state.mjs --check`. Post-deploy on dev: health, zero-LLM `print-load-plan` over the owner's history
(no 0 kg line), no model calls on dev. Model-backed checks only locally on the Z.AI subscription.

## Rules carried over (owner, this session)

- No OpenRouter credits; model runs only locally on `glm-5.3-flash` (local `apps/server/.env`).
- Never raise an approval prompt the owner did not ask for. The owner-gate hook greps the WHOLE Bash command text:
  write any text that mentions branch/worktree deletion commands with Write/Edit, never through Bash.
- Prompt versions: a wording change is a new version file (BR-LLM-008); the next free training version is v12.

## Execution decisions

## Review
