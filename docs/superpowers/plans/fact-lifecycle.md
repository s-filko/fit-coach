# Fact Lifecycle — Storage, Conversational Tools, Summariser Operations Implementation Plan

- Status: in progress
- Branch: plan/fact-lifecycle
- After: reply-latency-and-typing

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

**Wave A of two (split by the owner, 2026-09-21).** This plan gives memory a lifecycle and hands the
user control of it; it changes no coaching behaviour. Wave B (`course-check-and-constraints`) adds the
course-check layer and narrows the hard constraint block — behavioural, measured separately.

**Spec:** ADR-0009 (fact categories and storage), ADR-0013 §3.3 (compaction).
**Both need amendments; the orchestrator escalates the texts to the owner — no worker edits them.**

**Acceptance criteria:**
- **AC-FL-1** — every fact carries a durability class with its dates, context and status; the prompt
  block shows each fact with its date and confirmation count; expired/archived facts never render.
- **AC-FL-2** — the coach can add, update and retract facts during a conversation through a tool, with
  the code-side bounds above; a retraction archives, never deletes.
- **AC-FL-3** — a fact the user closed ("it's fine now") is never asked about again and is not
  re-created by a later summarisation of older evidence; a genuinely new statement creates a new fact
  linked to the closed one.
- **AC-FL-4** — the summariser receives the known facts and returns operations (add / confirm /
  update / retract) instead of a blind upsert.
- **AC-FL-8** — the user can review and control their own memory: on request the coach lists every
  active fact (grouped by category, each with its date, confirmation count and durability class) and,
  if asked, the archived ones with their closure reason; the user can have a fact corrected, archived
  ("that's not true, stop using it") or **permanently deleted** ("I don't want you storing that") —
  two distinct operations, never silently swapped, with the coach asking which is meant when the
  request is ambiguous.

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

### Task 1: Fact lifecycle in storage and rendering (AC-FL-1)

**Files:** `apps/server/src/infra/db/schema.ts` + a generated migration, `domain/user/ports/user-facts.ports.ts`,
`infra/db/repositories/user-facts.repository.ts`, `domain/user/services/fact-lifecycle.ts` (new, pure:
class bounds, expiry/review predicates against a passed-in `now`), `infra/ai/prompts/blocks/user-facts.v1.ts`
(→ v2 if the rendering changes shape), their tests.

- [x] **Step 1: Tests first** — bounds clamping per class; `permanent` refused without the explicit
  flag / confirmation threshold; an expired short fact is not returned for the prompt; an archived
  fact is never returned; review-date predicates; rendering shows date + confirmations.
- [x] **Step 2: Implement**, including `source_turn_id` finally being filled at extraction.
- [x] **Step 3: Commit** — `feat(memory): fact durability classes, expiry and archive (AC-FL-1)`
- [x] **Step 4: STOP** for orchestrator review. **Accepted 2026-09-21** (`9e949a18`, GLM worker via Orca). Migration `0006` adds the lifecycle columns additively — existing rows land on `permanent`/`active` with no dates, so nothing changes behaviourally today. The class numbers live once, in the new pure `domain/user/services/fact-lifecycle.ts` (short 1–14 d, long-term 14–182 d, `permanent` gated by an explicit user statement or ≥ 3 confirmations), together with the `now`-taking predicates; `getForPrompt` / `getConstraints` now take the run clock and exclude archived + expired rows (the SQL filter is the twin of `isActiveForPrompt`). Rendering moved to `USER_FACTS_V2` (date + confirmation count + long-term phase note); `USER_FACTS_V1` is kept unused, per the repo's prompt-version convention. `source_turn_id` is finally filled at extraction from the mirrored summary turn — the worker escalated that no other turn id is reachable at compact time and was answered A, with a narrow grant of `summary.ports.ts` + `drizzle-summary.service.ts`; the D-E independence (facts still written when the summary insert throws) is pinned by a test. Orchestrator re-ran everything itself: jest subset 24 suites / 165 tests, `test:unit` 107 suites / 946 tests, L0 96/96, `test:scenarios` 4 suites / 221 tests against the real `fitcoach_test`. `test:scenarios` exits 134 (`mutex lock failed` in native teardown) after a fully green run — reproduced identically on base `fce6b9ff`, so pre-existing and not from this diff (backlog).

**Verification:** `npx jest --ci src/domain/user src/infra/db src/infra/ai/prompts` → pass;
`npm run test:unit` → green; `npm run evals -- --level L0` → green; `npm run test:scenarios` → green.

---

### Task 2: Fact tools in conversation (AC-FL-2, AC-FL-3, AC-FL-8)

