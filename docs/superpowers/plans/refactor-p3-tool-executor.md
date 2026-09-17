# Refactor P3 — Shared Tool Executor Implementation Plan

- Status: done
- Branch: plan/refactor-p3-tool-executor
- After: refactor-p2-context-assembler
- Review: 2026-09-18 | clean | R1,R2,R3,R4

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One tool executor runs the tool calls of every phase. Tools return a typed `ToolOutcome` and request state changes (transition, active session) as a plain return value that the executor turns into a graph state update — no per-user maps, no module-level mutable state. The training-only protections (priority ordering, batch dedup, error budget, dynamic availability) and the planning-only `search_exercises` dedup become policy fields on one executor. The model sees the same tool schemas and the same tool-result strings as today.

**Architecture:** ADR-0013 §4.2 (`toolPolicy`), §4.4 (tools: run context via `config.configurable`, state updates from tools, `ToolOutcome` serialised by the executor "in a fixed textual shape"), §6 (`ToolOutcome`, error budget, `system_error`), §11 (`infra/ai/tools/` one file per tool; `infra/ai/messages/` catalog). Master plan P3 items 3 (executor half) and 4. This is the first of three P3 plans; `refactor-p3-phase-spec` (factory + shared agent node) and `refactor-p3-run-context-commit` (state, prepare/route/commit, run port) follow. Order rationale: the executor is self-contained and leaves the five subgraphs in place, so its blast radius is the tool loop only; the factory then replaces the subgraphs around a proven executor; the state/port rewrite touches one factory instead of five subgraphs.

**Tech Stack:** TypeScript, Jest (`--ci` snapshots), `@langchain/core` tools/messages, LangGraph 1.1.5, ESLint `no-restricted-syntax` rails, the `evals/` stack (L1 runner, baselines).

**Spec:** `docs/adr/0013-llm-core-target-architecture.md` §4.2, §4.4, §6, §11; `docs/LLM_CORE_REFACTOR_PLAN.md` § P3 scope items 3–4 and the cross-phase rules (no prompt wording change in a plumbing phase); `docs/PROMPT_EVAL_FRAMEWORK.md` §4.2 (L1 cases). Owner decisions 2026-09-17 (`docs/STATE.md` § Blocked): phases differ only by prompt, tool set (phase tools + shared tools) and context loaders.

**Acceptance criteria:** AC-1331 (`grep -rn "PendingRefMap\|pendingTransitions\|currentSessionIds" apps/server/src` → empty; no module-level mutable state in `infra/ai/graph/**` except compiled graphs), AC-1332 (executor unit tests: ordering, batch dedup, state-update propagation of `pendingTransition`/`activeSessionId`, `system_error` short-circuit, `llm_error` budget exhaustion → catalog message), AC-1334 (L1 pass rates within ±2 pp of the `v1` baseline frozen in Task 2; transition datasets ≥ baseline). Plus this plan's own arbiters: the Task 1 **tool-surface snapshots** (name, description, JSON schema of every tool bound per phase) and the P2 **message-assembly snapshots** (`evals/snapshots/__tests__/message-assembly.unit.test.ts`, 15) stay green and are never regenerated here.

## Global Constraints

