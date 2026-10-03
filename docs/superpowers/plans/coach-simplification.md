# Coach Simplification — Master Plan (delete-first refactor of the coaching core)

- Status: in progress

> **This is the governing plan from 2026-10-02 (owner order).** It supersedes the dispatch order in `docs/STATE.md`
> § Next. The planned stubs `coach-tone`, `restart-ladder`, `cold-start` and `refactor-p6-progress-and-drafts` are
> **on hold** — this plan absorbs or deletes their subject. Do not dispatch them.

## 0. Resume here (read first after a restart or compaction)

1. You are the **architect and coordinator**. You do not implement, investigate at length, or read large files
   yourself. Every piece of work goes to a subagent (Agent tool): **Opus** for design, judgement, case building and
   review; **Sonnet** for implementation and mechanical work. Keep your own context small: a subagent returns a
   short report and writes its details into files; you read the short report, not the files, unless a decision
   needs it.
2. Read § 6 **Progress log** (bottom) — the last entry says exactly where the work stands and what the next
   action is. Then read § 4 for the current iteration only.
3. The owner is asked **one simple question at a time**, recommendation first, and only where the answer changes
   what happens next. Everything else is decided by the coordinator and recorded in § 5 as `(D)`.
4. After every step that changes the state of the work, append one dated line to § 6. That log is the memory.
5. Reply to the owner in Russian; docs stay English.

## 1. Why (diagnosis, 2026-10-02)

The owner's assessment after the 2026-10-01 dev workout: the coach got much worse — demotivating, counting wrong,
contradicting itself, detached from history. The owner's hypothesis: over-engineering; a plain model with a short
prompt would do better at a tenth of the cost. The coordinator's analysis of the real 18:59 request
(`data/coach-simplification/evidence/req/b527d1bf_2.txt`) confirms it. Five architectural problems, by weight:

