# Refactor P6 — Muscle-Centric Progress Blocks and Structured Drafts Implementation Plan

- Status: planned
- Branch: plan/refactor-p6-progress-and-drafts
- After: refactor-p6-facts-and-progress-blocks

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Split out of `refactor-p6-facts-and-progress-blocks` on 2026-09-19 by owner decision**, at the
> Group 1 / Group 2 boundary that plan's D-A pre-recorded. That plan now holds master-plan P6
> item 1 (user facts, Tasks 1–6, closed and merged); this one holds items 2 and 3. Task
> numbers (7–13), decision ids (D-A..D-K) and the shared sections below are copied verbatim
> so references stay stable; D-B..D-G and the Group 1 rows of the parent's "Decided without
> the owner" table describe work that has already landed — read them in the parent plan.
> Both owner overrides of the master plan (no `remember_fact`; code first, no model-backed
> evals) bind here exactly as in the parent.

**Goal:** The coach sees muscle-level recovery and per-exercise history instead of one keyed
previous session, and edits a structured draft it then saves verbatim — so "what the model
proposed" and "what got persisted" stop being two independently-generated objects.

**Architecture / Spec / Tech Stack:** as in the parent plan's header (ADR-0013 §3.4, §4.2, §6;
`docs/PLAN-muscle-centric-history.md`; `docs/LLM_CORE_REFACTOR_PLAN.md` § P6 items 2–3;
`docs/PROMPT_EVAL_FRAMEWORK.md` §4.2). The Group 1 infrastructure this plan builds on is on
`dev`: `user_facts`, summariser v3, the `## User Facts` block at block 2, and the
`checkFactConflicts` hard validation in `save_workout_plan` / `start_training_session` —
Group 3's save-from-draft path must keep that validation on the draft it persists.

**Acceptance criteria:** each AC is split into the half provable now and the half deferred.

- **AC-1362** *(progress/history)* — "with fixture history in a different `sessionKey`, the
  training run's input contains the exercise's previous sets (deterministic: block present
  with ≥1 set) — 100 %; judge criterion TR-6 mean ≥ 4.0/5."
  - **Provable now (Task 8):** the deterministic 100 % half, as a unit test over fixture
    history — the `training.currentExerciseHistory` block renders with ≥ 1 set for an
    exercise whose previous sets were logged under a **different** `sessionKey`. This is
    exactly BUG-005's failure and needs no model.
  - **Deferred:** the TR-6 judge mean (L2 — and **no L2 runner exists**, per the P4 plan's
    own note on AC-1344).
- **AC-1363** *(plan/iteration)* — "a 4-turn scripted iteration ends with
  `save_workout_plan` persisting a plan equal to the last draft (deep-equal), and the
  draft's exercise IDs all exist in the catalog — 100 %."
  - **Provable now (Task 11):** the deep-equal invariant is **structural** once drafts
    land — `save_workout_plan` takes no payload and persists `state.draft`, so
    "persisted === last draft" is true by construction and is pinned by a mocked-model
    4-turn graph test (scripted tool calls, no live model). The catalog-existence check is
    a pure validation unit test.
  - **Deferred:** the 100 % pass rate over a live 4-turn model conversation (the
    `plan/iteration` dataset is authored in Task 11, not run).
- **AC-1364** *(no regression)* — "no regression > 2 pp on other datasets; L2 means not
  lower by > 0.2."
  - **Provable now:** nothing. This AC is a comparison of two model-backed runs by
    definition.
  - **Deferred in full to the consolidated eval pass**, together with AC-1344 (P4's
    episode-memory and context-budget compares). The deterministic guard that stands in
    meanwhile is L0 (96/96) plus the frozen message-assembly snapshots regenerated once
    per structural change, enumerated in each task.

## Global Constraints

- **Code first, no model-backed evals.** Per plan only: unit tests, mocked-model
  integration tests, L0 snapshots, and ONE 3–5-call dev smoke after deploy. **No** L1/L2
  model runs, **no** mini-compares, **no** `RUN_LLM_EVALS=1`, **no** `EVALS_FULL_RUN=1`.
  Datasets that an AC names are **authored and committed** in this plan so the consolidated
  pass has something to run; the executor never runs them. Every AC's deferred half is
  listed above per AC and must be restated in the close-out.
- **`remember_fact` is dropped** (owner, 2026-09-17). Fact extraction happens in the
  `compact` node from the summariser's structured output — **not** as a tool in any
  `PhaseSpec`, and **not** per-turn as ADR-0009 originally proposed. Any implementation
  that adds a fact-writing tool is wrong.
