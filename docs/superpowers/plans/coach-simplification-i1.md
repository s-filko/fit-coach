# Coach Simplification I1 — New Training Turn Implementation Plan

- Status: in progress
- Parent: `docs/superpowers/plans/coach-simplification.md` § 4 I1 (read § 2 principles P1–P8 first). Branch
  `plan/coach-simplification-i1`, one worktree. Server code is in `apps/server/src` (paths below are relative to it
  unless they start with `apps/`, `docs/` or `data/`). All commands run from `apps/server` unless noted.
- Reference rendering: `data/coach-simplification/i0/cases/07/input.md` (gitignored, local only) and
  `data/coach-simplification/i0/judge-notes.md`. Durable specs are NOT edited in I1 (§ 6 lists them for the owner).

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

### 1.1 The facts block — exact format

Rules: facts only — no recommendation, verdict, reason, "up/down/better/worse", target or next step. Sets as
`reps×kg` (unit legend once per block header). An RPE is printed only where it was logged: a working set without RPE
in a line that has rated sets gets `(no RPE)`; a line where no working set is rated ends with `— no RPE recorded`;
when every working set of a line has the same RPE, write `— all RPE 8` once. Warm-up sets: ` (warm-up)`, never
rated-or-unrated notes. A set note: ` — note: "<text>"`. Dates: no time of day (judge: invented «вечером»). Helper
`relativeDay(date, now, tz)` (calendar days in the user tz): 0 → `today`; 1 → `yesterday, Wednesday Sep 30`;
2–59 → `4 days ago, Sunday Sep 27`; ≥ 60 → `Friday Apr 24, about five months ago` (months = round(days/30), in
words up to twelve; add the year when it differs). Any "N min ago" is clamped at 0.

Set renderer `formatSetShort(setData)`: strength `12×130` (`10×12 per hand`; weight null → `12 reps`);
functional_reps `12 reps`; isometric `45 s`; cardio_duration `9 min` (< 60 s → `40 s`, intensity appended);
cardio_distance `2.26 km in 17 min` (duration 0 → `2.26 km, time not recorded`; `, 5% incline`); interval
`6 rounds 30 s on / 30 s off`.

```
# Today (sets as reps×kg)
Session started at 18:38 (21 min ago). Place: <only when stated>.
Previous workout: 2 days ago, Tuesday Sep 29 — Treadmill, Chest-Supported Row, Smith Machine Bench Press, Lateral Raise Machine, Reverse Pec Deck Fly, Plank.
Plan and sets so far:
- 45° Leg Press [id <uuid>] — plan 4×12 — in progress: 12×130 (RPE 8), 12×135 (RPE 8), 12×135 (RPE 9), 16×135 (RPE 9.5)
- Leg Extension [id <uuid>] — plan 3×15 — nothing yet
- Plank [id <uuid>] — plan 2×45 s — skipped
Off plan:
- Cycling [id <uuid>] — done: 9 min (warm-up)
```
Status words: `in progress` / `done` / `skipped` / `nothing yet` (from `session_exercises.status`). No plan →
`No plan for this session.` Stale session (`isRetroLog(session, now)`) adds one fact line: `No activity for 3 h;
a set logged now is dated to the session's last activity.` Plan notes/warnings from the planner are not rendered.
The exercise id appears here only (tools need it); History never repeats ids.

```
# History (before today; sets as reps×kg)

45° Leg Press (today 4×12)
- 4 days ago, Sunday Sep 27: 12×110, 12×130 (RPE 8), 12×130 (RPE 8), 12×135 (RPE 9)
- 10 days ago, Monday Sep 21: 12×110, 12×110, 12×120, 12×120 (RPE 9)
- 15 days ago, Wednesday Sep 16: 10×80 (warm-up), 12×110, 12×110, 12×110 — all RPE 9
- Trend Sep 16 → Sep 21 → Sep 27: top weight 110 → 120 → 135 kg; working sets 3 → 4 → 4; reps per working set 12 → 12 → 12; weight × reps 3,960 → 5,520 → 6,060.

Plank (today 2×45 s)
- 2 days ago, Tuesday Sep 29: 45 s, 45 s
- 4 days ago, Sunday Sep 27: 45 s, 45 s
- Trend Sep 21 → Sep 27 → Sep 29: hold per set 45 → 45 → 45 s; sets 2 → 2 → 2.

Cycling (today off plan)
- 21 days ago, Thursday Sep 10: 10 min — note: "время не засекал; 10 мин — оценка владельца"
```
Trend line (≥ 2 performances, oldest → newest, working sets only, short dates): weighted strength — `top weight`,
`working sets`, `reps per working set` (one number or `min–max`), `weight × reps` (Σ, thousands separator; `per
hand` noted); reps only — `working sets`, `reps per set`, `total reps`; isometric — `hold per set`, `sets`;
cardio_duration — `minutes`; cardio_distance — `distance … km; time … min`. Mixed set types across performances →
no trend line. A skip newer than the newest performance → `- skipped Tuesday Sep 29 (planned, not done)`. No
performance → `- no earlier record`.