1. **Division of labour is inverted.** Code makes coaching decisions (stages, return ladders, gap tiers, "cold
   start", "counts as 13") and the model is told to relay and justify them. Bookkeeping that code could enforce is
   given to the model as twelve prose rules. Standard: code owns facts and state; the model owns judgement and words.
2. **No single source of truth.** A past workout reaches the model in five forms (EXERCISE HISTORY, RECENT
   WORKOUTS, LOAD PLAN, episode summaries, old messages); advice comes from three (planning phase, the engine,
   summary "decisions"). Hence "130 then 135" and "volume grew / no, fell".
3. **The prompt describes prohibitions, not a coach.** One role line, then ~19k characters of rules; nothing about
   tone, encouragement, progress. v12 is v11 plus string replacements — the eleventh version in fifteen days.
4. **Scaffolding built for weak models stayed under a strong one.** The guards answer Gemini Flash / GLM Flash
   failures; dev runs Sonnet 5.5 and the scaffolding is now the main source of defects.
5. **Text is verified, not outcome.** Tests pin prompt strings and plan conformance; nothing asks whether the coach
   sounds right. So each fix is locally correct and globally harmful.

Complaint → source, all verified in that request: "16 reps does not count" ← engine line `≥ 15 once at RPE ≤ 8`;
one phrase six times ← prompt rule "name the `next step:` condition"; calves "long break" ← engine line `restart
tier (150 d gap before the last workout)`, `no number`; "no next weight in the base" ← `equipmentStep missing`;
jargon («система», «LOAD PLAN», «холодный старт») ← the prompt speaks that language and demands citing it;
3 vs 5 sessions a week ← profile goal, a user fact and the course directive disagree; no trend, no praise ← one
prior performance per exercise and no word about encouragement.

Scale on 2026-10-01: ~35k input tokens per call, two calls per logged set, 55 calls per workout; instructions
~19k chars; LOAD PLAN block 8.5k chars; server 31.7k LOC + 34.5k LOC tests; docs 41k lines, 118 BR ids, 57 plans.

## 2. Target (what "in order" means)

**Principles — the test every change must pass:**

- **P1 Delete first (owner, 2026-10-02: "do not be afraid to delete what brings little benefit and much
  complexity").** Low benefit + high complexity = deleted, not flagged off, not kept "just in case". Git is the
  archive.
- **P2 Code owns facts and state; the model owns judgement and words.** Code never emits a recommendation, a
  verdict or a reason. It emits dated facts.
- **P3 One source per fact.** A fact appears in the request once.
- **P4 The prompt describes the coach and the outcome**, with one canonical example (the owner's own:
  «В прошлый раз 12 повторов на RPE 10 с таким-то весом. Ты хорошо отдохнул — можем попробовать чуть больше,
  дотянуть до 15. Не получится — остаёмся на 12»). No lists of edge cases, no capital-letter prohibitions.
- **P5 What code can enforce is enforced in tools** (validation + a clear error), never in prose.
- **P6 Size is a budget.** Training system prompt ≤ 2 500 characters; a line is added only by removing one.
  One prompt file per phase, no version chain.
- **P7 Outcome is the gate.** Every prompt or context change is replayed over the eval set (§ 3) before merge.
- **P8 Add on top only what fits the shape**: a new piece must be a fact for the facts block, a tool, or one line
  of the coach description. Anything that needs its own block, its own model call or its own tuning knobs needs
  the owner's yes.

**Target shape of a training turn:** system = coach prompt (≤ 2.5k chars) + deduplicated user profile (≤ 8 lines);
tools described only by their schemas; context = one block "today" (plan, logged sets) + one block "history" (last
three performances of each of today's exercises, dated, with a plain trend line) + NOW; messages = this workout
only. Expected: about a fifth of today's request, instructions about a tenth.

**Keep as is:** LLM I/O audit trail (`llm_calls`, transcript export), tools and DB schema, migrations discipline,
prompt caching, run mutex, bot watchdog, deploy.

## 3. Operating rules

- **Executors:** Agent-tool subagents, Opus / Sonnet as in § 0. Code changes run in an isolated worktree
  (`isolation: "worktree"`), one branch per iteration `plan/coach-simplification-i<N>`. One Opus review per
  iteration (not per task). Review, merge, `Status:` and deploy stay with the coordinator.
- **Eval set (P7):** `data/coach-simplification/i0/cases/` — moments from real transcripts, each with the user's
  message, the facts, the real dev reply and what a good reply must and must not contain. Replies are generated on
  the subscription (`claude -p`, system prompt replaced, no tools; fallback: one subagent per case), never through
  the app's API unless the owner says yes. Judges: the owner on blind pairs for big steps; an Opus subagent with
  the rubric (`i0/rubric.md`) + a banned-jargon check for routine regression.
- **Tests:** unit + scenario suites green before merge (`db-test-lock.sh` when DB-backed); no local installs.
- **Owner-gated, always asked first:** anything on the VPS (ssh, `.env.dev`), push, model runs through the API,
  DB data changes, edits of durable specs (ADR, `*.spec.md`, BR ids), deletion of branches/worktrees (the hook
  prompts). Prod is frozen: every iteration ends at the dev deploy.
- **Commits:** docs commits stay local with `[skip ci]` until the owner allows a push; no attribution lines.
- **Evidence** (gitignored, personal data): `data/coach-simplification/evidence/` — `today.txt` (2026-10-01
  transcript), `req/<run>_<call>.txt` (65 reconstructed requests), `handoff-facts.md`, `turns.txt`, `runs.txt`,
  `v12.txt`. Owner's full history: `data/replay-2026-10-01/owner-history.json`.

## 4. Iterations

Each iteration: goal → work → exit check → owner gate. Do them in order; do not start one before the previous
exit check is recorded in § 6.

### I0 — Measure (no code change)

Goal: test the hypothesis on the owner's own workout before deleting anything, and get the eval set.
1. Opus subagent: build 20 cases from the 2026-10-01 transcript (must include: start advice 130/135; 130 done as
   advised; 16×135 RPE 9.5; "all three at 135"; leg extension "no next weight"; superset recap; calves first
   advice; "икры были регулярно"; RPE 8 asked after RPE 9; volume comparison; "ты сам виноват"; biceps 10 kg;
   session end); write the minimal coach prompt `i0/coach-prompt.md` (≤ 2.5k chars, P4) and the facts renderer
   input per case (today + last three performances + trend, from `owner-history.json`); write `i0/rubric.md`.
2. Coordinator reads the prompt only (it is the key artefact) and corrects it.
3. Sonnet subagent: generate the new replies; re-generate 5 cases with the *current* prompt in the same harness as
   a harness-effect control; assemble blind pairs (real dev reply vs new reply, order randomised, key kept apart)
   as one page for the owner.
4. Owner picks the better reply per pair.
Exit: verdict recorded. New side wins clearly (≥ 14/20) → I1. Otherwise → stop and re-diagnose with the owner.

### I1 — New training turn (the core change)

Goal: the training phase runs on the target shape of § 2.
- One coach prompt file for training (P4, P6, size pinned by a test); tool descriptions only in schemas.
- One facts block: today + last three performances per exercise + trend line; plain facts, no recommendation.
- Training context drops: LOAD PLAN block, EXERCISE HISTORY / RECENT WORKOUTS as separate blocks (folded into
  the one block), episode summaries, course directive, messages from before this workout, planning tool chatter.
- Profile: deduplicate user facts shown to the model (three lower-back facts → one; 3 vs 5 sessions resolved).
- Delete in the same branch (P1): `domain/training/load-plan/` (decision engine, schemes, gap tiers, ladders,
  breaks, effort hint), the LOAD PLAN blocks v1/v2, `get_load_plan`, the recommendation log writer, flags
  `LOAD_PLAN_*`, training prompt versions v1–v12, and their tests/golden tables. Keep plain metrics only if the
  facts block uses them. The `load_recommendations` table stays untouched (no destructive migration).
- Fix the fact bugs seen in the evidence if the code survives: "Session completed in -1 min", "Set 4 (-1min
  ago)", previous-episode labels "today".
Exit: eval set replayed with the real assembled context — no regression against the I0 new side (Opus judge +
jargon check); suites green; request size measured and logged. Owner gate: push + dev deploy, then one live workout.

### I2 — Bookkeeping into tools

Goal: P5. Duplicate-set guard, preconditions and correction flow are enforced by the tools with clear errors;
the prose rules that covered them are gone (they are already absent from the I1 prompt — this iteration makes
that safe). Review the forced "one tool round, then text" loop and the `order` field; simplify if tests allow.
Exit: tool scenario tests green incl. new guard tests; a 10-moment tool-correctness run through the app
(model-backed — ask the owner once). Owner gate: dev deploy + live workout.

### I3 — The other phases and the side calls

Goal: the same shape for `chat` and `session_planning`, and one advice-giver. Decide each by evidence, one at a
time, each replayed on the eval set (extended with 5–8 planning/chat moments):
- planning must not pre-advise loads that training will advise again (or merge planning into the workout start);
- course check + directive (extra model call, duplicate constraints, the 3-vs-5 contradiction) — delete unless
  it shows a benefit;
- fact verifier model call and summariser "decisions" — simplify to facts the user stated;
- episode summaries: keep only what chat needs.
Exit: per-item verdict in § 5; suites green. Owner gate: dev deploy.

### I4 — Residue and process diet

Goal: nothing left that describes or configures deleted things.
- Dead code, unused env knobs (budget/profile variables with no reader), stale tests.
- Docs: list every durable spec that now contradicts the code (ADR-0009/0013, `training.spec.md`
  BR-TRAINING-036…045, ARCHITECTURE, CLAUDE.md § LLM) and bring the amendments to the owner as one list.
- Close `coach-tone`, `restart-ladder`, `cold-start`, `refactor-p6-progress-and-drafts` as superseded; route
  still-valid BACKLOG/BUGS entries, close the ones whose subject was deleted.
- Write the standing rule (P6–P8) into `CONTRIBUTING_AI.md`.
Exit: `node scripts/state.mjs --check` OK; this plan `Status: done`.

## 5. Decisions

- (D1) 2026-10-02 — Executors are Agent-tool subagents (Opus/Sonnet), not Orca/GLM workers: owner order for this
  plan ("в твоём распоряжении опусы и сонеты").
- (D2) 2026-10-02 — I0 runs on the subscription inside Claude Code, not through the API (owner's question, cost).
- (D3) 2026-10-02 — Delete instead of flag-off (owner). The earlier idea "switch the engine off by env flags on
  dev" is dropped as a separate step; I1 deletes it. A flags-off stopgap before a workout is done only if the
  owner asks for it.
- (D4) 2026-10-02 — Evidence copied out of the previous session's temp scratchpad into `data/coach-simplification/`.
- (D5) 2026-10-02 — I1 work order is `coach-simplification-i1.md` (Opus design; five tasks, AC-CS1-1…5). Its six open
  questions are decided as its author recommended: profile may be ~10 lines for now (duplicate goal facts cleaned via
  data later, no similarity dedupe in code); training history budget 8 000 → 16 000 tokens; instruction tails in tool
  results removed (watch cases 08/09/14 in the replay); log+delete of one exercise in one response stays unguarded
  until I2 (first guard there); planning prompt loses the "LOAD PLAN" wording in I1; course check on training turns
  is left for I3.
- (D6) 2026-10-02 — Worktrees follow the project procedure (`docs/ORCHESTRATION.md` § worktree prepare: path under
  `/Users/filko/orca/workspaces/fit_coach/`, env links, `npm ci` in `apps/server`), created by the implementing
  subagent with plain git; branch `plan/coach-simplification-i1`. Workers commit on the plan branch; never push.
- (D7) 2026-10-02 — While the owner's I0 vote is pending, only I1 Task 1 (additive, nothing deleted) is dispatched;
  Tasks 2–5 wait for the vote (gate ≥ 14/20).
- (D8) 2026-10-02 — **I0 gate NOT met by the letter:** owner's blind vote = new 10, old 2, equal 2, both bad 6
  (`i0/owner-verdict.json`). Owner's words: he picked "the better one, not a good one"; "both bad" marks replies or
  coach behaviour he dislikes; the page gave no way to comment. Head-to-head the new side wins 10:2, but 8 of 20 are
  not acceptable yet (cases 01, 03, 10, 15, 19, 20 both bad; 07, 09 equal; 02, 08 old better). The Opus judge said
  19/20 → the rubric does NOT capture the owner's taste; do not use it as a gate until re-calibrated on his comments.
  Tasks 2–5 stay on hold until the owner answers "continue on the branch or hold". The stopgap flags question was
  asked three times and not answered → dropped (D3 stands).
- (D9) 2026-10-02 — **The I0 test design was flawed (owner):** "after an error I picked the reply that suits me better,
  but I want the error not to happen at all — that is the problem". About half of the 20 single-turn cases were
  consequences of the old coach's mistakes, so they measured recovery, not absence of errors. **New I0 gate:** a
  full-session replay — the new coach runs the whole 2026-10-01 workout from the first message, each turn seeing its
  OWN earlier replies; the client's stream is the real events (set reports, "дальше", requests) with the complaints
  about old-coach errors removed; every number in every reply is fact-checked. The owner reads it as one chat on a
  page with a comment box per coach message and says "acceptable" or what is wrong. The single-turn cases stay as a
  cheap regression set, not as the gate. The `i0/comments.html` page (https://claude.ai/artifact/5jFVMAhQ4YYzPaDTQU4g68)
  was built but is optional for the owner now.
- (D10) 2026-10-03 — **I0 gate passed in substance.** Owner's verdict on the full-session replay (run 3a): «в общем
  хорошо, звучит подбадривающе, так и должно быть, он должен быть наш бадди… тренер с памятью, что он и делает»,
  with 16 per-reply comments (verbatim + reading: `data/coach-simplification/i0/owner-comments-run3a.md`). None of
  them rejects the shape; they refine the coaching style (strategy for today judged after the first set, warm-up 7–8
  reps and optional, offer-not-press, praise a real jump, answer only what was asked, no illogical caps, comment on
  finishers) and name one app-logic defect (session end time = last set time, not the "закончил" message → I2).
  Decision: I1 Tasks 2–5 go now; in parallel one Opus round folds the comments into the prompt / facts shape /
  rubric with replay ×2; the result is synced into the branch before the I1 review. The owner's taste, as written in
  that file, is the rubric's source of truth from now on.

## 6. Progress log (append one line per state change; newest last)

- 2026-10-02 14:25 — Plan written; evidence persisted; I0 step 1 dispatched (Opus: cases, minimal prompt, rubric).
  **Next:** read the subagent's short report, review `i0/coach-prompt.md`, dispatch I0 step 3.
- 2026-10-02 14:45 — I0 step 1 done (Opus): `data/coach-simplification/i0/` holds 20 cases (`cases/NN/{input,real,expect}.md`),
  `coach-prompt.md` (2 337 chars, accepted by the coordinator unchanged), `rubric.md`, `harness.md` (works: the
  `claude` binary called directly with `-p --model sonnet --system-prompt … --tools ""`; the shell function `claude`
  routes to GLM — never use it). Case input ≈ 5–11k chars vs 58k real. Step 3 dispatched (Sonnet: generate new
  replies, 5 controls with the current prompt, blind pairs page). Owner asked (unanswered): flags-off stopgap on dev.
  **Next:** give the owner the pairs page; record the verdict; meanwhile calibrate the Opus judge on the same pairs.
- 2026-10-02 15:00 — I0 step 3 done (Sonnet): 20/20 new replies (`cases/NN/new.md`), 5 controls, `jargon.md` (banned-jargon
  hits: real 41, new 0, control 7), blind pairs page `i0/pairs.html`, key `i0/pairs-key.json`, published privately:
  https://claude.ai/artifact/XXfHqopQgXDDTVFKyqfqE9 . Controls 07/08/15/18 reproduce the real style, 09 partly → the
  harness is a fair stand-in. Avg reply 754 → 437 chars. Link given to the owner; Opus blind judge dispatched over
  `i0/judge/NN/{A,B}.md` (calibration of the automatic judge against the owner's picks).
  **Next:** wait for the owner's string (`1А 2Б …`), decode with the key, record the verdict here; ≥ 14/20 → write the
  I1 work order and dispatch it (Opus designs the cut list, Sonnet implements in a worktree).
- 2026-10-02 15:10 — Opus blind judge done (`i0/judge-verdict.json`, `i0/judge-notes.md`): new side picked in 19/20, real in
  0, "both bad" in 1 (case 14: the new reply invented an RPE for a set logged without one — a fact-discipline point for
  the I1 prompt/facts block). Not shown to the owner per pair before the owner's own vote. While waiting for the
  owner's string, I1 design dispatched (Opus, read-only): work order → `docs/superpowers/plans/coach-simplification-i1.md`.
  **Next:** owner's verdict → record; review the I1 work order (short report only); dispatch implementation (Sonnet, worktree).
- 2026-10-02 15:35 — I1 design done: `docs/superpowers/plans/coach-simplification-i1.md` (≈7 000 prod LOC + ≈17 000 test
  LOC to delete; request after I1 ≈ 14–17k chars vs 58k; prompt 2 469 chars). Decisions D5–D7. I1 Task 1 dispatched
  (Sonnet, worktree `/Users/filko/orca/workspaces/fit_coach/coach-simplification-i1`, branch `plan/coach-simplification-i1`).
  **Next:** on Task 1 report → wait for the owner's vote if still missing; after the vote dispatch Tasks 2–5 one at a
  time (Sonnet, same worktree), then one Opus review of the branch + eval replay (20 cases through
  `scripts/print-training-request.ts` output and the i0 harness), then ask the owner for push + dev deploy.
- 2026-10-02 16:05 — I1 Task 1 done (Sonnet): commit `e044994e` on `plan/coach-simplification-i1`, worktree
  `/Users/filko/orca/workspaces/fit_coach/coach-simplification-i1` (prepared: env links, `npm ci`). Added
  `prompts/blocks/training-facts.ts`, `training-profile.ts`, `prompts/phases/training/coach.ts` (2 469 chars, test-pinned
  ≤ 2 500), `workoutHistory` in `graph/episode.ts`; unit 2 781 green, lint/type-check clean. Accepted deviations: unrated
  rep sets print `(no RPE)` (rule over the work order's example); block data types live in `training-facts.ts`.
  Notes for Task 2: import `TRAINING_COACH` from `./coach`; `ContextBlock.render` takes `depth` (pass 0); the loader
  must supply a history entry for every plan exercise, even with no performances.
  **Blocked on the owner's I0 vote (D7).** **Next:** vote ≥ 14/20 → dispatch Task 2 (Sonnet, same worktree), then 3, 4, 5.
- 2026-10-02 16:40 — Owner voted (D8): 10 new / 2 old / 2 equal / 6 both bad — gate ≥ 14 not met. Dispatched (Sonnet) a
  comments page `i0/comments.html` (all 20 cases unblinded, non-wins first, a comment box each) to learn what is wrong.
  Owner asked one question: continue I1 Tasks 2–5 on the branch while the prompt is improved from his comments, or hold.
  **Next:** give the owner the comments page link; on his comments → Opus revises `coach-prompt` / facts shape and the
  rubric (`i0/rubric.md`), regenerate the 20 replies, show the owner only the cases he rejected; repeat until he accepts.
  Tasks 2–5 only after his "continue".
- 2026-10-02 16:55 — D9: gate changed to a full-session replay. Dispatched (Opus): `i0/session/` — client script, per-turn
  facts, sequential generation through the harness, fact-check of every number, chat-style page with comment boxes,
  private artifact. Tasks 2–5 of I1 stay on hold until the owner accepts a replay.
  **Next:** on the agent's report → if the fact-check found errors, say so with the link; give the owner the link;
  his comments → Opus revises prompt/facts shape → rerun the replay; accepted → dispatch I1 Task 2.
- 2026-10-02 17:20 — Full-session replay #1 done (`i0/session/`: script 20 client messages, `run.py`, `turns/NN/`,
  `factcheck.md`, page https://claude.ai/artifact/MQm4CCDsZeAD2hg2DrwQiC). Sonnet 5.5, avg reply 463 chars, input median
  8.3k chars (max 14k). Fact-check: **0 wrong numbers / arithmetic, 0 jargon**, but 18 behavioural faults: cutting planned
  sets for the 45–50 min cap ×6, overriding the client's off-plan biceps ×2, repeating last time instead of a small
  step up ×2, contradicting own earlier advice ×1, invented/imprecise claim ×3, missed praise ×1, program-like talk ×2,
  unclear cue ×1. Not shown to the owner yet: same Opus agent continued for a fix round (root causes first in the
  facts shape — e.g. drop the session-length line and elapsed time from the training input — then prompt wording,
  ≤ 2 500 chars), two reruns, fact-check, republish to the same URL. Prompt versions: `i0/coach-prompt.v1.md` (I0
  original, = the text in the I1 branch's `coach.ts`), `coach-prompt.md` (current).
  **Next:** on the report → give the owner the link with the honest fault count; accepted → sync the final prompt and
  facts shape into the I1 branch as part of Task 2, then Tasks 2–5.
- 2026-10-02 18:10 — Replay fix rounds done (Opus, 3 rounds, 100 Sonnet calls total). Faults per run: run1 18 → 2a 25 /
  2b 7 → 3a **3** / 3b 6 (`i0/session/factcheck.run{1,2,3}.md`, runs in `i0/session/run*/`). Run 3a is on the page
  (same URL https://claude.ai/artifact/MQm4CCDsZeAD2hg2DrwQiC). Current prompt `i0/coach-prompt.md` = 2 489 chars
  (v1 kept as `coach-prompt.v1.md`). **Input-shape changes that I1 Task 2 must mirror** (`i0/session/run.py` is the
  reference renderer): profile without age/height/weight, goal, session length, split/frequency and back-symptom
  wording (only the axial-loading limit stays); Today without "session started N min ago" (current time only).
  Lessons: (a) a misleading fact produces a behaviour fault — removing the fact fixed 8 faults, rules were not needed;
  (b) one prompt line ("only the lower back limits that") made the coach ask about the back in 17/20 replies —
  every prompt edit needs a full replay ×2; (c) run-to-run variance is real (3 vs 6 faults on the same prompt).
  Remaining faults trace to **missing facts**, to add in I1's facts block: the machine's observed load steps
  (so "more weight" has a number), set kind on legacy sets (a 12×110 first set read as warm-up). Emoji in 15/20
  replies of run 3a, none in 3b — owner's taste, ask via his comments.
  **Next:** owner reads the chat page and comments / accepts. Accepted → update the I1 branch (prompt text, profile
  and Today shape, the two facts above) inside Task 2, then Tasks 2–5. Not accepted → Opus revises from his
  comments, replay ×2, republish.
- 2026-10-03 05:05 — Owner's comments received (D10). Usage: session 4 %, week 4 % → NORMAL. Dispatched in parallel:
  (a) Opus — prompt/facts/rubric refinement from the comments, replay ×2, republish same URL, write `i0/final-shape.md`
  (the exact profile/Today/History rendering + prompt text Task 2 must mirror); (b) Sonnet — I1 Task 2 in the worktree
  (switch the training phase to the new blocks; prompt text and shape per the current `i0/coach-prompt.md` /
  `i0/session/run.py`, to be re-synced from `final-shape.md` afterwards).
  **Next:** on (a) → owner sees the page once more only if something big changed; on (b) → Task 3, then 4, 5, then
  sync task from `final-shape.md`, then Opus review of the branch, then ask the owner for push + dev deploy.
- 2026-10-03 05:40 — Replay round 4 done (Opus). Prompt 2 392 chars (`i0/coach-prompt.md`); rubric v2 built on the owner's
  comments (`i0/rubric.md`, v1 kept). Faults: run 3a re-judged by the new rubric 13 → run 4a 8 / run 4b **3**
  (0 wrong numbers in all). Run 4b on the page. Owner comments: all met in at least one run; 11, 06/07, 08 slip in one
  run each = model variance, no edge-case lines added. Facts added: habit line (cardio warm-up before 8 of last 10
  workouts), "Loads used" per strength exercise, "(no RPE recorded)" in history, no "(warm-up)" label unless the data
  says so. **`i0/final-shape.md` is the spec for the repo sync** (prompt verbatim, Profile/Today/History rules with
  invented examples, not-shown list, diffs). Style note for the sync: run 4b opens 12/20 replies with «Принято».
  **Next:** Task 2 report (Sonnet, running) → Task 3 → Task 4 → Task 5 → sync task from `final-shape.md` → Opus review.
- 2026-10-04 — Emoji probe (owner asked why they vanished): run-3a emoji were chance (same prompt, run 3b = 0); a tone-only
  edit gave 0/20 twice; an explicit line gave 20/20 with a new 😉 (overshoot). Prompt stays at round-4 text; owner asked
  to choose: bounded line («👍 или 💪 раз–два за тренировку, когда заслужил», replay ×2, accept at 5–12/20) or none.
- 2026-10-04 — I1 Task 2 done (Sonnet): commit `4053db26`. Training request = system (coach prompt 2 394 chars +
  `# Profile`) + `<context>` (`# Today`, `# History`, gap note, NOW) + this workout's messages; no user-facts block,
  course directive, episode summaries, `get_load_plan`, old blocks. Unit 2 775, scenarios 411 green; 7 old load-facts
  tests `it.skip` (deleted in Task 3); `prompt-cache-harness` on a plain fixture; `format-exercise-summary` lost its
  instruction tails. Known gap for the sync task: blocks do not yet render the habit line and "Loads used"
  (`final-shape.md`). Task 3 dispatched (Sonnet, same worktree).
  **Next:** Task 3 report → Task 4 → Task 5 → sync from `final-shape.md` → Opus review → owner: push + dev deploy.
