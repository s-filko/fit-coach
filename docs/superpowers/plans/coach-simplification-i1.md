# Coach Simplification I1 — New Training Turn Implementation Plan

- Status: in progress
- Parent: `docs/superpowers/plans/coach-simplification.md` § 4 I1 (read § 2 principles P1–P8 first). Branch
  `plan/coach-simplification-i1`, one worktree. Server code is in `apps/server/src` (paths below are relative to it
  unless they start with `apps/`, `docs/` or `data/`). All commands run from `apps/server` unless noted.
- Reference rendering: `data/coach-simplification/i0/cases/07/input.md` (gitignored, local only) and
  `data/coach-simplification/i0/judge-notes.md`. Durable specs are NOT edited in I1 (§ 6 lists them for the owner).
- **Spec:** the implementation spec of Tasks 6a/6b (Today / History rendering, profile, the frozen prompt) is
  committed as `docs/superpowers/specs/2026-10-04-training-turn-shape.md`. It is the spec the code follows where §§ 1.1–1.2
  and 3 below differ from it; the gitignored `data/` evidence may be cited but is never the only spec.

## 1. Target — the training request after I1

| Part | Content | Produced in |
|------|---------|-------------|
| tools | `search_exercises`, `get_exercise_history`, `log_set` (no `advised`), `complete_current_exercise`, `finish_training`, `set_session_place`, `delete_last_sets`, `update_last_set` + shared (`save_timezone`, `set_language`, `manage_fact`, `list_facts`). Described by their schemas only. | `graph/phases/training.spec.ts` |
| system (ONE stable SystemMessage) | coach prompt (§ 3, ≤ 2 500 chars) + `# Profile` (deduplicated). No `## User Facts`, no `## Course Directive`, no `## Previous episodes`, no directives. | new `prompts/phases/training/coach.ts` (`TRAINING_COACH`, id `phase.training`, version `v13`, `directives: []`) |
| messages | this workout only: from the HumanMessage that triggered `start_training_session` onward, without that tool call and its ToolMessage | new `workoutHistory()` in `graph/episode.ts`, applied in `graph/nodes/agent.node.ts` |
| current user message | `<context>` = `# Today` + `# History` + time-gap note (v1, when due) + NOW line (`CURRENT_TIME_V1`, unchanged, last) — then the client's text | new `prompts/blocks/training-facts.ts` (`TRAINING_TODAY_V1`, `TRAINING_HISTORY_V1`), assembled by `context/assemble-context.ts` (unchanged) |

Prompt caching stays as is: the system message changes only when facts change; per-turn data rides in `<context>`;
`applyCacheBreakpoints` and the post-tool nudge are untouched. The workout slice keeps the history prefix stable
within a workout (its start never moves).

