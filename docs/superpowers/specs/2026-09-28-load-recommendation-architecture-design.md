# Design — Load recommendation: deterministic load plan + session-start strategy records (draft v2.1)

> **Status: draft v2.1, 2026-09-28 — the four open questions of v2 answered by the owner (§11).** Not planned, not approved for implementation. v1 was reviewed
> by an independent Opus reviewer the same day; the review and each finding's disposition are in
> `2026-09-28-load-recommendation-architecture-review.md`. Amends
> `2026-09-24-load-advisor-design.md` (timing of the analyst, §3; open questions 13.1–13.3) and
> builds on its §14 (strategy memory) and §15 (owner statement 2026-09-28). Decisions are marked
> **[owner]** (stated in the discussion) or **[proposed]**. Companions:
> `2026-09-26-training-history-context-design.md` (history block), roadmap
> `2026-09-24-coach-roadmap.md` Stage 4.

- Governs: what the coach says about the load at the start of every exercise, where that
  number comes from, how progression schemes are defined and chosen, how breaks are handled,
  when strategy is (re)generated.
- Durable specs affected (escalate, never edit silently): `docs/domain/training.spec.md`,
  ADR-0009 (a new fact category), ADR-0013 (one new session-start structured call class), catalog
  schema (tags), `docs/PRODUCT_VISION.md`.
- **Load spec §3 [owner] ("the analyst must see the whole situation") stands:** the analyst runs
  at **session start**, when the gap and its reason, today's plan and today's remarks are all
  known (owner 2026-09-28, §11.1); the per-exercise numbers and today's pre-fatigue are code's at
  request time (§3).

## 1. Goal [owner]

`2026-09-24-load-advisor-design.md` §15, verbatim. In one line: at every exercise the coach
names a load that is **computed against every relevant fact**, cites the past performances it
relies on, argues it in one or two sentences, offers a conservative alternative with its own
reason, follows established sports practice, and says plainly when the facts are not enough.

Owner constraints from the discussion [owner]:

- Reliability over sophistication: no inconsistency between sources, nothing that makes
  debugging harder, no over-engineering.
- The strategic analysis is a **separate reasoning call**, not the in-session coach model.
- Its result guides a weaker in-session model; the coach's strategy carries from workout to
  workout; the user's objections are recorded.
- Progression schemes are **separate frameworks**, stored once, chosen once by the user; the
  coach recommends one when none is chosen. Adding schemes later must not break the logic.
- **A break is an event with a reason, not a number of days** (owner 2026-09-28): the plan
  must not ignore it, the coach finds out why, and the strategy adapts to the circumstances;
  the return is a ladder checked workout by workout. The owner's day counts were illustrative;
  thresholds come from sources.

## 2. Principles [proposed; v2 after review]

1. **One source of the load number: layer 1 in code, at request time.** No model-written load
   survives anywhere the coach can read: the session planner stops emitting `targetWeight`,
   WORKOUT OVERVIEW shows sets × reps only, and `LOAD PLAN` is the only place a load appears.
2. **One source of strategy: a stored record with status and reason** (layer 2), written by a
   separate reasoning call at session start, announced to the user. The in-session coach never
   writes strategy, scheme choice or objections.
3. **Schemes are code, choices are data.** A scheme is a versioned, tested module in a
   registry; the user's choice is an append-only row with provenance.
4. **Same input, same output, for every scheme.** All schemes read one fact package and return
   one result shape.
5. **Insufficient data beats every rule.** A metric below its evidence threshold is absent, not
   estimated.
6. **The load in `LOAD PLAN` is a suggestion with its reason, not a binding value** (amended 2026-09-30,
   owner decision O1, plan `load-plan`): the model decides the load by its judgement of the current
   situation, and states its reason when it departs from the suggestion; both the suggestion and the
   advised load are logged (D7).
7. **Precedence is fixed and printed:** safety rows → active tactic → scheme. The block shows
   which stage produced the number.
