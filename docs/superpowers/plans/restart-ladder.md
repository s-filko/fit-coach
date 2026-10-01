# Restart Ladder — the return ladder closes on fresh workouts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans and
> test-driven-development. To be detailed before execution.

- Status: planned
- After: load-plan-fixes

**Goal:** an exercise that has been trained repeatedly since a long break is no longer held on the return ladder.
Owner order 2026-10-01: a short plan right after `load-plan-fixes`, same verification standard (independent golden
cases, invariants, Opus review, local GLM check), BR-TRAINING-038 amended with the owner.

**Found:** dev zero-LLM report after the `load-plan-fixes` deploy (2026-10-01, `ce70268a`). Lateral Raise Machine:
5 performances in 8 weeks at 2.5 kg, exercise gap 2 d, yet `break: tier restart … cold start`, `recommend: no number`,
`next step: cold start now, then 3 more workouts → back to 2.5 kg`. The 207-day gap before the return still drives the
ladder, and the ladder advances only on "a workout in range with reserve" (BR-TRAINING-038) — the owner's sets there
are RPE 9–10, so it never advances.

**Live confirmation (owner session 2026-10-01, `lower_a_20261001`).** Standing Calf Raise Machine records:
2026-04-24, then 2026-09-21 (20/15/12 × 50 kg), 2026-09-27 (30 × 40, 40, 45, 45), 2026-10-01 — the third workout in
a row after the 150-day gap. The LOAD PLAN still said `cold start`, `no number`; the coach told the owner there was a
"long break", then invented that past calf work was "probably logged under another exercise", picked 40 kg itself
(Sunday's top was 45 kg), held it, and demanded RPE ≤ 8 on a third set after RPE 9. Owner: «так не бывает в
принципе», «я сделал столько, сколько ты сказал, мог бы и больше». Adds to scope: the coach never explains a ladder
or a gap the client cannot see in their own recent training, and never guesses at missing records.

## Scope (outline, owner-agreed 2026-10-01)

1. The ladder advances on every post-gap workout at the exercise that reached the rep floor (by capacity,
   BR-TRAINING-043); reserve is not required.
2. The ladder closes once the exercise has ≥ 2 performances after the gap (or the rungs are done); the normal
   rules (BR-TRAINING-041/042) take over from the post-gap history.
3. A restart with recent post-gap history never prints `no number`.
4. Golden cases for ladders (return / rebuild / restart × RPE 7–10 × number of post-gap workouts) written independently;
   the dev zero-LLM report over the owner's history shows a number for every strength exercise with recent history.
