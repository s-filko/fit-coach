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