8. **Layer 2 never touches a number and never re-evaluates a layer-1 signal.** Phase, trend,
   fatigue and gaps are code's; the record carries a tactic and reason codes only.

## 3. Layer 1 — the load plan (deterministic)

### 3.1 Inputs (existing data)

`session_sets` (set_data; `rpe`; `user_feedback`; `created_at`), `session_exercises`
(`target_sets`, `target_reps`, `user_feedback`, `order_index`), `workout_sessions`
(`completed_at`, `status`, `session_plan_json`), catalog (`exercise_type`, `equipment`,
`complexity`, `exercise_muscle_groups.involvement`), `user_facts` (with `muscle_group`,
`durability`), profile (experience, goal).

To add (§10): set kind, dumbbell convention, session place, reps in reserve, catalog tags,
fact category `break`.

### 3.2 Metrics per exercise (pure functions; unit-tested on fixtures; verified by the owner on
his own history — roadmap R4.2)

| # | Metric | Definition | Threshold |
|---|---|---|---|
| 1 | Data sufficiency | real performances (completed, ≥ 1 working set) in the last 8 weeks and all-time | per metric; below → absent |
| 2 | Reference performance | the newest comparable performance (same rep range, same place when known): working sets, date, age, RPE, **feedback verbatim** | ≥ 1 |
| 3 | Fatigue context of a performance | working sets done earlier in the same session on this exercise's primary and secondary muscles, and minutes since session start; computed for the reference performance **and for today** from set timestamps | always |
| 4 | Working weight | highest load at which every working set hit the scheme's rep range, over the last K performances / 8 weeks — never all-time; among such loads the highest that recurs in ≥ 2 performances wins, the highest overall only when none recurs (load-plan-fixes W-1) | ≥ 2 |
| 5 | e1RM trend | Epley on the best working set per performance, sets ≤ 10 reps only, last 3–5 performances; rising / flat / falling with a tolerance band (≈ ±2.5 %); weeks at current weight; machines low confidence | ≥ 3 |
| 6 | Last-exposure quality | reps vs range; RPE vs the scheme's target RPE; rep drop-off across sets vs the user's own norm | ≥ 1 (norm ≥ 3) |
| 7 | Gap | days since this exercise, since its primary muscles, since any real workout; the gap tier (§5) and the return-ladder step | always |
| 8 | Constraints | `physical_constraint` facts with a `muscle_group` touching the exercise (`short` → growth forbidden; `long_term`/`permanent` → step capped, printed); `equipment` facts printed, never matched | always |
| 9 | Equipment step | default per `exercises.equipment` (bar 2.5, dumbbell 2 per hand, stack 5) until machine instances exist; the candidate is a multiple of the step from the last used load | always |

Pre-U4 legacy sets have no kind: a set below ~60 % of that performance's top load is treated
as a warm-up, printed as "estimated", flagged as a heuristic in the block.

### 3.3 Decision order (fixed; the matching stage is the printed reason)

**Stage A — safety rows (shared, before any scheme):**

| Condition | Candidate | Conservative |
|---|---|---|
| data insufficient | with a loaded reference: its most-used load (one step lower after a break tier), low confidence (load-plan-fixes W-4); without one: no number; after U11: probe per cold-start protocol | one step lower, never ≤ 0 ("no lighter option", W-2); without a reference: none |
| `short` constraint on a primary muscle | ≤ working weight; growth forbidden | skip or substitute |
| gap tier ≥ *return* (§5) | the return ladder's step for this workout | one step lower |
| today's pre-fatigue **materially greater** than the reference performance's (metric 3 delta) | hold; −1 step if the delta exceeds the user's own drop-off norm | −1 step |
| last: below range floor | −1 step | −2 steps |

Fatigue equal to the reference (same order as last time) adds nothing and prints one line.
No flat "48 h" penalty: within-session order effects support like-for-like comparison, not a
reduction.

