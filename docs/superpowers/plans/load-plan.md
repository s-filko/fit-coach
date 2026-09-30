# Load Plan — Decision Order, Progression Schemes, Recommendation Log, Breaks (Roadmap U9b) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans and
> test-driven-development. Red tests first, then the code. The pre-commit hook runs `test:unit`,
> so a red unit test is verified by running it and stated in the commit body (load-facts D17);
> DB-backed reds may be committed as `*.repro.test.ts`.

- Status: in progress
- Branch: plan/load-plan
- After: load-facts

**Goal:** the `LOAD PLAN` block stops being facts only: code names the load for every exercise —
a candidate and a conservative alternative, each with its reason, produced by a fixed decision
order (safety rows → scheme), with the stage that produced it printed. The user's progression
scheme is a typed fact; every first working set snapshots what the plan said (recommendation
log); a break is an event with a reason and a return ladder. The session planner stops writing
`targetWeight`, so `LOAD PLAN` is the only place a load appears (design Principle 1).

**Written 2026-09-29 by the U9a orchestrator under the owner's order ("if budget remains, write
the U9b plan but do not execute it").** Executed 2026-10-01 under the owner's autonomy order (§ Execution
decisions); owner gates are listed in § "Before dispatch".

**Spec:** design `docs/superpowers/specs/2026-09-28-load-recommendation-architecture-design.md`
§2 (principles), §3.3 (decision order), §3.4 (output), §3.5 (recommendation log), §4 (schemes),
§5 (breaks), §7 (prompt side), §11 (owner decisions); review
`2026-09-28-load-recommendation-architecture-review.md` §E (sources), §F (U9b scope); roadmap
`2026-09-24-coach-roadmap.md` U9b, R4.4; predecessor plan `load-facts.md` (D1, D2, D5 deferrals,
§ R4.0 threshold table, § Zero-LLM check findings).

## Before dispatch (owner gates — the executing orchestrator asks, one question at a time)

1. ✅ (accepted 2026-09-30) **R4.0 threshold table** (`load-facts.md` § "R4.0 — sourced thresholds") reviewed by the owner
   once (design §11.4); items marked *verify* checked against the papers. Its values become the
   named parameters of D5 below.
   **Accepted by the owner 2026-09-30 as is** (the *verify* items included): under O1 the numbers are a suggestion
   the model may override, so a wrong threshold is cheap; they are refined later from the recommendation log.