**Phase switch (no new block types).** Add `memory?: 'episodes' | 'workout'` to `PhaseSpec` (`graph/phase-spec.ts`,
default `'episodes'` = today's behaviour). In `buildAgentNode`, `'workout'` means: do not call
`deps.userFacts.getForPrompt`; pass `userFacts: []`, `courseDirective: null`, `episodeSummaries: []` and
`history: workoutHistory(history, current)` to `assembleContext`. Only training sets `'workout'`; chat, planning,
registration, plan_creation are untouched in I1. Compaction and the course-check step keep running (chat needs
them); training just stops rendering them.

**`workoutHistory(history, current)`** (pure): if `current` contains an AI tool call named `start_training_session`
→ `[]` (hand-off run). Else find the LAST AIMessage in `history` with that tool call; return
`[the HumanMessage just before it, ...messages after the ToolMessage(s) answering it]`. Not found (a budget
compaction folded it) → `history` unchanged.

**Training data** (`TrainingData` in `training.spec.ts`, replaces the current shape):
`{ session; history: ExerciseHistory[]; lastWorkout: { completedAt: Date; exerciseNames: string[] } | null;
profileFacts: UserFact[] }`, with `ExerciseHistory = { exerciseId, exerciseName, plannedText | null,
performances: ExerciseLastPerformance[] /* ≤ 3, newest first, today's session excluded */, lastSkippedAt }`.
Loader: today's exercise ids as now (plan order, then off-plan started; catalog name wins); per id
`workoutSessionRepo.findRecentPerformancesForExercise(userId, id, session.id, 3)` (existing, `Promise.all`);
`findLastSkipsByExercise` (existing); `findRecentByUserIdWithDetails(userId, 2, { realWorkoutsOnly: true })` minus
today → `lastWorkout`; `deps.userFacts.getForPrompt(userId, now)` → `profileFacts`. Dropped: `recentWorkouts`,
`todayMuscles`, `recentPlacesCount`, `loadPlan`, `progression`. `budget.history` for training: 16 000 (see § 7 Q2).

### 1.1 The facts block — exact format (as shipped after Task 6b)

Rules: facts only — no recommendation, verdict, reason, "up/down/better/worse", target or next step. Sets as
`reps×kg` (unit legend once, in the `# Today` header). An RPE is printed only where it was logged: `(RPE 8)` on each
rated set; `(all RPE 9)` once when every working set of a line has the same RPE; a History line with a rep-based
exercise and no RPE at all ends `(no RPE recorded)` (Today lines never carry that note). A working set without RPE in a
line that has rated sets is printed bare. A warm-up label `(warm-up)` appears only for a set stored with
`set_kind = 'warmup'` — a legacy set without a kind is never labelled. A set note: ` — his note: "<text>"`. Dates: no
time of day (judge: invented «вечером»). Helper `relativeDay(date, now, tz)` (calendar days in the user tz): 0 →
`today`; 1 → `yesterday, Wednesday Sep 30`; 2–59 → `4 days ago, Sunday Sep 27`; ≥ 60 → `Friday Apr 24, about five
months ago` (months = round(days/30), in words up to twelve; add the year when it differs). Any "N min ago" is clamped
at 0.

Set renderer `formatSetShort(setData)`: strength `12×130` (`10×12 per hand`; weight null → `12 reps`);
functional_reps `12 reps`; isometric `45 s`; cardio_duration `9 min` (< 60 s → `40 s`, intensity appended);
cardio_distance `2.26 km in 17 min` (duration 0 → `2.26 km, time not recorded`; `, 5% incline`); interval
`6 rounds 30 s on / 30 s off`.

```
# Today (sets as reps×kg)
Previous workout: 2 days ago, Tuesday Sep 29 — Treadmill, Chest-Supported Row, Smith Machine Bench Press, Lateral Raise Machine, Reverse Pec Deck Fly, Plank.
Plan and sets so far:
- 45° Leg Press [id <uuid>] — plan 4×12 — in progress: 12×130 (RPE 8), 12×135 (RPE 8), 12×135 (RPE 9), 16×135 (RPE 9.5)
- Leg Extension [id <uuid>] — plan 3×15 — planning note: <planner note> — nothing yet
- Plank [id <uuid>] — plan 2×45 s — skipped
Planning warnings: <planner warning>; <planner warning>.
Off plan:
- Cycling [id <uuid>] — done: 9 min (warm-up)
Reported today: <fact the coach stored during this workout> (19:33)
Check-in: ask how the lower back is today — not asked yet today.
```
`# Today` has no session-start time and no elapsed-minutes line (they made the coach cut planned sets for time): the
current time is the NOW line (`CURRENT_TIME_V1`) that closes the `<context>` part. `Place: <place>.` is printed only
when stated. Status words: `in progress` / `done` / `skipped` / `nothing yet` (from `session_exercises.status`). No plan →
`No plan for this session.` Stale session (`isRetroLog(session, now)`) adds one fact line: `No activity for 3 h; a set
logged now is dated to the session's last activity.` **Planner output is rendered:** each plan exercise's `notes` as
` — planning note: <text>`, and the plan's `warnings` as one `Planning warnings: …` line (what the planning dialogue
recorded, verbatim). **State lines (Task 6b, D12/D13):** `Reported today: <fact> (HH:MM)` — one per fact created
during this workout (the coach's `manage_fact`), the profile excludes them so the system message stays cache-stable;
`Check-in: ask how the <muscle group> is today — not asked yet today.` — one per physical-constraint muscle group, only
on the first training turn (no coach reply in this workout yet, `coachReplied` false) and only when the plan carries no
planner warnings or notes. The check-in line is an instruction inside a facts-only block — a named exception (D12).
The exercise id appears here only (tools need it); History never repeats ids.

```
# History (before today)

Habit: a cardio warm-up (treadmill 10–15 min, bike 8 min) before 9 of the last 10 workouts.

45° Leg Press (today 4×12)
- 4 days ago, Sunday Sep 27: 12×110, 12×130 (RPE 8), 12×130 (RPE 8), 12×135 (RPE 9)
- 10 days ago, Monday Sep 21: 12×110, 12×110, 12×120, 12×120 (RPE 9)
- 15 days ago, Wednesday Sep 16: 10×80 (warm-up), 12×110, 12×110, 12×110 (all RPE 9)
- Trend Sep 16 → Sep 21 → Sep 27: top weight 110 → 120 → 135 kg; working sets 3 → 4 → 4; reps per working set 12 → 12 → 12; weight × reps 3,960 → 5,520 → 6,060.
- Loads used: 80, 110, 120, 130, 135 kg.

Plank (today 2×45 s)
- 2 days ago, Tuesday Sep 29: 45 s, 45 s
- 4 days ago, Sunday Sep 27: 45 s, 45 s
- Trend Sep 21 → Sep 27 → Sep 29: hold per set 45 → 45 → 45 s; sets 2 → 2 → 2.

Cycling (today off plan)
- 21 days ago, Thursday Sep 10: 10 min — his note: "время не засекал; 10 мин — оценка владельца"
```
**Habit line** (Task 6a/6b): `computeWarmupHabit` over the last ten workouts with ≥ 2 exercises — shown first when at
least half opened with a cardio exercise; it replaces the History block of today's first exercise when that exercise
is a cardio of a habitual kind. **Loads used** (Task 6a, strength, kg): `collectLoadsUsed` over up to 60 earlier
performances — loads of the last 60 days ascending, older ones grouped with their last date.
Trend line (≥ 2 performances, oldest → newest, working sets only, short dates): weighted strength — `top weight`,
`working sets`, `reps per working set` (one number or `min–max`), `weight × reps` (Σ, thousands separator; `per
hand` noted); reps only — `working sets`, `reps per set`, `total reps`; isometric — `hold per set`, `sets`;
cardio_duration — `minutes`; cardio_distance — `distance … km; time … min`. Mixed set types across performances →
no trend line. A skip newer than the newest performance → `- skipped Tuesday Sep 29 (planned, not done)`. No
performance → `- no earlier record`.

### 1.2 Profile and its dedupe rule

`renderTrainingProfile(user, facts)` (`prompts/blocks/training-profile.ts`), `# Profile`, one `- ` line each. **As
shipped (Task 6a; compact rendering is an open owner decision, see `## Review`):**
1. `<firstName>, <fitnessLevel>` (unknown parts omitted). No age, gender, height, weight; **no registration goal** —
   the first design (goal shown when there are no facts, 3-vs-5 resolution) was dropped in the i0 replay profile:
   user-stated facts are newer and confirmed, and the course directive has left the training request.
2. facts: drop categories `break` and `progression_scheme`; among facts with a non-null `muscleGroup`, keep one per
   `(category, muscleGroup)` — the latest `updatedAt`, tie → more `confirmations` (three lower-back facts → one);
   `physical_constraint` lines first, then `getForPrompt` order. Line = fact text, plus ` (<phaseNote>)` for a
   long-term fact with a phase note. No confirmation counts, no dates, no category headings.
Facts created during the current workout are not in the profile (they are the `Reported today:` lines in `# Today`).

## 2. Delete list (P1)

Approximate LOC; T = test/fixture LOC. "Partial" = edit inside a surviving file.

**A. Decision engine** — `domain/training/load-plan/` whole dir: decide, schemes/*, gap-tier, ladder-input,
break-fact, progression-fact, scheme-default, effort-hint, index (1 639; T 7 552 incl. `__tests__/fixtures/
golden-table.json` 5 150).
**B. Load metrics** — `domain/training/load-facts/` whole dir (1 323; T 2 028). The trend line needs four sums, not
these metrics; the new block computes them itself (≈ 40 LOC). Nothing else reads this dir.
**C. Infra load layer** — `infra/ai/load-facts/` whole dir: loader, load-decision, break-context,
load-recommendation-log (608; T 408). `infra/db/repositories/load-recommendation.repository.ts` (45),
`domain/training/ports/load-recommendation.ports.ts` (97) and their exports in `ports/index.ts`.
**D. Blocks** — `prompts/blocks/training-load-plan.v1.ts`, `.v2.ts`, `training-workout-overview.v2.ts`,
`training-exercise-history.v1.ts` (EXERCISE HISTORY + RECENT WORKOUTS), `time-gap.v2.ts`
(`session-planning-active-plan.v1.ts` stays: v2 reuses its renderer); from `training-workout-overview.v1.ts` delete `buildWorkoutOverview`,
`TRAINING_CLIENT_V1`, `TRAINING_WORKOUT_OVERVIEW_V1`, `TRAINING_STALE_SESSION_V1`, `TRAINING_PREVIOUS_SESSION_V1`,
`buildStaleSessionSection`, `buildPreviousSessionSection` and move `formatSetData`/`formatExerciseSets` to
`prompts/blocks/set-format.ts` (log_set and get_exercise_history use them); `formatDateAge` → replaced by
`relativeDay` in get_exercise_history. (≈ 1 100; T: `training-load-plan.*` ×6, `golden-table.unit.test.ts`,
`training-workout-overview.v1/v2`, `training-exercise-history.v1`, `training-blocks.v1`, `time-gap.v2` ≈ 2 600.)
**E. Training prompt chain** — `prompts/phases/training/v1.ts … v12.ts` (1 305) and `__tests__/training.v5/v8/v9/
v11/v12.unit.test.ts` (425); training entries in `evals/snapshots/__tests__/prompt-snapshots.unit.test.ts` + its
`.snap` (≈ 1 850), the `phase.training` case in `evals/fixtures/prompt-contexts.ts`, the RULE 7 allowlist entry in
`evals/levels/l0.ts`; `prompts/effort.ts` keeps `EFFORT_MAPPING_TEXT` only (the `rpe` schema text uses it).
**F. Tools** — `tools/get-load-plan.tool.ts` (140; T 124), its export and `get_load_plan` in
`graph/tool-policy.ts`; in `tools/log-set.tool.ts` the `advised` field, `effortHints`, `effortText`, `hintSetOf`,
`loadPlanLog`, `loadPlanPlannerRebind` (≈ 80; T ≈ 150 in `log-set.tool.unit.test.ts`); `omitTargetWeight` options in
`format-exercise-summary.ts`, `complete-current-exercise.tool.ts` (always omit the plan weight).
**G. Recommendation writer** — `TrainingService`'s `loadLog` ctor param, `prepareLoadRecommendation`,
`recordLoadOutcome` and their calls; `loadPlanLog` in `ports/training-service.ports.ts`;
`tests/helpers/training-service.ts` override; `main/register-infra-services.ts` wiring (≈ 70).
**H. Flags** — `LOAD_PLAN_SUGGESTION`, `LOAD_PLAN_BREAKS`, `LOAD_PLAN_PLANNER_REBIND` in `config/index.ts`,
`apps/server/.env.example`, `register-infra-services.ts`, `ConversationGraphDeps` (`loadPlanSuggestion`,
`loadPlanBreaks`, `loadPlanPlannerRebind`, `breakContext`), `graph/phases/planner-rebind.ts` (13),
`config/__tests__/load-plan-*.ts` ×4 (86). The flag-on behaviour that survives becomes unconditional: planning
writes no weights (`start_training_session` / `save_workout_plan` schemas without `targetWeight`,
`SESSION_PLANNING_ACTIVE_PLAN_V2`, `SESSION_PLANNING_V5` as the registry's `current`, its one phrase "the training
phase decides them from LOAD PLAN" → "the coach sets them during the workout", its unit test updated).
**I. Break / scheme facts** — `prompts/summarizer/v7.ts`, `prompts/fact-verifier/v2.ts` (211; T 33), their
selection in `compact.node.ts` and `verify-fact-operations.ts` (always v6 / verifier v1), `gatedOperationValid`
rejects `break` / `progression_scheme` unconditionally (**not as shipped — see B1 in `## Review`: the flags were removed but the v7 / v2 branch was left unreachable; owner decision pending**), `TIME_GAP_V2` branch + `ctx.trainingBreak` in
`agent.node.ts` / `state.ts` (≈ 60; T ≈ 250 in `compact.node`, `agent.node`, `manage-fact` tests).
**J. Repository readers left without callers** — `findLastPerformancesByExercise`,
`countRealPerformancesByExercise` (repo + port + test stubs).
**K. Scripts / scenarios** — `apps/server/scripts/print-load-plan.ts` (143) + its `package.json` script;
`tests/integration/scenarios/load-facts`, `load-plan-breaks`, `load-plan-fixes`, `load-plan-scheme-choice`,
`load-recommendation-log` `.integration.test.ts` (1 400). The prompt-cache harness
(`graph/nodes/__tests__/prompt-cache-harness.ts`) drops its load-facts fixture imports and `EFFORT_HINT_RESULT`.

Totals: production ≈ 7 000 LOC deleted, ≈ 600 added; tests/fixtures ≈ 17 000 deleted (5 150 of it golden JSON).

**Looks deletable, stays:** `load_recommendations` table + `infra/db/schema.ts` + migrations — no DB change in I1
(owner rule). `FACT_CATEGORIES` keeps `break` / `progression_scheme` — stored rows may exist; removing the enum
values is I4. `session-timing.ts` (`isRetroLog`, retro timestamps) — real bookkeeping, used by tools.
`tool-policy` ordering/batch dedup — enforces RULE 7 (§ 3). `CURRENT_TIME_V1`, `TIME_GAP_V1`, `POST_TOOL_NUDGE_V1` —
shared by every phase. `EPISODE_SUMMARIES_V2`, `USER_FACTS_V2`, `COURSE_DIRECTIVE_V1`, course check, summariser,
verifier — chat and planning still use them (I3). `get_exercise_history` — the only way to see an exercise outside
today. Directives — other phases use them. `findRecentPerformancesForExercise`, `findLastSkipsByExercise` — the new
loader reads them.

**Tool descriptions that lived in the prompt text:** the old TOOLS section is deleted, not moved. Each tool's own
`description`/schema already says the same; edit only the stale references: `log_set` ("from the SESSION PLAN" →
"from today's plan in the context"), `get_exercise_history` ("NOT shown in EXERCISE HISTORY or RECENT WORKOUTS" →
"not among today's exercises"), `set_session_place` (drop the WORKOUT OVERVIEW "Place: not stated (ask …)"
exception — the ask line is gone). Tool RESULTS lose their prose instructions: `format-exercise-summary.ts`
`EXPLICIT_INSTRUCTION` / `SET_TRIGGERED_INSTRUCTION` (they drove the unrequested recaps, judge cases 12/17) and the
"Now congratulate…" tail of `finish_training`; the facts in those results stay.

## 3. Tool-safety check and the final prompt

| Old rule | Enforced by code today? | I1 |
|----------|------------------------|----|
| RULE 7 `order` for several sets; identical calls | yes — `tool-policy.ts` batch dedup + sort by `order` | nothing |
| delete/update before any set of the current exercise | yes — `tools/set-preconditions.ts` | nothing |
| exact exercise UUID | yes — zod `.uuid()` + service lookup (`llm_error` on a miss) | nothing |
| a set needs reps / duration / distance | yes — `log_set` schema refine | nothing |
| retro-dating a stale session | yes — `log_set` + `session-timing.ts` (BR-TRAINING-030/031) | one Today fact line |
| reply text with every tool call | yes — post-tool nudge forces a text reply | nothing |
| warm-up only from the client's words; per-hand weight | schema descriptions | nothing |
| RULE 0/8 log only real set data (a comment is not a set) | no | none in I1 — the frozen prompt has no such sentence; I2 |
| RULE 4/5 + anti-pattern: complete an exercise only when asked | no (description only) | none in I1 — I2 |
| RULE 7(finish): `finish_training` only when asked — irreversible | no (description only) | none in I1 — I2 |
| RULE 9 correct instead of re-logging; "never re-log sets already logged" | no — duplicate re-log corrupts the log | none in I1 — guard in I2 |
| RULE 10 no `log_set` + `delete_last_sets` for one exercise in one response | no — priority runs log first, then delete removes the new set | waits for I2 (executor rejection); rare |
| RULE 6 strength set needs a weight | no — reps without weight is stored as `functional_reps` | prompt: "never invent a number"; type check in I2 |
| RULE 1/2/3/11 report results faithfully, "not in the records" | no (reply text) | prompt: "confirm it as today's log shows it"; `get_exercise_history` description keeps the "not in the records" line |

Conclusion: **no guard sentence exists in the shipped prompt.** The four unenforced data-corruption guards (log only
real set data; complete an exercise only when asked; `finish_training` only when asked; correct instead of re-logging)
are I2 work — executor / tool-level guards — and stay unenforced until then. The frozen D13 text replaced the
single guard sentence of the first design.

Final training prompt (`TRAINING_COACH` section `coach`; `{language}` = English name of `user.languageCode` via
`Intl.DisplayNames(['en'], { type: 'language' })`, fallback `Russian` — the product's clients write Russian). Text
below is verbatim from `prompts/phases/training/coach.ts` for `ru`: **2 496 characters** (the frozen D13 round-9
text, `data/coach-simplification/i0/final-shape.md` § 1; budget 2 500, pinned by `coach.unit.test.ts` for `ru`, `uk` and
`languageCode: null`). A longer language name pushes it past 2 500 (e.g. "Brazilian Portuguese": advisory R3).

```text
You are the client's personal strength coach and training buddy, in Telegram while they train. You answer in Russian like a coach who knows them well: warm, encouraging, direct, brief. Usually two to five short sentences; a list only for a recap.

Each message gives their profile, today's plan with every set logged so far, their recent history per exercise (dates, loads used, how it moved) and habits, and this workout's conversation. That is all you know: never invent a number or fact, nor ask what these show.

How you coach:
- At the start, give a short strategy for today, not every set ahead: what to try on the first set, keeping a couple of reps in reserve, and judge the rest from how it goes. Warm-up in one phrase, in line with their habit; a warm-up set is light, 7–8 reps.
- Offer the next set as a try, never a demand: an optimistic, reachable number with an easy way out, like «Попробуй до 15, но не до отказа; если 12 хватило — не гонись». When last time topped the rep range with reps to spare, the try is the next load they have used; otherwise a rep or two more. For high-rep and burn sets: «сколько сможешь, до жжения».
- The client leads: when they add, swap or skip something, go with it and help, within the limits in their profile. Every planned set gets done unless they or pain say otherwise.
- Keep your line; change it only when something new happened, and say what. Your conditions count: «135, если останется запас» and reps were left means 135.
- After a set, confirm it as today's log shows it (never from memory of the chat), then the next step. Praise earned progress briefly, with both numbers; call a real jump a jump, and do not sell a rep or two as a new height. Compare like with like. A drop set or finisher gets a one-line verdict.
- Answer exactly what was asked; a recap request gets only the recap.
- If something hurts (not the usual burn), they stop that exercise; offer a safe alternative or finishing, and remember a new limit for next time (manage_fact).

Talk like a person, not a program: you suggest, you never "asked" or "change the plan"; no records, logs, systems, rules or conditions behind your words. Say RPE only if the client does. Technique cues only when concrete.

Emoji mark a special moment: a new best, a hard set done, a good finish. Use them with care, never in every message, as a professional would.

Your tools save reported sets. Format: Telegram HTML, <b> for key numbers, <i> sparingly; no Markdown, tables or headings.
```

## 4. Fact bugs seen in the evidence

- **"Session completed in -1 min"** — a ToolMessage from the 2026-09-29 workout, written before BUG-043's fix
  (`domain/training/session-timing.ts` `resolveCompletion` clamps since commit `880335e0`, 2026-09-30). It reached
  the 10-01 request only through old history. Fixed already; I1's workout-only history removes the stale message.
- **"Set 4 (-1min ago)"** — `buildWorkoutOverview` (`prompts/blocks/training-workout-overview.v1.ts`):
  `Math.floor((ctx.now − set.createdAt)/60000)` where `ctx.now` is frozen at run start and the set is created later
  in the same run (the post-tool call re-renders the block) → floor of a small negative = -1. The code is deleted;
  the new Today block prints no per-set ages and clamps every "ago" at 0 (unit test with a set created after `now`).
- **Previous episodes labelled "today 18:38"** — `graph/nodes/compact.node.ts` stores
  `endedAt: ctx.now.toISOString()`, the time of the compaction, which runs at the NEXT run (inactivity / phase
  boundary), so 09-29 episodes folded on 10-01 read as "today". Survives (chat renders summaries): set
  `endedAt` to `state.lastUserMessageAt ?? ctx.now` (the episode's newest user message — already the evidence time
  for facts in the same file). Training no longer renders summaries at all.

## 5. Tasks (sequential; the suite is green after each)

Common checks for every task (from `apps/server`): `npm run type-check && npm run lint && npm run format:check &&
npm run test:unit`; DB-backed: `/Users/filko/orca/workspaces/fit_coach/db-test-lock.sh npm run test:scenarios`;
from the repo root: `node scripts/state.mjs --check`. Snapshot updates (`-u`) only for the training entries named.
Commit per task, no attribution lines, no push.

**Task 1 — Build the new pieces, unused (AC-CS1-1).** Files: new `prompts/blocks/training-facts.ts`
(`TRAINING_TODAY_V1` id `training.today`, `TRAINING_HISTORY_V1` id `training.history`, `relativeDay`,
`formatSetShort`, `trendLine`), new `prompts/blocks/training-profile.ts`, new `prompts/phases/training/coach.ts`
(`TRAINING_COACH`; context = `DirectiveContext & { profileFacts: UserFact[] }`; sections `coach`, `profile`), new
`workoutHistory` in `graph/episode.ts`; export from `blocks/index.ts`. Tests (new): `training-facts.unit.test.ts` —
a case-07-shaped fixture (6 planned + 1 off-plan exercise, three dated performances each) renders exactly the § 1.1
lines for leg press, plank and cycling; RPE rules (mixed / none / all equal / warm-up); `relativeDay` at 0, 1, 4,
15, 159 days and across a year; trend variants (weighted, per hand, reps-only, isometric, cardio, mixed → none);
skipped and no-record lines; a set created after `now` never prints a negative age; the rendered text matches none of
`/recommend|conservative|next step|stage|tier|LOAD PLAN|should|progress|regress/i`. `training-profile.unit.test.ts` —
the owner's 11 facts (lower back ×3) → one lower-back line, no `break`/`progression_scheme`, no "confirmed"/dates,
registration goal only without facts. `coach.unit.test.ts` — rendered `coach` section ≤ 2 500 chars for `ru`, `uk`
and `languageCode: null`; contains `<context>`, no `RULE`, `LOAD PLAN`, `EXERCISE HISTORY`. `episode.unit.test`
additions — hand-off in `current` → `[]`; slice after the start call; not found → unchanged. Verify:
`NODE_ENV=test npx jest src/infra/ai/prompts src/infra/ai/graph/__tests__` + common checks (scenarios not needed).

**Task 2 — Switch the training phase (AC-CS1-2).** Files: `graph/phase-spec.ts` (`memory`), `graph/nodes/agent.node.ts`
(the `'workout'` branch), `graph/phases/training.spec.ts` (prompt `TRAINING_COACH`, new loader and `TrainingData`,
`contextBlocks: [TRAINING_TODAY_V1, TRAINING_HISTORY_V1]`, `memory: 'workout'`, tools without `get_load_plan`,
`log_set`/`complete_current_exercise` built without flag options, `budget.history: 16000`),
`prompts/phases/training/index.ts` (`TRAINING_PROMPT.current = TRAINING_COACH`, `requiredSections: ['coach',
'profile']`), tool text edits of § 2 (log_set / get_exercise_history / set_session_place descriptions; summary and
finish result tails). Tests to rewrite: `phase-specs.unit.test.ts` (training blocks, tools, prompt; drop the
flag-selection cases for training), `registry.unit.test.ts` (training `v13`, no directives),
`agent.node.unit.test.ts` (+ a `'workout'` case: no facts/directive/summaries in the system message, history
sliced), `format-exercise-summary.unit.test.ts`, `finish-training` / `set-session-place` / `get-exercise-history`
tool tests where they pin the edited text, `evals/snapshots` message-assembly + tool-surface (training entries,
`-u`), `evals/scenarios/b-full-workout.scenario.ts` and `c-catch-up-logging.scenario.ts` expected headers
(`# Today`, `# History`). Run the scenario suite (b-full-workout, c-catch-up, retro-timestamps, set-kind,
isometric-hold, exercise-history-lookup*). Verify: common checks incl. `db-test-lock.sh npm run test:scenarios`.

**Task 3 — Delete the load engine and the flags (AC-CS1-3).** Groups A, B, C, F, G, H, I, J of § 2 and the
load-plan scenario files of K. Planning keeps not advising loads (H: the flag-on branch becomes the only one).
`.env.example` loses the three lines; `ConversationGraphDeps` loses the four fields; `compact.node.ts` /
`verify-fact-operations.ts` select v6 / verifier v1 only (**as shipped the `CompactStepDeps` fields remain and nothing sets them — B1**). Tests: delete the whole-file ones listed; edit
`compact.node.unit.test.ts`, `agent.node.unit.test.ts` (breaks block), `manage-fact.tool.unit.test.ts` (break /
scheme describes), `log-set.tool.unit.test.ts` (advised / effort hint), `save-workout-plan` /
`start-training-session` tool tests (only the no-`targetWeight` schema), `session-planning.v5.unit.test.ts`,
`training-service-test-support.ts`, `review-prepare` / `conversation.graph` test stubs. Grep gate must be empty of code identifiers:
`grep -rnE "LOAD_PLAN_|load-plan|load-facts|get_load_plan|loadPlan|advised|effortHint|BreakContext|trainingBreak|plannerRebind|LoadRecommendation" src tests evals scripts | grep -vE "SUMMARIZER_V7|FACT_VERIFIER_V2|loadPlanBreaks|loadPlanSuggestion"`
(except the `load_recommendations` table in `infra/db/schema.ts` and migrations; remaining hits must be comments or
prose — the stale comments are advisory R4). **`SUMMARIZER_V7`, `FACT_VERIFIER_V2`, `loadPlanBreaks` and
`loadPlanSuggestion` are excluded from the gate pending the owner's B1 decision** (wire v7 / v2 unconditionally, or
approve their removal): the original gate required them gone, but deleting them changes the facts pipeline, an
owner-gated area. Verify: grep gate + common checks
incl. `db-test-lock.sh npm run test:integration` (repository readers changed).

**Task 4 — Delete the old prompts and blocks; fix the episode date (AC-CS1-4).** Groups D, E and the rest of K;
move `formatSetData`/`formatExerciseSets` to `blocks/set-format.ts` (update `log-set.tool.ts`,
`get-exercise-history.tool.ts`); `get_exercise_history` dates via `relativeDay`; remove training cases from
`prompt-snapshots` (+ delete their snapshot entries with `-u` on that file only), `prompt-contexts.ts`, `l0.ts`
allowlist; rewrite `prompt-cache-harness.ts` on a plain session fixture. Fix `compact.node.ts` `endedAt` (§ 4) with a
unit test: an episode whose last user message is 2 days old renders `2 days ago`, not `today`. Grep gate:
`grep -rnE "TRAINING_V[0-9]|WORKOUT OVERVIEW|EXERCISE HISTORY|RECENT WORKOUTS|SESSION GUIDE|buildWorkoutOverview|TRAINING_CLIENT_V1" src tests evals`
→ empty. Verify: grep gate + common checks incl. scenarios.

**Task 5 — Print and measure the assembled request (AC-CS1-5).** New `apps/server/scripts/print-training-request.ts`
(+ `npm run print-training-request`), offline — no DB, no model: `--history <json>` (`user`, `facts`, `lastWorkout`,
`warmupHabit`, `exercises[]` with `performances[].sets[]`), `--today <json>` (plan + sets), `--at <ISO>`, optional
`--messages <json>` (the checkpointed conversation, last element = the client's message); the JSON shapes are
documented in the script header and mirror the loader's `TrainingFactsData`. The named fixtures `--case07` and
`--plain` stay for the size test; **any other flag, a missing value or an unreadable file fails with a usage message
(exit 2)** — nothing is silently ignored (review B4; the first version offered only the built-in fixtures and
ignored unknown flags). It runs the real `TRAINING_COACH`, `TRAINING_TODAY_V1`, `TRAINING_HISTORY_V1`,
`workoutHistory` and `assembleContext`, prints the messages and a size line: characters per part (system, context,
history), total, estimated tokens (`token-estimator.ts`), and the tool-schema characters separately.
`training-request.size.unit.test.ts` on the in-memory fixture pins system ≤ 3 500 chars, context ≤ 6 000 chars.
Verify: script runs; common checks; `node scripts/state.mjs --check`.

**Measured (2026-10-04, real case-07 moment, Thursday Oct 1 18:59 Asia/Manila):** `--history/--today/--at/--messages`
over the real data (history and today from `data/coach-simplification/i0/cases/07/input.md`; messages = the real
client messages and coach replies and the real tool results of 2026-10-01 18:38–18:59 from
`data/coach-simplification/evidence/today.txt`, 33 messages with the start call; inputs under
`data/coach-simplification/i1/case07/`, gitignored): **14 098 chars, ≈ 4 185 estimated tokens** (system 2 496 + profile
431; context 878 Today + 2 355 History + 64 NOW; 7 796 this-workout messages; 51 the client's message) versus **≈ 58 000
chars before** (system 25k, context 13.8k) — about a quarter. Tool schemas (separate): 18 345 chars. Not in the
measurement: the warm-up habit line (≈ 100 chars; the last workouts are not in `input.md`) and the tool-call arguments
of the 6 tool calls after the start (not in the evidence, ≈ 600 chars). The earlier fixture-based figure (7 657 chars) is
superseded — it understated the message volume. The size-test budgets are unchanged (the real figure does not break
them: the system message is 2 927 ≤ 3 500, the context 3 297 ≤ 6 000).

**Task 6a — Sync the context blocks to the final shape (AC-CS1-6).** Commit `73bd8b27`. Goal: bring the facts blocks
and the prompt to the frozen i0 shape (`docs/superpowers/specs/2026-10-04-training-turn-shape.md`, § 3–4). Files:
`prompts/blocks/training-facts.ts`, `blocks/index.ts`, `prompts/phases/training/coach.ts`,
`graph/phases/training.spec.ts` (loader: `warmupHabit`, `loadsUsed`), `graph/__tests__/training-request-fixture.ts`,
`evals/scenarios/b-full-workout.scenario.ts`, the `message-assembly` snapshot, `prompt-cache-harness.ts`. What shipped:
the **habit line** in `# History` (`computeWarmupHabit`, last ten workouts with ≥ 2 exercises, shown when at least
half opened with cardio); **Loads used** per strength exercise (`collectLoadsUsed`, loader scans up to 60
performances); `(no RPE recorded)` on History lines with no effort at all; a **set_kind-only** `(warm-up)` label (a
legacy set without a kind is never labelled); the planner's **warnings and notes** rendered in `# Today`
(`Planning warnings:`, ` — planning note:`). Verify (from `apps/server`):
`NODE_ENV=test npx jest src/infra/ai/prompts/blocks/__tests__/training-facts.unit.test.ts src/infra/ai/prompts/phases/training/__tests__/coach.unit.test.ts src/infra/ai/graph/phases/__tests__/phase-specs.unit.test.ts`
+ `/Users/filko/orca/workspaces/fit_coach/db-test-lock.sh npm run test:scenarios` + the common checks.

**Task 6b — Check-in, Reported-today and the frozen prompt (AC-CS1-7).** Commit `1a496ce4`. Goal: the two state
lines of `# Today` (D12, D13), the prompt synced to the frozen text, the habit line replacing the cardio warm-up's own
history block. Files: `prompts/blocks/training-facts.ts`, `prompts/phases/training/coach.ts`, `graph/episode.ts`
(`hasCoachReply`), `graph/nodes/agent.node.ts` (`coachReplied`), `graph/phase-spec.ts` (`LoadInput.coachReplied`),
`graph/phases/training.spec.ts` (`reportedToday`, `coachReplied`, profile excludes facts created during the workout),
the fixture and the snapshot. What shipped: `Check-in: ask how the <group> is today — not asked yet today.` per
constraint group, only on the first training turn and only when the plan carries no planner warnings/notes;
`Reported today: <fact> (HH:MM)` for facts created during the session; `TRAINING_COACH` = the frozen round-9 text
(2 496 characters, `ru`); the habit line replaces the History block of today's first exercise when it is a habitual
cardio kind. Verify (from `apps/server`):
`NODE_ENV=test npx jest src/infra/ai/prompts/blocks/__tests__/training-facts.unit.test.ts src/infra/ai/prompts/phases/training/__tests__/coach.unit.test.ts src/infra/ai/graph/__tests__/episode.unit.test.ts src/infra/ai/graph/phases/__tests__/phase-specs.unit.test.ts`
+ `/Users/filko/orca/workspaces/fit_coach/db-test-lock.sh npm run test:scenarios` + the common checks.

## 6. Durable docs that will contradict the code after I1 (list only — owner approves amendments)

- `docs/adr/0013-llm-core-target-architecture.md` § 3.4 (one message shape for every phase; block 2 facts /
  directive / summaries in every phase; budget table — training history 16 000) and the § 3.4 note at line ~212
  (`block.time_gap` v2 with `LOAD_PLAN_BREAKS`); `StoredEpisodeSummary.endedAt` = "time of the compaction".
- `docs/adr/0009-user-long-term-memory.md` "Always injected — all stored facts … every phase … `## User Facts`"
  (lines ~38, ~262, ~333) and the 2026-10-01 amendment (`break` / `progression_scheme` written by summariser v7).
- `docs/domain/training.spec.md` BR-TRAINING-036, 037, 038, 039, 041, 042, 043, 044, 045 (040 stays).
- `docs/ARCHITECTURE.md` lines 75–82 (`load-facts/`, `load-plan/` trees), 147 (training v11/v12 prompt chain), 183–184
  (`get-load-plan.tool.ts`), plus the older ~212, 461 (time-gap v2, summariser v7, assembler "user facts + course
  directive" for every phase) — and the files I1 adds (`prompts/blocks/training-facts.ts`, `training-profile.ts`,
  `prompts/phases/training/coach.ts`, `workoutHistory` in `graph/episode.ts`, `scripts/print-training-request.ts`).
- `docs/domain/conversation.spec.md` lines 33–37 (dialogue history / `## Previous episodes` for every phase — training
  now sees this workout's messages only).
- `docs/CONTRIBUTING_AI.md` lines ~164 (the three `LOAD_PLAN_*` flags) and ~167 (summariser v7 / verifier v2).
- `docs/MANUAL_TEST_PLAN.md` line ~69 (`get_load_plan` in the training tool list).
- **New behaviours to record as BR candidates** (owner approves ids and wording; `docs/domain/training.spec.md` /
  `conversation.spec.md`): (1) *workout-only memory* — the training phase sends this workout's messages only, with no
  user-facts block, course directive or episode summaries; (2) *`# Profile` rules* — constraints first, one fact per
  `(category, muscleGroup)`, `break` / `progression_scheme` dropped, no confirmations or dates, facts created during the
  workout excluded; (3) *`# Today` state lines* — `Check-in:` (first turn, constraint in profile, no planner
  warnings/notes), `Reported today:` (facts created during the session), `Planning warnings:` / `planning note:`
  (planner output verbatim); (4) *History habit line and Loads used* — habit line over the last ten workouts with ≥ 2
  exercises when at least half opened with cardio; Loads used per strength exercise, the last 60 days ascending, older
  grouped with their last date.
- Root `CLAUDE.md` § LLM: still true (one stable system message, `<context>` part) — no conflict found.

## 7. Risks and open questions for the coordinator

1. **Q1 Profile still above 8 lines for the owner (≈ 10).** After the dedupe two near-identical goal facts and a
   "speaks Russian" fact remain; code cannot merge free text safely. Recommendation: accept in I1 (the owner's facts
   are a data issue); clean them up by `manage_fact` in a chat, and simplify fact writing in I3. No text-similarity
   dedupe.
2. **Q2 Mid-workout budget compaction hides early workout turns** (summaries are no longer shown in training).
   Recommendation: raise training `budget.history` 8 000 → 16 000 tokens in the spec (the whole request still ends at
   about a third of today's); revisit with I2's measurements.
3. **Q3 Removing tool-result instructions** (summary/finish tails, BUG-037's reply order) could bring back "recap
   first". Recommendation: remove them in I1 (P2; they caused cases 12/17) and watch cases 08/09/14 in the eval
   replay; restore one neutral sentence only if the replay regresses.
4. **Q4 RULE 10 (log + delete in one response) stays unguarded until I2.** Recommendation: accept; it is rare and the
   prompt sentence discourages re-logging; put the executor rejection first in I2.
5. **Q5 Planning prompt keeps a one-phrase edit in I1** (v5 becomes current without "LOAD PLAN"). Recommendation:
   do it — otherwise a deleted concept stays in a live prompt; anything deeper in planning stays in I3.
6. **Q6 Course check still runs on training turns** (one extra model call when its events fire) though training no
   longer renders it. Recommendation: leave it for I3's verdict on the course layer; do not special-case training.

## Review

Verdict: **blocked (2026-10-04)** — four independent Opus zones (R1 architecture, R2 duplication, R3 correctness, R4
documentation currency). No `- Review:` header line is added while blocked.

| ID | Zone | Where | Rule / source | Finding | Status |
|----|------|-------|---------------|---------|--------|
| B1 | R1, R2, R3 | `compact.node.ts:110-113,125-127,294-300,449-475`, `verify-fact-operations.ts:72,95`, `conversation.graph.ts` (pass-through removed) | ADR-0009 Amendment 2026-10-01; master plan § 3 facts owner-gated; CONTRIBUTING_AI YAGNI | "The flags are gone from config, deps and wiring, but `CompactStepDeps.loadPlanBreaks/loadPlanSuggestion` still exist and nothing sets them, so `categoryFlags` is now always false. Compaction therefore always uses summariser v6 / verifier v1, and `gatedOperationValid` drops every `break` / `progression_scheme` operation. Dev ran with all three flags true, so the facts pipeline changes on deploy." | **open — owner decision** (wire v7/v2 unconditionally, or approve removal) |
| B2 | R1 | `prompts/phases/training/coach.ts:60` + `agent.node.ts:227-228`; `agent.node.ts:249-253` + `phase-spec.ts` (`memory`) + `training.spec.ts:109` | ADR-0013 § 3.4 (2026-09-30 amendment), INV-LLM-004 | "For training, user facts leave the long-term block and are rendered inside block 1 as the `profile` section of the phase prompt module … `memory: 'workout'` sends training a sliced history and no directive or summaries: a per-phase message shape. Merging it makes the code contradict the ADR." | **open — owner approval of the ADR-0013 § 3.4 amendment** |
| B3 | R3, R4 | this plan § 1 (:63, :74), § 3 (:184-201), § 5 (Tasks 1–5 only), § 6 | SUPERPOWERS_INTEGRATION rules 1–2 | "Tasks 6a and 6b (commits 73bd8b27, 1a496ce4) shipped with no task, no AC and no verification command … the only full spec is `data/coach-simplification/i0/final-shape.md`, which is gitignored." | **fixed on the branch (this commit)**: Tasks 6a/6b, § 1, § 3, § 6 amended; spec committed under `docs/superpowers/specs/` |
| B4 | R3 | `scripts/print-training-request.ts:16-18` | AC-CS1-5 | "The work order asks the script to read real data via `--history <json> --today <json> --at <ISO> [--messages]`. It only offers built-in fixtures … Unknown flags are silently ignored … the size claim is unproven." | **fixed on the branch**: real-data inputs, loud failure on unknown flags; case 07 re-measured (§ 5 Task 5) |
| B5 | R2 | `workout-session.repository.ts:391`, `workout-session.ports.ts:85`, `domain/training/place.ts:7-8` | YAGNI; plan § 2 J | "`distinctRecentPlaces`, `RECENT_PLACES_WINDOW` and `PLACE_AMBIGUOUS_THRESHOLD` have no production caller left." | **fixed on the branch**: deleted with their stubs and the integration block |

Advisory — every item: status **backlog candidate, I4**.

| Zone | File / place | Finding |
|------|--------------|---------|
| R1 | `training-facts.ts` (612 lines) | Mixes block rendering, training-domain derivations (`computeWarmupHabit`, `collectLoadsUsed`, trend), fact-category interpretation and `relativeDay`; the derivations belong in `domain/training`. |
| R1 | `get-exercise-history.tool.ts:11` | Imports `relativeDay` from a phase block; it belongs in `@shared/date-utils`. |
| R1 | `LoadInput.coachReplied`, `episode.ts` | `coachReplied` is training-only on the generic loader input; `episode.ts` hard-codes `start_training_session`. |
| R1 | `domain/training/fact-formats.ts` | Holds user-fact category formats (belongs to `domain/user`); exists only because group I was kept. |
| R1 | `print-training-request.ts` | Imports a `__tests__` fixture. |
| R1 | `Check-in:` line in `# Today` | An instruction inside a "facts only" block — record as a named exception (D12) in the block header. |
| R2 | `formatSetShort`, `formatSetData`, `format-exercise-summary` | Three renderers of the same `SetData` with disagreeing output (`(warm-up)` vs `(w/u)`); two sets-line renderers. |
| R2 | `dayLabel` / `shortDate` | Duplicate `formatToParts` code. |
| R2 | `get-exercise-history.tool.ts:84-93` | Builds a `ContextBlockCtx` only to read the timezone back. |
| R2 | `rehydratePerformances`, `realPerformanceConditions` | Stale "shared by" comments. |
| R2 | `training-request-fixture.ts`, `training-facts.unit.test.ts` | Test builders duplicated. |
| R2 | training loader | Runs `findByIdsWithMuscles` only to read names. |
| R3 | `coach.ts:19-27` | Language names such as "Brazilian Portuguese" push the prompt past 2 500 (the test covers ru/uk/null only; the fallback is "Russian", the comment says "neutral"). |
| R3 | `training.spec.ts:190-193` | `reportedToday` is split by `createdAt` only: an updated fact stays in `# Profile` (breaks the cached system message), boundary-compaction facts show as "Reported today". |
| R3 | `training.spec.ts:151-161` | Loads 60 performances per exercise every turn for "Loads used", unbounded. |
| R3 | `episode.ts:140-155` | After compaction folded the start call, planning/chat AI text counts as a coach reply and the check-in is suppressed; untested. |
| R4 | `compact.node.ts`, `verify-fact-operations.ts`, `summarizer/index.ts`, `fact-verifier/index.ts`, `v7.ts`, `v2.ts` | Stale comments treat `LOAD_PLAN_BREAKS/SUGGESTION` as live. |
| R4 | this plan § 6 | Missed `ARCHITECTURE.md` lines 75-82, 147, 183-184 and the new files, and `docs/domain/conversation.spec.md:33-37` (added to § 6 in this commit). |
| R4 | `npm run print-training-request` | Undocumented outside plans. |
| R4 | `docs/STATE.md:270,359`, `docs/BACKLOG.md:880,883,892` | Still point to print-load-plan / get-load-plan (I4 routing). |