**Stage B — active tactic** (layer 2, when present): selects a scheme branch (hold / rep
progression only / deload branch / technique-first). Never a number.

**Stage C — scheme** (§4): growth decision inside the rep range; step capped at ≈ 10 % of
the load, otherwise progress by reps; confirming sessions = scheme parameter, default 2
(ACSM / NSCA "2-for-2"); e1RM flat ≥ 3 performances → plateau printed (a variable change is a
tactic, Stage B).

### 3.4 Output — `LOAD PLAN`, one producer, two consumers

```
=== LOAD PLAN: Machine Chest Press ===
reference: 2026-09-25 (3d ago) · 65×10, 65×10, 65×9 · RPE 8 · "last set heavy" · fresh (1st exercise)
today: after 6 working sets on triceps (Dips) · 40 min into the session
metrics: working weight 65 (K=5) · e1RM flat ×2 (±2.5 %) · 5 performances / 8 wk · gap 3 d (rest)
scheme: double progression 8–12, confirm ×2 (chosen by user 2026-09-20)
tactic: none active
decision: Stage A, pre-fatigue delta → hold
recommend: 65 × 10–12 — last set short of the range top; triceps pre-loaded today, bench was fresh last time
conservative: 60 × 12 — secure the full range under triceps fatigue
confidence: medium (machine; 5 performances)
```

- **Block** for today's exercises (planned or started), rendered at every training request,
  a normal block-3 context block (since `prompt-caching` block 3 rides in the current user message, so
  the tail-after-`NOW` placement is moot — plan `load-plan` D1 note 2026-09-30); the e1RM trend prints
  its span rather than being cut to 8 weeks (plan `load-plan` (D) T2(f)). It reuses
  `formatSetData` / `formatDateAge`; it does not become a third history formatter. Whether it
  replaces `EXERCISE HISTORY` in training or drops its `reference:` line is decided in U9a.
- **Tool** `get_load_plan(exerciseId | exerciseName)` returning the same text for an exercise
  not in today's plan (spontaneous sessions, R3.3; "начал с подтягиваний"). Same producer.
- Class applicability as in load spec §8: bodyweight progresses by reps, isometric by hold
  time, cardio by volume/pace; strength-only metrics are absent for them.

### 3.5 Recommendation log (roadmap R4.4) — deterministic trigger

When `log_set` stores the **first working set** of an exercise in a session, the `LOAD PLAN`
entry as rendered for that run is snapshotted: scheme id + version, stage and row, candidate,
conservative, confidence, fatigue context, gap tier, run id. When the exercise completes, what
was done is added. A set reported before any recommendation could be voiced still snapshots
the entry (it records what the plan *would* have said). Calibration data for §7 and later the
athlete profile; not a cache.

## 4. Progression schemes

### 4.1 Definition in code (registry, versioned, like prompt modules)

Each scheme: `id@version`, decision function over the fact package, data requirements,
applicable exercise classes, parameters by goal (rep range or fixed reps, step, confirming
sessions, target RPE where used, deload rule), a one-paragraph user-facing description, a
one-line rule the coach repeats, a source citation (R4.0). Signature for all:
`(facts, goal, params) → { candidate, conservative, reason, confidence, missing[] }`.
Unmet requirements → `missing` and a **printed** fallback line ("scheme X needs RIR; using
double progression"), never a silent branch.

The rep range comes from the scheme parameters only; the planner's `targetReps` is derived
from them. A scheme with fixed reps (linear) overrides the goal's range.

**Contract tests** run every scheme over one fixture set: candidate ≤ working weight + 1 step;
conservative ≤ candidate; a `short` constraint on a primary muscle forbids growth; insufficient
data yields the Stage A answer; the candidate is a multiple of the step from the last load;
no step above the 10 % cap.

Initial set: `double_progression`, `linear_progression`. When reps in reserve is recorded:
`rpe_autoregulation`. Not planned: percentage-based, APRE, DUP. Deload is a shared detector,
not a scheme.

### 4.2 The user's choice (append-only, deterministic provenance) [owner: choose once; coach
recommends if none]