2. ✅ (approved 2026-09-30) **ADR-0009 amendment** — two new fact categories, `progression_scheme` (typed value: a
   registry id) and `break` (dates, reason class, free text; `durability = short`, expiry at the
   ladder's end). Durable spec: proposed text in § "Proposed durable-spec text", the owner edits
   or approves.
3. ✅ (approved 2026-09-30, with O1's `advised` column) **Recommendation log table** (additive migration) — the owner confirms the shape in D7.
4. ✅ (decided 2026-09-30: **one merge, three flags** — see D1 as amended) **Scope split (recommended, D1):** the review (§F) warned that U9′ bundled too much; this plan
   is already U9b alone, but it still carries three hypotheses. The recommended order is three
   merges, each deployed and live-checked on dev: **9b-1** Tasks 1–3 (schemes + decision order +
   log — the number appears), **9b-2** Task 4 (breaks), **9b-3** Task 5 (planner/prompt
   rebinding). The owner may take it as one merge instead.

## Decisions (D) — proposed, to be confirmed at dispatch

- **O1 — owner decision 2026-09-30: the code's number is a cheat sheet, the model decides.** `LOAD PLAN` hands the
  model the scheme's candidate and conservative option **as a suggestion with a comment**, framed as: "this is what
  the rules give; the decision is yours, to the extent of your awareness of the situation". The model may pick
  another load when the conversation gives a reason (sleep, pain, crowded gym, how the last set felt) and says why
  in its reply. Rationale (owner): a rigid formula errs where the model, with the whole context, reads the situation
  better; formulas are a guide, not the final word. Consequences: D10's "deviate only on a stated fact from the
  current conversation" becomes "deviate by judgement, stating the reason"; D7 logs both numbers (below); the
  design's Principle 6 is amended accordingly (durable-spec text at gate 2).

- **D1 — amended by the owner 2026-09-30: one merge, three feature flags.** Each part ships behind its own env
  flag, on in `.env.dev`, off by default: `LOAD_PLAN_SUGGESTION` (Tasks 1–3: schemes, decision order, log),
  `LOAD_PLAN_BREAKS` (Task 4), `LOAD_PLAN_PLANNER_REBIND` (Task 5 — planner without `targetWeight`, prompt
  rebinding). Any part can be switched off on dev without a revert (compose up, no redeploy). Errors stay
  attributable: the log row records the stage and row that produced the number, each part has its own commits and
  tests (flag on and off), one close-out review. Breaks are verified without a real break: dated-clock scenario
  tests, the zero-LLM report over the owner's real history (which exercises fall into which tier today), and
  optionally a throwaway dev user with back-dated history. With no exercise in a break tier the part is silent.
  Placement note (2026-09-30): since `prompt-caching`, all block-3 context already rides in the current user
  message, so the D6 "tail after NOW" question is moot — the block stays a normal context block.
- ~~**D1 — three merges, one plan** (see gate 4).~~ Each merge ends at a dev deploy and its own live
  check; `Status: done` only after 9b-3.
- **D2 — scheme registry in the domain.** `src/domain/training/load-plan/schemes/` — one module per
  scheme `double_progression@1`, `linear_progression@1`, a registry `SCHEMES` keyed by id, and one
  signature for all: `(facts: LoadFacts, goal, params) → { candidate, conservative, reason,
  confidence, missing[] }` (design §4.1). Parameters by goal (rep range or fixed reps, step,
  confirming sessions default 2 — ACSM/NSCA 2-for-2, 10 % step cap). Unmet requirements go to
  `missing` and a printed fallback line, never a silent branch.
- **D3 — contract tests over every scheme** (design §4.1): candidate ≤ working weight + 1 step;
  conservative ≤ candidate; a `short` constraint on a primary muscle forbids growth; insufficient
  data yields the Stage A answer; candidate is a multiple of the step from the last load; no step
  above the 10 % cap. One fixture set, all schemes.
- **D4 — decision order** (design §3.3) in `src/domain/training/load-plan/decide.ts`, pure, over
  `LoadFacts` (U9a) + the scheme: Stage A safety rows (insufficient data → "no record —
  conservative start", as v8 does, until U11; `short` constraint; gap tier ≥ `return`;
  pre-fatigue materially greater than the reference; below range floor) → Stage B (no tactic
  until U12; prints `tactic: none active`) → Stage C scheme. The matching stage and row are part
  of the output.
- **D5 — gap tiers and return ladder in code** from the R4.0 table as **named parameters with
  their citation** (`rest` / `rest_with_question` / `return` / `rebuild` / `restart`), printed as
  "general norm"; the ladder is a counter of real workouts since the gap (design §5). Personal
  thresholds (athlete profile) are not in this plan.
- **D6 — output.** `training.load_plan` **v2** adds the `scheme / tactic / decision / recommend /
  conservative / confidence` lines of design §3.4; `get_load_plan` returns the same. Folded
  load-facts findings: the `equipment` fact is printed **once per block**, not per entry; a
  negative drop-off reads `none (reps rose)`; the e1RM trend gets the same 8-week window as the
  working weight or prints its span (decided at Task 2: the span is printed — (D) T2(f));
  the D5 placement question of load-facts is settled here — the block moves to the tail after
  `NOW` **only if** the assembler slot is cheap (one optional `tailText`), otherwise stays in block
  3 and the reason is recorded.
- **D7 — recommendation log** (R4.4): table `load_recommendations` (id, user_id, session_id,
  exercise_id, run_id, scheme_id, scheme_version, stage, row, candidate jsonb, conservative
  jsonb, confidence, fatigue jsonb, gap_tier, rendered text, created_at; outcome jsonb +
  completed_at filled when the exercise completes). Written when `log_set` stores the **first
  working set** of an exercise in a session (design §3.5), with the entry as rendered for that
  run; never read back into the prompt (calibration data, not a cache).
  **Amended by O1:** the row also stores what the model actually told the user (`advised` jsonb — load, reps, and
  its stated reason when it differs from the candidate/conservative), so code-vs-model divergence and its outcome
  can be compared after a few workouts. Source of `advised`: the first working set's reply text is not parsed —
  the model states it through the `log_set` / a small `advise_load` field (Task 3 decides, red test first).
- **D8 — `progression_scheme` fact** (design §4.2): written only by the summariser + verifier
  from the user's verbatim quote; typed value validated against `SCHEMES`; newest active wins;
  default from profile (novice + strength → linear, else double) printed as "default,
  unconfirmed"; one context line `Progression: double, 8–12, confirm ×2 — chosen by user <date>`.
  No tool writes it.
- **D9 — `break` fact and the reason question** (design §5): after a gap at tier
  `rest_with_question` or above, the first conversation asks once what happened, before any
  training; the answer becomes a `break` fact through the existing pipeline; no answer → reason
  `unknown`, most conservative branch, never asked again. The existing chat time-gap note reads
  the same tier (one "long time no see" mechanism).
- **D10 — planner stops writing `targetWeight`** (design §2.1, §7): `save_workout_plan` /
  session-planning tool schemas drop it, WORKOUT OVERVIEW prints sets × reps only, the column
  stays (legacy rows, API) but is no longer written. Prompts: `session_planning` v4 and
  `training` v10 rebind v8/v9 rules 1, 2, 4b and the FIRST MESSAGE RULE to `LOAD PLAN` /
  `get_load_plan` (quote dated facts, always give the conservative option, say "insufficient
  data" when the block does, and — per O1 — treat the numbers as a suggestion: deviate by judgement, stating the
  reason). **Version note (2026-09-30):** `session_planning` v4 and `training` v10 were taken by `prompt-caching`;
  this plan's prompt versions are `session_planning` v5 and `training` v11.
- **D11 — executors.** Tasks 1, 2, 3 Sonnet (judgement-heavy); Task 4 Sonnet; Task 5 GLM
  (pattern-following prompt versions). Tasks 1 and 4 touch disjoint files and may run in parallel
  worktrees; DB tests via `db-test-lock.sh`.

## Execution decisions (autonomy order 2026-10-01, orchestrator — for the owner to review)

- **(D) A1 — executors per D11:** Tasks 1–4 Sonnet, Task 5 GLM.
- **(D) A2 — worktrees and order:** Task 1 in `load-plan-t1` (branch `plan/load-plan`) and Task 3 in
  `load-plan-t3` (branch `task/load-plan-t3`) run in parallel (disjoint files); Task 3 is merged into the plan
  branch before Task 2. Tasks 2, 4, 5 run sequentially in `load-plan-t1` (Task 4 needs `gap-tier.ts` from Task 2;
  Tasks 4 and 5 both touch `FACT_CATEGORIES` and the summariser). DB tests via `db-test-lock.sh`.
- **(D) A3 — log decision columns nullable:** Task 3 creates `load_recommendations` with `scheme_id`,
  `scheme_version`, `stage`, `row`, `candidate`, `conservative`, `confidence`, `gap_tier` nullable and snapshots
  the rendered v1 entry through a snapshot port; Task 2 fills the decision fields from `decide()`. A row written
  with no decision (flag on, decision unavailable) is still calibration data.
- **(D) A4 — `advised` source:** an optional `advised` object on the `log_set` tool input (load, reps, reason when
  it departs from the suggestion), stored on the first working set's row; exact shape settled by Task 3's red test.
  The reply text is never parsed.
- **(D) A5 — flags:** `LOAD_PLAN_SUGGESTION`, `LOAD_PLAN_BREAKS`, `LOAD_PLAN_PLANNER_REBIND` are booleans in the
  server env schema, default `false`; with a flag off the code path is exactly the pre-plan behaviour (tests cover
  both). Prompt versions `training` v11 / `session_planning` v5 are selected only when `LOAD_PLAN_PLANNER_REBIND` is on
  (with `LOAD_PLAN_SUGGESTION`, per the review fix).
- **(D) A6 — Task 5 split:** 5a (the `progression_scheme` fact through summariser v7 / verifier v2, the context line,
  the block's "chosen by user <date>") goes to the Sonnet worker that wrote summariser v7 in Task 4; 5b (planner without
  `targetWeight`, WORKOUT OVERVIEW, `session_planning` v5 / `training` v11) goes to GLM per D11. The scheme fact is part
  of the suggestion (D1 groups schemes under `LOAD_PLAN_SUGGESTION`): summariser v7 / verifier v2 are selected when
  `LOAD_PLAN_BREAKS` or `LOAD_PLAN_SUGGESTION` is on, and apply-time validation drops a category whose flag is off.
- **(D) T1 — scheme details the plan did not settle (Task 1):** (a) `goal` is `strength | hypertrophy | general`;
  `defaultParams(goal)` gives the rep range (double: 4–6 / 8–12 / 8–12) or fixed reps (linear: 5 / 8 / 8), both with
  `confirmSessions` 2 and `stepCapPct` 0.1 from `schemes/params.ts` with the R4.0 citations. (b) A recommendation is
  `{ load | null, unit, reps }`; insufficient data (no working weight) returns `load: null`, reason
  `no record — conservative start`, `missing: ['workingWeight']`. (c) `LoadFacts` carries no per-session rep history, so
  "confirmed ×N" is read from `e1rmTrend.flatRun` (consecutive performances within ±2.5 % of the newest) plus
  `lastExposure.repsVsRange`; an absent trend goes to `missing` and holds the load. (d) `LoadFacts.constraints` is
  already filtered to the exercise's muscles (any involvement, no involvement field), so any `short` constraint there
  forbids growth. (e) Linear counts "reps made" as `in range` or above (the planner derives `targetReps` = fixed reps).
  (f) A step above the 10 % cap holds the load and the reason says "progress by reps". (g) `getScheme(id)` throws
  `UnknownSchemeError`; `SCHEMES` is keyed by id without the version.
- **(D) T2 — decision order, tiers, block v2 (Task 2):** (a) **Tier source:** the exercise's own gap, else its primary
  muscles', else any workout's (`gapTierFacts`); thresholds `> 7 d` rest_with_question, `≥ 14` return, `≥ 28` rebuild,
  `≥ 84` restart, each a named parameter with its R4.0 citation in `gap-tier.ts`. (b) **Ladder stub:** `returnLadderStep(tier,
  workoutsSince = 0)` — return 2 rungs from 1 step below, rebuild 3 rungs from 2 steps below, restart = cold start (no load);
  the counter's source and the `break` fact are Task 4. A finished ladder falls through to Stage C. (c) **Pre-fatigue
  "materially greater":** the largest per-muscle increase in working sets on shared muscles (today − reference) ≥ 3 → hold;
  ≥ 6 → one step down. Reasoned caution parameters, not sourced; the log (R4.4) calibrates them. The design's "−1 step if
  the delta exceeds the user's own drop-off norm" is not implemented: the norm is in reps, the delta in sets — no
  unit-compatible comparison; revisit with the log data. (d) **Non-strength exercises** print `recommend: n/a for <type>`
  and no decision lines (schemes apply to strength). (e) **Scheme until Task 5:** `defaultProgression(profile)` — beginner
  (`users.fitness_level`) + a strength goal (`users.fitness_goal` text matching strength/stronger) → linear, else double;
  goal hypertrophy when the text names muscle/mass; printed `(default, unconfirmed)`. (f) **e1RM window (D6):** not cut to 8
  weeks — the v2 entry prints the span instead (`e1RM over N performances / D d`, new `spanDays` on `E1rmTrendFact`, additive;
  v1 output unchanged), so the owner's live check 4 can still judge the trend; the scheme's confirmation still reads
  `flatRun`. (g) **Flag plumbing:** `LOAD_PLAN_SUGGESTION` (env enum true/false → boolean, default false) →
  `ConversationGraphDeps.loadPlanSuggestion` (composition root) → `training.spec.ts` picks `TRAINING_LOAD_PLAN_V2` and
  `get_load_plan` renders v2 (its description switches to the suggestion wording); `TrainingData.progression` is set only
  with the flag on, so flag-off data is identical. (h) **Known gap until Task 5:** prompt `training` v9 rule 1 still says
  "LOAD PLAN recommends no weight" while the v2 header says suggestion; the rebinding is Task 5 (`LOAD_PLAN_PLANNER_REBIND`).
  (i) `renderLoadPlanEntry` (v1) gained opt-in `equipment` / `dropOff` / `e1rmSpan` options — defaults reproduce v1 exactly.
  (j) The zero-LLM `print-load-plan` prints v2 by default (`--v1` = facts only).
- **(D) T3-1 — snapshot before the set, write after it:** `logSetWithContext` renders the v1 entry before the set is
  stored (so `today:` excludes the set that triggers the row) and inserts it after the set succeeded; a unique index on
  `session_exercise_id` (+ `ON CONFLICT DO NOTHING`) keeps parallel first sets to one row. Trigger = no earlier set of
  that row with `set_kind <> 'warmup'` (legacy NULL counts as working).
- **(D) T3-2 — log never fails a set:** the log implementation swallows and logs errors (snapshot, insert, outcome).
- **(D) T3-3 — `advised` shape:** `log_set` input `advised?: { load?: kg, reps?: int, reason?: string }`; stored
  as-is on the first working set's row. The schema is visible to the model even with `LOAD_PLAN_SUGGESTION` off (tool
  surface snapshot updated); with the flag off the field is ignored — no row, no behaviour change.
- **(D) T3-4 — `outcome` shape:** `{ sets: [{ setNumber, reps?, weight?, weightUnit?, duration?, rpe }] }`, working sets
  only, written when the exercise completes (`complete_current_exercise`, switch auto-complete, or the session ends
  with the exercise still open); `completed_at` = now. `fatigue` is filled from the fact package's `fatigueToday`;
  the other decision columns stay NULL for Task 2 (A3).
- **(D) T3-5 — decision columns filled (A3, Task 2 follow-up):** the snapshot port calls `decideLoadPlanEntry` (the one
  decision call path, exported from `training-load-plan.v2.ts` and shared with the block, tool and report) and renders
  the **v2** entry from that same decision (`opts.decision`), so `rendered` is what the coach saw and the columns are the
  decision behind it: `scheme_id`, `scheme_version` (text, `'1'`), `stage` (`A|B|C`), `row` (the `DecisionRow` id, e.g.
  `scheme_hold`), `candidate` / `conservative` (the `Recommendation` `{ load | null, unit, reps }`), `confidence`,
  `gap_tier`. A non-strength exercise has no scheme decision: those columns stay NULL and the entry prints `recommend:
  n/a for <type>`. The log exists only with `LOAD_PLAN_SUGGESTION` on, so the v1-only snapshot path is gone (v1 remains
  the flag-off block/tool). The D8 default scheme reads the profile through an optional `userRepository` dep (wired in
  `register-infra-services.ts`); absent = the profile-less default. T3-1's "v1 entry" reads "v2 entry" from here on.
- **(D) T4 — breaks (Task 4, `LOAD_PLAN_BREAKS`):** (a) **Carrier:** the `break` fact is a text fact in the existing
  `user_facts` table (no schema change): `break reason=<class> from=<YYYY-MM-DD> to=<YYYY-MM-DD> — <user words>`;
  `parseBreakFact` rejects an unknown class, bad or reversed dates, free text — such an operation is skipped at apply time.
  (b) **Writers:** the summariser (v7) + verifier (v2) only — `manage_fact` takes `CONVERSATION_FACT_CATEGORIES` (every
  category but `break`). The one code-written row is the "asked" marker below (reason `unknown`, no claim about the user).
  (c) **Lifetime:** forced in code to `short`, `ttlDays 14` (the short-class cap), `onExpiry forget`; "expiring at the end of
  the ladder" is approximated by that cap. (d) **One-time question:** `BreakContext.resolve` (per run, first model call; kept on
  the run ctx so later calls of the run render the same note): last real workout > 7 d ago and no `break` fact of ANY status
  (active, archived, expired-not-yet-archived) overlapping `[last workout day, today]` → `ask: true` and the marker
  `break reason=unknown from=<last workout day> to=<today>` is stored first (the fact is the persisted "asked" state — it
  survives restarts and expiry checks; a failed write means no question, never a question per message). No answer = the
  marker stays `unknown` = the most conservative branch. The answer arrives at compaction as an `update` of the marker
  (summariser v7 is told to); until then the reason stays `unknown` (one step lower) — known gap, conservative side.
  (e) **Note:** `block.time_gap` v2 = v1 sentence for a message gap + `Training: training break of N days (tier X, general
  norm)` + the ask sentence; rendered when there is a message gap or a question pending; every text starts with the v1
  prefix (cache attribution). No new prompt version and no `training` v11 — the question rides in the note. (f) **Ladder
  counter:** per exercise, from its real performances: the newest gap ≥ 14 d between consecutive performances opens the
  ladder; `workoutsSince` counts the SUCCESSFUL performances since it (success = every working set ≥ the rep floor of
  that performance's own `targetReps`, and any recorded RPE ≤ 8 (`RESERVE_RPE_MAX`, a convention, no sourced gate); missing
  range/RPE is never a miss); a miss leaves the rung, a success advances it. The open (current) gap wins over an old
  ladder; a closed gap keeps the ladder until its rungs are done. After `restart` the first workout is a cold start, the
  next ones follow the rebuild ladder. (g) **Reason branch:** `unknown` and `illness` one step lower (illness adds a
  well-being check line), `stress_poor_sleep` standard ladder + "caution for the first week", `holiday_work_no_time`,
  `deliberate_deload`, `injury` standard ladder (an injury is the `physical_constraint` fact's job). Flag on: no covering fact
  = `unknown`; flag off: no adjustment at all (Task 2 behaviour). (h) **Flag plumbing:** `ConversationGraphDeps.loadPlanBreaks`
  → compact step (v7 + verifier v2 + the episode date), agent node (note v2 + `breakContext`), loader `breaks` param
  (`returnBranch` on the entry: ladder + reason), tool, snapshot port, `print-load-plan` (always on). Independent of
  `LOAD_PLAN_SUGGESTION`; the `break:` LOAD PLAN line needs both. (i) Summariser v7 / verifier v2 replace v6 / v1 only with the
  flag on and are not in `STANDALONE_PROMPTS` (same module id as the current one; its ids must stay unique).
- **(D) T5a — the `progression_scheme` fact (Task 5a, A6):** (a) **Carrier:** a text fact, `progression_scheme id=<registry
  id> — <user's words>`; `parseProgressionFact` accepts only ids in `SCHEMES` (an unknown id, `constructor`, free text →
  rejected at apply time). (b) **Writers/flags:** summariser v7 + verifier v2 are selected when `LOAD_PLAN_BREAKS` or
  `LOAD_PLAN_SUGGESTION` is on, each prompt section rendered only for its own flag (`breaks` / `schemes` on the v7 context);
  apply-time drops `break` without `LOAD_PLAN_BREAKS` and `progression_scheme` without `LOAD_PLAN_SUGGESTION`;
  `manage_fact` cannot write it (`CONVERSATION_FACT_CATEGORIES`). (c) **Lifetime:** forced in code to `long_term`, review in 182
  days (the class maximum; a standing choice, not a state) — the newest active fact is the choice and a change of mind is an
  `update` that supersedes it. (d) **Reading:** the loader attaches `chosenScheme` (newest valid active fact + its
  `createdAt`) to every entry; `progressionOf(entry, base)` in the v2 module overrides the D8 default and is the one place
  the choice is applied, so `decide()`, the block, the tool, `print-load-plan` and the log's `scheme_id` all follow it; the
  goal stays the profile's. (e) **Printing:** `Progression: double, 8–12, confirm ×2 — chosen by user 2026-09-20` (or
  `— default, unconfirmed`) is one line at the top of the LOAD PLAN v2 block; the per-entry `scheme:` line carries the same
  provenance. Until Task 5b (the planner derives `targetReps` from the scheme) the entry's rep range is still today's plan
  range, so the two lines can show different ranges (e.g. strength goal: line 4–6, entry 8–12 from the plan). (f) No new
  context block or prompt version outside the LOAD PLAN block; planning-phase context line and prompts are Task 5b.
