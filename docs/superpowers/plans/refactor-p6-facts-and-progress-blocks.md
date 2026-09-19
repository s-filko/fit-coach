# Refactor P6 — User Facts, Muscle-Centric Progress Blocks and Structured Drafts Implementation Plan

- Status: in progress
- Branch: plan/refactor-p6-facts-and-progress-blocks
- After: refactor-p4-context-budget

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Planned 2026-09-19** (planning architect). Master-plan phase P6, AC-1361..1364.
> Three items, sequenced as three separable task groups in one plan file (D-A).
>
> **Two owner decisions override the master plan's P6 text and are binding here:**
>
> 1. **The `remember_fact` tool is DROPPED** (owner, 2026-09-17 — `docs/STATE.md`
>    § "Blocked / waiting on owner", memory-model decisions). Long-term user facts are
>    extracted **only at summarisation**, from the summariser's structured output, via an
>    idempotent upsert with a confirmation counter. The `user_facts` table stays; the
>    `## User Facts` context block stays; the hard-validation half of item 1 stays. No
>    `PhaseSpec` gains a fact tool.
> 2. **Code first, no model-backed evals** (owner strategy, 2026-09-19). AC-1361..1364 each
>    demand a model-backed statistic; each is split into a deterministic half implemented
>    and tested now, and a model-backed half recorded as **pending the consolidated eval
>    pass** on the prod model via OpenRouter. See **Acceptance criteria** for the per-AC
>    split — that split is the contract, not a caveat.

**Goal:** The coach remembers what the user told it across episodes (facts extracted at
compaction, rendered as block 2, enforced as a hard constraint on plan and session tools),
sees muscle-level recovery and per-exercise history instead of one keyed previous session,
and edits a structured draft it then saves verbatim — so "what the model proposed" and
"what got persisted" stop being two independently-generated objects.