- **Schema changes go through drizzle migrations only**: `npm run drizzle:generate` from
  `apps/server/`, review the generated SQL, commit it. **Never** `drizzle-kit push` (removed
  and CI-blocked, HB-01). **Never** add the LangGraph `checkpoints*` tables to a migration.
- **Prompt wording changes are real changes.** Items 2 and 3 both require prompt edits
  (master plan: item 2 bumps the training/session_planning prompt versions and folds in the
  carried-over next-set-recommendation rule; item 3 changes plan_creation/session_planning
  to "edit the draft, then save"). Each bump is a **new version file** (`v3.ts` next to
  `v2.ts`), both files kept, `current` repointed, L0 snapshots added for the new version —
  the same discipline P4 used. The eval arbiter for wording quality is the consolidated
  pass, which is why each wording change is isolated in its own commit for easy revert.
- **Facts are never invented by code.** The upsert is idempotent on a normalised key with a
  confirmation counter (D-C); code never rewrites a fact's text, only increments its
  counter and timestamp. Deduplication is the summariser's job at extraction and the
  normalised key's job at write — not an LLM call of its own.
- **Do not plan any branch or worktree deletion** and **do not write to any `.env` file**.
  New env vars go into `.env.example` only; the owner applies them.
- **Reserved to the orchestrator:** Task 13 (deploy, smoke, close-out) and every
  `Status:`/merge transition. Verification from `apps/server/`. No attribution lines.

## Decisions taken by this plan (not settled by the durable specs — owner may overrule)

