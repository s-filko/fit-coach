# Load Plan Fixes — zero-kg ladder, isometric holds, no-record with a reference (U9b follow-up) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans and
> test-driven-development. Red tests first (from the replay data below), then the code.

- Status: in progress
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

## Scope extension — cautiously optimistic progression (owner-approved 2026-10-01, after the GLM replay)

The local GLM replay of the merged items 1–3 (AC-LPF-4 run, `6eb7ce01`) showed the W-1 recurring-load rule pulling the
45° Leg Press working weight back to 110 kg (history 110 ×3 → 110,110,120,120 → 110,130,130,135; 120 occurred in one
session only), and the block never proposes growth for the owner's 12–15-rep sets (report U7: `e1rmTrend missing —
cannot count confirming sessions`). Owner, 2026-10-01: «важно строить осторожно оптимистические рекомендации на объемах и
силе. т.е. если прошлый раз я жал 3 подхода по 15 на 50, тренер может сказать, если отдохнул за 4 дня то можно
попробовать взять 55 и сделать 8-10 повторов». Items:

4. **Working weight follows the newest session.** Working weight = max(highest recurring load (W-1), the newest
   performance's highest load at which every working set reached the rep floor). Lateral raise stays 2.5 kg (its 5 kg set
   is in the oldest session); leg press → 120 after 09-21, ≥ 130 after 09-27.
5. **Growth rule, from the literature (owner-approved 2026-10-01; the 50×15 → 55 case is an example, not a formula).**
   Sources: NSCA "2-for-2" (Essentials of Strength Training and Conditioning — ≥ 2 reps above the target on the last set in
   two consecutive sessions → increase; increments ≈ 1–4.5 kg upper / 2.5–7 kg lower ≈ one equipment step); APRE (Mann et
   al. 2010, JSCR — the next session's load is set from the reps achieved on the final set; more surplus → larger
   increase); RIR-based RPE (Helms et al. 2018, Front. Physiol. — ≈ 4 % load per RPE point). **Rejected:** Epley
   prediction above ~10 reps (Reynolds et al. 2006, JSCR — accuracy degrades above 10 reps, equations underestimate leg
   press) and fixed %1RM↔reps tables across exercises (leg press ≈ 19 vs bench ≈ 14 reps at 70 % 1RM) — `E1RM_MAX_REPS`
   stays 10 and no load is predicted by formula. Rule, judged on the sets AT the working weight (last such set = "last
   set"):
   - **one-session growth:** last set ≥ range top + 3 reps, its RPE ≤ 8 or absent, recovered (gap tier `rest`, no `short`
     constraint on a primary muscle, no material pre-fatigue today) → recommend +1 step with the range reps;
     conservative = the working weight; confidence ≤ medium; never more than one step whatever the surplus;
   - **2-for-2:** last set ≥ range top + 2 in the two newest consecutive performances at the working weight → +1 step;
     this replaces "e1rmTrend missing — cannot count confirming sessions" as the confirmation path for rep data (U7);
   - otherwise hold, and state what is missing (item 7).
6. **A badly chosen first set does not distort the decision (owner-approved 2026-10-01).**
   - Each load is judged on its own sets: a set at another load (a too-heavy opener, 135 × 6 before 130 × 12 ×3) is a
     probe — it does not make the performance `below floor` and does not trigger a step down for the working weight
     (today `repsVsRange` takes the weakest set at any load).
   - **Uneven performance:** drop-off at the working weight (first − last set reps) far above the user's usual
     (`dropOff.usual`, threshold set by the worker as a (D) — e.g. > usual + 3, or > 4 with no norm) → the performance
     counts neither for growth nor for a step down; hold, and the reason says the opener was too heavy / too light.
   - **In-session hint (APRE set-to-set):** v12 tells the coach that when a working set lands clearly outside the range
     (≥ 3 reps above the top, or below the floor), it suggests one step up / down for the NEXT set.
7. **Expectation management (owner 2026-10-01: «тренер пояснял выбор текущего веса и также пояснял план, если вес может
   казаться ниже чем хочется, почему такой и когда мы увеличим»).**
   - Every LOAD PLAN row carries a `next step:` line naming the concrete condition for the next increase (2-for-2 one
     session short: "+2 reps on the last set once more → +1 step"; return ladder: "2 more workouts → back to 130"; uneven:
     "even sets at 120 → growth"; after a step down: "back to 65 when …").
   - Training v12 (unreleased; v11 untouched): when giving a load, the coach briefly says why (from the block reason) and,
     when the recommendation is below the user's recent best, says plainly why and when it will rise (`next step:`);
     cautiously optimistic — offers a block-proposed step with the working weight as fallback, mentions volume progress
     as encouragement, never pressures, never promises what the block does not offer.
8. **Volume as context, not a decision input.** The block prints volume load (Σ reps × kg of working sets) of the newest
   performance vs the previous one ("volume +15 % vs last"); no decision reads it.

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
| AC-LPF-5 | Leg-press history (110 ×3 → 110,110,120,120) gives working weight 120, not 110; lateral raise stays 2.5 kg | metrics unit tests on the owner-history fixture |
| AC-LPF-6 | 2-for-2: last set ≥ top+2 in two consecutive performances at the working weight → +1 step; one only → hold with the `next step:` condition; `E1RM_MAX_REPS` unchanged | decide unit tests on owner-history fixtures |
| AC-LPF-7 | One-session growth: last set ≥ top+3, RPE ≤ 8/absent, recovered → +1 step, conservative = working weight, never > 1 step; RPE 9, short constraint, pre-fatigue or gap ≥ return → no jump. Opener at another load does not cause below-floor; uneven drop-off → hold with the reason | decide + metrics unit tests |
| AC-LPF-8 | Every row prints `next step:`; v12 rules: explain the load, explain a below-recent-best load and when it rises, offer a block step with fallback, in-session one-step hint when a set lands clearly outside the range | block v2 + v12 unit tests; GLM replay transcript |
| AC-LPF-9 | Block prints volume of the newest vs previous performance; no decision changes when only volume changes | block + decide unit tests |
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

- (D) W-1: item 1 root cause — `qualifyingLoad` took the HIGHEST load that cleared the rep floor in any of the last K=5
  performances; the owner's 2026-09-10 Lateral Raise Machine session had one set 5 kg × 10 (then 2.5 kg × 10), so that
  single set beat four sessions at 2.5 kg. Fix: among the loads that recur in ≥ 2 of the performances the highest wins;
  when nothing recurs the old "highest" rule applies (pyramids). This refines the design §3.2 metric-4 wording
  ("highest load at which every set hit the range") — the orchestrator ratifies / updates the spec line. Observation, not
  changed: `classifySets` drops a legacy NULL set < 60 % of the top weight as a warm-up even when it comes AFTER the top
  set (2.5 after 5 here); not the cause of C1, left alone.
- (D) W-2: floor = `stepDown` returns the load itself when one step would reach ≤ 0 ("no lighter option"); the block prints
  `— no lighter option` instead of a lower conservative. Applies to every step-down (all rows + scheme hold).
- (D) W-3: item 2 lives in `TrainingService.logSetWithContext` (next to the per-hand shaping — the exercise row is resolved there,
  for a name-only call too), not in the tool: a `cardio_duration` set on an `isometric` exercise is re-keyed to
  `{type:'isometric', duration}`; cardio exercises unchanged. A reps-only call on an isometric exercise is NOT converted
  (seconds vs reps is ambiguous) — the tool description now says hold time = `durationSeconds`, never reps. Tool-surface
  snapshot updated for the new description.
- (D) W-4: item 3 — `decide()` (Stage A `insufficient_data`) with a reference that carried a load: candidate = the reference's
  most-used working load (heavier on a tie), conservative = one step down (floored, W-2), confidence low, reason =
  the Metric's own absent text + "last performance X kg N d ago used as the reference". After a break tier
  (return / rebuild / restart) the candidate is one step below the reference and the tier is named in the reason.
  No reference, or a reference with no loaded set (bodyweight): no number, no conservative; `NO_RECORD_REASON` is now
  `no record, no reference load` (the old "conservative start" wording invited the coach to invent one); the block prints
  `recommend: no number — …` / `conservative: no conservative option — …`.
- (D) W-5: training prompt v12 = v11 derived by three exact-text replacements (rule 1 ×2 lines, rule 4b; a missing needle throws),
  v11 file untouched; `training.spec.ts` selects v12 instead of v11 with `LOAD_PLAN_PLANNER_REBIND`; v11 stays registered.
- (D) O-1 (orchestrator): dev data correction for isometric sets — **not run; owner-gated, DB backup first.** From the worker's
  read of the owner's history export: 2026-09-21 lower_a Plank 2 × `{reps:45, functional_reps}` and Side Plank 2 ×
  `{reps:30, functional_reps}` → `{type:'isometric', duration:45 / 30}`; stored as `cardio_duration` → isometric:
  2026-09-20 upper_a_press Plank 2×45, 2026-09-27 lower_a Plank 2×45 + Side Plank 2×30, 2026-09-29 upper_b Plank 2×45
  (verify on dev — some may be replay artefacts).
- (D) W-6: review fixes — every reason/outcome that claims a step now checks the floor: `pre_fatigue`, `below_floor`, the gap-ladder
  branch notes (unknown / illness) and the insufficient-data break-tier line say "no lighter option — the load holds" when the
  floor stopped the step; the insufficient-data outcome is `reference load, no lighter option` in that case. Unchanged on purpose:
  the restart cold start (`gap_restart`, no reference-less number) still prints outcome `conservative start`.
- (D) W-7: unknown equipment step on the insufficient-data path adds `equipmentStep` to `missing` and the note
  "equipmentStep missing — steps cannot be computed"; the block prints "no lighter option" only when the step is known.
  No-reference outcome is `no number`. v12 rule 1 now says a `no lighter option` conservative line means the load is the
  lightest — never present it as a variant (v11 untouched).
- (D) W-8: item 4 — `qualifyingLoad` (metrics.ts) returns the larger of (a) the W-1 reading (highest recurring load that reached
  the floor; nothing recurs → highest) and (b) the highest load of the NEWEST performance (newest usable one inside the K = 5
  window) at which every set AT THAT LOAD reached the floor. "Every working set" is read per load, as W-1 already does, not per
  performance: a last heavy single set of 3 reps must not discard the whole session (per-performance reading would). A heavier
  load of an older session never wins unless it recurs. Owner history: leg press 120 after 09-21, 135 after 09-27 (a single set
  at 135 ×12 — the rule as ordered; recorded so the owner can see it), lateral raise 2.5. Decisions on the new working weight
  are unchanged (e.g. 09-21 now prints `recommend: 120 kg` — growth rules 5–7 are on hold, see the scope change below).
- (D) W-9: item 8 — new load metric 10 `volume` (`computeVolume`, `LoadFacts.volume`, pure): Σ reps × load over the working sets
  (warm-ups out by D7, per-hand/total mixes left out as in metrics 4–5) of the newest vs the previous real performance with a
  load, no 56-day window (ages are printed). The block prints `volume: +16 % vs last (5520 vs 4760 kg×reps, working sets;
  4 d and 9 d ago)` after the confidence line; absent / no previous volume → no line. `decide()` and the schemes never read
  the field (unit tests: identical decision with absent / large up / large down volume).
- (D) W-10 (orchestrator scope change, owner 2026-10-01): items 5, 6, 7 (e1RM rep cap 10 → 15, rep-history confirmation, one-session
  jump, v12 wording) are **on hold** — to be redefined from the strength-training literature. The worker had started them and
  reverted all of it uncommitted: `E1RM_MAX_REPS` stays 10, confirmation logic and training v12 are unchanged. AC-LPF-6 and
  AC-LPF-7 and AC-LPF-8 are open; items 4 and 8 (AC-LPF-5, AC-LPF-9) are implemented.
- (D) W-11: items 5 (rule rewritten in 451af616) integrated into the existing machinery, no parallel ladder. 2-for-2 lives in the
  scheme (`decideProgression` with `ProgressionRule.surplusReps`, set by double progression only): `LoadFacts.repHistory`
  (new metric 4b: per performance of the working-weight set, the reps at the working weight and the RPE of the last such set;
  a set at another load is not in it) → the last set must be ≥ range top + 2 in `confirmSessions` (2) consecutive performances,
  else hold with "confirmation k of 2". A performance at another load breaks the run. Linear progression and facts without a
  rep history keep the old last-exposure + e1RM-trend confirmation (so "e1rmTrend missing — cannot count confirming sessions"
  now appears only when BOTH sources are missing). One-session growth is a Stage C override in `decide()` (row `early_growth`,
  label "one-session growth"): newest performance's last set ≥ top + 3, its RPE ≤ 8 or absent, gap tier `rest`, step within the
  10 % cap, range schemes only; it runs only after Stage A found nothing, so a short constraint (any muscle of the exercise —
  stricter than "primary"), a return/rebuild/restart gap, material pre-fatigue (≥ 3 extra working sets, the existing row) and an
  uneven performance never reach it. Conservative = the working weight, confidence capped at medium, never > 1 step. Parameters
  with their sources are in `schemes/params.ts` (`TWO_FOR_TWO_SURPLUS` NSCA, `ONE_SESSION_SURPLUS` APRE-inspired, `ONE_SESSION_MAX_RPE`
  RIR-RPE). `E1RM_MAX_REPS` stays 10; no load is predicted by formula (the first draft's Epley check was dropped).
- (D) W-12: item 6 — `computeLastExposure` takes the working weight: `repsVsRange` and `dropOff` are judged on the sets AT that load
  (a probe at another load never reads "below floor"); the usual drop-off is the median over earlier performances that used the
  same load; with no set at the working weight in the reference it falls back to the old top-load reading. **Uneven threshold:**
  drop-off (first − last set reps at the working weight) > usual + 3 (`UNEVEN_ABOVE_USUAL`), or > 4 with no norm
  (`UNEVEN_WITHOUT_NORM`) → Stage A row `uneven_performance` (after pre-fatigue, before below floor): hold the working weight,
  conservative one step lower, reason "reps fell by N from the first to the last set (usual U) — the opening set was probably
  too light for this load; the performance counts neither for growth nor for a step down". Only a FALL is "uneven" (rising reps
  after a weak opener are the benign case the owner described as warm-up).
- (D) W-13: observation, not changed — the reference (like-for-like pick, D6) can be an older performance than the newest one
  (the lateral raise 2026-09-25 session has a 15-rep top set, outside range 10–12 ± 2, so the 09-20 session is the reference and
  its 8-rep set triggers "below floor"). Below floor and uneven judge the reference; the growth rules judge the newest performance
  at the working weight. Proposal for the owner: judge the safety rows on the newest performance at the working weight too.
- (D) W-14: item 7 — every `Decision` and `SchemeOutput` carries `next: NextStep` (domain data: growth / after_growth / reps_only /
  ladder / uneven / step_down / constraint / pre_fatigue / insufficient / no_number / hold); the words live in block v2
  (`nextStepText`), printed as `next step: …` after `conservative:` on every strength row. Examples: "last set at 120 kg ≥ 14 reps in
  2 workouts in a row (or ≥ 15 reps once at RPE ≤ 8, recovered) → +1 step (125 kg)", "1 more workout → back to 130 kg",
  "back to 65 kg when the sets at 60 kg reach 8+ reps", "log this exercise once — that performance becomes the reference".
  A hold from the old path prints the reason's own cause as the next step (nothing invented).
- (D) W-15: training v12 (still unreleased) gets two added lines under rule 1 — "Explain the load" (why, `next step:`, why a
  below-recent-best load is lower and when it rises, cautious optimism with the conservative/working weight as fallback, never
  pressure or invent a step, volume as encouragement) and "In-session hint" (a set ≥ 3 reps above the top or below the floor →
  one step up/down for the NEXT set only); line-diff test now expects 5 added lines. v11 untouched.
- (D) W-16: indirect working-weight estimate (item 4 addition, owner-approved): working weight = max(item-4 value, estimate), also when
  no load reached the floor. Estimate = Epley e1RM of the newest performance's loaded working sets with reps ≤ 10
  (`E1RM_MAX_REPS` stays 10), converted to the load for the range MIN reps (e1RM / (1 + min/30)), rounded DOWN to the equipment
  step (epsilon 1e-6 so an exact grid value stays); unknown step (bodyweight/none) → no estimate. **Which set:** the brief's
  "heaviest working set" cannot give the owner case 60×6, 55×7, 45×12 → 50 (60×6 would give 55), so the LOWEST e1RM of the sets
  ≤ 10 reps is read (cautious; 55×7 → 50, 55×8 → 55; the opener never lifts it) — asked of the orchestrator, no answer by the
  time of the commit; revisit if a different rule is wanted. `WorkingWeightFact.estimatedFrom {weight, reps}`; the metrics line
  prints "(2 performances / 8 wk, estimated from 55×7)". Stage A rows still apply on top, except below floor: an estimated
  weight is itself the answer to the below-floor performance, so it is not stepped down again; the hold reason is "working weight
  estimated from 55×7 (short of the rep floor at the heavier load) — hold", next step `estimated` ("sets at 50 kg reaching 8+ reps
  confirm it, then the growth rule applies"), confidence ≤ medium. **Gate added (deviation from the brief's bare max):** the
  estimate applies only when its source set fell SHORT of the floor (reps < range min). Without it 80×10 for 8–12 was
  "estimated" up to 82.5 kg — above anything the user demonstrated (caught by four scenario tests). The owner cases are unchanged.

## Review

### Run 1 — 2026-10-01 — blocked (R1 0 / R2 0 / R3 2 / R4 3 blocking); run 2 (R3, R4 re-run) — clean

**Blocking**

- R3 | `docs/superpowers/plans/load-plan-fixes.md:48-50` | SUPERPOWERS_INTEGRATION rules of engagement rule 2 — the plan's
  verification commands have no recorded evidence (DB-backed `test:integration` / `test:scenarios` are the only runs of the
  scenario proofs for AC-LPF-1/2/3). **Closing:** evidence recorded below (§ Verification evidence).
- R3 | `docs/superpowers/plans/load-plan-fixes.md:44` | AC-LPF-4 — the GLM replay re-run has no result. **Deferred:** the
  owner's order puts the replay after the dev deploy; owner = orchestrator, command =
  `data/replay-2026-10-01/src/run.ts` (local `glm-5.3-flash` only), result recorded in this plan after deploy.
- R4 | `docs/domain/training.spec.md:36` | SUPERPOWERS_INTEGRATION rule 7 (+ rule 3 escalation) — BR-TRAINING-036 still says
  LOAD PLAN names "a lighter `conservative:`"; after W-2 conservative can equal recommend ("no lighter option"), after W-4 no
  load is named without a reference, and Stage A insufficient data now gives the reference load. Owner-level: escalated.
- R4 | `apps/server/src/domain/training/services/training.service.ts:437-440` | SUPERPOWERS_INTEGRATION rule 1 — the new rule
  (`cardio_duration` on an `isometric` exercise stored as `{type:'isometric', duration}`; reps-only not converted, W-3) has
  no BR-* ID. Owner-level: escalated.
- R4 | `docs/ARCHITECTURE.md:182-183` | SUPERPOWERS_INTEGRATION rule 7 — still names `training/v11.ts` as the prompt selected
  under the load-plan flags; `v12.ts` missing from the tree listing. Factual reconciliation.

**Advisory** (not fixed on this branch unless noted)

- R1+R2 | `training.service.ts:433` — `applyPerHand` now has two reasons to change (per-hand shaping and isometric re-key); name
  no longer describes it.
- R1+R2 | `decide.ts:246` — `referenceLoad()` derives a load fact inside the decision module and repeats `loadOf`'s
  loaded-set rule (drops `perHand`); belongs next to Metric 2 in `load-facts` as a `ReferenceFact` field.
- R1+R2 | `decide.ts:271/279` — `insufficientData()` / `afterBreak` is a second "after a break, one step below" ladder beside
  `gap-tier.ts` `LADDER`; the two disagree (restart with a working weight → no number, without one → a number).
- R2 | `decide.ts:285` — `insufficientData` assembles the Decision by hand instead of `finish()`; the `equipmentStep missing`
  note is lost, so `step === null` prints "no lighter option" without saying why.
- R1 | `training-load-plan.v2.ts:137` — the renderer infers "floored" from `candidate.load === conservative.load`; also true
  when the step is unknown; an explicit field would state it.
- R1 | `v12.ts:30` — v12 is derived at render time by exact-text replacement on v11; a missing needle throws in a live turn,
  not at load/build.
- R2 | `prompts/phases/training/index.ts:60` — `TRAINING_PROMPT_V11` wrapper has no production call site; third copy of the
  `requiredSections` literal.
- R2 | `tests/integration/scenarios/load-plan-fixes.integration.test.ts:34` — `seedWorkout` / `loadPlanOf` are a third copy
  of scenario helpers; move to `tests/helpers`.
- R3 | `metrics.ts:333-345` — the recurring-load rule ignores recency: a first session at a heavier load (60, 60, then 65 all
  in range) keeps working weight at 60 until 65 recurs; no test for "latest session progressed".
- R3 | `decide.ts:278-282` — the insufficient-data-with-reference path ignores break reason (unknown/illness extra step) and
  gives restart a number where design §3.3/§5 say no number; for gaps > 56 d this path is now the usual one.
- R3 | `decide.ts:246-259` — `referenceLoad` ignores `perHand`; a mixed per-hand/total dumbbell reference can be printed as
  per-hand.
- R3 | `decide.ts:224-239` — when the floor stops a step-down, `pre_fatigue` / `below_floor` reasons still say "one step down"
  while the outcome says `hold`.
- R3 | `training-load-plan.v2.ts:172` — floored rows print `conservative: 2.5 kg × … — no lighter option` while v12 says "show
  the conservative option whenever the block gives one" (U2 pattern); the no-reference case still prints
  `decision: … → conservative start`.
- R3 | `training.service.ts:436-439` — a reps-only plank is still stored as `functional_reps` (W-3, deliberate); no test pins it.
- R4 | `docs/BUGS.md:1247` — BUG-023 status should say the duration path is fixed, reps-only stays open, AC-LSR-1 probe red by
  design.
- R4 | `log-set.tool.repro.test.ts:4-8` — header says a timed hold has no documented shape; now false.
- R4 | `docs/BACKLOG.md:911` — the 0 kg item is W-2. **Closed:** removed on `dev` in `8f1d85e0` (promoted to this plan).
- R4 | design `2026-09-28-load-recommendation-architecture-design.md:88,104` — metric 4 and the Stage A insufficient-data row are
  stale after W-1/W-4; the step-down floor is stated nowhere.
- R4 | plan item 2 — the dev data correction for isometric sets is not listed. **Closed:** listed in § Execution decisions O-1.

**Meta** (filed in `docs/REVIEW_FINDINGS.md`): R1 ×2 (design departure not flagged for ratification; superpowers design as
the only statement of a rule), R2 ×1 (derived prompt versions), R3 ×2 (post-deploy ACs at close-out; no evidence section),
R4 ×1 (load-plan metric definitions have no durable home).

### Verification evidence

- Worker (2026-10-01, reported): `check-all` exit 0; `test:unit` 204 suites / 2381; `DB_PORT=5999 test:unit` 2381;
  `test:integration` 59 suites / 707; `test:scenarios` 28 suites / 440. Red-then-green per item in the worker report
  (item 1: 6/7 new domain tests red; item 2: service 1/2, tool description, scenario plank red; item 3: 4 decide tests,
  scenario 3/3 red).
- Orchestrator re-run (2026-10-01, `d7888c80`): `DB_PORT=5999 npm run test:unit` 204 suites / 2381 passed;
  `db-test-lock.sh npm run test:scenarios` 28 suites / 440 passed (1 todo); `state.mjs --check` OK. R3 zone: type-check,
  lint (0 errors), format:check clean.
- Orchestrator re-run on the merge head (2026-10-01, `6eb7ce01`, after the review-fix commit `2eb710ec`): `npm run
  check-all` exit 0; `DB_PORT=5999 npm run test:unit` 204 suites / 2390 passed; `db-test-lock.sh npm run
  test:integration` 59 suites / 707 passed (1 todo); `db-test-lock.sh npm run test:scenarios` 28 suites / 440 passed
  (1 todo); `state.mjs --check` OK.

### Run 2 — 2026-10-01 — clean (R3, R4 re-run on the whole diff; R1/R2 had no blocking in run 1)

Run-1 blocking closures, re-verified by the zones: R4 BR-TRAINING-036 amended and BR-TRAINING-040 added (owner-approved
2026-10-01, `ab858c55`; R4 confirmed the English text is faithful); R4 ARCHITECTURE v12 line (`ab858c55`); R3 evidence
(§ Verification evidence); R3 AC-LPF-4 accepted as deferred (owner = orchestrator, command recorded). Review-fix commit
`2eb710ec` closed the run-1 R3 advisories on floored reasons, v12 "no lighter option", and the "conservative start"
no-reference outcome (W-6, W-7).

**Blocking (run 2)**

- R3 | `docs/superpowers/plans/load-plan-fixes.md:167-175` | SUPERPOWERS_INTEGRATION rule 2 — evidence covered only
  `d7888c80`, not the review-fix head. **Closed:** full re-run on `6eb7ce01` recorded above.

**Advisory (run 2)** — routed to `docs/BACKLOG.md` § load-plan-fixes close-out review advisories unless closed here

- R3 | `decide.ts:204-206` — a partial floor in `gapRow` (3 steps requested, floor after one) says "no lighter option —
  the load holds" while the outcome says "one step down"; no test.
- R3 | `decide.ts:295-301` — insufficient data after a break tier with an unknown step still claims "one step below the
  reference"; same pre-branch claim in `gapRow` / `pre_fatigue` with an unknown step.
- R3 | `training-load-plan.v2.ts:141-145` — with an unknown step, `conservative` equals `recommend` with no note (U2 pattern
  on unknown-step rows).
- R3 | `training-service-isometric.unit.test.ts:45` — BR-TRAINING-040's third clause (reps-only stored as given) has no
  test; no test cites BR-TRAINING-040 / 036.
- R3 | `metrics.ts:333-345` — recurring-load rule ignores recency (repeat of run 1).
- R4 | `log-set.tool.repro.test.ts:4-8` — header stale. **Closed:** `6eb7ce01`.
- R4 | design `:207-208` — §5 restart vs amended Stage A row 1. **Closed:** `6eb7ce01`.
- R4 | design `:88` — working-weight rule has no durable home (same class as run-1 meta).
- R4 | `training.spec.md:36` — BR-TRAINING-036 does not cover an unknown equipment step (pre-existing).
- R4 | `docs/STATE.md:277` — U9b handoff still routes the 0 kg conservative to backlog. **Closed** in this plan's STATE
  handoff at close-out.

**Meta (run 2)** filed in `docs/REVIEW_FINDINGS.md`: R3 — evidence must name the head it ran on.
