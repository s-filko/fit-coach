# Design — Load advisor (draft)

> **Status: draft from the 2026-09-24 owner brainstorm.** Not planned, not approved for
> implementation. Decisions are marked **[owner]** (stated or confirmed by the owner) or
> **[proposed]** (the orchestrator's proposal, not yet confirmed). Open questions are in
> section 12. Companion spec: `2026-09-24-session-planning-redesign-design.md` (its
> governing principle, section 1, applies here).

- Governs: the per-exercise load recommendation ("doing bench press — what weight?"), the
  athlete profile behind it, overreach detection, cold start
- Durable specs affected (escalate, never edit silently): `docs/domain/training.spec.md`,
  ADR-0013 (a new sub-agent call class), the exercise catalog schema, `docs/PRODUCT_VISION.md`
- Replaces: `refactor-p6-progress-and-drafts` Task 8 (per-exercise history as raw sets)

## 1. Goal [owner]

This is the core value of the product. When the user starts an exercise, the coach gives a
load recommendation that is scientifically grounded, explained, and motivating:

- it says what it relies on (last time, the trend, recovery) and why exactly +2.5 kg, or why
  hold;
- it teaches the user to choose the weight themselves;
- it keeps the user progressing — no stagnation — but never "out of thin air";
- over time it tries different strategies (change a variable, a small step back, a deload)
  to break a plateau.

## 2. Standard practice the framework draws on [proposed; to be sourced]

Progressive overload; double progression (work in a rep range, add weight when every set
reaches the top); RPE/RIR autoregulation (RPE = 10 − reps in reserve); estimated 1RM (e.g.
Epley) to compare performances across rep ranges — reliable only up to ~10–12 reps;
plateau = no e1RM growth over ≥3 exposures → change a variable or deload (~−40–50 % volume
or ~−10 % load for a week). **The spec must cite established sources for every rule** —
neither the owner nor the orchestrator has coaching credentials.

## 3. Architecture — a delegated analyst [owner shape; mechanics proposed]

- **[owner]** Not the general coach prompt: a dedicated analyst the coach delegates to, with
  a step-by-step framework (assess each point, then combine), and with the conclusions of
  its past assessments available so it self-corrects. It must see the whole situation, not
  the exercise in isolation (e.g. what was already trained today).
- **[proposed]** The training coach calls a tool `recommend_load(exerciseId)`. The tool
  builds a fact package in code and makes a **separate LLM call** with its own framework
  prompt; the output is structured JSON with a required field per framework step (a weak
  model cannot skip a step). The coach presents the result in its own words.
- Precedent: the summariser already is a separate structured LLM call (own profile,
  `json_object`, versioned prompt, audit trail). The interim message from the companion spec
  covers the extra latency ("checking your bench press trend…").
- **[proposed]** Division of labour: **code computes facts and a rule-based candidate; the
  analyst adapts it to conversational context and explains.** A deviation from the candidate
  must be justified in the output.

## 4. Framework steps [proposed draft]

| # | Step | Computed by code | Judged by the analyst |
|---|---|---|---|
| 0 | Applicability & data sufficiency | exercise class, which metrics apply, evidence per metric (section 7) | — (code decides; n/a metrics are not sent) |
| 1 | Trend | e1RM over the last 3–5 exposures: rising / flat for N / falling; weeks at the current weight | phase: growth, plateau, decline |
| 2 | Last exposure quality | reps vs target range, RPE, feedback | was there reserve, did form hold |
| 3 | Recovery & today's load | days since the exercise and its muscles; **what was trained today on the same muscles and synergists** | how fresh the muscle is now |
| 4 | Conversational context | fact constraints | sleep, pain, time, mood |
| 5 | Overreach check (section 6) | overreach signals | was the last load "not yours" |
| 6 | Past recommendations | last 2–3 "recommended → done" pairs | calibration: am I too conservative / aggressive |
| 7 | Decision | equipment weight step | increase / hold / decrease / deload / change variable; load, rep target, "how to check yourself" |

Owner example corrected for the record: after chest the triceps is pre-fatigued (all
presses); the biceps after back (pulls). The principle — never assess in isolation — holds.

## 5. Athlete profile [owner concept; parameters proposed]

- **[owner]** General formulas have personal variables: some people progress faster, some
  fatigue faster but are strong, some are enduring but weaker. The system needs a long-term
  memory of these variables with a strategy for filling them, and a correction model:
  **small steps, confirmed by repeated evidence, protected against breaking.**
- **[proposed]** Three levels, each falling back to the level above when data is thin
  (exercise → movement pattern / muscle group → person → population prior):
  - **Person:** training age, systemic recovery, volume tolerance, self-assessment accuracy
    (reported RPE vs what followed), regularity.
  - **Pattern / muscle group:** progression rate (legs and compounds faster, isolation
    slower), fatigability (muscles differ; calves tend to be enduring), per-group recovery.
  - **Exercise:** working weight, e1RM, last performance, response to rep ranges.
- **[proposed]** Measured from the log, no tests: progression rate = e1RM trend; fatigability
  = rep drop-off at a fixed load (12/12/11 vs 12/9/7); strength-vs-endurance = reps at a
  given % of e1RM; recovery = performance vs days since last exposure; advisor calibration =
  hit rate of recommendations.
- **[proposed]** Numeric parameters are computed by **code** from the log, never by the LLM
  from impressions. The analyst may keep observations ("elbow complains on close-grip
  press") as a separate, labelled layer.
- **[proposed] Update rules:** start from conservative norms (experience, sex, age, goal
  from registration) with low confidence; change a parameter only after ≥3 consecutive
  observations pointing the same way; move only part of the way (e.g. ≤¼ of the gap) per
  update; revert when later evidence contradicts; store value, confidence, evidence count,
  date. Same philosophy as user facts (confirmation counts, "may be outdated").
- **[proposed] Filling strategy is passive:** parameters appear as the log grows. The only
  active step is what a human coach does anyway — asking "how many more could you have
  done?" after a hard set.

## 6. Conservative progression and presentation [owner]

- Slow, steady growth is acceptable and often better than the maximum possible rate: safer
  for health, and no sharp ceiling after a fast start. **[proposed]** The recommendation sits
  below the measured progression rate, with a margin.
- Presentation is mandatory: anchor on personal progress ("+10 kg on bench in 6 weeks"),
  present conservatism as a deliberate strategy, keep it motivating. A coach-prompt rule; the
  analyst supplies the facts for the story.

## 7. Overreach ("ego lifting") detection [owner]

- **[owner]** Detect loads that are not the user's — form breakdown, one set of 5 instead of
  3×12, a weight above the working weight at the limit — i.e. chasing the number instead of
  growth, technique and strategy; correct it with facts: "you took a load that isn't yours
  yet — let's do X today / next time".
- **[proposed] Working weight** (profile, per exercise) = the highest load at which every set
  landed in the target rep range.
- **[proposed] Signals (code):** rep collapse beyond the user's *own* fatigability norm;
  reps below the range floor; fewer sets than planned; load above the recommendation; a jump
  faster than the personal progression rate; heavier but lower e1RM/volume. **Signals
  (analyst):** the user's words ("barely", "used my back", "lower back", "at the limit").
- Strongest argument to the user: **volume** — 70×5 = 350 kg vs 3×11 at 60 = 1980 kg.
- **[proposed] Two moments:** in the moment (`log_set` checks the set against the target and
  working weight and flags its result, like the existing constraint advisory; the coach
  suggests the next sets lighter) and next time (the analyst's step 5 → back to working
  weight, typically −10–20 %, plus a path: "70 in a month at +2.5/week").
- **[proposed] Not a nag:** a heavy set is not always ego (deliberate top set, max test;
  low reps are normal for a strength goal) — consider the goal, ask when unclear; one remark,
  then respect the choice; raise again only if the pattern repeats. Tone: facts and a path,
  no shame. Technique is never asserted (no video) — only asked about.

## 8. Applicability by exercise class [owner concern; table proposed]

- **[owner]** Not every exercise supports this; data may be missing or the method may not
  apply. The model must not apply it where it does not work.
- **[proposed]** Applicability is decided **in code**: the fact package is shaped by the
  exercise's progression model, so inapplicable metrics are absent, not merely discouraged.

| Class (from `exercise_type`, `equipment`, `complexity`) | Progress by | Not applicable |
|---|---|---|
| Strength, external load | load within a rep range | — (full model) |
| Bodyweight (`functional_reps`) | reps, then added load or a harder variant | load-based e1RM |
| Isometric | hold time | load, reps, load overreach |
| Cardio (`cardio_distance/duration`) | pace, time, heart rate | everything strength; separate endurance model |
| Interval | rounds, work/rest | everything strength |
| High `complexity` (snatch, clean) | technique first, then load, cautiously | e1RM formulas, aggressive progression |

- **[proposed] Data sufficiency gate:** each metric has an evidence threshold (e.g. ≥3
  exposures in 8 weeks); below it code sends "insufficient data", and the analyst's output
  has an "applicable / insufficient / n/a" field per step — it must say "not much history on
  this one yet, let's start with…" instead of performing analysis.

## 9. Cold start and confidence [owner]

- **[owner]** A recommended load always exists. First time ever: a strategy — "take a load
  you could do 10 times, tell me how it went"; "did 10, could do 10 more" → add; "only 2" →
  drop; adjust immediately. The result is a **draft working weight with explicit, low
  confidence**; confidence and analysis depth grow as data accumulates.
- **[proposed] Starting number** via the level fallback: a similar exercise of the same
  pattern (heavily discounted) → novice norms relative to bodyweight/sex → empty bar /
  lightest stack. Always err low: a light probe costs nothing, a heavy one is dangerous.
  High-complexity lifts: always light and technique-first the first time.
- **[proposed] Calibration:** from "did N, could do M more", code estimates e1RM (N+M = reps
  to failure) and the load for the target range on the next set; 2–3 sets converge. Analogous
  probes for other classes (plank: hold while comfortable; cardio: conversational pace).
- **[proposed] Confidence is derived, not guessed:**

| Level | When | How the coach presents |
|---|---|---|
| none | no measurement | probe set per the protocol |
| low | 1–2 measurements | "try N, tell me after the first set" — adjusts |
| medium | ≥3 consistent measurements | recommendation with a short reason; overreach check enabled |
| high | stable, recent history | full analysis: trend, rate, progression and deload decisions |

- **[proposed] Confidence decays:** after a break (e.g. 3 weeks) it drops a level and the
  load estimate shifts down — "we'll start lighter after your holiday". The analyst receives
  the level with its reason ("low: 1 measurement, 3 weeks ago").

## 10. Similar exercises and transfer [owner question; answer proposed]

- **[owner]** Flat vs incline bench, cable vs lever lat pulldown: different exercises, much in
  common — the model should be able to recommend indirectly.
- **[proposed]** Two different similarities, never conflated: **by muscles** (exists in the
  catalog — for fatigue/recovery only, useless for load transfer) and **by movement pattern**
  (missing — for load transfer). Embeddings are unsuitable (textual, not mechanical
  similarity).
- What transfers reliably: relative effort, progression rate, rep-range response. Absolute kg
  do not (resistance curves and stacks differ). Transfer only seeds the cold-start probe, at
  low confidence.
- A ~15-value movement-pattern tag in the catalog (horizontal press, incline press, vertical
  press, vertical pull, horizontal pull, squat, hinge, lunge, elbow flexion, elbow
  extension, …), tagged once (LLM-assisted, human-reviewed), together with the
  progression-model tag. Rough between-variant ratios only as starting guesses; **personal
  ratios** (your incline ≈ 85 % of your flat) learned into the profile once both are done.
- Out of scope: universal conversion tables, biomechanical machine models, guessing kg
  without a probe.

## 11. Data prerequisites

Fix before the advisor relies on history, or the accumulated log is spoiled:

1. **Warm-up vs working sets are not distinguished** — breaks drop-off analysis and working
   weight. Needs a set-kind marker.
2. **Dumbbells: per hand or total** — ambiguous; trends will jump.
3. **Machines differ between gyms** — "stack 50" is not comparable across gyms.
4. **No explicit progression-model / movement-pattern tags** in the catalog.
5. **Reps in reserve** — `log_set` has `rpe` 1–10 only; the coach asks in plain words, code
   maps RIR → RPE.
6. **Target rep range** exists in templates/proposals (`targetReps`); spontaneous sessions
   need a default from the user's goal.
7. **Equipment weight step** (bar 2.5 kg, dumbbells often 2 kg, stack 5 kg) — a user/gym fact.
8. **Recommendation log** — a new table of "recommended → done" pairs, written from day one
   even before the analyst reads it (data accrues for free).

## 12. Staging [proposed]

The executable order (steps R4.x, units U9–U14) lives in `2026-09-24-coach-roadmap.md`;
this section only states the design intent.


1. **Core:** facts in code (incl. today's muscle load), analyst with steps 0–4 and 7,
   structured output, cold-start protocol, conservative norms, recommendation log written.
2. **Self-correction and tactics:** steps 5–6, athlete-profile parameters (progression rate
   and fatigability first), strategy memory (plateau → change variable → deload), confidence
   decay.
3. **Quality:** eval set from real sessions — recommendation accuracy (target-rep hit rate)
   and, separately, explanation quality.

Not at the start: a numeric muscle-fatigue model, a periodisation engine, unverifiable
scores.

## 13. Open questions

1. When the analyst runs: at the start of every exercise, cached for the exercise
   (recommended — a human coach names the load unprompted), or only on request.
2. Code candidate + analyst adapts (recommended) vs code gives facts only and the analyst
   decides.
3. Where the strategy memory lives (per exercise, per pattern, per muscle group).
4. Sources for the progression rules (section 2) — a research task before the spec is final.