**[owner 2026-09-28, §11.2]** The choice is a **user fact** of a new category
`progression_scheme` with a typed value validated against the registry (scheme **id** only, no
version pin — the version is recorded per log row), written through the existing compaction
pipeline: summariser + model verifier, the user's verbatim quote as evidence. No channel-specific
UI (buttons would tie the flow to Telegram; WhatsApp and others differ), no coach-side tool.
Until the episode is compacted the default applies and the block prints it as "default,
unconfirmed". The newest active fact is the choice; a change is a superseding fact with the new
quote. First version: user-wide scope only; per-exercise overrides come only through layer 2
tactics.

Default when none: from profile (novice + strength → linear; otherwise double). The coach
proposes once, at planning or before the first load recommendation: one sentence, one
alternative, no survey. The coach never writes the choice itself and never changes the scheme;
at a plateau it may propose a change (layer 2 tactic).

Context gets one line: `Progression: double, 8–12, confirm ×2 — chosen by user 2026-09-20`.

## 5. Breaks — tier, reason, return ladder [owner idea; mechanics proposed]

**Tier (code).** From metric 7, with thresholds as sourced parameters (R4.0; detraining
literature puts maximal-strength retention at roughly three weeks). Tiers, names only:
`rest` (normal spacing) · `rest_with_question` (beyond normal spacing, strength retained) ·
`return` (strength largely retained, first workout one step down, confidence one level down)
· `rebuild` (marked loss; working weight and trend marked stale; start clearly below, ladder
of several workouts) · `restart` (history shown as dated reference only; cold-start probes;
confidence low — except Stage A row 1: with a loaded reference the candidate is one step below it, load-plan-fixes W-4). The scheme choice is unaffected by any tier.