| # | Decision | Alternative rejected | Why |
|---|---|---|---|
| D-A | **All three items stay in one plan file**, sequenced as three separable task groups: **Group 1 = item 1** (Tasks 1–6, user facts), **Group 2 = item 2** (Tasks 7–9, muscle-centric blocks), **Group 3 = item 3** (Tasks 10–12, structured drafts). Each group ends at a green tree and could be cut into its own branch at that boundary | Three separate plan files / branches up front | The master plan calls the three items "independent PRs" and its Rollback condition reverts them individually — the task-group boundaries preserve exactly that. One file keeps the shared vocabulary (blocks, `ToolStateUpdate`, budget) in one place. **Splitting into three branches remains an option for the owner**: cut after Task 6 and after Task 9; the `After:` chain would be p6-facts → p6-progress → p6-drafts. |
| D-B | `user_facts` reuses ADR-0009's table shape and `FactCategory` enum, **plus** three columns the 2026-09-17 decision requires: `muscle_group` (nullable, master plan item 1's "facts get an optional `muscleGroup` field"), `confirmations` (integer, default 1 — the confirmation counter) and `fact_key` (the normalised dedup key, D-C). ADR-0009's *mechanism* (per-turn passive extraction via a tool) is superseded and must be recorded as such | A fresh table design; ADR-0009 verbatim | The owner's decision changed *when* facts are written, not *what* a fact is. Reusing the categories keeps ADR-0009's prompt-facing vocabulary; the three added columns are exactly what "idempotent upsert with a confirmation counter, muscle-tagged constraints" needs. |
| D-C | **Idempotency key** = `fact_key`, a code-computed normalisation of the fact text: lowercase, trim, collapse whitespace, strip terminal punctuation; unique index on `(user_id, category, fact_key)`. Upsert = `ON CONFLICT … DO UPDATE SET confirmations = confirmations + 1, updated_at = now()` — the stored `fact` text is **not** overwritten. A fact re-stated in a later episode raises its counter | An LLM dedup call; an embedding-similarity match; no key (insert always) | Deterministic, testable without a model, and cheap. Near-duplicates that differ in wording will create two rows — accepted for now (the block caps at 50, ordered by category then recency), and noted as a backlog candidate rather than solved with a similarity search this plan cannot evaluate. |
| D-D | The summariser gains a **v3** (`prompts/summarizer/v3.ts`) whose schema adds `facts: Array<{ category; fact; muscleGroup? }>` to the five existing `EpisodeSummary` fields. `EpisodeSummarySchema` is extended in `domain/conversation/episode.ts`; **`StoredEpisodeSummary` keeps rendering only the original five fields** so `episode-summaries.v1.ts` and its snapshots are byte-unchanged | Reusing the existing `userState` array as the fact source; a second LLM call at compaction | `userState` is free text with no category or muscle tag — it cannot drive the hard validation. A second call doubles compaction cost. Extending the one structured call is the cheapest correct option, and keeping the rendered block unchanged means the episode-summary snapshots do not move. |
| D-E | Extraction failure is **non-fatal**, matching the existing summariser contract: `compact.node.ts` already logs `warn` and trims without a summary on a summariser error (BR-LLM-004). Facts get the same treatment — a failed fact upsert logs `error` and the run continues. A compaction never fails because of facts | Failing the compaction; retrying | The compaction path is on the user's critical path; a memory write is not worth a lost reply. Mirrors the existing `summaries.insert` catch in `compact.node.ts`. |
| D-F | The `## User Facts` block is a **`PromptModule` rendered by the assembler at block 2**, next to the episode-summaries block — **not** a `ContextBlock<D>` on `PhaseSpec.contextBlocks`. It lives at `prompts/blocks/user-facts.v1.ts` and is added to `AssembleInput` as `userFacts`, budgeted against the already-existing-but-unused `TokenBudget.longTerm` | A `ContextBlock` per phase | Facts are phase-independent (ADR-0013 §3.4 puts long-term memory in block 2, before domain block 3) and are loaded once per run by the adapter/prepare path, not by a phase's `loadContext`. Making it a `ContextBlock` would duplicate it across five specs and route it through the wrong budget line. |
| D-G | Hard validation lives in a **pure domain function** `checkFactConflicts({ facts, exercises })` in `domain/user/services/fact-conflicts.ts`, called by `save_workout_plan` and `start_training_session`. Conflict = an exercise whose **primary** muscle groups intersect a `physical_constraint` fact's `muscleGroup`. The tool returns `userError(<message quoting the fact>)` | Validation inside each tool; a graph-level guard | One pure function, two call sites, one unit test suite — and `user_error` is exactly ADR-0013 §6's "valid call, business rule says no; the model relays it". A graph guard would fire after the tool already wrote. |
| D-H | Item 2's repository methods are named **`getMuscleGroupFatigue(userId)`** and **`getExerciseHistory(userId, exerciseId, primaryMuscles, opts)`** on `IWorkoutSessionRepository`, per `PLAN-muscle-centric-history.md` — **not** the master plan's `getMuscleRecovery` / `getExerciseHistoryByMuscles`, which are the *service*-level names in that same doc (`getMuscleReadiness` / `getExerciseHistoryByMuscles` on `ITrainingService`) | The master plan's names | The detailed design doc the master plan itself cites carries both layers with different names; the master plan compressed them into one line. Following the design doc keeps repository and service names distinct. Recorded in Discrepancies. |
| D-I | **`findLastCompletedByUserAndKey` is NOT removed in this plan.** Item 2's new blocks are added and the training prompt's previous-session section is repointed at them; the old repository method and its `training.spec.ts` call site are **left in place, marked deprecated with a JSDoc `@deprecated` naming this plan** | Removing it as `PLAN-muscle-centric-history.md` § Cleanup says | Removal is only safe once the replacement is proven better — which is a model-backed judgement (AC-1362's TR-6 mean) this plan is forbidden to make. Removing it now would make the consolidated eval pass's comparison impossible and the rollback lossy. The removal is a one-line follow-up once the pass reports. |
| D-J | The `draft` channel is `Annotation<PlanDraft \| SessionDraft \| null>` on `ConversationState` with a last-write-wins reducer, and `ToolStateUpdate` gains an optional `draft` field (a **third** allowed field alongside `pendingTransition` and `activeSessionId`). `tool-executor.ts`'s `finish()` applies it the same way it applies the other two | A separate draft store; a draft table; tools returning `Command` | The two-field `ToolStateUpdate` and its `finish()` applier are the established P3 mechanism for "a tool changes durable state" — a third field is the smallest correct extension. A table would make an in-progress draft survive `clearContext`, which is wrong: a draft belongs to the episode. |
| D-K | `save_workout_plan` / `start_training_session` **keep their current payload schemas** as a deprecated fallback: if `state.draft` is present they persist the draft and ignore the payload; if it is absent they behave exactly as today. The payload is removed in P7, not here | Removing the payload now, as the master plan says ("take no payload") | A hard cutover means every in-flight conversation on dev breaks at deploy, and the rollback condition ("revert the corresponding item") stops being a clean revert. The fallback is ~5 lines and one test, and it makes the draft path independently verifiable. Recorded as a deliberate deviation. |

## Discrepancies between the specs and the real tree (verified 2026-09-19)

| The spec says | The tree actually has | Resolution |
|---|---|---|
| P6 item 1: "`remember_fact` tool in all `PhaseSpec`s" | Nothing — no such tool exists (`grep -rn "remember_fact" apps/server/src` → no hits) | **Dropped by owner decision 2026-09-17** (`STATE.md`). Extraction moves to `compact.node.ts`. The Global Constraints make "no fact-writing tool" a hard rule |
| P6 item 1: "long-term block `## User Facts` rendered by the assembler" | `assembleContext` renders block 1 (phase prompt), block 2 (`## Previous episodes`), block 3 (domain blocks), then history — **no long-term block**. `TokenBudget.longTerm` exists and is set by all five specs, and `budget.ts:110` already includes it in `sumMinusReserve`, but nothing is billed to it | D-F: a `PromptModule` at `prompts/blocks/user-facts.v1.ts`, rendered ahead of the summaries block, billed to `longTerm` |
| P6 item 1: "`user_facts` table" | **Does not exist.** `schema.ts` has 11 tables; `user_facts` is not among them, and `drizzle/` stops at `0004_quick_agent_brand.sql` | Task 1 creates it via `npm run drizzle:generate` (migration `0005`) |
| ADR-0009's mechanism: per-turn passive extraction via a `remember_fact` tool | Never implemented | Superseded by the 2026-09-17 decision. **ADR-0009's table shape and its eight `FactCategory` values are reused** (D-B); its mechanism is escalated to the owner as superseded, not edited (Task 13) |
| P6 item 2: repository methods "`getMuscleRecovery(userId, days)`" and "`getExerciseHistoryByMuscles(userId, muscles, limit)`" | **Neither exists.** `IWorkoutSessionRepository` has `findLastCompletedByUserAndKey` (the method item 2 replaces) and 12 others. `PLAN-muscle-centric-history.md` — the design doc the master plan cites — names these **`getMuscleGroupFatigue`** / **`getExerciseHistory`** at the *repository* layer and `getMuscleReadiness` / `getExerciseHistoryByMuscles` at the *service* layer | D-H: follow the design doc's two-layer naming. The master plan compressed two layers into one line |
| `PLAN-muscle-centric-history.md` § Prompt changes points at `session-planning.node.ts`, `training.node.ts`, `training.subgraph.ts`, `session-planning.subgraph.ts` | **None of these exist.** P3 replaced per-phase nodes/subgraphs with one `PhaseSpec` per phase (`graph/phases/*.spec.ts`) plus a shared `agent.node.ts`; there is **no `graph/subgraphs/` directory** | Tasks 8–9 target `graph/phases/session-planning.spec.ts`, `graph/phases/training.spec.ts` and the `prompts/phases/*/` version files instead |
| `PLAN-muscle-centric-history.md` § New types: `exerciseId: number` | Exercise and session-exercise ids are **`string` (uuid)** throughout (`IExerciseRepository.findById(id: string)`, `ISessionExerciseRepository.findById(exerciseId: string)`) | Task 7 uses `string`. `Involvement = 'primary' \| 'secondary'` **already exists** at `src/domain/training/types.ts:57` — reuse it, do not redeclare |
| P6 item 3: "`save_workout_plan`/`start_training_session` take no payload" | Both take full Zod payload schemas today (`sessionTemplateSchema` etc. in `save-workout-plan.tool.ts`) | D-K: draft-wins with the payload kept as a deprecated fallback; the payload is removed in P7. **Deliberate deviation — recorded in the Decisions table** |
| P6 item 3: "`draft` channel" | `ConversationState` has 8 channels (`phase`, `activeSessionId`, `messages`, `pendingTransition`, `episodeSummaries`, `episodeId`, `episodeStartedAt`, `lastUserMessageAt`, `compactReason`) — **no `draft`**. `ToolStateUpdate` allows exactly **two** fields (`pendingTransition`, `activeSessionId`), applied by `tool-executor.ts`'s `finish()` | D-J: add the channel and a third `ToolStateUpdate` field through the existing `finish()` mechanism |
| AC-1361/1362/1363 name datasets `memory/facts`, `progress/history`, `plan/iteration` | `evals/datasets/` contains **only phase-named directories** (`chat`, `plan_creation`, `registration`, `session_planning`, `training`). No cross-phase directory exists, and `loadCases(phase, dataset?)` (`evals/levels/l1.ts:165`) is phase-keyed | Tasks 6, 9 and 11 author the datasets at the AC's own paths and make verifying/extending the loader an explicit step |
| AC-1362's "judge criterion TR-6 mean ≥ 4.0/5" | **No L2 runner exists** — recorded in the P4 context-budget plan's AC-1344 note (`evals/levels/` has `l0.ts` and `l1.ts` only) | Deferred to the consolidated eval pass, where the judge is set up (OQ-3's Gemini 3 Flash PAYG default) |
| The summariser is "`SUMMARIZER_PROMPT`" | `prompts/summarizer/index.ts` exports **`SUMMARIZER_V2` as `SUMMARIZER_PROMPT`**; `v1.ts` and `v2.ts` both exist. `compact.node.ts` imports the alias | D-D: add `v3.ts`, repoint the alias, keep v1 and v2 |


## Group 2 — Muscle-centric progress blocks (master plan P6 item 2)

### Task 7: Repository and service methods

**Files:**
- Modify: `apps/server/src/domain/training/types.ts` — `ExerciseSetHistory`, `ExerciseSessionHistory`, `MuscleGroupFatigue` per `PLAN-muscle-centric-history.md` § New types, **with `exerciseId: string`** (uuid — the design doc's `number` is stale). Reuse the existing `Involvement` type at line 57 — do not redeclare it.
- Modify: `apps/server/src/domain/training/ports/workout-session.ports.ts` — add `getMuscleGroupFatigue(userId)` and `getExerciseHistory(userId, exerciseId, primaryMuscles, opts)` to `IWorkoutSessionRepository` (D-H — **the design doc's names, not the master plan's**).
- Modify: `apps/server/src/domain/training/ports/training-service.ports.ts` — add `getMuscleReadiness(userId)` and `getExerciseHistoryByMuscles(userId, exerciseId, primaryMuscles)` to the service interface (D-H).
- Modify: `apps/server/src/infra/db/repositories/workout-session.repository.ts` — the two queries, adapted from `PLAN-muscle-centric-history.md` § New repository methods. **`exerciseId` is a `string` (uuid) in this tree**, not the `number` that doc's types show — see Discrepancies.
- Modify: the training service implementation (**grep**: `grep -rln "implements ITrainingService\|getTrainingHistory" src/domain/training/services/`).
- Modify: `apps/server/tests/integration/database/training.repository.integration.test.ts` — extend.
- Modify: every test stub of `IWorkoutSessionRepository` (**grep**: `grep -rln "findLastCompletedByUserAndKey" src/ tests/`) — the interface grew, so the stubs must too.

- [ ] **Step 1: Tests first** — integration: fatigue aggregates primary **and** secondary involvement with correct `daysSince` and `totalSets`; exercise history returns exact matches before primary-muscle matches, each with its sets, and **finds history logged under a different `sessionKey`** (this is BUG-005 and the deterministic core of AC-1362); an exercise with no history returns an empty array, never null.
- [ ] **Step 2: Implement.**
- [ ] **Step 3: Commit** — `feat(training): muscle-group fatigue and muscle-matched exercise history queries (P6 item 2, BUG-005)`
- [ ] **Step 4: STOP** for orchestrator review.

**Verification:** `RUN_DB_TESTS=1 NODE_ENV=test npx jest --ci --testMatch='**/tests/integration/database/training.repository.integration.test.ts'` → pass; `npx jest --ci src/domain/training` → pass; `npx tsc --noEmit` clean (the interface change ripples into stubs — that ripple is the point).

---

### Task 8: The two context blocks and AC-1362's deterministic half

**Files:**
- Create: `apps/server/src/infra/ai/prompts/blocks/session-planning-muscle-recovery.v1.ts` — `ContextBlock<D>` `session_planning.muscle_recovery`, `depths` declared (e.g. all groups → primary only) so the budget resolver can step it down.
- Create: `apps/server/src/infra/ai/prompts/blocks/training-current-exercise-history.v1.ts` — `ContextBlock<D>` `training.current_exercise_history`, keyed by the in-progress exercise's primary muscles, `depths` for the number of past sessions shown.
- Modify: `apps/server/src/infra/ai/prompts/blocks/index.ts` — export both.
- Modify: `apps/server/src/infra/ai/graph/phases/session-planning.spec.ts` — `loadContext` also loads muscle readiness; `contextBlocks` gains the new block.
- Modify: `apps/server/src/infra/ai/graph/phases/training.spec.ts` — `loadContext` finds the in-progress exercise and loads its muscle-matched history; `contextBlocks` gains the new block. **Add `@deprecated` JSDoc** to the `findLastCompletedByUserAndKey` call at line ~105 naming this plan (D-I) — **do not remove it**.
- Create: `apps/server/src/infra/ai/prompts/blocks/__tests__/` tests for both blocks.
- Modify: `apps/server/evals/snapshots/__tests__/message-assembly.unit.test.ts` — regenerate once, diff enumerated first.

- [ ] **Step 1: Tests first** — **AC-1362 deterministic half** (the `it` name carries `AC-1362`): with fixture history under a **different `sessionKey`**, the training block renders with **≥ 1 set** for the current exercise. Plus: each block renders `null` when its data is empty; depth steps render strictly less text; both blocks are pure.
- [ ] **Step 2: Implement.** Paste the enumerated snapshot diff under **Snapshot diff (Task 8)**; STOP before regenerating.
- [ ] **Step 3: Commit** — `feat(ai): muscleRecovery and currentExerciseHistory context blocks (AC-1362 deterministic half)`
- [ ] **Step 4: STOP** for orchestrator review.

**Verification:** `npx jest --ci src/infra/ai evals/snapshots` → all pass; `npm run evals -- --level L0` → pass; `npm run check-all` → 0 errors.

**Snapshot diff (Task 8):** _(enumerate before regenerating)_

---

### Task 9: Training and session_planning prompt bump, `progress/history` dataset

**Files:**
- Create: `apps/server/src/infra/ai/prompts/phases/training/v3.ts` and `.../session-planning/v3.ts` (**check the real version currently at `current`** — P4 introduced `v2`; `grep -n "current" src/infra/ai/prompts/phases/training/index.ts`). Changes: the previous-session section is replaced by a reference to the new block, and the master plan's **carried-over rule** is folded in — *after every logged set the response must contain a concrete next-set recommendation (weight or rep target), never a bare confirmation* (today the prompt requires this only conditionally, at RPE ≥ 8 / reported difficulty).
- Modify: the two phases' `index.ts` — `current` repointed; **both old versions kept**.
- Modify: L0 fixtures and snapshots for v3.
- Create: `apps/server/evals/datasets/progress/history.jsonl` — AC-1362's cases (authored, **not run**; same cross-phase-directory caveat as Task 6).
- Modify: `apps/server/evals/levels/l1.ts` — a deterministic `exercise-history-block-present` check.

- [ ] **Step 1: Tests first** — v3 renders without the previous-session section and with the next-set rule; v2 still renders byte-identically (both files kept); the new L1 check is unit-tested against fixture observations.
- [ ] **Step 2: Implement.**
- [ ] **Step 3: Commit** — `feat(ai): training and session_planning prompts v3 — muscle-centric history, mandatory next-set recommendation (P6 item 2)`
- [ ] **Step 4: STOP** — **Group 2 boundary.** Report: green tree, item 2 complete and independently revertable.

**Verification:** `npx jest --ci src/infra/ai evals` → all pass; `npm run evals -- --level L0` → pass (state the new count). **No model-backed run.** AC-1362's deterministic half is closed; TR-6's judge mean is recorded as pending the consolidated eval pass (and **no L2 runner exists**).

---

## Group 3 — Structured drafts (master plan P6 item 3)

### Task 10: The `draft` channel and the four draft tools

**Files:**
- Create: `apps/server/src/domain/conversation/draft.ts` — `PlanDraftSchema` and `SessionDraftSchema` (Zod), derived from the **existing** `save_workout_plan` / `start_training_session` payload schemas so a draft is exactly what those tools already accept (read `src/infra/ai/tools/save-workout-plan.tool.ts` — `sessionTemplateSchema`, `sessionTemplateExerciseSchema`, the `MUSCLE_GROUPS` and `ENERGY_COST` tuples — and reuse, do not retype). `type Draft = { kind: 'plan'; value: PlanDraft } | { kind: 'session'; value: SessionDraft }`.
- Modify: `apps/server/src/infra/ai/graph/state.ts` — the `draft` channel (D-J), `Annotation<Draft | null>`, last-write-wins, default `null`. Document the writers in the existing channel-writers comment block.
- Modify: `apps/server/src/domain/conversation/tool-outcome.ts` — `ToolStateUpdate` gains `draft?: Draft | null` (D-J).
- Modify: `apps/server/src/infra/ai/graph/tool-executor.ts` — `finish()` applies `updates.draft` alongside `pendingTransition` and `activeSessionId` (line ~210).
- Create: `apps/server/src/infra/ai/tools/propose-plan-draft.tool.ts`, `update-plan-draft.tool.ts`, `propose-session-draft.tool.ts`, `update-session-draft.tool.ts`. `propose_*` replaces the draft; `update_*` applies a partial patch to the existing one and returns `llmError` when there is no draft to update.
- Modify: `apps/server/src/infra/ai/tools/index.ts`, `src/infra/ai/graph/phases/plan-creation.spec.ts` (the two plan tools), `session-planning.spec.ts` (the two session tools).
- Create: `__tests__` for each tool.

- [ ] **Step 1: Tests first** — `propose_*` returns an `ok` outcome **and** a `ToolStateUpdate` carrying the draft; `update_*` patches and preserves untouched fields; `update_*` with no draft returns `llm_error`; the executor's `finish()` writes the channel; an invalid draft (bad exercise id shape) returns `llm_error`, never `system_error`; `clearContext` drops the draft with the thread (it is a state channel — assert it is not persisted anywhere else).
- [ ] **Step 2: Implement.**
- [ ] **Step 3: Commit** — `feat(ai): draft state channel and the four plan/session draft tools (P6 item 3)`
- [ ] **Step 4: STOP** for orchestrator review.

**Verification:** `npx jest --ci src/infra/ai src/domain/conversation` → all pass; `npx tsc --noEmit` clean.

---

### Task 11: Save-from-draft and AC-1363's deterministic half

**Files:**
- Modify: `apps/server/src/infra/ai/tools/save-workout-plan.tool.ts` and `start-training-session.tool.ts` — per **D-K**: when `state.draft` matches the tool's kind, persist the draft and ignore the payload; otherwise fall back to today's payload path. The tools need read access to the draft — **check how a tool reads state today** (`grep -n "config\|getCurrentTaskInput\|state" src/infra/ai/graph/tool-executor.ts | head -20`; the executor already passes `activeSessionId` into the tool call context at line ~152 — extend that same mechanism rather than inventing a new one).
- Modify: the two tools' catalog validation — the draft's exercise IDs must all exist (`exerciseRepository.findByIds`); a missing ID returns `llmError`.
- Create: `apps/server/evals/fixtures/plan-iteration-draft.ts` — a 4-turn scripted iteration fixture.
- Create: `apps/server/evals/levels/__tests__/draft-iteration.unit.test.ts` — **AC-1363 deterministic half** (the `it` name carries `AC-1363`): a mocked-model 4-turn run (`propose_plan_draft` → `update_plan_draft` ×2 → `save_workout_plan`) ends with the persisted plan **deep-equal** to the last draft, and every draft exercise ID exists in the stub catalog. Use a `BaseChatModel` **subclass** as the mock, not a plain object — the P4 plan's Task 4 note records that the shared plain-object model mock never dispatches LangChain callbacks.
- Create: `apps/server/evals/datasets/plan/iteration.jsonl` — authored, **not run** (same cross-phase-directory caveat as Task 6).
- Modify: `apps/server/evals/levels/l1.ts` — a deterministic `draft-equals-persisted` check (PROMPT_EVAL_FRAMEWORK §4.2's "deterministic checks read the draft").

- [ ] **Step 1: Tests first** — as described, plus: with **no** draft the legacy payload path still works byte-identically (D-K); with a draft, a *conflicting* payload is ignored (the draft wins) and that is logged.
- [ ] **Step 2: Implement.**
- [ ] **Step 3: Commit** — `feat(ai): save_workout_plan and start_training_session persist the current draft (AC-1363 deterministic half)`
- [ ] **Step 4: STOP** for orchestrator review.

**Verification:** `npx jest --ci evals src/infra/ai/tools` → all pass; full `npx jest --ci` → green; `npm run evals -- --level L0` → pass.

---

### Task 12: Plan-creation and session-planning prompts for the draft flow

**Files:**
- Create: `apps/server/src/infra/ai/prompts/phases/plan-creation/v3.ts` and `.../session-planning/v4.ts` (**session_planning already gets a v3 in Task 9 — check the version actually at `current` before numbering**). The rule becomes "propose a draft, edit the draft, then save"; the save tool's description says it takes no arguments when a draft exists.
- Modify: the phases' `index.ts` — `current` repointed; all old versions kept.
- Modify: L0 fixtures/snapshots for the new versions.

- [ ] **Step 1: Tests first** — the new versions render with the draft instructions; the previous versions render byte-identically.
- [ ] **Step 2: Implement.**
- [ ] **Step 3: Commit** — `feat(ai): plan_creation and session_planning prompts instruct the draft-then-save flow (P6 item 3)`
- [ ] **Step 4: STOP** — **Group 3 boundary.**

**Verification:** `npx jest --ci src/infra/ai evals` → all pass; `npm run evals -- --level L0` → pass (state the count); `npm run check-all` → 0 errors.

---

### Task 13: Docs, dev deploy, smoke, close-out (orchestrator)

> **Group 1 parts already done.** The facts path in `ARCHITECTURE.md` / `CONTRIBUTING_AI.md`, the `memory/facts` check in `PROMPT_EVAL_FRAMEWORK.md` §4.2, migration `0005`, the ADR-0009 / ADR-0013 D-14 escalations and the D-C backlog entry were handled at the parent plan's Group 1 close-out. Only the Group 2–3 parts of this task remain; the smoke's `user_facts` query (a) is optional here, and no migration is expected unless Tasks 7–12 add one.

**Files:**
- Modify: `docs/ARCHITECTURE.md` (the facts path, the two new blocks, the draft channel, `user_facts`), `docs/CONTRIBUTING_AI.md` (adding a fact category; the draft flow; that `remember_fact` was dropped), `docs/PROMPT_EVAL_FRAMEWORK.md` §4.2 (the three new deterministic checks), `docs/BUGS.md` (BUG-005 — mark it addressed by item 2, **pending** the consolidated pass's TR-6 confirmation, not closed outright).
- Modify: `docs/BACKLOG.md` via the `backlog` skill — the D-C near-duplicate-facts limitation; D-I's deferred removal of `findLastCompletedByUserAndKey`; D-K's deferred removal of the legacy tool payloads (P7).
- ADR amendments to **escalate to the owner, never edit** (`docs/adr/**` is read-only for this plan): **ADR-0009** — its per-turn passive-extraction mechanism and its `remember_fact` tool are superseded by the 2026-09-17 owner decision; its table shape and categories survive (D-B). **ADR-0013** — D-14 (`remember_fact`) is dropped; §3.4 block 2 is now the `## User Facts` block budgeted against `longTerm`; §4.2 gains the `draft` channel and the third `ToolStateUpdate` field.

- [ ] **Step 1: JSDoc and rails** — every new port, block, tool and channel carries JSDoc naming its AC/ADR section. `npx jest --ci evals/levels/__tests__/no-inline-prompts.unit.test.ts` → pass (all new prompt text is under `prompts/`, never `context/`).
- [ ] **Step 2: Docs reconcile** — commit `docs: reconcile ARCHITECTURE, CONTRIBUTING_AI, PROMPT_EVAL_FRAMEWORK, BUGS, BACKLOG with P6`.
- [ ] **Step 3: Deploy to dev** — merge to `dev`, GitHub Actions deploy, migration `0005` applied by `deploy.sh` **before** containers start, `curl https://fitcoach-dev.filko.dev/health` → 200. Confirm the migration actually ran: `docker logs fitcoach-dev-server --tail 50`.
- [ ] **Step 4: Dev smoke — 3–5 calls only.** The owner sends 3–5 messages to `@MyFitAiCoachDevBot`. Paste: (a) one forced compaction (phase transition) followed by `SELECT category, fact, muscle_group, confirmations FROM user_facts WHERE user_id = '<id>';` → at least one row, or an explicit note that the episode carried no durable fact; (b) `SELECT budget_report->'longTerm', budget_report->'cuts' FROM conversation_runs WHERE created_at > now() - interval '2 hours';`; (c) one plan_creation turn showing a `propose_plan_draft` tool call in the run row's `tool_calls`. **No `RUN_LLM_EVALS=1`, no mini-compare, no baseline freeze.**
- [ ] **Step 5: Close-out** — `close-out-review` skill, tick every checkbox, `- Status: done`, `node scripts/state.mjs --write`, commit, merge. **The close-out must restate the per-AC split verbatim:** AC-1361 deterministic half closed / pass-rate deferred; AC-1362 deterministic half closed / TR-6 deferred (no L2 runner); AC-1363 deep-equal invariant closed structurally / live pass rate deferred; **AC-1364 deferred in full**. All deferred halves go to the consolidated eval pass on the prod model via OpenRouter, together with AC-1344. STATE: P6 complete-with-deferrals; Next → P7 (which the master plan says depends on P4 **and** P6) and the consolidated eval pass. Branch/worktree cleanup **only on the owner's explicit command** — report the branch as ready, do not delete it.

**Verification:** `npm run check-all` → 0 errors; full `npx jest --ci` → green; `npm run evals -- --level L0` → pass; `node scripts/state.mjs --check` → OK; `grep -rn "remember_fact" apps/server/src` → no hits. AC-1361, AC-1362, AC-1363 (deterministic halves), AC-1364 (deferred).