**Files:** `apps/server/src/infra/ai/tools/remember-fact.tool.ts`, `retract-fact.tool.ts`,
`list-facts.tool.ts` (or one `manage_fact` tool plus a listing tool — the worker decides and says
why), their registration in the shared tool set (`graph/phases/*.spec.ts`),
`domain/user/services/fact-lifecycle.ts`, tests.

The listing tool is what answers "what do you remember about me": the `## User Facts` prompt block is
capped and ordered for steering, not for review, so it cannot serve this. The listing returns active
facts grouped by category with date, confirmation count and durability class, and archived ones with
their closure reason when asked.

Archive and delete are **two operations**: `retract` (not true / no longer applies — archived, keeps
history and the recurrence counter) and `delete` (the user does not want it stored — the row is gone,
no trace). The tool exposes both; the model picks by intent and asks when the request is ambiguous.

- [x] **Step 1: Tests first** — add/update/retract paths; user closure sets `closed_by_user_at` and
  archives; a closed fact key is not re-created from older evidence but is from newer; bounds enforced
  on the tool input; `retract` never deletes a row and `delete` leaves none; the listing returns the
  documented shape and excludes archived facts unless asked.
- [x] **Step 2: Implement.**
- [x] **Step 3: Commit** — `feat(memory): the coach can list, add, update, retract and delete facts in conversation (AC-FL-2, AC-FL-3, AC-FL-8)`
- [x] **Step 4: STOP** for orchestrator review. **Accepted 2026-09-21** (`7fa36aa9` + review fix `7049ad14`, GLM worker via Orca). One `manage_fact` tool (`save | retract | delete`) plus `list_facts`, both in `buildSharedTools` so memory control exists in every phase; the worker's reason for one tool over three: the archive-vs-erase distinction has to be an explicit per-call choice with the ask-when-ambiguous rule stated once. The port gained `rememberFact` / `retractFact` / `deleteFact` / `listFacts`, all run-clock based, all bounds via `resolveLifecycle` — no class number restated. `delete` additionally requires `confirmed=true`.
  **First pass was rejected on two AC-FL-3 findings, both fixed in `7049ad14`:** (1) a user-closed fact was *reactivated in place*, clearing `closed_by_user_at` — the AC requires a NEW row linked by `supersedes_id` with the closed row left archived, and that archive is exactly what wave B's recurrence promotion will count. The real blocker underneath was the unconditional unique index, so migration `0007` drops it for a PARTIAL unique index over active rows only (`... WHERE status = 'active'`; a Postgres UNIQUE constraint cannot be partial), and `upsertMany` repeats the predicate as `targetWhere`. The `reactivated` outcome is gone from the type, so the old behaviour cannot return by accident. (2) the stale-evidence guard compared the *run* clock with the closure, which on the conversational path is always later — the guard could never fire where it was tested, and AC-FL-3 silently rested on Task 3. The input now carries `evidenceAt` (default `now`): the closure comparison reads the evidence clock, every written date keeps the run clock, pinned by a T0/T1/T2/T3 test.
  Orchestrator re-ran everything after the fix: `npx jest --ci src/infra/ai/tools` 16 suites / 114 tests, subset 24 / 165, `test:unit` 109 / 961, L0 96/96, `test:scenarios` 4 / 221, and the user-facts repository integration suite 22/22 on the real `fitcoach_test` with `0007` applied.

**Verification:** as Task 1, plus `npx jest --ci src/infra/ai/tools`.

---

### Task 3: The summariser sees known facts and returns operations (AC-FL-4)

**Files:** `apps/server/src/infra/ai/prompts/summarizer/v4.ts` (+ schema), `graph/nodes/compact.node.ts`
(passes the active facts in, applies the returned operations), tests.

- [ ] **Step 1: Tests first** — known facts reach the summariser prompt; `confirm` bumps the counter
  without rewriting text; `update` supersedes with a link; `retract` archives with a reason; a
  user-closed fact is never re-added; extraction failure stays non-fatal.
- [ ] **Step 2: Implement.**
- [ ] **Step 3: Commit** — `feat(memory): summariser v4 returns fact operations, not blind upserts (AC-FL-4)`
- [ ] **Step 4: STOP** for orchestrator review.

**Verification:** as Task 1.

---

### Task 4: Close-out (orchestrator)

- [ ] One combined close-out review; the ADR-0009 / ADR-0013 §3.3 amendment texts (durability classes,
  fact operations at compaction, user-controlled memory) — **escalated to the owner before merge**;
  `- Status: done`; `state.mjs --write`; merge, push, deploy dev, health 200, migration applied.
- [ ] Dev smoke by the owner: ask the coach what it remembers, correct one fact, delete another, state
  an injury and close it with "it's fine now" — it must not come back.