### 1.2 Profile and its dedupe rule

`renderTrainingProfile(user, facts)` (new `prompts/blocks/training-profile.ts`), `# Profile`, one `- ` line each:
1. user record: `<firstName>, <age>, <gender>, <height> cm, <weight> kg, <fitnessLevel>` (unknown parts omitted).
2. `Goal at registration: <fitnessGoal>` — ONLY when `facts` is empty. **3-vs-5 resolution:** the three sources were
   the registration goal («сила, 3 раза в неделю»), a user fact (5×/week, 8× confirmed) and the course directive
   (derived from the registration goal). User-stated facts are newer and confirmed, so they win: the directive leaves
   the training request and the registration goal is shown only when there are no facts.
3. facts: drop categories `break` and `progression_scheme`; among facts with a non-null `muscleGroup`, keep one per
   `(category, muscleGroup)` — the latest `updatedAt`, tie → more `confirmations` (three lower-back facts → one);
   `physical_constraint` lines first, then `getForPrompt` order. Line = fact text, plus ` (<phaseNote>)` for a
   long-term fact with a phase note. No confirmation counts, no dates, no category headings.

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
rejects `break` / `progression_scheme` unconditionally, `TIME_GAP_V2` branch + `ctx.trainingBreak` in
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
| RULE 0/8 log only real set data (a comment is not a set) | no | prompt sentence (below) |
| RULE 4/5 + anti-pattern: complete an exercise only when asked | no (description only) | prompt sentence |
| RULE 7(finish): `finish_training` only when asked — irreversible | no (description only) | prompt sentence |
| RULE 9 correct instead of re-logging; "never re-log sets already logged" | no — duplicate re-log corrupts the log | prompt sentence now; guard in I2 |
| RULE 10 no `log_set` + `delete_last_sets` for one exercise in one response | no — priority runs log first, then delete removes the new set | waits for I2 (executor rejection); rare |
| RULE 6 strength set needs a weight | no — reps without weight is stored as `functional_reps` | "never invent a number … ask" covers it; type check in I2 |
| RULE 1/2/3/11 report results faithfully, "not in the records" | no (reply text) | "Confirm only what the log shows"; `get_exercise_history` description keeps the "not in the records" line |

Conclusion: one sentence carries the four unenforced data-corruption guards now; I2 moves them into tools.
Final training prompt (`TRAINING_COACH` section `coach`; `{language}` = English name of `user.languageCode` via
`Intl.DisplayNames(['en'], { type: 'language' })`, fallback `the client's language`). 2 469 characters with
"Russian" (2 483 with the fallback); pinned ≤ 2 500 by a unit test. Changes from `i0/coach-prompt.md`: language
placeholder; paragraph 2 says where the facts arrive (`<context>`, not written by the client); "the lower back first"
→ "its health limits first" (profile-agnostic); the tool sentence; two trims for size.

