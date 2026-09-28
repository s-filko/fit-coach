# Review record — load recommendation architecture draft v1 (2026-09-28)

Independent review of `2026-09-28-load-recommendation-architecture-design.md` v1 by an Opus
reviewer (read-only, no code run). Dispositions by the orchestrator, same day; v2 of the draft
carries them. Line numbers in the review refer to v1.

## Dispositions

| Finding | Disposition | Where in v2 |
|---|---|---|
| B1 planner writes `targetWeight`, two numbers in the prompt | accepted | Principle 1, §7, U9b |
| B2 fatigue row starves progression, double-counts | accepted — fatigue only as a delta vs the reference performance | §3.2 metric 3, §3.3 Stage A |
| B3 two layers act on the same facts | accepted — layer 2 = tactic + reason codes only; precedence printed | Principles 7–8, §6 |
| B4 rep range / working weight circular; all-time peak | accepted — range from scheme params; working weight windowed | §3.2 metric 4, §4.1 |
| B5 "no numbers" check relies on a removed mechanism (`eb9ac4c9`) | accepted — numberless by construction (enums) | §6 |
| B6 coach writes the user's decisions | accepted — button or verified quote; objections are call input | §4.2, §6 |
| B7 condition vocabulary not evaluable in session | accepted — dropped; Principle 6 is the only door | Principle 6 |
| B8 permanent constraints freeze growth forever | accepted — `short` forbids, `long_term`/`permanent` cap | §3.2 metric 8 |
| B9 event 1 has no process to run in | accepted — course-check fingerprint pattern | §6 trigger |
| C1 muscle-scope records | accepted for v1, deferred (owner's §14 muscle view stays) | §6 |
| C2 condition vocabulary | accepted | — |
| C3 shared coach-decisions table | accepted — `user_progression_scheme` + `exercise_tactics` | §4.2, §6 |
| C4 `scheme@version` pinned on the user | accepted — id only; version per log row | §4.2 |
| C5 silent scheme fallback | accepted — printed | §4.1 |
| C6 events 2–4, `needs_review`, staleness guard | accepted — one fingerprint | §6 |
| C7 split-by-muscle fallback | accepted — retry once, else no record | §6 |
| C8 per-step required fields in the record | accepted | §6 |
| D `get_load_plan` tool needed | accepted | §3.4 |
| D feedback not printed | accepted — verbatim in the reference line | §3.2 metric 2 |
| D v7 rules 2, 4b, FIRST MESSAGE still issue numbers | accepted | §7 |
| D third history formatter | accepted — reuse; U2's R1.2 folded into U9a | §3.4, U9a |
| D caching order | accepted — block at the tail | §3.4 |
| D dumbbell convention, session place | accepted — into U4 | U4, §10 |
| D equipment step as a structured fact | accepted — defaults by `equipment` until instances | §3.2 metric 9 |
| D step grid not implementable | accepted — multiple of the step from the last load | §3.2 metric 9 |
| D legacy sets before U4 | accepted — 60 % heuristic, printed as estimated | §3.2 |
| D analyst timing changes an [owner] item | accepted — escalated | header, §11.1 |
| D log trigger not observable | accepted — snapshot at first working `log_set` | §3.5 |
| D detraining threshold inconsistency | accepted — sourced parameter, ~3 weeks | §5 |
| E growth after one session vs ACSM/NSCA 2-for-2 | accepted — confirming sessions param, default 2 | §3.3 Stage C |
| E +1 step vs percentage | accepted — 10 % cap, else reps | §3.3 Stage C |
| E "RPE 9–10 → reduce" invented | accepted — dropped; RPE vs scheme target only | §3.2 metric 6 |
| E 48 h scheduling rule misused | accepted — no flat penalty | §3.3 |
| E gap 10–14 d invented | accepted — tiers from sources | §5 |
| E Epley ≤ 10 reps, tolerance band, machines | accepted | §3.2 metric 5 |
| E plateau ≥ 3 is a convention | accepted — cited as such | §3.3 |
| F split U9 into U9a/U9b | accepted | §9 |
| F U13 before U12; U12 waits for log data | accepted (owner recommendation pending) | §9 |
| F R4.1 tags not blocking | accepted — derived tag in U9a, movement pattern in U11 | §9 |
| G one call per exercise (alternative design item 7) | **rejected** — cross-exercise coherence is the point of the call; one call per workout, no split fallback | §6 |

Owner additions after the review (2026-09-28), not from the reviewer: breaks as an event with a
reason and a return ladder (§5); fatigue context of each performance (§3.2 metric 3);
exercise-order behaviour and BUG-042 (§8).

## Full review text

# Review — `2026-09-28-load-recommendation-architecture-design.md` (draft)

Reviewer: independent, read-only. Line numbers refer to the draft unless another file is named.

## A. Verdict

The core split, with numbers computed by code at request time and strategy stored as a status-carrying record written offline, is the right shape. It meets §15 items 2–5 and 8 better than the earlier in-session analyst. As written, though, the design has **three sources of the recommended number** (the planning model's `targetWeight`, layer 1's decision table and layer 2's tactic and conditions), and it gives no rule for combining them. That breaks the owner's "no inconsistency between sources" constraint before any code is written.

The biggest single risk is behavioural: the first-match decision table puts the "same muscles loaded today" row above the growth rows. In a body-part split, every exercise after the first shares muscles with an earlier one, so it holds or drops every session and **never progresses**. It also re-penalises pre-fatigue that is already baked into its own history.

## B. Blocking problems (by severity)

**B1. Session-planning already stores a model-generated load; the draft ignores it.**
Where: Principle 1 (l. 35–37) says "nothing generated by a model ever stores a number". In fact, `RecommendedExerciseSchema.targetWeight` (`apps/server/src/domain/training/session-planning.types.ts:16`) is written by the planning LLM into `session_plan_json` and `session_exercises.target_weight` (`schema.ts`). It is then rendered as `Target: 3×10 @ 60 kg` in WORKOUT OVERVIEW (`training-workout-overview.v1.ts:47,84`), and v7's FIRST MESSAGE RULE (`v7.ts:89`) tells the coach to display it. With LOAD PLAN added, the prompt carries two different kilogram numbers for the same exercise.
Why it blocks: this is exactly the source-of-truth conflict the owner forbade. A weak model will pick one of the two numbers at random.
Alternative: in the same unit as LOAD PLAN, stop the planning prompt from emitting `targetWeight`, or overwrite it from layer 1 at proposal time. Remove kilograms from WORKOUT OVERVIEW's target line, so that LOAD PLAN is the only place a load number appears. `targetReps` has the same problem: it is a free string such as `'8-10'` chosen by the planner, and it competes with the scheme's rep range (see B4).

**B2. The fatigue row starves progression and double-counts pre-fatigue.**
Where: §3.3 row 3 (l. 86), "same muscles loaded today or < 48 h → hold or −1 step", sits above the growth rows (l. 88–90), and the first matching row wins (l. 80).
Why it blocks:
- On a chest day, the second and third chest exercises and every triceps exercise match row 3 every time, so they are never offered +1 step.
- If the user's exercise order is stable, the reference performance was *also* done pre-fatigued. Applying −1 step compares a fatigued today against a fatigued last time and ratchets the load down.
- Exercise-order research (Simão et al. 2012, *Sports Med*) shows a systematic rep decrement for later exercises. That supports comparing performances like for like; it does not support a flat penalty.

Alternative: the fatigue row fires only when today's pre-load on the exercise's muscles is **materially greater** than the pre-load before the reference performance (sets on overlapping primary muscles before this exercise, today vs then). Otherwise it adds no step and only prints a line. The "< 48 h" half should compare against days since the reference performance's muscles were last loaded, for the same reason.

**B3. The two layers act on the same facts with no composition rule.**
Where: layer-1 safety rows (l. 84–87) and layer-2 conditions (l. 167–170: `same_muscles_loaded_today`, `gap_days > N`) evaluate the same signals, each producing a step change. The layer-2 tactic list (l. 165–166: "hold, rep progression, add step, deload") overlaps what "the scheme owns" (l. 93). Layer-2 `phase` (growth / plateau / decline, l. 164) duplicates layer-1 metric 4, the e1RM trend (l. 70).
Why it blocks:
- Fatigue can be subtracted twice (−1 from the row, then −1 from the condition).
- A tactic of "add step" can contradict a scheme that says "hold".
- The printed `strategy: plateau` can contradict `e1RM trend rising` in the same block.

Two places deciding the same thing is also the debugging cost the owner named.
Alternative:
- Layer 2 never touches a number and never re-evaluates a layer-1 signal.
- `phase` is computed by code only.
- The layer-2 output is one field, `tactic ∈ closed list`. Its only numeric effect is to **select** a scheme branch that code already has, such as a deload branch or a rep-progression-only branch.
- Drop the condition vocabulary entirely (see C2).
- Precedence is written once: safety rows, then tactic, then scheme, and the block prints each stage's result.

**B4. The rep range and "working weight" are defined in a circle, and three sources disagree.**
Where: metric 3 (l. 69) needs "the target rep range". The scheme owns "default parameters by goal (rep range…)" (l. 124–125). The plan row carries `session_exercises.target_reps` (a model-written text, often null in spontaneous sessions).
Why it blocks:
- Working weight, the growth rows and the contract invariant "candidate ≤ working weight + 1 step" (l. 131) all depend on a range whose source is undefined.
- "Highest load ever" has no recency window. After a deload or a gap, working weight stays at the old peak, and the invariant then permits a jump back to it.

Alternative:
- The rep range comes from **the scheme parameters only**, with the planner's `targetReps` derived from them (not the reverse).
- Working weight is evaluated over the last *K* performances or the 8-week window, never all-time.
- Performances whose target range differed from today's are marked as not comparable.

**B5. The draft relies on a mechanism the owner has already replaced.**
Where: l. 163 says "no numbers allowed; validated by code, like fact provenance"; l. 214 says "numbers in the record → rejected".
Why it blocks:
- The string check `checkFactProvenance` was removed on the owner's decision and replaced by a model verifier. See `verify-fact-operations.ts:1-17`, the comment "no string matching (the owner's rule)" at `compact.node.ts:362`, and the BUG-040 status line: "numbers matched by meaning (words or digits)".
- A digit ban on prose would also reject legitimate rationale ("3 sessions without progress") and miss "три недели".

Alternative: make the record **numberless by construction**. Use enums plus a rationale assembled from reason codes that layer 1 renders with its own numbers ("plateau: e1RM flat for {n} performances"). If free prose is kept, it is voiced only through the fact-verifier-style judge. Do not claim a code check that the repo no longer has.

**B6. Layer 2 lets the in-session coach write, contradicting Principle 2.**
Where: Principle 2 (l. 38–39) says strategy is written "never by the in-session coach". But l. 175–176 has the coach write the user's objection as `rejected`, and l. 151–152 has the coach record "coach-recommended-and-accepted".
Why it blocks: this is the BUG-040 class of error, where the coach's interpretation is stored as the user's decision. The draft has no evidence field.
Alternative:
- Record the scheme choice and any objection with a deterministic user action (a Telegram inline button: `double / linear / not now`), or at minimum require a `userQuote` checked by the existing verifier.
- An objection voiced mid-session is carried to event 1 as input to the offline call, which is what l. 197–199 already implies. The coach does not write it.

**B7. The condition vocabulary assumes conversation facts that code cannot see in session.**
Where: `user_reports_pain` and `sleep_poor` are taken "from facts/conversation" (l. 169).
Why it blocks: code cannot read the current conversation deterministically. Facts are written only at compaction (`compact.node.ts:~300`), so "slept badly" said at the start of today's session is not a fact until after the workout, and the condition never fires when it matters. The "closed vocabulary code can evaluate" (l. 167) is therefore false for two of its five items. The other three duplicate layer 1 (B3).
Alternative: drop the conditions. Pain and sleep are covered by Principle 6: the coach deviates on a fact from the current conversation and says why. That clause already exists and is the honest home for them.

**B8. A "grow never" trap for permanent constraints.**
Where: the row "constraint on a primary muscle → growth forbidden" (l. 85).
Why it blocks: `user_facts.durability` has `permanent` and `long_term` (`schema.ts:274`). A permanent "old knee injury — careful with deep squats" would freeze every quads exercise forever. "Often below" is also not deterministic. Matching `equipment` facts to exercises by code is the scope misapplication in BUG-040 (a lever-machine fact applied to the leg press), and `user_facts` has no link to an equipment instance.
Alternative:
- Only `short` facts and `physical_constraint` facts with an explicit `muscle_group` forbid growth.
- `long_term` and `permanent` facts cap the step (hold or rep progression only) and are printed.
- Equipment facts are printed, never matched, until machine instances exist.

**B9. Event 1 has no process to run in.**
Where: l. 188 ("`finish_training`, or auto-close with ≥1 set").
Why it blocks: auto-close is lazy. It runs inside `trainingService.getActiveSession/startSession` (`training.service.ts:93,274,466` → `workout-session.repository.ts:320`), which are called at the user's **next** request, often the next session start. The repo has no job runner, only owner-installed nightly CLIs. So a detached event-1 call would either run inside the next day's first request (adding latency where the user notices) or never run. Open question 11.2 treats this as a detail; it is structural.
Alternative: follow the course-check pattern (`course-check/events.ts`, `fingerprint.ts`). Take a fingerprint over (the newest completed workout id per scope + the scheme + the constraint-fact ids), let `prepare` fire on a fingerprint change with the cooldown, fail open, and keep the previous record. That one mechanism replaces events 1–3, `needs_review` and the staleness guard, and it already exists in the repo, with tests.

## C. Over-engineering: cut from v1 without losing §15

1. **Muscle-scope strategy records** (l. 161, 174). Plateau and tactics are per exercise. Weekly volume per muscle is not computed anywhere in layer 1, so the call would reason about something no code checks.
2. **The condition vocabulary** (l. 167–170). It duplicates layer 1 or cannot be evaluated (B3, B7).
3. **The generic "coach decisions" table shared by scheme and tactic** (l. 142–147, 174). The scheme choice is a user setting: a 5-column append-only `user_progression_scheme` table is enough. Designing a shared table in U9′ for a layer that U12′ may drop (l. 243, 263) is premature.
4. **`scheme@version` pinned on the user's choice** (l. 143). Store the scheme id only. Record the version per recommendation in the log. Pinning users to old code is what would break "adding schemes later".
5. **Silent fallback to the default scheme** (l. 127–128). Replace it with a printed line (`scheme X needs RIR; using double`). Otherwise it is a hidden branch.
6. **Events 2, 3, 4, `needs_review` and the staleness guard** (l. 190–203). Replace them with one fingerprint (B9).
7. **The split-by-muscle-group fallback for > 8 exercises** (l. 216–217). Retry once; if that fails, keep no new record (layer 1 still works).
8. **"A required field per framework step"** (l. 213) in an offline, numberless record. Load-spec §4 steps 1–3 and 5 are computed by code now, so asking the model to restate them adds tokens and a second place to contradict code.

What must stay for §15: the metrics, the decision table (fixed per B2 and B4), the conservative line with its reason, the data-sufficiency degradation, the cited sources, the recommendation log with the chosen row, the scheme choice, and one offline tactic per exercise (the owner's "separate reasoning call").

## D. Gaps against §15 and existing repo facts

- **§15.1 trigger when there is no plan.** LOAD PLAN renders "one entry per today's exercise" (l. 96). In a spontaneous session (R3.3), today's next exercise is unknown until the user logs a set, which is too late. The history spec §5 (`2026-09-26-training-history-context-design.md:125-127`) already says load advice is "a separate tool with computed analytics". A `get_load_plan(exerciseId)` read tool that returns the same block is needed alongside the block. The draft removes the tool without saying so.
- **§15.7 feedback.** `session_sets.user_feedback` and `session_exercises.user_feedback` are free text that layer 1 cannot evaluate. The example block (l. 99–106) does not even print them. At a minimum the block must print the last performance's feedback verbatim, and the draft should say that Principle 6 is how feedback enters the in-session decision.
- **Two more v7 lines issue numbers that the draft leaves unbound.** §8 replaces only rule 1 (`v7.ts:20-25`). Rule 2 (`v7.ts:27`, "RPE ≥ 8 → suggest adjusting weight"), rule 4b ("announce the next exercise … with a specific recommendation", `v7.ts:34`) and the FIRST MESSAGE RULE (`v7.ts:89`) also produce loads, and all must point to LOAD PLAN.
- **A third view of the same history.** The block's `last:` line repeats EXERCISE HISTORY (`training-exercise-history.v1.ts:85-104`) in another format. The history spec §3 names several views of the same data as a source of confusion and plans one block. Either LOAD PLAN replaces EXERCISE HISTORY in training, or `last:` is dropped. It must reuse `formatSetData`/`formatDateAge`, not add a third formatter (R1.2 / U2 exists for this reason).
- **Caching order.** The block carries relative times ("3d ago", "40 min ago"). History spec §4 requires anything relative to today at the tail, after `NOW`. The draft does not place the block.
- **Dumbbell per hand vs total** (load spec §11.2). This is not in §9. Trends will jump, and the equipment-step grid is ambiguous. It is a data-shape fix and belongs in U4.
- **Machine comparability.** The backlog entry (`BACKLOG.md:52-80`, point 4) requires comparisons only within the same machine instance. "Lower confidence" (l. 76–77) does not stop a wrong trend across two gyms. The cheapest compounding fix is to record the session place (free text or enum) now, in U4, per roadmap rule 6, and to show performances from different places as separate lines.
- **Equipment step as a "user fact, structured value"** (l. 229). `user_facts` has no structured value, only a free-text `fact` (`schema.ts:292-331`). Facts are written by the summariser and verifier, which is BUG-040 territory for numbers. The backlog says machine details belong "on the instance, not as a loose fact". Keep conservative defaults by `exercises.equipment` until places exist.
- **The step grid is not implementable.** "No output outside the equipment step grid" (l. 132–133) needs a base value as well as a step (22.5 + 2 = 24.5 does not exist). Define it as "a multiple of the step from the last used load", not a grid.
- **Legacy data before U4.** Sets logged before U4 have no kind. The draft does not say whether they count as working (pollution for 8 weeks) or as unknown (no metrics for 8 weeks). Pick one explicitly. I suggest treating a set as a warm-up when it is below ~60 % of that performance's top load, printed as "estimated", and flagging this as a heuristic.
- **The analyst's timing changes an [owner] item without saying so.** Load spec §3 [owner] says the analyst "must see the whole situation, e.g. what was already trained today". An offline post-workout call cannot see today. The draft moves "today" to code (fine), but that is a change to an owner decision and needs explicit confirmation. At present it is tagged only "[owner shape; mechanics proposed]" (l. 158).
- **The recommendation log trigger** (l. 115). "When the coach voices the first-set recommendation" is not observable by code. Make it deterministic: snapshot the LOAD PLAN entry as it was rendered for the run in which the exercise's first working set is logged (`log_set`, set 1).
- **Detraining threshold inconsistency.** Load spec §9 uses "e.g. 3 weeks" for the confidence drop; the draft uses 10–14 days (l. 87). One number, sourced (see E).
- **Nit:** the example block's "chosen by user 2026-10-02" (l. 102) postdates "2026-09-25 (3d ago)" (l. 100).

## E. Sports-science check

Sources below are from memory; I did not re-open them. Items marked *(unsure)* should be verified in R4.0.

| Rule in draft | Status | What the sources say |
|---|---|---|
| Growth: "all working sets at range top, RPE ≤ 8 → +1 step" after **one** session (l. 88) | **Coaching convention, more aggressive than the position stands** | ACSM 2009 position stand (Ratamess et al., *MSSE* 41:687–708; also Kraemer & Ratamess 2004): raise the load 2–10 % when the lifter can do 1–2 reps **over** the target on **two consecutive sessions**. NSCA "2-for-2" rule (Baechle & Earle, *Essentials of S&C*): 2+ reps over the goal on the last set in 2 consecutive workouts, with suggested increments of roughly 1–2 kg upper / 2–4 kg lower for less-trained lifters and 2–4 / 4–7 kg for trained *(increment figures unsure)*. "Top of the range once → add weight" is common double-progression practice (e.g. Helms et al., *Muscle & Strength Pyramid*) but is not a position-stand rule. Given the owner's conservative preference (load spec §6), make the number of confirming sessions a scheme parameter, default 2, and cite ACSM/NSCA. |
| "+1 step" as the growth unit | **Conflicts with percentage guidance at light loads** | ACSM expresses the increase in percent (2–10 %). A 5 kg stack step on a 20 kg lateral-raise machine is +25 %. Rule: if one step > ~10 % of the load, progress by reps (or a smaller step) instead. |
| "Inside range → hold, +1–2 reps" (l. 89) | Standard | This is the definition of double progression. |
| "Below range floor **or RPE 9–10** → −1 step" (l. 90) | **Half invented** | Missing the range floor → reduce is standard. RPE 9–10 on the last set is normal hypertrophy practice: 0–3 RIR is the usual prescription (Refalo et al. 2023/2024 on proximity to failure; Helms et al. 2016 RIR-RPE, *SCJ* 38:42–49). RPE-based autoregulation adjusts the load against a **target** RPE (RTS/Tuchscherer charts, roughly 2–4 % per RPE point, *unsure of exact figure*), not "RPE ≥ 9 means reduce". Keep only the floor half, or compare against the scheme's target RPE. |
| RPE ≤ 8 as a growth gate; relying on self-reported RPE | Plausible, data-weak | RPE 8 ≈ 2 RIR (Zourdos et al. 2016, *JSCR* 30:267–275). Prediction of reps-to-failure is imprecise: Halperin et al. 2022 (*Sports Med*) found an average error of about 1 rep, worse further from failure and at higher reps, and worse in less-trained people. Before any row depends on RPE, measure how often `session_sets.rpe` is actually filled in the owner's data; if it is sparse, the row silently never fires. |
| "Same muscles today or < 48 h → hold/−1" (l. 86) | **48 h is sourced, but for a different use** | ACSM (Garber et al. 2011, *MSSE* 43:1334–1359) advises ≥ 48 h between sessions for the same muscle group. That is a scheduling guideline, not a load-reduction rule. Within-session pre-fatigue lowers reps (Simão et al. 2012), which argues for a like-for-like comparison (B2), not a penalty. |
| "Gap > 10–14 days → −1 step" (l. 87) | **Invented; conservative** | Detraining reviews (Mujika & Padilla 2000, *Sports Med*; McMaster et al. 2013 *(unsure of details)*) show maximal strength largely retained for about 3 weeks. Ogasawara et al. 2013: 3-week breaks did not blunt gains. Around 3 weeks is the defensible threshold; 10–14 days is a caution parameter and should be labelled as such, not cited as practice. |
| e1RM via Epley, ≤ 12 reps (l. 70) | Standard formula, **validity limit overstated** | Epley 1985: 1RM = w·(1 + r/30). Accuracy falls with reps; LeSuer et al. 1997 (*JSCR* 11:211–213) and Reynolds et al. 2006 (*JSCR*) favour ≤ 10 reps (best ≤ 5). The formulas were validated on free-weight bench, squat and deadlift, not machines. The draft does not say which set's e1RM counts per performance (use the best working set). In an 8–12 range, a one-rep difference moves e1RM by about 3 %, similar to formula noise, so "flat" needs a tolerance band (e.g. ±2.5 %) or it will flicker. Use ≤ 10 reps and flag machines as low confidence. |
| Plateau = e1RM flat ≥ 3 performances (l. 91) | **Convention, not research** | No consensus definition exists. "Stall 3 times → reset about 10 %" is a practitioner rule (Rippetoe & Baker, *Practical Programming*). Cite it as a convention. |
| Deload as a shared detector | Reasonable | Bell et al. 2023 Delphi consensus on deloading *(unsure of journal and issue)*: reduced volume or intensity for about 1 week; methods vary. Load spec §2's "−40–50 % volume or −10 % load" fits that range. |
| Scheme list: double, linear, later RPE autoregulation | Standard | Linear for novices (ACSM: novices progress fastest; Rippetoe). Double progression and RPE/RIR autoregulation are both well established. "Novice + strength → linear" as the default is fine, but linear with 8–12 reps is odd, because linear progression uses fixed reps. State that the scheme's own rep target overrides the goal's range. |

## F. Sequencing

- **U4 first: agreed.** Widen it slightly with the other data-shape fixes that compound daily: dumbbell per-hand convention and session place. Each is an additive column.
- **U9′ is too large for one plan and one hypothesis** (roadmap §2 rule 1). It bundles research, catalog tagging, metrics, a registry, a block, a log, a new tool, a new table and a prompt version. Split it:
  - **U9a `load-facts`:** R4.0 sources and R4.2 metrics, verified by the owner on his history, with the block showing facts only, no recommendation. The live check is "are the numbers right".
  - **U9b `load-plan`:** the decision table, schemes, recommendation log, scheme choice, the prompt version that removes the planner's `targetWeight` (B1), and rebinding v7 rules 1, 2 and 4b and the FIRST MESSAGE RULE.
- **R4.1 tags.** The progression-model tag can be derived from `exercise_type` and `equipment` now, so it does not need to block U9. Movement pattern is needed only for transfer, which seeds the cold start, so move it to U11.
- **U11 vs U9b.** Row 1 of the table ("data insufficient → probe per cold-start") depends on U11. Until U11 lands, U9b's row 1 should reproduce today's v7 behaviour ("no record → say so, conservative start"), and the draft should say so.
- **U13 (overreach, code-only, cheap) belongs before U12′.** U12′'s own acceptance ("kept only if the target-rep hit rate improves", l. 243) needs weeks of recommendation-log data from U9b. It cannot be judged right after U9b, so U12′ should wait for that data and not occupy the next slot.
- **U2 (one set formatter) should precede, or be folded into, U9a,** so that LOAD PLAN does not become a third formatter.

## G. Alternative design (≤ 15 lines)

1. **Data first (U4+):** set kind, dumbbell convention and session place. All additive, and they start accruing today.
2. **A single `LOAD PLAN` producer in code, used by both a tail-placed block and a `get_load_plan(exerciseId)` tool.** It shows facts (reusing the history formatter), the scheme, the one decision row and the conservative line.
3. **The planner no longer writes `targetWeight`;** WORKOUT OVERVIEW shows sets × reps only. LOAD PLAN is the only place a load number appears.
4. **Decision order is fixed and printed:** sufficiency → short-term constraint → scheme (parameterised: confirming sessions = 2, max step ≈ 10 %, else reps). Pre-fatigue only as a delta against the reference performance.
5. **Scheme choice:** an append-only row set by a Telegram button, or by a verified user quote. Store the id only; record the version per log row.
6. **Recommendation log:** a snapshot of the entry at the first working `log_set`, plus what was done. This is the calibration data U12 needs.
7. **Layer 2 (later, after enough log data):** one call per exercise, triggered by the course-check fingerprint pattern. Its output is `tactic ∈ enum` plus reason codes only, with no numbers and no phase (code owns phase). Code maps the tactic to a scheme branch. A user objection is an input to the next call, never a coach write.
8. **Keep Principle 6** as the only path by which today's conversation (pain, sleep, feedback) changes the number, and require the coach to state the fact behind any deviation.