**Reason (user, once).** Code cannot know why. In the first conversation after a gap at tier
`rest_with_question` or above, the coach asks once what happened, before any training. The
answer becomes a fact of new category **`break`** (dates, reason class, free text) through the
existing pipeline (compaction + verifier — the user's words only), with `durability = short`
and expiry at the end of the return ladder, so a September illness is not "current" in March.
No answer → reason `unknown`, most conservative branch, no repeated asking.

**Branch (code).** The reason selects the return branch; the tier selects its depth:

| Reason class | Branch |
|---|---|
| illness | one step below the tier's start; a well-being check before the first workout |
| injury | a `physical_constraint` fact on the muscle (growth forbidden until closed); affected exercises questioned already in planning |
| holiday / work / no time | the tier's standard ladder |
| deliberate deload / pause | no reduction at `rest_with_question`; standard ladder above |
| stress / poor sleep | standard ladder plus caution flag for the first week |
| unknown | the tier's ladder, one step lower |

**Population defaults, personal thresholds [owner 2026-09-28, §11.4].** The tier thresholds and
ladder depths are population defaults from sources, carried with low confidence and printed as
"general norm". Three things make them personal, none by guessing:
1. the first workout after a gap is a probe — sets in range with reserve (RPE below the
   scheme's target) skip rungs or end the ladder at once; a miss repeats the rung;
2. code measures the person's own recovery from the log — each (gap days → performance vs the
   pre-gap reference) pair is one observation; with the athlete-profile update rules (load spec
   §5: ≥ 3 observations pointing the same way, ≤ ¼ of the gap per update, revert on
   contradiction, value + confidence + count + date) a personal threshold replaces the norm and
   the block says so ("return threshold: 18 d, personal, 4 observations");
3. health and circumstances enter through the reason class and `physiological_pattern` facts,
   which shift the branch regardless of the numbers.

**Ladder (code, no layer 2).** A counter of real workouts since the gap: "return, workout 2 of
3 — target: back to working weight by the third". Each workout confirms the next rung when the
sets land in range with reserve; a miss repeats the rung. It is printed in `LOAD PLAN` and in
the planning context, and the existing chat time-gap note references the same tier so there
are not two "long time no see" mechanisms. Layer 2 may later choose a different return tactic
with a reason; the ladder itself lives in code.

## 6. Layer 2 — strategy records (session-start reasoning call) [owner shape; mechanics proposed]

A record per **exercise** of today's session, written by a separate structured call with
reasoning (own LLM profile `LLM_PROFILE_ANALYST_*`; model and route chosen at the U12 plan after a
probe — owner 2026-09-28, §11.3), built after enough recommendation-log data exists to judge it
(§9).

Content, numberless by construction:
- `tactic` ∈ closed list: hold · rep_progression · add_step · variable_change · deload ·
  technique_first · return_ladder_alt;
- `reason_codes[]` ∈ closed list (plateau_n_performances, drop_off_high, rpe_drift,
  user_objection, …) which layer 1 renders with its own numbers;
- confidence with a reason code; provenance: `llm_call_id`, newest workout considered, input
  input hash.

No `phase` (code owns it), no conditions (code owns the signals; today's conversation enters
through Principle 6), no prose that could carry a number. Storage: table `exercise_tactics`,
statuses per load spec §14 (active / superseded / rejected, with who-when-why). A muscle-scope
view (load spec §14 [owner]) is deferred until layer 1 computes weekly volume per muscle.

**The user's objection** ("не хочу снижать вес на жиме") is never written by the coach: it is
carried into the next call as input (from the episode summary / fact pipeline), and the call
sets `rejected` with the quote as evidence.

**Trigger — session start, announced [owner 2026-09-28, §11.1].** One call per workout at the
moment today's plan exists: the session proposal in planning, or `start_training` without a plan.
The coach says "готовлю план на сегодня, займёт около минуты", then delivers the result as the next
message (interim/final delivery from U6; before U6, one delayed reply with the typing indicator).
The records are scoped to the session (`workout_session_id`) and serve the whole workout. Why
here and not after the previous workout: at session start the gap and its reason, today's plan
and order, and today's remarks are known; a record written at the previous finish would be stale
by an unknown amount. Input: history and layer-1 facts for today's exercises, the previous
session's records (continuity per load spec §14: continue or supersede with a reason), the
episode summaries (user objections), break and constraint facts.
Mid-session revision only on an explicit cause (the user asks, or reports something new such as
pain): announced the same way, one scope. Nothing runs in the background and nothing runs after
the workout; no fingerprint, no lazy step, no job runner. A failed call is said aloud and the
workout continues on layer 1 alone. An exercise not in today's plan has no record → layer 1
alone, printed.

**One call per workout, not per exercise** [proposed, disputed by the reviewer, kept]:
cross-exercise coherence is why the call exists. Guards: a required object per input exercise
id (id sets must match exactly, else reject and retry once); enums only; a second failure →
no new record, layer 1 continues. No split-by-muscle fallback.

## 7. Prompt side (training vN, session_planning vN)

- Training: rule 1 (feedback → ±%, RPE ≤ 5 → +kg), rule 2 (RPE ≥ 8 → adjust), rule 4b
  ("announce the next exercise with a specific recommendation") and the FIRST MESSAGE RULE all
  point to `LOAD PLAN` / `get_load_plan`; the coach quotes its dated facts, always gives the
  conservative option, says "insufficient data" when the block does, and departs from the
  suggestion by its judgement, stating the reason (Principle 6 as amended by O1).
- Session planning: `propose_session` / `save_workout_plan` no longer carry `targetWeight`;
  after a gap at tier `rest_with_question`+ the coach asks the reason once before proposing.
- Reversible by prompt version (roadmap rule 4).

## 8. Exercise order and off-plan exercises

Plan order is not enforced (today: rows are created lazily on the first set; a set for another
exercise auto-completes the current one). `LOAD PLAN` is keyed by exercise id and recomputed
per request, so an exercise done earlier or later than planned gets its numbers with today's
actual pre-fatigue. Untouched plan items must become `skipped` at finish (BUG-042) so that
"not done" and "replaced" are distinguishable in the log and in layer 2's input.

## 9. Staging (each unit red-first with a live check, roadmap §2)

| Unit | Content | Roadmap |
|---|---|---|
| U4 `set-kind` | set kind on `log_set` + migration, excluded from targets; **dumbbell per-hand convention; session place** (enum/free text) — all additive, accrue from day one; BUG-042 `skipped` at finish | R1.4 (+ data-shape fixes) |
| U9a `load-facts` | R4.0 sources; metrics §3.2 incl. fatigue context and gap tier; `LOAD PLAN` producer showing **facts only**; `get_load_plan`; formatter reuse (folds U2's R1.2 for training). Live check: the owner verifies the numbers on his history | R4.0, R4.2, R4.3 |
| U9b `load-plan` | Stage A/C decision order; scheme registry (double, linear) + contract tests; `progression_scheme` fact category + default by profile; recommendation log; `break` fact category + reason question + return ladder; planner stops writing `targetWeight`; training/planning prompt versions | R4.4 |
| U11 `cold-start` | probe protocol + calibration; movement-pattern tag (R4.1) for transfer seeds | R4.5 |
| U13 `overreach-signal` | in-the-moment check in `log_set` (code only, cheap) | R4.7 |
| U6 `interim-delivery` | interim/final messages on `/api/bot/chat` + bot — needed for "готовлю план… → результат" (roadmap R2.3–R2.4) | R2.3–R2.4 |
| U12 `strategy-records` | layer 2 at session start, after ≥ 3–4 weeks of recommendation-log data; kept only if target-rep hit rate improves over layer 1 | R4.6 |

Pulled ahead of U3/U2/U7 (owner direction 2026-09-28); U6 moves before U12 because the announced session-start call needs the two-message delivery. The progression-model tag is
derived from `exercise_type` + `equipment` in U9a; no catalog tagging blocks U9.

## 10. Data prerequisites (order matters — data accrues from the day they land)

1. Set kind (U4). 2. Dumbbell per hand vs total (U4). 3. Session place (U4; comparisons only
within a place when known; other places shown as separate lines). 4. `break` and `progression_scheme` fact
categories (U9b; ADR-0009 amendment). 5. Reps in reserve on `log_set` (before `rpe_autoregulation`).
6. Machine instances — separate spec (`BACKLOG.md` 2026-09-27); until then machines carry low
confidence and no equipment fact is matched by code.

## 11. Owner decisions 2026-09-28 (the four open questions of v2, answered one at a time)

1. **Analyst timing:** at session start, announced, result as the next message; not after the
   previous workout (stale by an unknown amount), not in the background, not batched. Load spec
   §3 [owner] stands. Mid-session revision only on an explicit cause, announced. (§6)
2. **Scheme choice:** the user's verbatim quote through the existing summariser + model
   verifier, as a typed fact; no channel-specific buttons. (§4.2)
3. **Analyst profile:** a separate LLM profile; the model and route are decided at the U12 plan.
   (§6)
4. **Gap thresholds and ladder lengths:** from R4.0 sources into one table with citations and a
   conservative margin, reviewed by the owner once before they become named parameters in
   code; population defaults only — personal thresholds are measured from the log with the
   athlete-profile update rules, never guessed. (§5)

## 12. Risks

- Two layers are still two places to look when a number is wrong: mitigated by the printed
  stage/row/tactic and the run log carrying the rendered block.
- Layer 1 alone may satisfy §15 for a regular trainee; U12 is judged on the log, not assumed.
- RPE may be sparse in the journal; measure fill rate before any row depends on it.
- The sources may not support a threshold as drafted; every threshold is a parameter set from
  R4.0, none is a constant.