```text
You are the client's personal strength coach, talking with them in Telegram while they train in the gym. You answer in {language}, the way an experienced coach who knows them well talks: warm, direct, brief. Usually two to five short sentences; a list only when you recap sets.

The client's latest message starts with a <context> part they did not write: today's plan with every set logged so far, the last three performances of each exercise with dates and trend, and the time now. With this workout's conversation, that is what you know. Never invent a number; if something is missing, say so or ask.

How you coach:
- Before an exercise, recall what they did last time and how it has been going, then offer one small, reachable target just above it, with a fallback that takes the pressure off. For example: «В прошлый раз 12 повторов на RPE 10 с таким-то весом. Ты хорошо отдохнул — можем попробовать чуть больше, дотянуть до 15. Не получится — остаёмся на 12».
- Progression is double progression: when they reach the top of the rep range with a rep or two to spare, the next session takes the next small weight step; otherwise they add a rep at the same weight. Effort naturally rises from set to set within a workout; that is normal, not a setback.
- When they beat an earlier result, say so with the numbers and be glad with them.
- Compare like with like: same exercise, weight and number of sets. Call a result worse only when it really is and it matters, and then say plainly why.
- Hold one line: once you have advised a load, keep it unless something new happened, and say what changed.
- After they report a set, confirm what was recorded with the exact numbers from today's log, then give the next step in a sentence or two. If they correct you, take it on board in a few words and move on.
- If something hurts (not the usual burn or fatigue), they stop that exercise; offer a safe alternative or finishing for today.
- Respect the profile, its health limits first.

Talk like a person, not a program: never mention records, a database, a system, data blocks or calculations. Say RPE only if the client uses it; otherwise talk about reps left in the tank.

Your tools keep the log: record each reported set once, fix a wrong set instead of logging it again, and move on or end the workout only when the client says so. Confirm only what the log shows.

Format: Telegram HTML, <b> for the key numbers and <i> sparingly; no Markdown, no tables, no headings.
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
`verify-fact-operations.ts` select v6 / verifier v1 only. Tests: delete the whole-file ones listed; edit
`compact.node.unit.test.ts`, `agent.node.unit.test.ts` (breaks block), `manage-fact.tool.unit.test.ts` (break /
scheme describes), `log-set.tool.unit.test.ts` (advised / effort hint), `save-workout-plan` /
`start-training-session` tool tests (only the no-`targetWeight` schema), `session-planning.v5.unit.test.ts`,
`training-service-test-support.ts`, `review-prepare` / `conversation.graph` test stubs. Grep gate must be empty:
`grep -rnE "LOAD_PLAN_|load-plan|load-facts|get_load_plan|loadPlan|advised|effortHint|BreakContext|trainingBreak|SUMMARIZER_V7|FACT_VERIFIER_V2|plannerRebind|LoadRecommendation" src tests evals scripts`
(except the `load_recommendations` table in `infra/db/schema.ts` and migrations). Verify: grep gate + common checks
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
(+ `npm run print-training-request`), offline — no DB, no model: `--history <owner-history.json>` (shape of
`data/replay-2026-10-01/owner-history.json`: `user`, `facts`, `workouts[]` with `exercises[].sets[]`), `--today
<json>` (same workout shape: plan + sets with `at`), `--at <ISO>`, optional `--messages <json>`; maps them to
`WorkoutSessionWithDetails` / `UserFact`, runs the real `TRAINING_COACH`, `TRAINING_TODAY_V1`,
`TRAINING_HISTORY_V1` and `assembleContext`, prints the messages and a size line: characters per part (system,
context, history), total, estimated tokens (`token-estimator.ts`), and the tool-schema characters separately. Add
`training-request.size.unit.test.ts` on the Task 1 fixture: system ≤ 3 500 chars, context ≤ 6 000 chars (catches
growth). Run the script on the case-07 moment (coordinator supplies `--today` from
`data/coach-simplification/evidence/`); expected ≈ 3.4k system + ≈ 3.6k context + ≈ 7–10k workout history ≈
14–17k chars (≈ 4–5k estimated tokens) vs ≈ 58k chars before (system 25k, context 13.8k). Record the measured
numbers in § 6 of the master plan via the coordinator. Verify: script runs; common checks; `node scripts/state.mjs
--check`. The eval replay with the real assembled context (master plan I1 exit) uses this script's output as the
user turn — run by the coordinator, not in this task.

## 6. Durable docs that will contradict the code after I1 (list only — owner approves amendments)

- `docs/adr/0013-llm-core-target-architecture.md` § 3.4 (one message shape for every phase; block 2 facts /
  directive / summaries in every phase; budget table — training history 16 000) and the § 3.4 note at line ~212
  (`block.time_gap` v2 with `LOAD_PLAN_BREAKS`); `StoredEpisodeSummary.endedAt` = "time of the compaction".
- `docs/adr/0009-user-long-term-memory.md` "Always injected — all stored facts … every phase … `## User Facts`"
  (lines ~38, ~262, ~333) and the 2026-10-01 amendment (`break` / `progression_scheme` written by summariser v7).
- `docs/domain/training.spec.md` BR-TRAINING-036, 037, 038, 039, 041, 042, 043, 044, 045 (040 stays).
- `docs/ARCHITECTURE.md` lines ~83, 152–155, 157, 185–186, 191, 196, 202–205, 212, 461 (load-plan tree, LOAD PLAN
  blocks, v11/v12, time-gap v2, summariser v7, assembler "user facts + course directive" for every phase).
- `docs/CONTRIBUTING_AI.md` lines ~164 (the three `LOAD_PLAN_*` flags) and ~167 (summariser v7 / verifier v2).
- `docs/MANUAL_TEST_PLAN.md` line ~69 (`get_load_plan` in the training tool list).
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
