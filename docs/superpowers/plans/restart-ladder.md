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

## Scope (outline, owner-agreed 2026-10-01)

1. The ladder advances on every post-gap workout at the exercise that reached the rep floor (by capacity,
   BR-TRAINING-043); reserve is not required.
2. The ladder closes once the exercise has ≥ 2 performances after the gap (or the rungs are done); the normal
   rules (BR-TRAINING-041/042) take over from the post-gap history.
3. A restart with recent post-gap history never prints `no number`.
4. Golden cases for ladders (return / rebuild / restart × RPE 7–10 × number of post-gap workouts) written independently;
   the dev zero-LLM report over the owner's history shows a number for every strength exercise with recent history.
