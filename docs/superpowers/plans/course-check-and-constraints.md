# Course Check and Constraint Handling Implementation Plan

- Status: in progress
- Branch: plan/course-check-and-constraints
- After: fact-lifecycle

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans and superpowers:test-driven-development. One plan task per worker session; stop after the task.

**Goal (owner, 2026-09-20):** facts must age, be correctable in conversation, and steer the coach
*before* it takes a wrong direction — instead of a label match silently blocking exercises forever.
Three things the owner wants, in his words: a fact that is no longer true must stop being applied;
the coach must be able to write and retract facts while talking, not only at compaction; and a
control layer must run at key points ("сверка курса") so the coach never has to say "sorry, what I
told you earlier was wrong".

**Why now (evidence, 2026-09-20):** a `user_facts` row lives forever and nothing can retract it.
A `physical_constraint` fact hard-rejects `save_workout_plan` / `start_training_session` when a
fact's `muscleGroup` intersects an exercise's PRIMARY muscles (`domain/user/services/fact-conflicts.ts`,
decision D-G — taken by the P6 plan, never ruled on by the owner). Checked against the real catalog,
a `lower_back` constraint **blocks** Conventional Deadlift and **Hyperextension** (the rehab exercise)
and **allows** Romanian Deadlift, Barbell Back Squat and Barbell Row (lower_back is secondary there) —
the guard is close to inverted for its own purpose, because muscle labels do not express movement or
load. It is also a hard gate over a soft, model-assigned label, with no expiry, no retraction and no
user override.

**Owner's durability model (2026-09-20), the spine of this plan:**
- **Permanent** — missing limb/fingers, irreversible condition. Never re-asked. This is the only
  class where a hard block is honest, and it stays hard.
- **Long-term** — fracture, surgery, a months-long recovery. Carries a *review date* and a *phase*
  note ("in a cast three weeks ago"). The coach asks when the date comes, with a specific question,
  and the answer updates the fact and moves the date.
- **Short** — DOMS, one bad night's sleep, food poisoning, a tweaked shoulder. Stored (conversation
  history is compacted away, so nothing else survives inside their own lifetime) **with a TTL**, and
  hidden from the prompt when it expires. On expiry either **forgotten silently** (states that
  certainly resolve: soreness, sleep, poisoning — asking about 4-day-old DOMS is noise) or **asked
  once** (states that may leave a trace: a tweak, a pain under load), by a flag set when the fact is
  written.
- **The user's word wins, immediately.** "It's fine now" closes a fact: archived, never asked again,
  and **not resurrected** by a later summarisation of an older conversation (a closed fact key is
  only re-created from evidence newer than the closure).