- **Plumbing phase: no prompt wording change.** Tool names, descriptions and argument schemas are model input and are frozen by the Task 1 tool-surface snapshots. The rendered phase prompts are untouched (L0 snapshots stay green).
- **Tool-result strings are frozen per tool.** `ToolOutcome` serialisation v1 reproduces today's text: an `ok` outcome's `summary` is exactly the string the tool returns today; `llm_error` renders as `LLM_ERROR: <message>`, `system_error` as `SYSTEM_ERROR: <message>` (the prefixes move, they do not change); `user_error` renders its `message` verbatim (today's plain-string refusals such as `Cannot complete registration — still missing: …`). The one deliberate unification: the dedup node's `Error: <message>` for a thrown tool and `ToolNode`'s own error text become `LLM_ERROR: <message>` with `status: 'error'` (decision D-C). Existing tool unit tests keep every string assertion; they change only for the new return type and the `config.configurable` contract.
- **The executor is the only place that turns tool returns into messages and state.** Tools never import LangGraph; they return data (decision D-A).
- **No LangGraph in `domain/**`.** `ToolOutcome` is a plain type in `domain/conversation/tool-outcome.ts`. The ESLint ban on `@langchain/*` in domain is `refactor-p3-run-context-commit` (AC-1333); this plan simply adds nothing that would violate it.
- **The executor passes the node's config through** (`{ ...config, configurable: { ...config.configurable, userId, activeSessionId, runId } }`) so LangChain callbacks (the eval `ToolRecorder`, the LLM log handler's metadata) keep firing exactly as with `ToolNode`. `runId` comes from `config.metadata.runId` (the one channel that reaches callbacks — ADR-0013 §8 P0 note); `configurable.userId` is populated from `state.userId` until `refactor-p3-run-context-commit` moves it to run context.
- **Behaviour on tool failures is preserved, then unified.** Today only training enforces an error budget (1) and a system-error stop; the other four phases loop until `recursionLimit`. After this plan every phase has an `llmErrorBudget` (training keeps 1; the others get `Infinity` — explicitly unbounded, exactly today's behaviour) and every phase stops on `system_error` with the catalog message training shows today. Tightening the other budgets is a tuning decision for the owner, not this plan.
- **No schema change, no migration.** `git status apps/server/drizzle` clean after the plan.
- **Reserved to the orchestrator:** Task 2 (baseline freeze against the real model), Task 8 (L1 compare, dev deploy, smoke, docs, close-out), `Status:` transitions, `docs/STATE.md`, durable specs. Verification commands run from `apps/server/`. Commit messages carry no attribution lines.

## Decisions taken by this plan (not settled by the durable specs — owner may overrule)

| #   | Decision                                                                                                                                                                                               | Alternative rejected                                                            | Why                                                                                                                                                                                                                                                                                                                                                                                  |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| D-A | Tools return `ToolReturn = ToolOutcome \| { outcome: ToolOutcome; update: ToolStateUpdate }`; the **executor** converts `update` into the node's state update (`pendingTransition`, `activeSessionId`) | Tools return LangGraph `Command({ update })` themselves (ADR-0013 §4.4 wording) | Same mechanism (a state update from a tool, D-05) with the LangGraph type kept out of tool bodies: tools stay pure adapters over domain services, testable without a graph; the executor is the one place that knows the state schema. ADR-0007 guardrail 2 is untouched. If the owner prefers literal `Command` returns, the executor's `isCommand` branch is a five-line addition. |
| D-B | `ToolStateUpdate` is `{ pendingTransition?: TransitionRequest; activeSessionId?: string }` — the two facts tools change today                                                                          | A generic `Partial<State>`                                                      | Two named fields are what the five subgraphs propagate through `extractNode` today; a generic partial would let a tool write `phase` directly and bypass the guard (`commit` decides — ADR §4.3).                                                                                                                                                                                    |
| D-C | One error rendering for thrown tools: `LLM_ERROR: <message>`, `status: 'error'`                                                                                                                        | Keep three shapes (`Error:`, `LLM_ERROR:`, `ToolNode`'s text)                   | The shapes differ by accident of which node ran the tool; the model reads the prefix (training prompt rules reference `LLM_ERROR`). Gated by AC-1334.                                                                                                                                                                                                                                |
| D-D | `system_error` ends the run with a catalog message (HTTP 200), as training does today; raising `ToolSystemError` → 500 `CORE_ERROR` (ADR §6) waits for P5, when the bot maps error codes               | Raise now                                                                       | Until P5 the bot cannot map codes, so a 500 today is a worse user experience than training's message. The executor already isolates the decision in one branch; P5 flips it.                                                                                                                                                                                                         |
| D-E | The message catalog (`infra/ai/messages/`) is created here with the executor's two keys; `refactor-p3-run-context-commit` adds the rest                                                                | Create the whole catalog in the last plan                                       | The executor needs two user-facing strings now; creating the directory here lets the inline-prompt rails cover it from the first commit (BACKLOG: "Extend the inline-prompt rails to `infra/ai/messages`").                                                                                                                                                                          |
| D-F | Catalog entries carry both `en` and `ru`; the existing literal keeps its original language byte-for-byte, the other language is a translation the owner reviews in the PR                              | Single-language entries                                                         | OQ-5: catalog driven by `language_code`, English fallback. A Russian user currently receives English router text; the translation is the intended behaviour, listed in the PR description as new text.                                                                                                                                                                               |
| D-G | Tools move to `infra/ai/tools/<tool>.ts` (one file per tool, ADR §11) in this plan's last task                                                                                                         | Leave them in `graph/tools/<phase>.tools.ts` until the PhaseSpec plan           | Every tool body is edited here anyway (return type, `configurable` contract); moving them in the same PR keeps one churn instead of two. Shared tools (`save_timezone`, `search_exercises`) are already tool-per-file.                                                                                                                                                               |
| D-H | Dynamic availability (`training.subgraph.ts` "Dynamic tool filtering") becomes `toolPolicy.availability(input)` but is still called by the training agent node in this plan                            | Move it into the executor                                                       | Availability filters what the model may call (`bindTools`), which is the agent node's business; the shared agent node arrives in `refactor-p3-phase-spec`. The policy field exists now so that plan only moves the call.                                                                                                                                                             |

---

### Task 1: Freeze the tool surface and add the missing transition datasets

Nothing is refactored until the model-facing tool surface is pinned from the **old** code and the transition datasets AC-1334 names exist.

**Files:**

- Create: `apps/server/evals/snapshots/__tests__/tool-surface.unit.test.ts`
- Create: `apps/server/evals/snapshots/__tests__/__snapshots__/tool-surface.unit.test.ts.snap` (generated once, then frozen)
- Create: `apps/server/evals/datasets/session_planning/transitions.jsonl`
- Create: `apps/server/evals/datasets/training/transitions.jsonl`

- [x] **Step 1: Tool-surface snapshot test**

For each phase, build the phase's tool list exactly as its subgraph does today (`buildChatTools({...}) + buildSaveTimezoneTool`, etc.; `pendingTransitions` deps are dummy `PendingRefMap`s) and snapshot `tools.map(t => ({ name: t.name, description: t.description, schema: zodToJsonSchema(t.schema) }))` — `zod-to-json-schema` is what `@langchain/core` uses for `bindTools`; use the same conversion (`import { zodToJsonSchema } from 'zod-to-json-schema'` if present in `node_modules`, else `toJsonSchema` from `@langchain/core/utils/json_schema`). One `it` per phase, test names `` `${phase} tool surface` ``. Header comment: captured from the pre-executor tools; never regenerated in this plan.

- [x] **Step 2: Transition datasets**

Follow the shape of `evals/datasets/chat/transitions.jsonl` (`parseCases` in `evals/schema/case.schema.ts` is the contract). Cases:

`session_planning/transitions.jsonl` (fixture `COMPLETE_PROFILE` with an active plan; `state.phase: 'session_planning'`):

- `SPT-0001` — `state.messages` seed: an assistant message proposing a concrete session (three exercises with valid catalog UUIDs from `evals/fixtures`), user input "Да, всё подходит, погнали" → `tools.must: ['start_training_session']`, `transition: 'training'`.
- `SPT-0002` — user input "Давай не сегодня, вернёмся к этому позже" → `tools.must: ['request_transition']`, `tools.args: { request_transition: { toPhase: 'chat' } }`, `transition: 'chat'`, `tools.mustNot: ['start_training_session']`.
- `SPT-0003` — user input "А сколько подходов в первом упражнении?" (a question during planning) → `tools.mustNot: ['start_training_session', 'request_transition']`, `transition: null`.

`training/transitions.jsonl` (fixture `ACTIVE_SESSION`, `state.phase: 'training'`, `state.activeSessionId: 'session-1'`):

- `TRT-0001` — "Всё, на сегодня закончил" → `tools.must: ['finish_training']`, `transition: 'chat'`.
- `TRT-0002` — "Следующее упражнение" → `tools.must: ['complete_current_exercise']`, `tools.mustNot: ['finish_training']`, `transition: null`.
- `TRT-0003` — "Записал 8 повторов на 80" → `tools.must: ['log_set']`, `tools.mustNot: ['finish_training']`, `transition: null`.

Tags: `['transition', 'AC-1334']`. `text.language: 'ru'` on all six.

- [x] **Step 3: Generate the snapshot and validate the datasets offline**

`npx jest evals/snapshots/__tests__/tool-surface.unit.test.ts` once without `--ci`, then `npx jest --ci evals/snapshots` (5 new + 38 existing snapshots green). `npm run evals -- --level L0` still green (datasets parse; L0 does not run the model).

- [x] **Step 4: Commit**

`test(evals): freeze per-phase tool surface; add session_planning/training transition datasets (AC-1334)`

**Verification:** `npx jest --ci evals/snapshots` → 43 snapshots green; `git show --stat HEAD` lists the `.snap` and both `.jsonl`. AC: this plan's tool-surface arbiter; AC-1334 datasets.

---

### Task 2: Freeze the `v1` baseline (orchestrator)

The master plan's AC-1334 compares against "the P2 baseline"; only `v0` (P0 code) exists. `v1` is the post-P2 code plus Task 1's datasets, frozen before any executor code lands.

- [x] **Step 1:** On the branch at Task 1's commit: `RUN_LLM_EVALS=1 npm run evals -- --level L1 --phase all --samples 3 --baseline write --baseline-version v1`. Record the model id printed (must be the dev route `glm-5.3`).
- [x] **Step 2:** Eyeball `evals/baselines/v1/*.json`: the six new cases have results (a case that fails 0/3 in the baseline is fine — it is baseline truth, and the compare will show it — but a case that _throws_ means the fixture is wrong; fix the dataset, re-freeze).
- [x] **Step 3:** Commit `evals/baselines/v1/` — `test(evals): freeze v1 baseline (post-P2 code, transition datasets)`. Update `evals/baselines/README.md` with the v1 row.

**Verification:** five files under `evals/baselines/v1/`; README row. AC-1334 has its reference.

---

### Task 3: `ToolOutcome`, serialisation v1, and the message catalog

**Files:**

- Create: `apps/server/src/domain/conversation/tool-outcome.ts`
- Create: `apps/server/src/infra/ai/tools/outcome.ts`
- Create: `apps/server/src/infra/ai/tools/__tests__/outcome.unit.test.ts`
- Create: `apps/server/src/infra/ai/messages/catalog.ts`, `en.ts`, `ru.ts`, `index.ts`, `__tests__/catalog.unit.test.ts`
- Modify: `apps/server/src/infra/ai/context/tool-results.ts` (import prefixes from `@infra/ai/tools/outcome`, not from `graph/tools/training.tools`)
- Modify: `apps/server/eslint.config.js`, `apps/server/evals/levels/__tests__/no-inline-prompts.unit.test.ts` (rails cover `src/infra/ai/messages/**` and `src/infra/ai/tools/**`)

**Interfaces:**

```typescript
// domain/conversation/tool-outcome.ts — pure, no imports
export type ToolErrorKind = 'user_error' | 'llm_error' | 'system_error';
export type ToolOutcome =
  | { ok: true; summary: string; data?: unknown }
  | { ok: false; kind: ToolErrorKind; message: string; hint?: string };
export interface ToolStateUpdate { pendingTransition?: TransitionRequest; activeSessionId?: string }
export type ToolReturn = ToolOutcome | { outcome: ToolOutcome; update: ToolStateUpdate };
export function isToolReturnWithUpdate(r: ToolReturn): r is { outcome: ToolOutcome; update: ToolStateUpdate };
export const ok = (summary: string, data?: unknown): ToolOutcome;
export const userError = (message: string, hint?: string): ToolOutcome;
export const llmError = (message: string, hint?: string): ToolOutcome;
export const systemError = (message: string): ToolOutcome;

// infra/ai/tools/outcome.ts
export const LLM_ERROR_PREFIX = 'LLM_ERROR:';        // moved verbatim from graph/tools/training.tools.ts
export const SYSTEM_ERROR_PREFIX = 'SYSTEM_ERROR:';
export const TOOL_OUTCOME_FORMAT_ID = 'v1';
export function toToolMessage(outcome: ToolOutcome, toolCallId: string): ToolMessage;
//   ok           → content: summary                       status: 'success'
//   user_error   → content: message (+ ' ' + hint if any) status: 'success'  (the model relays it; not an error for the budget)
//   llm_error    → content: `${LLM_ERROR_PREFIX} ${message}` (+ hint)  status: 'error'
//   system_error → content: `${SYSTEM_ERROR_PREFIX} ${message}`        status: 'error'
export function outcomeKindOf(message: ToolMessage): 'ok' | ToolErrorKind;   // by prefix/status — used by the executor's budget and by run records

// infra/ai/messages/catalog.ts
export type MessageKey = 'tool_error_budget_exhausted' | 'tool_system_error';   // grows in refactor-p3-run-context-commit
export type Lang = 'en' | 'ru';
export function langOf(languageCode: string | null | undefined): Lang;   // 'ru' → 'ru', everything else 'en'
export function t(key: MessageKey, lang: Lang): string;                   // en fallback when a key is missing in ru (test asserts none is)
```

`TransitionRequest` is imported from `@domain/conversation/graph/conversation.state` for now (it moves to `domain/conversation/transitions.ts` in `refactor-p3-run-context-commit`); `tool-outcome.ts` must import it as a **type only**, so the domain file stays free of runtime LangGraph.

- [x] **Step 1: Failing tests first** — `outcome.unit.test.ts`: the four renderings above with exact strings; `outcomeKindOf` round-trips each. `catalog.unit.test.ts`: every `MessageKey` present in both languages; `t('tool_error_budget_exhausted','ru')` equals today's literal from `training.subgraph.ts` character for character (`'Не удалось записать данные после нескольких попыток. Попробуй переформулировать: укажи упражнение, вес и количество повторений чётко.'`) and `t('tool_system_error','ru')` equals `'Произошла техническая ошибка при сохранении данных тренировки. Пожалуйста, попробуй снова или обратись в поддержку.'`; `langOf('ru')`, `langOf('en')`, `langOf(null)`.
- [x] **Step 2: Implement.** English texts for the two keys are translations (D-F) — put them in `en.ts` with a `// translation of the ru original (2026-09)` comment so the PR reviewer finds them.
- [x] **Step 3: Rails.** Add `src/infra/ai/messages/**` and `src/infra/ai/tools/**` to the ESLint `no-restricted-syntax` override globs that police inline `SystemMessage`/`AIMessage` prompt literals (see the P2 entry in `eslint.config.js`) and to the grep list in `no-inline-prompts.unit.test.ts`. Bite proof: add a temporary `new SystemMessage('x')` under `src/infra/ai/messages/`, run `npm run lint`, paste the error line here, remove it.
- [x] **Step 4: `tool-results.ts`** imports the prefixes from `@infra/ai/tools/outcome`; the `graph/tools/training.tools.ts` exports become re-exports of the same constants until Task 5 deletes them (so the P2 fixtures keep compiling).
- [x] **Step 5: Commit** — `feat(ai): ToolOutcome with v1 serialisation and the message catalog (ADR-0013 §6)`

**Verification:** `npx jest --ci src/infra/ai/tools src/infra/ai/messages evals/snapshots` green (the 15 message-assembly snapshots are untouched: the training post-tool fixture still renders the same `LLM_ERROR:` text); `npm run lint` green; bite proof pasted. AC-1332 (catalog message half).

---

### Task 4: The shared tool executor

**Files:**

- Create: `apps/server/src/infra/ai/graph/tool-executor.ts`
- Create: `apps/server/src/infra/ai/graph/tool-policy.ts` (pure helpers: ordering, batch dedup, search key)
- Create: `apps/server/src/infra/ai/graph/__tests__/tool-executor.unit.test.ts`, `__tests__/tool-policy.unit.test.ts`
- Move (verbatim logic): `sortToolCallsByPriority`, `findDuplicateLogSets` from `training.subgraph.ts`; `buildSearchKey` from `dedup-tool-node.ts` → `tool-policy.ts`; their existing tests move with them (`training.subgraph.unit.test.ts` ordering/dedup blocks → `tool-policy.unit.test.ts`, kept as-is: ADR-0011 tests "pass unchanged").

**Interfaces:**

```typescript
// tool-policy.ts
export interface ToolPolicy {
  /** Execution priority (lower first); unknown tools last. Secondary key: `args.order` within `log_set`. */
  ordering?: Record<string, number>;
  /** Tools whose identical-args calls in one batch are all rejected with the batch-duplicate LLM_ERROR (today: log_set). */
  batchDedup?: readonly string[];
  /** Tools whose identical calls in one batch run once; later ones reuse the first result (today: search_exercises). */
  perTurnDedup?: readonly string[];
  /** Max `llm_error` tool results per run before the executor ends the run with the catalog message. Infinity = today's unbounded loop. */
  llmErrorBudget: number;
  /** Names the model may call now, given what the agent node loaded; null = all. Called by the agent node (D-H). */
  availability?: (input: AvailabilityInput) => readonly string[] | null;
}
export const NO_POLICY: ToolPolicy = { llmErrorBudget: Infinity };

// tool-executor.ts
export interface ToolExecutorState {
  messages: BaseMessage[];
  userId: string;
  activeSessionId?: string | null;
  user?: { languageCode?: string | null } | null;
}
export function buildToolExecutor(
  tools: StructuredToolInterface[],
  policy: ToolPolicy,
): (
  state: ToolExecutorState,
  config: RunnableConfig,
) => Promise<{
  messages: BaseMessage[];
  requestedTransition?: TransitionRequest;
  activeSessionId?: string;
}>;
/** Conditional edge after the executor: 'agent' normally, END when the executor appended a terminal AIMessage. */
export function afterTools(state: {
  messages: BaseMessage[];
}): "agent" | typeof END;
```

Executor algorithm (one node, all phases):

1. Take the last message's `tool_calls` (empty → `{ messages: [] }`).
2. `sortToolCallsByPriority(calls, policy.ordering)`.
3. Batch dedup: for names in `policy.batchDedup`, `findDuplicateLogSets`-style grouping (generalised by name; the training text for the rejection message moves verbatim into `tool-policy.ts` as `BATCH_DUPLICATE_MESSAGE(name)` — for `log_set` it must equal today's string exactly, the message-assembly training post-tool snapshot depends on nothing here but the tool unit tests do).
4. For each remaining call in order: unknown tool → `llmError('Unknown tool: <name>')`; per-turn dedup hit → reuse the cached `ToolMessage` content with the new `tool_call_id`; else `tool.invoke(args, toolConfig)` where `toolConfig = { ...config, configurable: { ...config.configurable, userId: state.userId, activeSessionId: state.activeSessionId ?? null, runId: config.metadata?.runId } }`; a thrown error → `llmError(err.message)` (D-C) with the `warn` log line training has today; the return value → `ToolReturn`; collect `update`s (last write wins per field).
5. Serialise each outcome with `toToolMessage`; `system_error` anywhere → after serialising the batch, append `new AIMessage(t('tool_system_error', langOf(state.user?.languageCode)))`, log `error`, and stop (no further calls in this batch are executed; earlier ones already ran — same as training today, which detects the prefix on the next agent step).
6. Budget: count `llm_error` messages in `state.messages` (previous batches) plus this batch; if `> policy.llmErrorBudget` → append `new AIMessage(t('tool_error_budget_exhausted', lang))`, log `warn` with the count (today's line).
7. Return `{ messages, ...updates }` — `requestedTransition` is the state key name until `refactor-p3-run-context-commit` renames it to `pendingTransition`; keep a single mapping line `pendingTransition → requestedTransition` in the executor so the rename is one edit.

`afterTools`: last message is an `AIMessage` → `END`; else `'agent'`.

- [x] **Step 1: Failing tests (AC-1332)** — with two fake tools (`tool()` from `@langchain/core/tools` over jest fns): ordering per policy and by `args.order`; batch dedup rejects the whole duplicate group and runs the rest; per-turn dedup runs `search_exercises` once for identical args and twice for different ones; `update` propagation (`pendingTransition`, `activeSessionId`) lands in the return value; `system_error` short-circuit appends the catalog AIMessage and skips the remaining calls; budget exhaustion with `llmErrorBudget: 1` on the second `llm_error` across two batches (seed the first in `state.messages`); `Infinity` never exhausts; `afterTools` routing; config passthrough (`configurable.userId/activeSessionId/runId` and `callbacks` reach the tool — assert on the `config` the fake tool receives). Language selection: `user.languageCode: 'ru'` → Russian text, `null` → English.
- [x] **Step 2: Implement; move the pure helpers and their tests** (`git mv` semantics for the test blocks: same `it` names).
- [x] **Step 3: Commit** — `feat(ai): shared tool executor with per-phase ToolPolicy (ADR-0013 §4.2, §6; AC-1332)`

**Verification:** `npx jest --ci src/infra/ai/graph/__tests__/tool-executor.unit.test.ts src/infra/ai/graph/__tests__/tool-policy.unit.test.ts` — every AC-1332 bullet is an `it` whose name starts with `AC-1332:`; `npm run type-check`.

---

### Task 5: Tools return `ToolReturn` and read their context from `config.configurable`

**Files:**

- Modify: `apps/server/src/infra/ai/graph/tools/{registration,chat,plan-creation,session-planning,training}.tools.ts`, `timezone.tool.ts`, `search-exercises.tool.ts` and their `__tests__`

Per tool (strings unchanged):

- Return values wrap today's strings: success → `ok(text)`; the `Error: could not identify user…`/`Failed to update profile…`/`Cannot complete registration — still missing…`/`No valid fields to save…`/`Invalid timezone…`/`No exercises found…`/`Error creating session…`/`Error searching exercises…` strings → `userError(text)` (model relays them; not budget-counted — today they were not counted either, except in training where none of them occur); `LLM_ERROR: …` strings → `llmError(rest)`; `SYSTEM_ERROR: …` → `systemError(rest)`. Assert in each test that `toToolMessage(result).content` equals the old expected string — one helper in `evals/fixtures` or the test file: `renderedContent(ret) = toToolMessage(isToolReturnWithUpdate(ret) ? ret.outcome : ret, 'id').content`.
- Transitions: `complete_registration`, `request_transition` (chat, plan_creation, session_planning), `save_workout_plan`, `finish_training` return `{ outcome, update: { pendingTransition: { toPhase, reason } } }` with today's `toPhase`/`reason` values; `start_training_session` adds `activeSessionId: session.id`.
- `activeSessionId` for the five training tools comes from `config.configurable.activeSessionId` (the executor sets it); the `currentSessionIds` dep and the `pendingTransitions` dep disappear from every `*ToolsDeps` interface.
- Delete the `LLM_ERROR_PREFIX`/`SYSTEM_ERROR_PREFIX` re-exports from `training.tools.ts`; update `evals/fixtures/assembly-scenarios.ts` to import from `@infra/ai/tools/outcome`.

- [x] **Step 1:** Update each tool test first (return-type assertions through `renderedContent`, `update` assertions for the transition tools, `configurable.activeSessionId` instead of the map), watch them fail, then change the tools.
- [x] **Step 2:** `npx jest --ci src/infra/ai/graph/tools` green; `npx jest --ci evals/snapshots` green (tool surface unchanged — the snapshot proves descriptions/schemas did not drift while editing).
- [x] **Step 3: Commit** — `refactor(ai): tools return ToolOutcome and state updates; session id via configurable (ADR-0013 §4.4)`

**Verification:** the two jest commands above; `grep -rn "pendingTransitions\|currentSessionIds" apps/server/src/infra/ai/graph/tools` → empty.

---

### Task 6: Wire the executor into the five subgraphs; delete the maps

**Files:**

- Modify: the five `apps/server/src/infra/ai/graph/subgraphs/*.subgraph.ts` and their `__tests__`
- Delete: `apps/server/src/infra/ai/graph/pending-ref-map.ts`, `dedup-tool-node.ts` and their tests

Per subgraph: `tools` node = `buildToolExecutor(tools, POLICY)` with

- registration, chat: `NO_POLICY`;
- plan_creation, session_planning: `{ perTurnDedup: ['search_exercises'], llmErrorBudget: Infinity }`;
- training: `{ ordering: TOOL_PRIORITY, batchDedup: ['log_set'], llmErrorBudget: 1, availability: ({ session }) => currentSetsCount === 0 ? tools minus delete_last_sets/update_last_set : null }` — the `TOOL_PRIORITY` map moves into `tool-policy.ts` as `TRAINING_TOOL_PRIORITY`.
- Edges: `agent → (tools | extract)` via `toolsCondition` as today; `tools → afterTools → (agent | extract)` (the terminal AIMessage goes straight to `extract`, which reads it as the reply — exactly what training does today when its agent node returns the budget message).
- `extractNode` returns `{ responseMessage, user }` only; `requestedTransition`/`activeSessionId` now arrive through the subgraph state from the executor and flow to the parent by shared keys (verify with the existing graph test that a `request_transition` call still records `transition` on the run row — `conversation.graph.unit.test.ts`).
- Training `agentNode`: delete the system-error and error-budget blocks (executor owns them), `currentSessionIds.set`, and the `PendingRefMap` construction; keep the `activeSessionId`/`session` guards and the `try/catch` (they move in `refactor-p3-phase-spec`); `availableTools` comes from `policy.availability`.

- [x] **Step 1:** Adjust the subgraph tests to the executor (mock the model with tool calls where a test covers the loop) — the assertions on transitions/session ids read subgraph output state instead of map side effects.
- [x] **Step 2:** Delete the two files and their tests; fix imports.
- [x] **Step 3:** `npx jest --ci` full unit run green; `npx jest --ci evals/snapshots` → the 15 message-assembly snapshots and 5 tool-surface snapshots green **unchanged** (`git status` shows no `.snap` modification).
- [x] **Step 4: AC-1331 grep** — `grep -rn "PendingRefMap\|pendingTransitions\|currentSessionIds" apps/server/src` → empty; paste the (empty) output. Module-level state audit: `grep -rn "^const .* = new Map\|^let " apps/server/src/infra/ai/graph` → only compiled-graph caches, if any; paste.
- [x] **Step 5: Commit** — `refactor(ai): five subgraphs run tools through the shared executor; PendingRefMap and dedup node deleted (AC-1331)`

**Verification:** the greps; `npm run check-all && npm run test:unit`; `npm run evals -- --level L0` green.

---

### Task 7: One file per tool under `infra/ai/tools/`

**Files:**

- Move: `graph/tools/registration.tools.ts` → `tools/save-profile-fields.tool.ts`, `tools/complete-registration.tool.ts`; `chat.tools.ts` → `tools/update-profile.tool.ts`, `tools/request-transition.tool.ts` (one builder parameterised by the allowed targets and the reply text — the three phases' `request_transition` differ only in `toPhase` enum, description and return string; keep all three literal variants selectable so the tool-surface snapshot stays byte-identical); `plan-creation.tools.ts` → `tools/save-workout-plan.tool.ts`; `session-planning.tools.ts` → `tools/start-training-session.tool.ts`; `training.tools.ts` → `tools/log-set.tool.ts`, `complete-current-exercise.tool.ts`, `finish-training.tool.ts`, `delete-last-sets.tool.ts`, `update-last-set.tool.ts` (+ `tools/format-exercise-summary.ts` for the shared helper); `graph/tools/timezone.tool.ts`, `search-exercises.tool.ts` → `tools/`.
- Create: `apps/server/src/infra/ai/tools/index.ts` exporting `buildSharedTools(deps)` (= `[save_timezone]`, the owner's "shared tools in every phase") and the per-tool builders.
- Tests move alongside (`tools/__tests__/<tool>.unit.test.ts`), bodies unchanged.
- Delete: `apps/server/src/infra/ai/graph/tools/`.

- [x] **Step 1:** Mechanical move; subgraphs import from `@infra/ai/tools`.
- [x] **Step 2:** `npx jest --ci evals/snapshots` — tool-surface snapshots **unchanged** (this is the point of the snapshot: a description drifting during the split fails here).
- [x] **Step 3: Commit** — `refactor(ai): one file per tool under infra/ai/tools (ADR-0013 §11)`

**Verification:** `ls apps/server/src/infra/ai/graph/tools` → no such directory; `npm run check-all && npm run test:unit`; snapshots unchanged.

---

### Task 8: L1 compare, dev deploy, docs reconcile, close-out (orchestrator)

> **Owner decision 2026-09-17 (quota):** no further full L1 runs in P3 beyond the one
> already-running tool-executor compare — the weekly Z.AI quota cannot absorb three
> ~171-call compares. AC-1334 for this phase is satisfied by the byte-identity
> snapshots + unit tests + the phase-end dev smoke; an optional scoped mini-L1
> (transition datasets only, 1 sample, ~18 calls) may be run at the phase close-out
> if the owner asks.

> **Steps 2, 4 deferred to the P3 phase close-out (owner decision 2026-09-17):**
> the three P3 plans run as one phase; dev deploy, smoke, close-out-review,
> `Status: done` and the PR merge happen once, at the end of P3 — not per plan.
> Step 1 (L1 compare) and Step 3 (docs reconcile) are done in this branch.

- [x] **Step 1: AC-1334** — run 2026-09-17, model glm-5.3, 365/370 checks. Per-dataset vs `v1`:
      registration 96.8% (−3.2 pp), chat 100% (=), plan_creation 98.4% (=), session_planning 98.8% (=),
      training 98.8% (=). Transitions ≥ baseline everywhere (TRT-0003 log_set 0/3 → 1/3, still below the
      2/3 threshold on both sides — not a regression; PC-0007/SP-0005 fail in the baseline too). The
      registration −3.2 pp is two 1/3-sample text-check flips (RG-0003 mustNotMatch точн|уточни, RG-0005
      maxChars) on a byte-identical model-input surface — sample noise, not code; **no re-run** (owner quota
      decision 2026-09-17). Evidence: `evidence/refactor-p3-tool-executor-l1-compare.json`. Original step text: — `RUN_LLM_EVALS=1 npm run evals -- --level L1 --phase all --samples 3 --baseline compare --baseline-version v1`; save the JSON to `docs/superpowers/plans/evidence/refactor-p3-tool-executor-l1-compare.json`; paste the per-dataset table. Pass: every dataset within ±2 pp; `chat/transitions`, `session_planning/transitions`, `training/transitions` ≥ baseline. Apparent regressions are re-run once (P2's sample-noise rule) before being treated as real.
- [x] **Step 2: Deploy to dev** — done at the phase close-out (dev @ `bbab7b07`, 2026-09-17):
      fresh-user smoke via `POST /api/bot/user` + `POST /api/bot/chat`; the
      `registration → plan_creation` transition is recorded in `conversation_runs.transition`
      (evidence table in `refactor-p3-run-context-commit.md` Task 6 Step 2). The
      session-planning/training items could not be reached (catalog data defect, pre-dating
      P3 — invalid exercise UUIDs rejected by the tool schema); originally: one chat message with a transition request, one session-planning approval (creates a session, `activeSessionId` propagates — verify `SELECT phase, active_session … ` via the checkpoint or the next run's behaviour), a `log_set` in training, `finish_training`. Confirm `conversation_runs.transition` rows for each transition. Paste the query output.
- [x] **Step 3: Docs reconcile** (factual bucket): `docs/ARCHITECTURE.md` file tree (`infra/ai/tools/`, `tool-executor.ts`, `tool-policy.ts`, `messages/`; `pending-ref-map`/`dedup-tool-node` gone); `docs/CONTRIBUTING_AI.md` ("tool result contract: `ToolOutcome` + `toToolMessage` v1; user-facing strings: `infra/ai/messages`"); `docs/BACKLOG.md` ticks: "Extend the inline-prompt rails to `infra/ai/messages`" (done), the P2 R1 advisory about `tool-results.ts` importing from `graph/` (closed), ADR-0011 tests note if any. ADR-0013 §4.4 wording ("return `Command({update})`") vs D-A → **escalate to the owner** with the amendment text; do not edit the ADR.
      **ADR-0013 §4.4 amendment (Command({update}) vs D-A ToolStateUpdate) escalated
      to the owner 2026-09-17; pending.** Implementation stays D-A until the owner
      rules otherwise.
- [x] **Step 4: Close-out** — the three P3 plans closed as one phase (owner decision
      2026-09-17): a single four-zone `close-out-review` over the whole phase diff
      (2026-09-18; one blocking finding on this plan's surface — none; record in
      `refactor-p3-run-context-commit.md` § Review). ADR-0013 §4.4 escalation resolved by the
      owner-approved amendment (2026-09-18) — the ADR now records the D-A `ToolStateUpdate`
      mechanism. `- Status: done` set 2026-09-18; STATE → P3 complete.

**Verification:** the pasted L1 table and dev query outputs; `node scripts/state.mjs --check` → OK. AC-1331, AC-1332, AC-1334 (this plan's slice).

## Follow-up (not part of this plan)

- `refactor-p3-phase-spec`: `PhaseSpec` carries `tools` and `toolPolicy`; the shared agent node calls `policy.availability`; the training guards and `try/catch` leave the last hand-written agent node.
- `refactor-p3-run-context-commit`: `requestedTransition` → `pendingTransition`; `userId`/`runId` from run context; the executor's `configurable` block reads `ctx` instead of `state.userId`; catalog grows (router replies, training guards).
- P5: D-D flips — `system_error` raises `ToolSystemError` once the bot maps `CORE_ERROR`.
- Owner tuning (not a plumbing change): `llmErrorBudget` for the four phases that are unbounded today.