- **(D) T5a-fix — one rep range per entry (orchestrator review of Task 5a):** the block-level `Progression:` line (the
  context line of design §4.2) prints no rep range — `Progression: double, confirm ×2 — chosen by user 2026-09-20` /
  `— default, unconfirmed`. Each entry's `scheme:` line prints the range that entry actually uses: today's plan range,
  else the reference performance's; when neither exists, or the scheme fixes the reps (linear), it prints the scheme's own
  range/reps labelled `(scheme default)`. One block never shows two ranges that contradict each other; Task 5b (the planner
  deriving `targetReps` from the scheme) is unaffected.

- **(D) T5b — choices the plan left open (Task 5b, worker):** (a) `formatExerciseSummary` DOES print a plan target
  (`Target: 3x8-10 @ 70 kg`), so with the flag on its Target line drops the weight too — threaded through the
  `log_set` / `complete_current_exercise` builders as `loadPlanPlannerRebind`; logged sets always keep their weights.
  (b) WORKOUT OVERVIEW v2 and `active_plan` v2 omit target weights everywhere, including legacy rows that still carry
  one (the column stays readable, it is just not printed). (c) v11 / v5 are registered as separate prompt entries
  (`TRAINING_PROMPT_V11`, `SESSION_PLANNING_PROMPT_V5`) next to `current` (still v10 / v4 per A5); the specs select
  them by the flag. (d) The agent node stamps the phase module version it actually rendered into the run row's
  `promptVersionExtras`, so a flag-on run records v11 / v5 instead of the static registry's v10 / v4 (same value with
  the flag off — today's rows unchanged). (e) `session-planning.types.ts` grows `buildSessionRecommendationSchema({
  dropTargetWeight })`; zod strips a `targetWeight` sent anyway (tested), so nothing reaches the DB. (f) `session_planning`
  v5 also rewords STEP 1e's "adapt intensity (reduce weights, …)" to "reduce intensity" — the minimal reading of
  "minus any instruction to propose or save weights".
- **(D) Fix-9 — a break fact belongs to a gap only when it covers a day strictly between the workouts (B-code 9, fix
  worker):** the window's ends are training days, so `breakReasonOf(facts, { from, to })` matches a fact when
  `fact.to > from` and (`to` is null or `fact.from < to`). `from` = the last workout before the gap; `to` = the
  workout that ended it, or **null while the gap is still open** (today is not a training day). A marker asked about
  on the day the user then trained (`to` = that day) therefore never covers the next gap, and a new gap's marker
  (`from` = that workout day) never colours the ladder gap before it. Used by `BreakContext` (open window) and the
  loader's `returnBranchOf` (open window for the current gap, closed window for the ladder's own gap).
- **(D) Fix-2 — wording out of the domain, one decision composer (B-code 2, 3, 6 + R1 folded):** the domain returns
  typed values only (row id, scheme id, `ProgressionChoice` with `source` / `chosenAt`). `ROW_LABELS`, the scheme
  display name, the provenance text and the `Progression:` line live in `training-load-plan.v2.ts` (one helper each).
  `decideLoadPlanEntry` moved to `infra/ai/load-facts/load-decision.ts` (resolve the scheme, then `decide()`; it no
  longer passes `params`, `decide()` defaults them) and the log imports it, not a block; `progressionOf` is gone
  (`progressionFromChoice(base, entry.chosenScheme)`). `TrainingBreakNote` is declared by its producer
  (`break-context.ts`). **Deliberate text change (only one):** the block-level line now spells the scheme the way the
  entry's `scheme:` line does — `Progression: double progression, confirm ×2 — …` (was `Progression: double, …`);
  the design §4.2 sample shows the short form, the owner may prefer to shorten the `scheme:` lines instead. LOAD PLAN
  v2 is not deployed yet, so this edits the module in place.
- **(D) Fix-S — Stage A takes the more conservative of the matching rows:** a short constraint and a gap row can both
  match; the lower candidate load wins (a cold start — no load — is lowest), a tie keeps the constraint. A rebuild
  ladder now beats a constraint's hold; the last rung of a finished-soon ladder (back at the working weight) ties and
  the constraint row stays. Post-restart rungs follow the rebuild ladder and are labelled `gap_rebuild` (the printed
  reason still says `restart tier`).
- **(D) Fix-T — the D7 trigger moved into the log (R3 folded):** `ILoadRecommendationLog.prepare` takes
  `{ sessionId, sessionExerciseId, exerciseId, ctx }` and reads the session itself inside its never-throw guard; the
  "no earlier working set" check uses `workingSets()` on the session details (was a separate `findByExerciseId` read
  and an inline copy of the rule in the service). A failed read skips the log, never the set. `recordLoadOutcome` also
  uses `workingSets()`.
- **(D) Fix-R — `LOAD_PLAN_PLANNER_REBIND` needs `LOAD_PLAN_SUGGESTION`:** one predicate, `plannerRebindOn(deps)`
  (`graph/phases/planner-rebind.ts`), gates everything the flag switched — prompts v11 / v5, WORKOUT OVERVIEW /
  active-plan v2 and the planner tools' schemas — so rebind-only is exactly the pre-plan behaviour (tested in
  `phase-specs.unit.test.ts`), never a half-applied planner.
- **(D) Fix-P — summariser v7 / verifier v2 edited in place (R2 folded):** neither prompt is deployed yet, so the
  break classes (`BREAK_REASONS`) and the lifecycle numbers (`FACT_LIFECYCLE_BOUNDS`) are derived instead of typed; the
  rendered text is byte-identical (pinned in `summarizer/__tests__/v7.unit.test.ts`). The TTL / review constants of
  the compaction node and the marker derive from the same bounds (B-code 8).
- **(D) Fix-C — small folds:** `maybeCtxOf(config)` next to `ctxOf` is the lenient run-context accessor used by
  `log_set`; `CONVERSATION_FACT_CATEGORIES` is derived from `FACT_CATEGORIES` minus the compaction-only pair; both
  `get_load_plan` descriptions share one tail constant (text unchanged); `start_training_session` builds its schema
  with `buildSessionRecommendationSchema({ dropTargetWeight })`; the dead `hasShortConstraint` / `PLATEAU_FLAT_RUN`
  are deleted; the 14 new test files carry AC ids in their top-level `describe` names.

## Acceptance criteria

| AC | Criterion | Verification |
|---|---|---|
| AC-LP-1 | Every scheme passes the D3 contract suite; the registry rejects an unknown id | `src/domain/training/load-plan/__tests__/scheme-contract.unit.test.ts` |
| AC-LP-2 | The decision order returns the stage/row of design §3.3 on fixtures for each Stage A row and for Stage C growth/hold | `decide.unit.test.ts` |
| AC-LP-3 | `LOAD PLAN` v2 prints `recommend:` and `conservative:` with reasons and `decision: Stage X, <row>`; equipment facts once per block | block unit test + scenario |
| AC-LP-4 | The first working set of an exercise writes one `load_recommendations` row with the rendered entry; a second set does not; completion fills `outcome` | `tests/integration/scenarios/load-recommendation-log.integration.test.ts` |
| AC-LP-5 | A `progression_scheme` fact is stored only from a verified user quote; the block prints "chosen by user <date>", or "default, unconfirmed" without one | summariser/verifier unit tests + scenario |
| AC-LP-6 | A 30-day gap prints the tier and ladder step; the next conversation asks the reason once; the answer is a `break` fact; the ladder advances on a workout in range with reserve | unit + scenario |
| AC-LP-7 | Session planning writes no `targetWeight`; WORKOUT OVERVIEW shows sets × reps only; prompts `session_planning` v5 / `training` v11 differ from `session_planning` v4 / `training` v10 only in the D10 lines | tool/block/prompt unit tests + snapshots |

Verification commands (from `apps/server/`): `npm run check-all`, `npm run test:unit`,
`db-test-lock.sh npm run test:integration`, `db-test-lock.sh npm run test:scenarios`,
`node scripts/state.mjs --check`; post-deploy: `print-load-plan` over the owner's dev data (zero
LLM, as in load-facts).

## Task 1 — Scheme registry + contract tests (AC-LP-1) — 9b-1

Files: `apps/server/src/domain/training/load-plan/schemes/` (new), `__tests__/`. Pure; input is
U9a's `LoadFacts`. Red: the contract suite over an empty registry.

## Task 2 — Decision order, gap tiers, `LOAD PLAN` v2 (AC-LP-2, AC-LP-3) — 9b-1, after Task 1

Files: `src/domain/training/load-plan/decide.ts`, `gap-tier.ts` (D5 parameters with citations),
`src/infra/ai/prompts/blocks/training-load-plan.v2.ts`, `get-load-plan.tool.ts`,
`training.spec.ts` (block v1 → v2), `scripts/print-load-plan.ts`. The folded load-facts findings
(D6). Red: fixtures per Stage A row.

## Task 3 — Recommendation log (AC-LP-4) — 9b-1, parallel with Task 1

Files: `src/infra/db/schema.ts` + migration (generated, inspected), a repository + port,
`training.service.ts` (`logSet` hook on the first working set), the loader/producer call that
renders the entry being snapshotted. Red: the scenario.

## Task 4 — Breaks: `break` fact, reason question, return ladder (AC-LP-6) — 9b-2

Files: `FACT_CATEGORIES` (+ ADR-0009 amendment already approved at gate 2), summariser v7 +
verifier prompt, `gap-tier.ts` ladder counter, the chat time-gap note block reading the tier,
chat/training prompt line for the one-time question. Red: the scenario.

## Task 5 — Scheme choice fact, planner without `targetWeight`, prompt rebinding (AC-LP-5, AC-LP-7) — 9b-3

Files: `FACT_CATEGORIES` (`progression_scheme`), summariser/verifier (typed value), the context
line; `save-workout-plan.tool.ts`, `session-planning.types.ts`, `session-planning-active-plan.v1.ts`
→ v2, `training-workout-overview.v1.ts` (no weight); `session_planning/v5.ts`,
`training/v11.ts`. Red: tool schema test + prompt test.

## Live check (dev, owner — one merge, all three flags on; D1 as amended)

- 9b-1: «какой вес на жим?» → the coach names the block's candidate with its reason and the
  conservative option; `load_recommendations` has a row after the first working set.
- 9b-2: after ≥ 14 days without training, the first message asks once why; the next workout
  starts one step down and says "return, workout 1 of N".
- 9b-3: «хочу прогрессию по повторам» → next day the block says "chosen by user <date>";
  a new session plan shows sets × reps only.

## Proposed durable-spec text (for the owner, gate 2)

ADR-0009 amendment (fact categories): "`progression_scheme` — the user's chosen progression
scheme; value is a registry id validated in code; written only from the user's verbatim words
through the summariser and the model verifier; the newest active fact is the choice.
`break` — a pause in training with dates, a reason class (illness, injury, holiday/work/no time,
deliberate deload, stress/poor sleep, unknown) and the user's words; `durability = short`,
expiring at the end of the return ladder."

Design `2026-09-28-load-recommendation-architecture-design.md` Principle 6 amendment (O1): "The load in `LOAD PLAN`
is a suggestion with its reason, not a binding value: the model decides the load by its judgement of the current
situation, and states its reason when it departs from the suggestion; both the suggestion and the advised load are
logged (D7)."

**Gate 2 approved by the owner 2026-09-30** (both texts above, as written). The ADR-0009 edit is applied by the
orchestrator in the 9b-1 close-out, in the same diff as the code.

## Review

Close-out review 2026-10-01 (R1, R2, R3, R4; four isolated Opus zones over `ae9a48a8...plan/load-plan`).
**Verdict: blocked** (13 blocking, one shared by R1 and R4). Under the autonomy order the orchestrator routes them
(**(D) A7**): blocking code findings go to one Sonnet fix worker (B-code below); blocking doc findings are fixed by the
orchestrator (B-doc); advisory findings are either folded into the fix pass when they are a line or two (marked
*folded*) or filed in `docs/BACKLOG.md` (marked *backlog*). Findings are recorded in the reviewers' words, shortened.

### Blocking

1. **R1 + R4 — `docs/adr/0009-user-long-term-memory.md:220` / `:206`** (SI rules 3 and 7). The paragraph after the
   approved amendment text was not approved and writes the T4(c) approximation ("expiry approximated by the `short`
   cap") into the durable ADR; the table example `progression_scheme=double_progression` does not match the code's
   carrier `progression_scheme id=<id>` (`progression-fact.ts:17`). *B-doc:* paragraph removed (T4(c) stays a (D)
   for the owner), example corrected to the parsed shape.
2. **R1 — `progression-fact.ts:61`** (ADR-0013 D-09/D-13, BR-LLM-008). `progressionLine()` builds prompt wording in
   the domain layer; its only consumer is the v2 block, so block output can change without a version bump. *B-code.*
3. **R1 — `decide.ts:36`** (same rule). `ROW_LABELS` holds prompt presentation strings used only by the v2 block's
   `decision:` line. *B-code.*
4. **R2 — `training.service.ts:407` / `:429`** (CONTRIBUTING_AI DRY). The working-set rule is re-written inline;
   `workingSets()` in `domain/training/sets.ts:10` is the one copy. *B-code.*
5. **R2 — `load-facts.loader.ts:228` / `:244`** (DRY). `daysOf` and the `exercise ?? primaryMuscles ?? anyWorkout`
   chain copy `gap-tier.ts:66–82`; `gapTierFacts(facts).days` returns the same number. *B-code.*
6. **R2 — `training-load-plan.v2.ts:66`** (DRY). `schemeLine` copies `progressionLine`'s provenance text, and the two
   spell the scheme name differently ("double progression" vs "double") in one block. *B-code* (with 2).
7. **R2 — `break-fact.ts:65`** (DRY). `calendarDate` rebuilds `formatInUserTz(date, tz).dateOnly`
   (`shared/date-utils.ts:33`) and throws where the shared one falls back to UTC; imported at 5 new sites. *B-code.*
8. **R2 — `compact.node.ts:69`, `break-context.ts:23`, `compact.node.ts:453`** (DRY). `BREAK_TTL_DAYS = 14`,
   `MARKER_TTL_DAYS = 14`, `SCHEME_REVIEW_DAYS = 182` restate `FACT_LIFECYCLE_BOUNDS` (`fact-lifecycle.ts:37/39`).
   *B-code.*
9. **R3 — `break-context.ts:66-67` + `break-fact.ts:58`** (AC-LP-6 / D9). The asked-check matches any break fact of
   any status overlapping `[last workout day, today]` inclusively; the marker's `to` is the day asked — usually a
   training day that starts the next window — so every later break is never asked about, and while the old fact is
   active a new gap takes the old reason (`returnBranchOf`). Confirmed with tsx. *B-code* (red test on the adjacent
   case first).
10. **R4 — `docs/CONTRIBUTING_AI.md:167`** (SI rule 7). "Categories are ADR-0009's eight" — now ten; the two new ones
    are compaction-only (summariser v7 / verifier v2, behind flags). *B-doc.*
11. **R4 — `docs/adr/0013-llm-core-target-architecture.md:211-212`** (SI rule 7). The time-gap note is documented as
    sent only after an `EPISODE_GAP_HOURS` pause; with `LOAD_PLAN_BREAKS` on, `block.time_gap` v2 is also sent for a
    training break with no message gap and carries the one-time question. *B-doc* (factual, flagged for the owner).
12. **R4 — `docs/domain/training.spec.md:23`** (SI rule 1). Lasting rules exist only in `docs/superpowers/` (planner
    writes no `targetWeight`; fixed precedence and the non-binding suggestion; the one-time reason question; gap
    tiers and the ladder; the never-read-back recommendation log). *B-doc:* added as flag-gated BR entries describing
    shipped behaviour, flagged for the owner's review (autonomy rule: factual durable edits only).

### Advisory

- R1 `training-load-plan.v2.ts:106` — decision composition (`decideLoadPlanEntry`, `progressionOf`) lives in a prompt
  block; the log imports a block to get its decision. *Folded* (moves with B-code 2/3/6).
- R1 `agent.node.ts:170` — `BreakContext.resolve` writes a fact during prompt assembly, outside a PhaseSpec loader.
  *Backlog.*
- R1 `compact.node.ts:461` — per-category fact policy lives in the compaction node; belongs with `fact-lifecycle`.
  *Backlog* (the duplicated bounds are B-code 8).
- R1 `load-recommendation.ports.ts:38` / R2 same — snapshot and repository ports used only inside infra;
  `unknown`-typed `candidate` / `conservative` / `fatigue`. *Backlog.*
- R1 `break-context.ts:15` — data service imports its return type from a prompt block. *Folded.*
- R1 `break-fact.ts:65` — general date formatter in the break module. *Folded* (B-code 7).
- R2 `user-facts.ports.ts:53` — `CONVERSATION_FACT_CATEGORIES` retyped by hand. *Folded.*
- R2 `get-load-plan.tool.ts:35` — two descriptions share a verbatim tail. *Folded.*
- R2 `schemes/shared.ts:30` — dead `hasShortConstraint`; R2 `params.ts:16` — unread `PLATEAU_FLAT_RUN`. *Folded.*
- R2 `training-load-plan.v2.ts:75` — pass-through `progressionOf`, `defaultParams` computed twice. *Folded.*
- R2 `decide.ts:298` — step-count computation repeated. *Folded.*
- R2 `start-training-session.tool.ts:55` — needless ternary. *Folded.*
- R2 `format-exercise-summary.ts:59` — target-weight suffix formatted at four sites. *Backlog* (predates the branch).
- R2 `log-set.tool.ts:68` — ad-hoc context cast instead of `ctxOf()`. *Folded* (document or use a lenient accessor).
- R2 `summarizer/v7.ts:40` — break reasons and lifecycle numbers hard-coded in prompt text. *Folded* (derive from
  `BREAK_REASONS` / bounds, as v7 already does for `SCHEMES`).
- R3 `gap-tier.ts:154-168` — a ladder's lifetime is bounded only by loaded history; routine misses can hold
  `gap_return` for months. *Backlog* (needs the log's calibration data; under O1 the model can override).
- R3 `decide.ts:195` — post-`restart` rungs are labelled `gap_return`. *Folded.*
- R3 `decide.ts:208-220` — a `short` constraint wins over a more conservative gap row. *Folded* (take the more
  conservative of the matching Stage A rows, or record why not).
- R3 `training.spec.ts:129` — `LOAD_PLAN_PLANNER_REBIND` without `LOAD_PLAN_SUGGESTION` leaves v11 without a load
  source. *Folded* (v11 / v5 only when both are on; test the combination).
- R3 `load-recommendation.repository.ts:42` — outcome not refreshed after a reopened exercise. *Backlog.*
- R3 `training.service.ts:371` — trigger reads outside the log's try/catch can fail a set. *Folded.*
- R3 `break-context.ts:71` — the marker is stored before the model replies. *Backlog.*
- R3 tests — 14 new test files carry no AC id in `describe`/`it` names. *Folded.*
- R4 `ARCHITECTURE.md:139-189,415` — module map / storage list not updated. *Folded* (fix worker).
- R4 `apps/server/.env.example:63` — the three flags are missing. *B-doc pass.*
- R4 design §3.4 — tail placement and 8-week e1RM window are stale in the working design doc. *B-doc pass.*
- R4 plan stale lines (header "Not dispatched", D6 "decide at Task 2", A5 AC note, Task 5 file names, per-merge live
  check). *B-doc pass.*
- R4 `schema.ts:564` — stale "nullable until the decision order lands" comment. *Folded.*

### Meta

Filed in `docs/REVIEW_FINDINGS.md` (R1 ×2, R2 ×1, R3 ×2, R4 ×3).
