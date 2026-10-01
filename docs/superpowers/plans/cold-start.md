# Cold Start — a load for a user with no history (U11) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans and
> test-driven-development. To be detailed before execution.

- Status: planned
- After: load-plan-fixes

**Goal:** a newly registered, already active user gets a sensible first load instead of `no number`. Owner order
2026-10-01: next plan after `load-plan-fixes`, same verification standard (independent Opus golden table from the
literature, invariants, local GLM replay of a new-user session, Opus review).

**Today (after load-plan-fixes):** no history and no reference → LOAD PLAN prints `recommend: no number` / `no
conservative option`; training v12 forbids inventing a load; the coach has no procedure to find one. From the second or
third workout the normal rules apply.

## Scope (outline, owner-agreed 2026-10-01)

1. **Ask the usual load.** For an exercise with no reference, the coach asks in plain language what load the user usually
   does it with (and how many reps / how long ago). The answer is stored as a user-reported reference (low confidence,
   dated); LOAD PLAN then applies the existing rules to it — recommend = that load, conservative = one step down,
   `next step:` as usual, the break ladder when it is old.
2. **In-session ramp when the user does not know.** Autoregulation (APRE set-to-set adjustment; RIR-based RPE): start
   clearly light, add a step per set, stop when a set lands in the range with 2–3 reps in reserve (the effort question
   from load-plan-fixes item 10); the ramp sets are stored as warm-ups, the found load becomes the working weight.
3. **Later, not here:** transfer from similar exercises (movement-pattern tags, design R4.1).

Open for detailing: where the user-reported reference lives (fact vs a dedicated row), how it expires when real history
arrives, the ramp's starting point per equipment, and the golden-table cases for new users.