- A short state that keeps recurring is promoted to a `physiological_pattern` fact ("the shoulder
  aches after pressing") — that is how the archive turns into knowledge instead of garbage.

**Findings this plan builds on (verified 2026-09-20, paths under `apps/server/`):**
- `user_facts` columns today: `category`, `fact`, `fact_key`, `muscle_group`, `confirmations`,
  `source_turn_id` (exists, **not filled at extraction**), `created_at`, `updated_at`; unique on
  (user_id, category, fact_key) (`infra/db/schema.ts:173-195`).
- `IUserFactsService` has exactly `upsertMany`, `getForPrompt`, `getConstraints`
  (`domain/user/ports/user-facts.ports.ts:61-75`) — no delete, no archive, no status.
- Facts are extracted only at compaction from summariser v3's `facts` array
  (`prompts/summarizer/v3.ts:44-64`); the summariser **never sees the known facts**, so it cannot say
  one stopped being true. The `remember_fact` tool was dropped by the owner on 2026-09-17 — this plan
  reverses that for the conversational half, with the owner's agreement (2026-09-20): the case that
  decision did not cover is "the user says something important now and it must stick now".
- The `## User Facts` block renders text (+ muscle) only — no date, no confirmation count
  (`prompts/blocks/user-facts.v1.ts`), so the model cannot tell yesterday from six months ago.
- Per-task model routing already exists (`config/llm-profiles.ts`, `getModel(profile)`), as does a
  robust structured-output path (`structured()` after BUG-017/BUG-019 work), and
  `LLM_REASONING_EFFORT` is now configurable per profile.
- Time discipline: expiry/review dates must be computed from the run's `ctx.now`, never the DB clock —
  the training-journey scenarios already had to re-stamp rows because of the two-clock split.

**Architecture:**
- **One table, more columns.** `user_facts` gains `durability` (permanent | long_term | short),
  `expires_at` (short), `review_after` (long-term), `phase_note` + `phase_at`, `on_expiry`
  (forget | ask_once), `status` (active | archived), `archived_at`, `archived_reason`
  (user_closed | expired | superseded), `closed_by_user_at`, `supersedes_id`, and `context` (a short
  "how we learned this"). No new table, no rewrite — the owner asked to extend, not replace.
- **Code owns the bounds, the model owns the judgement.** The model picks durability, TTL/review date
  and `on_expiry`; the config clamps them per class (short: 1–14 days; long-term: 2 weeks–6 months;
  permanent: no date) and refuses `permanent` unless the user stated it explicitly or the fact has
  ≥ N confirmations.
- **Course check (the owner's "слой сверки курса").** One extra structured model call on a cheap
  profile, fired **by event, not per turn**: entering planning, before a durable write, first run
  after a long gap, or when its input fingerprint changed (facts set + stated goal + phase +
  active plan). It returns a typed **directive**: the current vector (goal in one line), the
  constraints in force, the questions to ask now (review-date and expiry questions, plus the standing
  "how do you feel today"), the facts it suspects are stale, and its verdict on any proposed
  exercises. The directive is **persisted in state** and rendered as one prompt block until its
  fingerprint changes — so the decision is made once and the ordinary path carries it, and a normal
  turn costs exactly what it costs today. Failure of the call degrades to today's behaviour.
- **The hard block shrinks to `permanent`.** Everything else becomes an advisory line in the tool
  result ("saved; note the constraint X — explain or replace"), which the coach must address. The
  user can always override in words.

**Wave B of two (split by the owner, 2026-09-21).** Wave A (`fact-lifecycle`) gives facts their
durability classes, dates, status and the conversational tools; this plan uses them: the course-check
layer that keeps the coach on course, and the hard constraint block narrowed to permanent facts. This
is the behavioural half and it is measured (AC-FL-7).

**Spec:** ADR-0013 §3.4/§6 (assembly, tool outcomes), ADR-0009 (fact categories).
**Both need amendments; the orchestrator escalates the texts to the owner — no worker edits them.**

**Acceptance criteria:**
- **AC-FL-5** — the course check runs only on its events, its directive is persisted and reused while
  its fingerprint holds, and a failed call never blocks a reply.
- **AC-FL-6** — `save_workout_plan` / `start_training_session` hard-reject only `permanent`
  constraints; other conflicts come back as an advisory the coach must address, and the plan is saved.
- **AC-FL-7** — scenario cases compare "prompt-only" against "with the course check" on the same
  journeys, so the layer is kept or dropped on evidence.

## Global Constraints

- No model-backed evals (`RUN_LLM_EVALS` / `EVALS_FULL_RUN` never set); mocked models only. The
  AC-FL-7 comparison is authored now and run by the owner.
- Schema changes go through migrations (`npm run drizzle:generate`), never `drizzle-kit push`.
- Never write any `.env*` file — `.env.example` only.
- Reserved to the orchestrator: push, ssh, deploy, merge, `npm run db:*`, `docker compose`, durable
  specs (`docs/adr/**`, `docs/domain/**`, `ARCHITECTURE.md`, `API_SPEC.md`, `LLM_CORE_REFACTOR_PLAN.md`),
  `docs/STATE.md`, `docs/BUGS.md`, any `Status:`.
- `npm run test:scenarios` is part of the acceptance of every task here (conversation/memory/tools).
- Plans end at the dev deploy — prod is frozen (owner, 2026-09-20).

---

### Task 1: The course check and its directive (AC-FL-5)

**Files:** `apps/server/src/infra/ai/course-check/` (the structured call on its own profile, the
fingerprint, the pure event predicate), `graph/state.ts` (the persisted directive),
`graph/nodes/prepare.node.ts` or `agent.node.ts` (the firing point), `prompts/blocks/course-directive.v1.ts`,
`.env.example` (profile + on/off switch), tests.

- [x] **Step 1: Tests first** (mocked model) — fires on each event and on nothing else; a stable
  fingerprint reuses the stored directive with zero calls; a changed fact set refires; a failed or
  malformed call leaves the run untouched and logs a warn; the directive renders as one block; the
  user's current message always outranks the stored directive.
- [x] **Step 2: Implement.**
- [x] **Step 3: Commit** — `feat(ai): course-check directive at key points (AC-FL-5)`
- [x] **Step 4: STOP** for orchestrator review. **Accepted 2026-09-21** (`fa5d1505` + review fix
  `bfd8ae39`). **Executor change mid-task:** the GLM worker implemented it and then died on
  `Weekly/Monthly Limit Exhausted` (resets 2026-09-24) during verification, with the work uncommitted;
  it was abandoned on positive proof (429 in its transcript, final turn without `worker_done`) and a
  Sonnet worker took the working tree over, reviewed it as its own, finished and committed it.
  The check fires from `prepare` on two events only — a changed fingerprint (facts set, goal, phase,
  active plan; "entering planning" and "before a durable write" ride on phase/`activePlanId` being
  fingerprint components, so it fires on the first run AFTER either moves, not literally before the
  write — accepted as the plan's own design) and a long gap. An ordinary turn costs exactly what it
  cost before: the stored directive rides until its fingerprint changes.
  **One review finding, fixed in `bfd8ae39`:** a failed call kept the stored directive (correct) but
  left the fingerprint mismatched, so the check re-fired every subsequent turn while the provider was
  down — one failed model call per ordinary turn, which is precisely what this task's central promise
  forbids. A failure now records `{fingerprint, at}` in its own persisted channel and the predicate
  stays silent for that fingerprint until `COURSE_CHECK_RETRY_COOLDOWN_MINUTES` (default 15, threaded
  as data) has passed; a genuinely new fingerprint is not covered by the cooldown, the stale directive
  keeps rendering, and success clears the failure.
  Both the event predicate and the cooldown are pinned by mutation: breaking `events.ts` to always
  refire fails 8 tests across three levels, removing the cooldown guard fails 7. Orchestrator re-ran on
  the committed tree: `npx jest --ci src/infra/ai` 65 suites / 557 tests, `npm run test:unit` 118 /
  1056, L0 96/96, `npm run test:scenarios` 4 / 221 (exit 0, no teardown abort this run — the 134 abort
  recorded in the backlog is intermittent).
  Two smaller decisions accepted as reported: the `course_check` profile needs no registration
  (profiles are free-form, `LLM_PROFILE_COURSE_CHECK_*` falls back to globals, documented in
  `.env.example`), and the layer has an on/off switch.

**Verification:** as Task 1, plus the call-count assertions named above.

---

### Task 2: The hard block shrinks to permanent constraints (AC-FL-6)

**Files:** `domain/user/services/fact-conflicts.ts`, `infra/ai/tools/fact-constraint-guard.ts`,
`save-workout-plan.tool.ts`, `start-training-session.tool.ts`, tests.

- [x] **Step 1: Tests first** — a `permanent` constraint still rejects (nothing persisted); a
  long-term or short constraint no longer rejects: the call succeeds and the result carries an
  advisory naming the fact and the exercise; an advisory lists **all** conflicting exercises, not just
  the first; no constraint → unchanged.
- [x] **Step 2: Implement.**
- [x] **Step 3: Commit** — `fix(training): only permanent constraints block a write; the rest advise (AC-FL-6)`
- [x] **Step 4: STOP** for orchestrator review. **Accepted 2026-09-21** (`a6d8c216`, Sonnet worker).
  The guard splits into two honest halves: `findFactConflicts` returns EVERY conflict (exercise order,
  then fact order) and `blockingConflicts` keeps only the `permanent` ones. A permanent conflict still
  rejects with nothing persisted and quotes only the permanent facts even in a mixed set; a
  `long_term` / `short` conflict now persists and appends an advisory to the tool's ok summary naming
  each fact (durability + phase note) and every conflicting exercise; no constraint or no intersection
  leaves the summary byte-identical. The rationale (a muscle label expresses neither movement nor
  load — a `lower_back` constraint blocks Conventional Deadlift and Hyperextension while allowing
  Romanian Deadlift and Barbell Row) is recorded in `fact-conflicts.ts` so it cannot be "fixed" back by
  someone who only sees the code.
  Accepted as reported: the advisory rides in the ok summary because that is the only channel a
  `ToolOutcome` gives the model, and `save_workout_plan`'s fixed "congratulate them" becomes "write a
  brief confirmation" when an advisory is present — congratulating over an unaddressed injury caveat
  would be wrong.
  Pinned by mutation, as in Task 1: making everything block again fails 10 tests, reporting only the
  first conflict fails 15. Orchestrator re-ran on the committed tree: `npx jest --ci src/infra/ai` 569
  tests, `npx jest --ci src/domain/user` 58, `npm run test:unit` 1076, L0 96/96, `npm run
  test:scenarios` 221.

**Verification:** as Task 1.

---

### Task 3: Journey cases for stale, closed and recurring facts (AC-FL-7)

**Files:** `apps/server/evals/scenarios/` (new scenario modules reusing the Task 1–5 machinery),
`tests/integration/scenarios/`, `evals/levels/l3.ts` if the live layer needs the new steps.

- [ ] **Step 1:** author journeys: (a) a long-term injury whose review date comes up — one specific
  question, the answer updates the fact; (b) the user says "it's fine now" — the fact is closed and
  never asked again, and a later compaction of older evidence does not resurrect it; (c) a short state
  that expires silently vs one that asks once; (d) the same short state recurring three times → a
  pattern fact; (e) a plan containing an exercise that hits a non-permanent constraint → saved with an
  advisory the coach relays; (f) the user asks what the coach remembers, then has one fact corrected
  and one deleted outright — the listing reflects both on the next ask.
- [ ] **Step 2:** the same journeys are runnable with the course check on and off, so the owner can
  compare (AC-FL-7) — the comparison itself is an owner-launched live run, never a task.
- [x] **Step 3: Commit** — `test(ai): journeys for fact lifecycle and the course check (AC-FL-7)`
- [x] **Step 4: STOP** for orchestrator review. **Accepted 2026-09-21** (`efe4988e`, Sonnet worker).
  Six journeys (`fl-a` … `fl-f`), each runnable with the course check ON and OFF, each ending in an
  assertion read from `user_facts` / `workout_plans` — not from the coach's prose, which is the whole
  point after the 2026-09-21 smoke found the coach announcing a retraction that never happened. The
  runner gained the on/off switch, per-step scripting, fact-id placeholders and a pg-pool release (12
  runs had been exhausting DB connections). Pinned by five mutations of PRODUCTION code, each failing
  the journeys: equal-time stale evidence accepted (5 fail), a retract that writes nothing (17), every
  constraint blocking again (6), a delete that only archives (6), an update that does not move
  `review_after` (7).
  **Journey (d) deliberately stops short**, per my ruling on the worker's `ask`: the recurrence →
  `physiological_pattern` promotion does not exist anywhere in the code, so (d) asserts the three-row
  `supersedes_id` chain (2 archived, 1 active) and marks the missing ending as `it.todo` rather than
  faking it by scripting the coach to write the pattern fact. The gap and the three owner decisions it
  needs are recorded in `BACKLOG.md`.
  Orchestrator re-ran on the committed tree: `npm run test:scenarios` 5 suites / 300 tests (298 passed,
  2 todo), L0 96/96, `npm run test:unit` 1078.
  Two further findings from the worker, both recorded rather than silently fixed: the `fl-*` group is
  selectable with `--scenario fact-lifecycle` but is not in the default L3 run (it would cross the call
  ceiling), and live L3 judges review dates strictly, so a model answering 28 where the journey expects
  30 review days would fail journey (a) on a live run. **The third finding became its own task below.**

**Verification:** `npm run test:scenarios` → green; L0 green.

---

### Task 4: Close-out (orchestrator)

- [ ] One combined close-out review; ADR-0009 + ADR-0013 amendments (durability classes, fact
  operations at compaction, the course-check directive, the narrowed hard block) — **texts escalated
  to the owner before merge**; `- Status: done`; `state.mjs --write`; merge, push, deploy dev, health 200.
- [ ] Dev smoke by the owner: state an injury, be asked about it at the right time, close it with
  "it's fine now", and confirm it never comes back.