**Architecture:** ADR-0013 §3.4 block 2 (`longTerm` — the budget field already exists on
`TokenBudget` (`src/domain/conversation/episode.ts:44`), is set by all five phase specs
(1000–1500), is already part of `resolveBudget`'s `sumMinusReserve` ceiling
(`context/budget.ts:110`) and is overridable via `LLM_BUDGET_<PHASE>_LONG_TERM`
(`config/llm-budget-overrides.ts`) — but **nothing currently occupies block 2's
long-term slot**, because no content is billed to it. P6 fills it), §3.3 (compaction —
the extraction seam), §4.2
(`contextBlocks`), §6 (`ToolOutcome`, `user_error`), D-14 (the `remember_fact` tool — now
**dropped**, D-B below records the supersession); ADR-0009 (the `user_facts` table shape
and `FactCategory` enum — its *passive per-turn extraction* mechanism is superseded by the
2026-09-17 owner decision; its schema and categories are reused); `docs/PLAN-muscle-centric-history.md`
(item 2's SQL and types — **its file paths are stale**, see Discrepancies).
Master plan P6 items 1–3.

Inputs already in the tree (all verified 2026-09-19): `compact.node.ts`'s
`buildCompactStep` with `llmGateway.structured(EpisodeSummarySchema, …)`;
`SUMMARIZER_V2` (exported as `SUMMARIZER_PROMPT` from `prompts/summarizer/index.ts`) with
its `userState` field; `ContextBlock<D>` / `renderBlocks` / `fullDepth` in
`prompts/blocks/`; `assembleContext`'s block ordering; `PhaseSpec.contextBlocks` and
`PhaseSpec.budget`; `ToolStateUpdate`'s two-field shape in
`domain/conversation/tool-outcome.ts`; `ConversationState`'s channel list in
`graph/state.ts`.

**Tech Stack:** TypeScript, Drizzle (migrations only), Zod, `@langchain/langgraph`, Jest,
the eval harness under `apps/server/evals/`.

**Spec:** ADR-0013 §3.3, §3.4 (block 2, `longTerm`), §4.2, §6; ADR-0009 (table + categories
only); `docs/LLM_CORE_REFACTOR_PLAN.md` § P6 items 1–3, its Notes (the carried-over
"concrete next-set recommendation" rule) and its Rollback condition;
`docs/PROMPT_EVAL_FRAMEWORK.md` §4.2 (deterministic draft checks); `docs/STATE.md`
§ "Blocked / waiting on owner" (the 2026-09-17 memory-model decisions).

**Acceptance criteria:** each AC is split into the half provable now and the half deferred.

- **AC-1361** *(memory/facts)* — "after a constraint is stated in chat, the next
  session_planning run's input contains the fact and the proposed draft contains no
  conflicting exercise; ≥ 90 % pass over n=3."
  - **Provable now (Task 4, Task 6):** on a **fixture** `user_facts` row of category
    `physical_constraint` with a `muscleGroup`, the assembled session_planning input
    contains the `## User Facts` block with that fact (unit test on `assembleContext` +
    the block renderer), and `save_workout_plan` / `start_training_session` **reject** a
    conflicting exercise with a `user_error` outcome quoting the fact (unit tests on the
    tools with a stubbed facts port and a stubbed exercise repo). The extraction half is
    proved with a **mocked summariser** returning a `facts` array (Task 3).
  - **Deferred to the consolidated eval pass:** the `≥ 90 % over n=3` pass rate, and that a
    *live* model actually states the constraint in a way the summariser extracts. The
    `memory/facts` dataset is **authored** in Task 6 and committed; it is not run.
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

---

## Group 1 — User facts (master plan P6 item 1, `remember_fact` dropped)

### Task 1: The `user_facts` table and port

**Files:**
- Modify: `apps/server/src/infra/db/schema.ts` — `userFacts = pgTable('user_facts', …)` per D-B: `id` (uuid pk, `gen_random_uuid()`), `userId` (uuid, FK `users.id` on delete cascade), `category` (text), `fact` (text), `factKey` (text), `muscleGroup` (text, nullable), `confirmations` (integer, default 1), `sourceTurnId` (uuid, nullable, FK `conversation_turns.id` — OQ-6), `createdAt`, `updatedAt` (timestamptz, default now). Indexes: on `userId`; **unique** on `(userId, category, factKey)` (D-C). Place it next to the other conversation-adjacent tables (`conversationSummaries` is at line ~148 — follow the file's existing ordering).
- Create: `apps/server/src/domain/user/ports/user-facts.ports.ts` — `FactCategory` (ADR-0009's eight values), `UserFact`, `UpsertFactInput`, `USER_FACTS_SERVICE_TOKEN`, `IUserFactsService` with `upsertMany(userId, facts, sourceTurnId?): Promise<number>` (returns rows written/confirmed), `getForPrompt(userId, cap?): Promise<UserFact[]>` (ordered by category then recency, cap default 50), `getConstraints(userId): Promise<UserFact[]>` (the `physical_constraint` subset with a non-null `muscleGroup` — what D-G's validation needs).
- Modify: `apps/server/src/domain/user/ports/index.ts` — re-export.
- Create: `apps/server/src/infra/db/repositories/user-facts.repository.ts` — the Drizzle implementation; `upsertMany` uses `onConflictDoUpdate` on the unique index per D-C.
- Create: `apps/server/src/infra/db/__tests__/user-facts.schema.unit.test.ts` (follow `conversation-runs.schema.unit.test.ts`'s shape), `apps/server/tests/integration/database/user-facts.repository.integration.test.ts` (behind the same env gate the neighbouring integration tests use — **check `tests/integration/database/` first**).
- Modify: `apps/server/src/main/register-infra-services.ts` — register the service under `USER_FACTS_SERVICE_TOKEN`.
- Create: the drizzle migration — `npm run drizzle:generate`, review the SQL, commit it (it will be `drizzle/0005_*.sql`). **Never** `drizzle-kit push`; **never** touch `checkpoints*`.

- [x] **Step 1: Tests first** — schema unit test pins the column set and the unique index; repository integration test: inserting the same normalised fact twice yields **one** row with `confirmations = 2` and an unchanged `fact` text (D-C); a different category with the same text yields a second row; `getForPrompt` respects the cap and the category-then-recency order; `getConstraints` returns only `physical_constraint` rows with a `muscleGroup`.
- [x] **Step 2: Implement.** Migration SQL pasted below and **reviewed and approved by the orchestrator 2026-09-19** before committing.
- [x] **Step 3: Commit** — `feat(db): user_facts table with idempotent upsert and confirmation counter (ADR-0009 schema, owner decision 2026-09-17)` — `626c9d21`.
- [x] **Step 4: STOP** for orchestrator review. **Reviewed and accepted 2026-09-19.** Verification: `npx jest --ci src/infra/db` 36/36; the user-facts integration test 5/5 under `RUN_DB_TESTS=1`; `tsc --noEmit` clean; `git diff --stat drizzle/` → exactly one new `.sql` (`0005_blue_domino.sql`) plus drizzle's own `meta/` bookkeeping. **Timestamp convention — decided by the orchestrator:** the plan and ADR-0009 sketch `TIMESTAMPTZ`, but `grep -c "timestamptz|withTimezone" schema.ts` → **0** — every existing table uses naive `timestamp`. `user_facts` follows the file's convention rather than becoming the lone exception; making one table diverge would create two conventions inside one schema, which is worse than the flaw. The flaw is real and now tracked: during the P5 dev smoke a `WHERE created_at > now() - interval '15 minutes'` filter returned zero rows while the runs existed (naive local time vs UTC `now()`, ~3 h skew) — filed in `docs/BACKLOG.md` as a schema-wide `timestamptz` migration.

**Verification:** `npx jest --ci src/infra/db` → all pass; `RUN_DB_TESTS=1 NODE_ENV=test npx jest --ci --testMatch='**/tests/integration/database/user-facts.repository.integration.test.ts'` → pass; `npx tsc --noEmit` clean; `git diff --stat drizzle/` shows exactly one new migration file.

**Migration (Task 1).** `apps/server/drizzle/0005_blue_domino.sql`, generated by `npm run drizzle:generate` (never `push`), reviewed by the orchestrator before commit:

```sql
CREATE TABLE "user_facts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"category" text NOT NULL,
	"fact" text NOT NULL,
	"fact_key" text NOT NULL,
	"muscle_group" text,
	"confirmations" integer DEFAULT 1 NOT NULL,
	"source_turn_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "uq_user_facts_user_category_fact_key" UNIQUE("user_id","category","fact_key")
);
--> statement-breakpoint
ALTER TABLE "user_facts" ADD CONSTRAINT "user_facts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_facts" ADD CONSTRAINT "user_facts_source_turn_id_conversation_turns_id_fk" FOREIGN KEY ("source_turn_id") REFERENCES "public"."conversation_turns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_user_facts_user" ON "user_facts" USING btree ("user_id");
```

Review notes: the unique constraint on `(user_id, category, fact_key)` is what makes D-C's idempotent upsert work; `ON DELETE cascade` on `user_id` is right (facts die with the user); `NO ACTION` on `source_turn_id` is the safer default — a pruned conversation turn must not silently delete a confirmed fact. No `checkpoints*` table is referenced.

---

### Task 2: Summariser v3 with a `facts` field

**Files:**
- Modify: `apps/server/src/domain/conversation/episode.ts` — extend `EpisodeSummarySchema` with `facts: z.array(z.object({ category: z.enum([...FactCategory]), fact: z.string(), muscleGroup: z.string().optional() }))`. **Keep the schema `.strict()`**. Note the JSDoc: `StoredEpisodeSummary`'s *rendering* is unchanged (D-D).
- Create: `apps/server/src/infra/ai/prompts/summarizer/v3.ts` — `SUMMARIZER_V3`, v2's text plus the `facts` field instruction (what counts as a durable fact vs. episode chatter; muscle tagging for physical constraints; empty array when nothing qualifies).
- Modify: `apps/server/src/infra/ai/prompts/summarizer/index.ts` — `export { SUMMARIZER_V3 as SUMMARIZER_PROMPT }`; keep the `SUMMARIZER_V1`/`SUMMARIZER_V2` exports (both files stay).
- Modify: `apps/server/src/infra/ai/prompts/blocks/episode-summaries.v1.ts` — **verify no change is needed**: it must render only the original five fields. If it iterates the summary object generically, pin the five fields explicitly and say so in the commit.
- L0: add snapshots for `summarizer` v3 alongside the existing ones (**find them first**: `grep -rn "summarizer" evals/snapshots/ evals/levels/l0.ts`).

- [x] **Step 1: Tests first** — the v3 prompt renders two sections (system, user) like v2; `EpisodeSummarySchema` accepts a payload with `facts` and rejects an unknown category; `episodeParagraph` output for a summary **with** facts is byte-identical to the same summary **without** them (D-D — the block does not leak facts).
- [x] **Step 2: Implement.**
- [x] **Step 3: Commit** — `feat(ai): summariser v3 extracts durable user facts in its structured output (owner decision 2026-09-17)` — `d9231e2b`.
- [x] **Step 4: STOP** for orchestrator review. **Reviewed and accepted 2026-09-19.** D-D verified by the orchestrator against the tree: `episode-summaries.v1.ts` names its five fields explicitly (`topics`, `decisions`, `userState`, `trainingFeedback`, `openItems`) rather than iterating the summary object, so `facts` cannot leak into the rendered block — no code change was needed there, and two new tests pin it (byte-identical render with and without facts; fact text/category/muscleGroup never appear in the output). Verification: `npx jest --ci src/infra/ai/prompts src/domain/conversation` 84/84; full `npx jest --ci` 857/857; L0 96/96 (unchanged — the facts check arrives with Task 6's dataset); `tsc --noEmit` clean. Two new snapshots (`summarizer v3 / system`, `/ user`); all 34 pre-existing snapshots byte-identical.

**Latent defect found and fixed by the executor (outside the task's file list, accepted):** the two snapshot tests named `summarizer v2 / …` in `evals/snapshots/__tests__/prompt-snapshots.unit.test.ts` rendered the **moving** `SUMMARIZER_PROMPT` alias, not `SUMMARIZER_V2`. Freezing v2 was therefore illusory — the first `jest -u` after the alias moved to v3 would have silently re-baselined v2's snapshot onto v3's output, destroying the "v1 and v2 both stay, byte-identical" guarantee. (v1 was safe; its tests already referenced `SUMMARIZER_V1` directly.) Both tests now reference `SUMMARIZER_V2` directly. This is exactly the hazard the P4 review's rule candidate about frozen artefacts is circling — worth generalising: **a snapshot test must reference the concrete version it claims to freeze, never a `*_PROMPT`-style alias.**

**Verification:** `npx jest --ci src/infra/ai/prompts src/domain/conversation` → all pass; `npm run evals -- --level L0` → passes with the v3 snapshots added (state the new count).

---

### Task 3: Fact extraction in the `compact` node

**Files:**
- Modify: `apps/server/src/infra/ai/graph/nodes/compact.node.ts` — `CompactStepDeps` gains `userFacts: IUserFactsService`. After a successful `summaries.insert`, call `userFacts.upsertMany(userId, summary.facts, …)` inside its **own** try/catch logging `error` and continuing (D-E). Note in the node's header comment that this is the **only** fact-writing path (no tool).
- Modify: `apps/server/src/infra/ai/graph/conversation.graph.ts` (or wherever `buildCompactStep` is wired — **grep first**: `grep -rn "buildCompactStep" src/`) — pass the service through.
- Modify: `apps/server/src/infra/ai/graph/nodes/__tests__/compact.node.unit.test.ts` — extend.

- [x] **Step 1: Tests first** — a mocked summariser returning two facts calls `upsertMany` once with both; a summariser returning `facts: []` calls it with an empty array or not at all (pick one, assert it); a **failed** summariser writes no facts and still trims (BR-LLM-004 unchanged); a **throwing** `upsertMany` logs `error` and the compaction result is unchanged (D-E); a **short episode** trimmed without a summary writes no facts.
- [x] **Step 2: Implement.**
- [x] **Step 3: Commit** — `feat(ai): extract user facts at compaction from the summariser's structured output (P6 item 1, no remember_fact tool)` — `98724cd4`.
- [x] **Step 4: STOP** for orchestrator review. **Reviewed and accepted 2026-09-19.** `buildCompactStep` is constructed in `conversation.graph.ts:70` (no `*.subgraph.ts` survives P3); the service is threaded `ConversationGraphDeps` → `buildGraph` → `buildCompactStep`, with the real repository injected in `register-infra-services.ts`. **Empty-facts choice: skip the call entirely** when `summary.facts.length === 0` — asserted as `expect(upsertMany).not.toHaveBeenCalled()`, which is a stronger claim than asserting an empty-array argument, and avoids a pointless round-trip in the common case. D-E verified by the orchestrator in the tree: the upsert sits in its own try/catch that logs `error` and lets compaction continue; the test asserts the **returned state** (`removedIds`, `episodeId`, `episodeStartedAt`, `compactReason`, summary count) is identical between a throwing upsert and a no-facts run, not merely that a log happened. Verification: `npx jest --ci src/infra/ai/graph` 148/148; full `npx jest --ci` 862/862; L0 96/96; `tsc --noEmit` clean; `grep -rn "remember_fact" apps/server/src` → **no hits**.

**Two real defects found by the executor while implementing this task, both fixed here:**
1. **A type hole from Task 2.** `FACT_CATEGORIES` was declared `readonly FactCategory[]`, which erases literal types, so `z.enum(FACT_CATEGORIES as [string, ...string[]])` inferred `category: string` rather than `FactCategory` — `summary.facts` then did not type-check against `UpsertFactInput[]` at the one call site that actually passes it to `upsertMany`. Task 2's schema was runtime-correct but type-hollow, and only Task 3's real call site exposed it. Fixed by making `FACT_CATEGORIES` an `as const satisfies readonly FactCategory[]` tuple and dropping the cast.
2. **A latent runtime crash in `episode-memory.integration.unit.test.ts`.** That test overrides `llmGateway.structured` with a hand-built summary object (bypassing Zod) and drives it through the *real* `compact.node.ts`, whose deps are `as unknown as ConversationGraphDeps` — so `tsc` could not see that the mock lacked `facts`, and `summary.facts.length` would have thrown `Cannot read properties of undefined` at run time. Fixed by adding `facts: []` to the mock.

**One consequence of the plan's own verification gate, worth noting:** `grep -rn "remember_fact" apps/server/src` → "no hits" is a *literal string* check, so explanatory comments correctly stating that no such tool exists also break it. Six such comments (from Tasks 2 and 3) were reworded to "no per-turn fact-writing tool". The gate works, but it forbids naming the dropped tool even to say it is dropped.

**Verification:** `npx jest --ci src/infra/ai/graph` → all pass; `grep -rn "remember_fact" apps/server/src` → **no hits** (the dropped tool never exists).

---

### Task 4: The `## User Facts` block (block 2) and the `longTerm` budget line

**Files:**
- Create: `apps/server/src/infra/ai/prompts/blocks/user-facts.v1.ts` — a `PromptModule` rendered with the existing `renderBlock` helper (D-F), heading `## User Facts`, facts grouped by category then recency, cap 50. Pure (BR-LLM-007): no I/O, no clock reads beyond the passed `now`.
- Modify: `apps/server/src/infra/ai/prompts/blocks/index.ts` — export it.
- Modify: `apps/server/src/infra/ai/context/assemble-context.ts` — `AssembleInput` gains `userFacts?: UserFact[]`; the rendered block is placed at **block 2**, immediately after the phase prompt and **before** the episode-summaries block (ADR-0013 §3.4 ordering — long-term memory precedes episode memory). `BudgetReport` gains `longTerm: number`.
- Modify: `apps/server/src/infra/ai/context/budget.ts` — `resolveBudget` counts the facts block against `budget.longTerm` and, when over, **truncates the fact list** (drop lowest-`confirmations` first, then oldest) **before** step (a) trims history. Add this as a new first step in the INV-LLM-004 order and say so in the JSDoc.
- Modify: `apps/server/src/domain/conversation/ports/conversation-run.ports.ts` — `BudgetReport.longTerm`; `cuts` gains `'facts'`.
- Modify: `apps/server/src/infra/ai/graph/nodes/agent.node.ts` — load the facts once per run and pass them to `assembleContext` (**grep the current call site**: `grep -n "assembleContext" src/infra/ai/graph/nodes/agent.node.ts`).
- Modify: `apps/server/evals/snapshots/__tests__/message-assembly.unit.test.ts` — regenerate **once**, with the diff enumerated first: a new SystemMessage appears at position 2 **only** for fixtures that have facts; fixtures without facts are byte-identical.

- [x] **Step 1: Tests first** — block renders nothing (`null`/absent) for zero facts; renders grouped and capped for many; the assembler places it before the summaries block; a fixture with no facts produces a byte-identical message array to today's; `resolveBudget` truncates facts before trimming history and records `'facts'` in `cuts`; INV-LLM-004 still holds (block 1 untouched).
- [x] **Step 2: Implement.** Snapshot diff enumerated below; **reviewed by the orchestrator before any regeneration — and the answer was that none was needed.**
- [x] **Step 3: Commit** — `feat(ai): ## User Facts context block at block 2, budgeted against longTerm (ADR-0013 §3.4)` — `9378851d`.
- [ ] **Step 4: STOP** for orchestrator review.

**Verification:** `npx jest --ci src/infra/ai evals/snapshots` → all pass; `npm run evals -- --level L0` → 96/96 (or the new count after Task 2 — state it); `npx jest --ci evals/levels/__tests__/no-inline-prompts.unit.test.ts` → pass (the block is under `prompts/`, which is the allowed location — **not** `context/`).

**Snapshot diff (Task 4):** _(enumerate before regenerating)_

---

### Task 5: Hard validation — constraint conflicts reject the tool call

**Files:**
- Create: `apps/server/src/domain/user/services/fact-conflicts.ts` — `checkFactConflicts({ facts, exercises }): { exerciseId: string; exerciseName: string; fact: UserFact } | null` (D-G). Pure, no I/O. Conflict = an exercise's **primary** muscle groups intersect a `physical_constraint` fact's `muscleGroup`.
- Create: `apps/server/src/domain/user/services/__tests__/fact-conflicts.unit.test.ts`
- Modify: `apps/server/src/infra/ai/tools/save-workout-plan.tool.ts` — deps gain `userFactsService`; before persisting, resolve the plan's exercise IDs to muscle groups via the existing `exerciseRepository.findByIdsWithMuscles` (**verified to exist** in `IExerciseRepository`) and return `userError(...)` quoting the fact on a conflict.
- Modify: `apps/server/src/infra/ai/tools/start-training-session.tool.ts` — the same.
- Modify: `apps/server/src/infra/ai/graph/phases/plan-creation.spec.ts`, `session-planning.spec.ts`, `training.spec.ts` — whichever specs build those tools (**grep**: `grep -rn "saveWorkoutPlanTool\|startTrainingSessionTool" src/infra/ai/graph/phases/`) get the service through their deps.
- Modify: the two tools' existing `__tests__`.

- [x] **Step 1: Tests first** — pure function: no facts → null; a `physical_constraint` fact with `muscleGroup: 'lower_back'` and an exercise whose **primary** muscles include `lower_back` → conflict; the same muscle as a **secondary** muscle → **no** conflict (constraints bind on primary involvement only — state this in the JSDoc); a non-`physical_constraint` fact with a muscle group → no conflict (preferences are soft, per ADR-0009's category semantics). Tools: a conflicting plan returns `ok: false, kind: 'user_error'` with the fact's text in the message and **persists nothing**; a clean plan persists as before (byte-identical `ok.summary` — `TOOL_OUTCOME_FORMAT_ID` is frozen).
- [x] **Step 2: Implement.**
- [x] **Step 3: Commit** — `feat(ai): save_workout_plan and start_training_session reject exercises conflicting with a physical_constraint fact (AC-1361 deterministic half)`
- [x] **Step 4: STOP** for orchestrator review. **Reviewed and accepted 2026-09-19** (commit `1e2031c5`, GLM worker via Orca). Verified independently by the orchestrator: `npx jest --ci src/domain/user src/infra/ai/tools src/infra/ai/graph/phases` 142/142; L0 96/96 — the success-path text is unchanged and now also pinned by an exact-equality test; primary-only semantics in the JSDoc and covered by a secondary-muscle negative test in both tools; a conflict persists nothing (`create` / `startSession` not called). Existence check now uses `findByIdsWithMuscles` (one call instead of two) — it loads exercises via `findByIds` first, so an exercise with no muscle rows is still found and simply cannot conflict.

**Verification:** `npx jest --ci src/domain/user src/infra/ai/tools src/infra/ai/graph/phases` → all pass; `npm run evals -- --level L0` → pass (tool-result text for the clean path must be unchanged).

---

### Task 6: `memory/facts` dataset (authored, not run) and Group 1 docs

**Files:**
- Create: `apps/server/evals/datasets/memory/facts.jsonl` — the AC-1361 cases: a constraint stated in chat, then a session_planning turn. **Follow the existing dataset schema exactly** (`evals/schema/`, and read an existing file such as `evals/datasets/chat/transitions.jsonl` first). **Note:** every existing dataset directory is named after a *phase*; `memory/` is the first cross-phase one — check `evals/levels/l1.ts`'s `loadCases(phase, dataset?)` (line ~165) and `evals/run.ts`'s `--phase` handling to see whether a non-phase directory loads at all. **If it does not, fix the loader to accept it** (a small, tested change) rather than shoehorning the dataset into a phase directory.
- Modify: `apps/server/evals/levels/l1.ts` — add the deterministic check `user-facts-block-present` (the assembled input contains the `## User Facts` heading and the expected fact substring). Do **not** rename existing checks (baselines v0–v2 record them).
- Modify: `docs/ARCHITECTURE.md`, `docs/CONTRIBUTING_AI.md` — the facts path (extraction at compaction, block 2, hard validation), explicitly stating that `remember_fact` was dropped by owner decision 2026-09-17.
- Modify: `docs/PROMPT_EVAL_FRAMEWORK.md` §4.2 — the new check.

- [x] **Step 1:** Author the dataset and the check; unit-test the check against fixture observations (the check is pure — it does not need a model).
- [x] **Step 2: Commit** — `test(evals): memory/facts dataset and the user-facts-block check (AC-1361, authored not run)`
- [ ] **Step 3: STOP** — **Group 1 boundary.** Report: the tree is green, item 1 is complete and independently revertable here.

**Verification:** `npx jest --ci evals` → all pass; `npm run evals -- --level L0` → pass. **No `RUN_LLM_EVALS=1`.** AC-1361's deterministic half is closed; its pass-rate half is recorded as pending the consolidated eval pass.

---

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

---

### Task 14: Decided without the owner (2026-09-19)

| Decision | Options considered | What I chose and why | How to revert |
|---|---|---|---|
| **Group 1 stopped after Task 4 and the branch is left UNMERGED.** Decided by the orchestrator at the end of the delegated night, 2026-09-19. | (a) Merge the four done tasks and set `Status: done`; (b) merge and accept a failing `state.mjs --check`; (c) split the plan file at the Task 4/5 boundary; (d) leave the branch unmerged, `--check` green. | **(d)** — I did merge it, observed the consequence, and reverted (local only, never pushed). `scripts/state.mjs` equates "merged" with "finished": a merged plan whose `Status` is not `done` is reported as **close-out debt** and fails the gate. (a) is a lie — Tasks 5–12 are not done. (b) hands over a red gate, which is exactly the close-out debt the rule exists to prevent. (c) is a plan rewrite, and cutting mid-group unsupervised at the end of a night is the kind of judgement that should have the owner in the loop. (d) misrepresents nothing: the code is green and committed, `dev` is untouched, `--check` is OK. | Nothing to revert. To land the work: finish Tasks 5–6 and close Group 1 normally (cheapest), or split per D-A and close Group 1 as its own plan. |
| **All three P6 items in one plan file, three task groups.** | (a) Three plan files/branches; (b) one file, one undifferentiated task list; (c) one file, three explicitly separable groups. | **(c)** — D-A. The master plan calls the items "independent PRs" and reverts them individually, so the boundaries must survive; but three files would triplicate the shared vocabulary (blocks, budget, `ToolStateUpdate`) and the `After:` chain. The group boundaries (end of Task 6, Task 9, Task 12) are each a green tree. **Splitting into three branches remains an option for the owner** — cut at those two points. | Split the file at the group boundaries into `refactor-p6-facts`, `refactor-p6-progress-blocks`, `refactor-p6-drafts` with an `After:` chain. No task content changes. |
| **Every AC split into a deterministic half (now) and a model-backed half (deferred).** | (a) Mark AC-1361..1364 wholly deferred; (b) split per AC. | **(b)** — the owner's instruction was explicit that the deterministic half is implemented and tested now and the split is stated per AC. It also means three of the four ACs have real, failing-if-broken tests in CI today rather than an IOU. AC-1364 alone is deferred in full because it is a two-run comparison by definition. | Nothing to revert — the deferred halves are recorded, not skipped. The consolidated eval pass closes them. |
| **Summariser v3 extends the structured schema rather than reusing `userState`.** | (a) Mine the existing `userState` free-text array for facts; (b) a second LLM call at compaction; (c) add a typed `facts` field to the one structured call. | **(c)** — D-D. `userState` has no category and no muscle tag, so it cannot drive the hard validation (D-G) that AC-1361's deterministic half rests on; (b) doubles compaction latency and cost on the user's critical path. (c) costs one schema field. | Revert `v3.ts`, repoint `SUMMARIZER_PROMPT` to v2, drop `facts` from `EpisodeSummarySchema`. Task 3's extraction call becomes a no-op. |
| **Idempotency by a code-normalised `fact_key`, not by similarity.** | (a) Unique on the raw text; (b) embedding-similarity dedup; (c) normalised key + confirmation counter. | **(c)** — D-C. Deterministic and testable without a model, which is the whole constraint this plan operates under. (b) would need an eval to tune the threshold — exactly what is banned. The known cost: near-duplicates phrased differently create two rows. **Logged to BACKLOG rather than solved.** | Change the unique index and the upsert in one migration + one repository method. |
| **`## User Facts` is a `PromptModule` at block 2, not a `ContextBlock` per phase.** | (a) A `ContextBlock` added to all five `PhaseSpec`s; (b) a block-2 module in the assembler. | **(b)** — D-F. Facts are phase-independent; ADR-0013 §3.4 puts long-term memory at block 2, before domain block 3; and `TokenBudget.longTerm` already exists, is set by all five specs and already caps `resolveBudget`'s total — but nothing is billed to it yet, so this slot is exactly what it was reserved for. (a) would duplicate the block across five specs and bill it to the wrong budget line. | Move the renderer into a `ContextBlock` and add it to each spec's `contextBlocks`; drop the `longTerm` accounting. |
| **Facts are truncated before history is trimmed** in the INV-LLM-004 order. | (a) Facts last (after dropping summaries); (b) facts first; (c) facts never cut. | **(b)** — facts are the cheapest thing to shorten (drop lowest-`confirmations` first) and the least contextually load-bearing per token, whereas history and the current turn carry the live conversation. **This extends INV-LLM-004's published order**, so it is flagged for the owner and documented in `budget.ts`'s JSDoc. (c) risks a floor case with many facts. | Reorder the steps in `resolveBudget`; the `'facts'` entry in `cuts` stays valid either way. |
| **Repository/service method names follow `PLAN-muscle-centric-history.md`, not the master plan.** | (a) The master plan's `getMuscleRecovery` / `getExerciseHistoryByMuscles` on the repository; (b) the design doc's two-layer naming. | **(b)** — D-H. The master plan compressed a two-layer design (repository `getMuscleGroupFatigue` / `getExerciseHistory`; service `getMuscleReadiness` / `getExerciseHistoryByMuscles`) into one line. Following the design doc keeps the layers distinguishable; using one name at both layers would be confusing at the call sites. | Rename; it is mechanical and type-checked. |
| **`findLastCompletedByUserAndKey` is deprecated, not removed**, contrary to `PLAN-muscle-centric-history.md` § Cleanup. | (a) Remove it now as that doc says; (b) deprecate and remove in a follow-up. | **(b)** — D-I. Removing the old path before the new one is *proven* better makes the consolidated eval pass's comparison impossible and the rollback lossy — and "better" here is AC-1362's TR-6 judge mean, a model-backed judgement this plan is forbidden to make. | Delete the method, its implementation and the `training.spec.ts` call site once the consolidated pass reports. One commit. |
| **Save tools keep their payload as a deprecated fallback** instead of "take no payload" as the master plan says. | (a) Hard cutover to draft-only; (b) draft-wins with a payload fallback. | **(b)** — D-K. A hard cutover breaks every in-flight dev conversation at deploy and makes item 3's revert dirty. The fallback is a few lines and one test, and it lets the draft path be verified independently before the old path is retired in P7. **Deliberate deviation from the master plan text.** | Delete the fallback branch and the payload schemas in P7, as the master plan intends. |
| **The `draft` channel is state, not a table.** | (a) A `plan_drafts` table; (b) a `ConversationState` channel. | **(b)** — D-J. A draft belongs to the episode: `clearContext` should drop it, and it should never outlive the conversation that produced it. A table would make an abandoned draft immortal and add a migration for nothing. | Add a table and a port; the tools' interfaces would not change. |
| **`memory/`, `progress/` and `plan/` dataset directories are cross-phase**, which the eval loader may not support. | (a) Force the datasets into existing phase directories; (b) check the loader and extend it if needed. | **(b)** — the AC text names those dataset paths (`memory/facts`, `progress/history`, `plan/iteration`), and bending them into phase directories would make the consolidated pass's report not match the ACs. Task 6 makes verifying the loader an explicit step rather than an assumption. | If the owner prefers phase directories, rename the three files and drop the loader change. |
| **P6's `- After:` names `refactor-p4-context-budget`.** | (a) `refactor-p4-episode-memory`; (b) `refactor-p4-context-budget`. | **(b)** — as instructed, and correct on the merits: P6's blocks and budget accounting build directly on the context-budget plan's `ContextBlock`/`resolveBudget`/`prompts/blocks/` machinery, not merely on episode memory. Note that plan is **`in progress`**, so P6 must not start until it is `done` (dispatch rule). | Change the header line. |
| **BUG-005 is marked addressed-pending-confirmation, not closed.** | (a) Close it when item 2 merges; (b) mark addressed, close after the consolidated pass. | **(b)** — the bug's user-visible symptom is a *quality* claim; the deterministic test proves the data now reaches the prompt, which is necessary but not sufficient. Closing on the deterministic half alone would overstate what was verified. | Close it once TR-6 reports. |


---

## Execution status (2026-09-19, overnight orchestration)

**Group 1 (user facts) is 4 of 6 tasks done, on the branch and NOT merged to `dev`; Groups 2 and
3 are untouched.** The plan stays `- Status: in progress`. Nothing here is half-written: every
task is committed, tested and reviewed, and the tree is clean at `bc5c5dac`.

**Why it is not merged — decided by the orchestrator, 2026-09-19.** I merged it, saw what that
does to the status gate, and reverted the merge (local only, never pushed). `scripts/state.mjs`
treats "merged into dev" + "Status is not done" as **close-out debt** and fails `--check`, because
it assumes a merged plan is a finished plan. A partially-executed plan merged mid-way has no
honest representation in that model: `Status: done` would be a lie (Tasks 5–12 are not done), and
the only other options were to rewrite the gate or to split the plan file at Task 4 — neither of
which I will do unsupervised at the end of a delegated night. So the branch stays unmerged and
`--check` stays green, which is the state that misrepresents nothing.

**What the owner can do with it, in order of preference:**
1. Continue Group 1 — run Task 5 (hard validation) and Task 6 (dataset + docs), then close and
   merge the whole group normally. This is the cheapest path; the branch is ready to build on.
2. Split the plan at the Task 4/5 boundary into `refactor-p6-facts` (done) and a follow-up plan
   holding Tasks 5–12, per D-A's pre-recorded option. Then Group 1's four tasks close and merge
   cleanly on their own.
3. Merge as-is and accept one `--check` failure until Group 1 finishes — the code is green
   (878 tests, 56 snapshots, L0 96/96, `check-all` 0 errors) and migration `0005` is additive.

Option 1 or 2; option 3 only if the code is wanted on dev today.

| Task | State |
|---|---|
| 1 — `user_facts` table and port | **done** (`626c9d21`), migration `0005` reviewed before commit |
| 2 — summariser v3 with a `facts` field | **done** (`d9231e2b`) |
| 3 — fact extraction in the `compact` node | **done** (`98724cd4`) |
| 4 — `## User Facts` block at block 2, `longTerm` budget | **done** (`9378851d`) |
| 5 — hard validation (constraint conflicts reject the tool call) | **not started** |
| 6 — `memory/facts` dataset and Group 1 docs | **not started** |
| 7–12 — Groups 2 (progress blocks) and 3 (structured drafts) | **not started** |

**What works end to end after these four tasks:** the summariser emits durable facts in its
structured output, compaction upserts them idempotently with a confirmation counter, and the
`## User Facts` block renders them at block 2 — ahead of episode memory, budgeted against
`longTerm`, truncated most-expendable-first when over budget. A fact stated in conversation now
survives compaction and comes back in the next run's prompt.

**What is deliberately not there yet:** nothing *enforces* a fact. Task 5's hard validation —
rejecting a `save_workout_plan` / `start_training_session` call whose exercises conflict with a
`physical_constraint` fact — is unimplemented, so today a stated injury informs the model without
binding it. That is the difference between "the model knows" and "the system guarantees", and it
is the next task to run.

**Why it stopped here:** the owner delegated the night and is due back; Task 5 modifies two tools
whose output text is frozen by `TOOL_OUTCOME_FORMAT_ID = 'v1'`, and starting it without leaving
time for review and a dev smoke would have meant handing over a branch mid-task. AC-1361's
deterministic half depends on Task 5, so it stays **pending**, as do AC-1362/1363 (Groups 2/3)
and AC-1364 (a two-run comparison by definition, deferred to the consolidated eval pass).

**Migration note for the owner:** `0005_blue_domino.sql` is merged to `dev` and applied by
`deploy.sh` on the next dev deploy. It is additive — one new table, no column changes to existing
tables — so it carries no rollback hazard for the running app. It has **not** reached prod, and
must not until the owner decides.
