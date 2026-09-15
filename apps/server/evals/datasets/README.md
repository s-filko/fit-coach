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
| `plan_creation/id-reuse.jsonl` | PC-0001..PC-0010 | PC-1, search discipline |
| `session_planning/one-question-first.jsonl` | SP-0001..SP-0010 | SP-1 |

## Frozen by baseline v0

Every case listed above is referenced by `evals/baselines/v0/*.json`. Per BR-EVAL-001 a
referenced case is **immutable**: to change what a case asserts, add a new case with a new
id and set `"deprecated": true` on the old one. Editing a frozen case silently invalidates
every comparison made against v0.

Re-run a comparison with:

    RUN_LLM_EVALS=1 npm run evals -- --level L1 --phase <phase> --samples 3 --baseline compare --baseline-version v0
