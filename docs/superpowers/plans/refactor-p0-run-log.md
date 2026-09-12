# Refactor P0 — Run Log Implementation Plan

- Status: planned
- Branch: plan/refactor-p0-run-log
- After: refactor-p0-dead-code

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record one durable row per conversation run — phase, model, latency, tokens, tool calls, outcome — so later refactor phases can be measured instead of guessed at.

**Architecture:** A new `conversation_runs` table plus three columns on `conversation_turns`, shipped as one Drizzle migration. The route generates a `runId`, starts the run's latency clock, and passes the id through `configurable`; the graph carries it in a new state channel; `persist.node.ts` writes the row (its temporary home — P3 moves this into a `commit` node). Token counts are collected by a small per-run accumulator that the existing `LLMLogHandler` feeds, keyed by `runId` — the handler already receives `configurable`, so no new plumbing reaches the model call sites. Because one `LLMLogHandler` instance serves the whole process, the bridge between the handler's start and end callbacks is keyed on LangChain's per-call run id rather than on any shared "most recent id" state (Task 3, Step 5). Failure to write a run row must never break a user response: the write is wrapped exactly like the existing turn persistence.

**Corrections applied before execution (2026-09-12), owner-approved:** three defects were found in this plan while reviewing it against the code and ADR-0013, and fixed here rather than carried into the branch or parked as debt.
1. The metrics bridge used a module-level `lastRunId`, which races across concurrent users and would have corrupted the very numbers P1–P7 are measured by (rationale in Task 3, Step 5; regression tests in Step 1).
2. `latencyMs` was measured from the first LLM call, not from the request — understating the end-to-end latency that P5.2 calibrates `requestTimeout` against and that AC-1351's windows rely on (Task 3, Step 5a).
3. `toolCalls` omitted `argsHash`, diverging from the ADR-0013 section 8 shape `[{name, argsHash, outcomeKind}]`; P0 still writes `null`, but the type now matches the ADR so P3 need not change the contract.

**Tech Stack:** Drizzle ORM + drizzle-kit (generate/migrate), PostgreSQL 16, LangGraph (`StateGraph`, `Annotation`, `MemorySaver` in tests), LangChain callbacks (`BaseCallbackHandler`), Fastify, Jest + ts-jest, pino.

**Spec:** `docs/LLM_CORE_REFACTOR_PLAN.md` § "P0 — Safety net and measurement", scope items 1–3. Schema: `docs/adr/0013-llm-core-target-architecture.md` §8. Logging rules: `docs/LOGGING_GUIDE.md`.

**Acceptance criteria:** AC-1301 (one run row per `POST /api/bot/chat`, verified by integration test with a `MemorySaver` graph and mocked model), and the run-log half of AC-1304 (verified in Task 7).

## Global Constraints

- **Schema changes go through migrations only** (HB-01). Generate with `npm run drizzle:generate`, apply locally with `npm run db:local:migrate`. **Never `drizzle-kit push`** — it offers to drop the `checkpoints*` tables.
- **`checkpoints`, `checkpoint_blobs`, `checkpoint_writes`, `checkpoint_migrations` are LangGraph runtime storage** — absent from `schema.ts`, never added to a migration.
- **Do not backfill `run_id`** on existing `conversation_turns` rows (master plan P0 Notes). `kind` *is* backfilled, from `role`.
- **Never log user message text or LLM response text at `info`** — `docs/LOGGING_GUIDE.md` § Forbidden data categories lists "User LLM messages" and "LLM responses". The replay payload stays at `debug`, exactly as BUG-003 left it.
- **No prompt wording changes and no state-machine changes.** P0 item 2 is instrumentation only.
- **`promptVersions` is a placeholder in P0**: write `{ 'phase.<name>': 'v0', 'directives': 'v0' }`. P2 makes it real.
- Verification commands run from `apps/server/` unless stated otherwise.
- Commit messages carry no attribution lines.

---

### Task 1: Add the schema and its migration

The table and columns come first: everything downstream writes to them.

**Files:**
- Modify: `apps/server/src/infra/db/schema.ts` (add `conversationRunOutcomeEnum`, `conversationRuns`; add three columns + index to `conversationTurns` at `:75-96`)
- Create: `apps/server/drizzle/0002_conversation_runs.sql` (generated, then hand-extended with the `kind` backfill)
- Modify: `apps/server/drizzle/meta/*` (generated — commit as-is)

**Interfaces:**
- Consumes: nothing.
- Produces: `conversationRuns` with columns `id, runId, userId, phaseIn, phaseOut, trigger, client, model, promptVersions, tokensIn, tokensOut, latencyMs, toolCalls, transition, outcome, budgetReport, createdAt`; and `conversationTurns.runId / .kind / .payload`. Tasks 4 and 5 insert into these; Task 6 reads them.

- [x] **Step 1: Write the failing schema test**

Create `apps/server/src/infra/db/__tests__/conversation-runs.schema.unit.test.ts`:

```typescript
import { conversationRuns, conversationTurns } from '@infra/db/schema';

describe('conversation_runs schema (ADR-0013 §8)', () => {
  it('exposes every column the run log needs', () => {
    const columns = Object.keys(conversationRuns);
    expect(columns).toEqual(
      expect.arrayContaining([
        'id',
        'runId',
        'userId',
        'phaseIn',
        'phaseOut',
        'trigger',
        'client',
        'model',
        'promptVersions',
        'tokensIn',
        'tokensOut',
        'latencyMs',
        'toolCalls',
        'transition',
        'outcome',
        'budgetReport',
        'createdAt',
      ]),
    );
  });

  it('requires the fields AC-1301 asserts are non-null', () => {
    expect(conversationRuns.runId.notNull).toBe(true);
    expect(conversationRuns.phaseIn.notNull).toBe(true);
    expect(conversationRuns.model.notNull).toBe(true);
    expect(conversationRuns.latencyMs.notNull).toBe(true);
    expect(conversationRuns.outcome.notNull).toBe(true);
  });

  it('adds run_id, kind and payload to conversation_turns', () => {
    const columns = Object.keys(conversationTurns);
    expect(columns).toEqual(expect.arrayContaining(['runId', 'kind', 'payload']));
    expect(conversationTurns.kind.notNull).toBe(true);
  });
});
```

- [x] **Step 2: Run it to confirm it fails**

Run: `npm run test:unit -- conversation-runs.schema`
Expected: FAIL — `conversationRuns` is not exported from `@infra/db/schema`.

- [x] **Step 3: Add the enums, table and columns to `schema.ts`**

In `apps/server/src/infra/db/schema.ts`, next to the existing conversation enums (around `:24-31`), add:

```typescript
export const conversationTurnKindEnum = pgEnum('conversation_turn_kind', [
  'human',
  'ai',
  'tool_call',
  'tool_result',
  'system_note',
  'summary',
]);
export const conversationRunOutcomeEnum = pgEnum('conversation_run_outcome', [
  'ok',
  'llm_unavailable',
  'core_error',
  'budget_exhausted',
]);
```

Extend the `conversationTurns` column block (after `content`, before `createdAt`) with:

```typescript
    runId: uuid('run_id'),
    kind: conversationTurnKindEnum('kind').notNull().default('human'),
    payload: jsonb('payload'),
```

Add the new table immediately after `conversationTurns`:

```typescript
export const conversationRuns = pgTable(
  'conversation_runs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    runId: uuid('run_id').notNull().unique(),
    userId: uuid('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    phaseIn: conversationPhaseEnum('phase_in').notNull(),
    phaseOut: conversationPhaseEnum('phase_out'),
    trigger: text('trigger').notNull().default('user_message'),
    client: text('client').notNull().default('telegram'),
    model: text('model').notNull(),
    promptVersions: jsonb('prompt_versions'),
    tokensIn: integer('tokens_in'),
    tokensOut: integer('tokens_out'),
    latencyMs: integer('latency_ms').notNull(),
    toolCalls: jsonb('tool_calls'),
    transition: jsonb('transition'),
    outcome: conversationRunOutcomeEnum('outcome').notNull(),
    budgetReport: jsonb('budget_report'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  table => {
    return {
      userCreatedIdx: index('idx_conversation_runs_user_created').on(table.userId, table.createdAt),
    };
  },
);
```

- [x] **Step 4: Run the test to confirm it passes**

Run: `npm run test:unit -- conversation-runs.schema`
Expected: PASS, all three assertions.

- [x] **Step 5: Generate the migration**

Run: `npm run drizzle:generate`
Expected: a new `drizzle/0002_*.sql` appears with `CREATE TYPE`, `CREATE TABLE conversation_runs`, and `ALTER TABLE conversation_turns ADD COLUMN` statements. Rename the file to `0002_conversation_runs.sql` only if drizzle-kit's generated name is unhelpful — if you rename, update `drizzle/meta/_journal.json` to match.

- [x] **Step 6: Hand-add the `kind` backfill to the migration**

Existing rows get `kind` from `role` (master plan P0 Notes). Append to the generated SQL file, after the `ADD COLUMN` statements:

```sql
--> statement-breakpoint
UPDATE "conversation_turns" SET "kind" = CASE
  WHEN "role" = 'user' THEN 'human'::"conversation_turn_kind"
  WHEN "role" = 'assistant' THEN 'ai'::"conversation_turn_kind"
  WHEN "role" = 'summary' THEN 'summary'::"conversation_turn_kind"
  ELSE 'system_note'::"conversation_turn_kind"
END;
```

- [x] **Step 7: Apply it locally and inspect the result**

```bash
npm run db:local:up
npm run db:local:migrate
docker exec fitcoach-db psql -U postgres -d fitcoach_dev -c '\d conversation_runs'
docker exec fitcoach-db psql -U postgres -d fitcoach_dev -c "SELECT role, kind, count(*) FROM conversation_turns GROUP BY 1,2;"
```

Expected: the table exists with all seventeen columns; every existing turn has a `kind` matching its `role` (no NULLs, no `human` rows whose role is `assistant`).

- [x] **Step 8: Commit**

```bash
git add src/infra/db/schema.ts src/infra/db/__tests__/conversation-runs.schema.unit.test.ts drizzle/
git commit -m "feat(db): add conversation_runs table and turn kind/run_id/payload columns"
```

---

### Task 2: Carry `runId` through the route and graph state

The run id is born in the route and must reach `persist.node.ts`. It travels two ways: in `configurable` (so the LLM callback handler sees it) and in graph state (so the persist node sees it).

**Files:**
- Modify: `apps/server/src/domain/conversation/graph/conversation.state.ts` (add a `runId` channel)
- Modify: `apps/server/src/app/routes/chat.routes.ts:80-83` (generate the id, pass it both ways)

**Interfaces:**
- Consumes: nothing.
- Produces: `ConversationStateType.runId: string` (empty string default), and `configurable.runId` on every graph invoke. Tasks 3 and 4 read both.

- [x] **Step 1: Write the failing state test**

Create `apps/server/src/domain/conversation/graph/__tests__/conversation.state.unit.test.ts` (or append to it if the file exists):

```typescript
import { ConversationState } from '@domain/conversation/graph/conversation.state';

describe('ConversationState runId channel', () => {
  it('defaults runId to an empty string', () => {
    const spec = ConversationState.spec as Record<string, { default?: () => unknown }>;
    expect(spec['runId']).toBeDefined();
    expect(spec['runId']?.default?.()).toBe('');
  });
});
```

- [x] **Step 2: Run it to confirm it fails**

Run: `npm run test:unit -- conversation.state`
Expected: FAIL — `spec['runId']` is undefined.

- [x] **Step 3: Add the channel**

In `apps/server/src/domain/conversation/graph/conversation.state.ts`, add inside `Annotation.Root({ … })`, after `userId`:

```typescript
  runId: Annotation<string>({
    reducer: (_, v) => v,
    default: () => '',
  }),
```

- [x] **Step 4: Run the test to confirm it passes**

Run: `npm run test:unit -- conversation.state`
Expected: PASS.

- [x] **Step 5: Generate and pass the id from the route**

In `apps/server/src/app/routes/chat.routes.ts`, add at the top of the file:

```typescript
import { randomUUID } from 'node:crypto';
```

In the `/chat` handler, replace the `invoke` call:

```typescript
        const runId = randomUUID();

        const result = await app.services.conversationGraph.invoke(
          { userId, userMessage: message, runId },
          { configurable: { thread_id: userId, userId, runId }, recursionLimit: 50 },
        );
```

The latency clock is started here too, by a `startRun(runId)` line added in Task 3 Step 5a — `run-metrics.ts` does not exist yet at this point in the sequence.

- [x] **Step 6: Check nothing broke**

Run: `npm run type-check && npm run test:unit`
Expected: exit 0. The existing chat route integration test uses a stub graph that ignores extra input fields, so it still passes.

- [x] **Step 7: Commit**

```bash
git add src/domain/conversation/graph/conversation.state.ts src/domain/conversation/graph/__tests__/conversation.state.unit.test.ts src/app/routes/chat.routes.ts
git commit -m "feat(graph): generate and thread runId from the chat route into graph state"
```

---

### Task 3: Collect per-run metrics from the LLM callback

Latency and token counts are only visible at the model boundary. `LLMLogHandler` already sits there and already reads `configurable`. Give it a sibling: a module-level accumulator keyed by `runId`, which the handler fills and the persist node drains.

**Files:**
- Create: `apps/server/src/infra/ai/run-metrics.ts`
- Create: `apps/server/src/infra/ai/__tests__/run-metrics.unit.test.ts`
- Modify: `apps/server/src/infra/ai/model.factory.ts:41-101` (`LLMLogHandler`: record start time, tokens, model; emit the new `info` line)

**Interfaces:**
- Consumes: `configurable.runId` from Task 2, and `startRun(runId)` called by the route (Task 2, Step 5) so `latencyMs` measures the whole run.
- Produces:

```typescript
export interface RunMetrics {
  model: string | null;
  tokensIn: number;
  tokensOut: number;
  latencyMs: number;
  llmCalls: number;
}
/** Opens the run and starts the latency clock. Called by the route, before the graph runs. */
export function startRun(runId: string): void;
export function startLlmCall(runId: string, model: string): void;
export function finishLlmCall(runId: string, tokensIn: number, tokensOut: number): void;
export function drainRunMetrics(runId: string): RunMetrics;
/** Maps LangChain's per-call run id to our conversation runId (see Step 5). */
export function bindCallToRun(llmRunId: string, runId: string): void;
export function resolveCallRun(llmRunId: string): string | undefined;
```

Task 4's persist node calls `drainRunMetrics`.

- [x] **Step 1: Write the failing accumulator test**

Create `apps/server/src/infra/ai/__tests__/run-metrics.unit.test.ts`:

```typescript
import {
  bindCallToRun,
  drainRunMetrics,
  finishLlmCall,
  resolveCallRun,
  startLlmCall,
  startRun,
} from '@infra/ai/run-metrics';

describe('run metrics accumulator', () => {
  it('sums tokens and counts calls across several LLM calls in one run', () => {
    startLlmCall('run-1', 'z-ai/glm-5.3');
    finishLlmCall('run-1', 100, 20);
    startLlmCall('run-1', 'z-ai/glm-5.3');
    finishLlmCall('run-1', 150, 30);

    const metrics = drainRunMetrics('run-1');
    expect(metrics.tokensIn).toBe(250);
    expect(metrics.tokensOut).toBe(50);
    expect(metrics.llmCalls).toBe(2);
    expect(metrics.model).toBe('z-ai/glm-5.3');
    expect(metrics.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('drains: a second drain of the same run returns an empty record', () => {
    startLlmCall('run-2', 'z-ai/glm-5.3');
    finishLlmCall('run-2', 10, 5);
    drainRunMetrics('run-2');

    const second = drainRunMetrics('run-2');
    expect(second.llmCalls).toBe(0);
    expect(second.tokensIn).toBe(0);
    expect(second.model).toBeNull();
  });

  it('keeps runs isolated from each other', () => {
    startLlmCall('run-a', 'model-a');
    finishLlmCall('run-a', 7, 3);
    startLlmCall('run-b', 'model-b');
    finishLlmCall('run-b', 11, 4);

    expect(drainRunMetrics('run-a').tokensIn).toBe(7);
    expect(drainRunMetrics('run-b').tokensIn).toBe(11);
  });

  it('ignores calls with no runId without throwing', () => {
    expect(() => startLlmCall('', 'model')).not.toThrow();
    expect(() => finishLlmCall('', 1, 1)).not.toThrow();
    expect(drainRunMetrics('').llmCalls).toBe(0);
  });

  it('measures latency from startRun, not from the first LLM call', async () => {
    startRun('run-timed');
    await new Promise(resolve => setTimeout(resolve, 30));
    startLlmCall('run-timed', 'model');
    finishLlmCall('run-timed', 1, 1);

    // The clock starts at startRun, so the 30 ms before any model call counts.
    expect(drainRunMetrics('run-timed').latencyMs).toBeGreaterThanOrEqual(25);
  });

  it('startRun opens a run that records no calls of its own', () => {
    startRun('run-empty');
    const metrics = drainRunMetrics('run-empty');
    expect(metrics.llmCalls).toBe(0);
    expect(metrics.model).toBeNull();
  });

  describe('call-to-run binding (no shared "last id" state)', () => {
    it('attributes interleaved concurrent calls to the right runs', () => {
      // The failure mode this replaces: start(A), start(B), end(A) must not
      // credit A's tokens to B. See Step 5 for why a module-level id breaks.
      startRun('run-A');
      startRun('run-B');
      startLlmCall('run-A', 'model');
      bindCallToRun('lc-call-1', 'run-A');
      startLlmCall('run-B', 'model');
      bindCallToRun('lc-call-2', 'run-B');

      finishLlmCall(resolveCallRun('lc-call-1') as string, 100, 10);
      finishLlmCall(resolveCallRun('lc-call-2') as string, 7, 3);

      expect(drainRunMetrics('run-A').tokensIn).toBe(100);
      expect(drainRunMetrics('run-B').tokensIn).toBe(7);
    });

    it('drops the binding on read and ignores unknown or empty call ids', () => {
      bindCallToRun('lc-call-3', 'run-C');
      expect(resolveCallRun('lc-call-3')).toBe('run-C');
      expect(resolveCallRun('lc-call-3')).toBeUndefined();
      expect(resolveCallRun('never-bound')).toBeUndefined();
      expect(() => bindCallToRun('', 'run-C')).not.toThrow();
    });
  });
});
```

- [x] **Step 2: Run it to confirm it fails**

Run: `npm run test:unit -- run-metrics`
Expected: FAIL — module `@infra/ai/run-metrics` not found.

- [x] **Step 3: Implement the accumulator**

Create `apps/server/src/infra/ai/run-metrics.ts`:

```typescript
/**
 * Per-run LLM metrics, accumulated at the model boundary and drained when the
 * run is persisted (P0, ADR-0013 §8). Temporary home: P3 moves this into the
 * `commit` node's run context.
 *
 * `latencyMs` is wall time from `startRun` (called by the route, before the graph
 * runs) to the drain, so it is the end-to-end run latency P5.2 calibrates
 * `requestTimeout` against — not just the time spent inside model calls.
 *
 * Two maps, both capped: `runs` is keyed by our conversation runId and normally
 * dropped by `drainRunMetrics`; `callRuns` bridges LangChain's per-call run id to
 * ours between `handleChatModelStart` and `handleLLMEnd` and is dropped on read.
 * A run or call that errors before that leaves an entry behind, hence the caps.
 */
const MAX_TRACKED_RUNS = 500;
const MAX_TRACKED_CALLS = 500;

export interface RunMetrics {
  model: string | null;
  tokensIn: number;
  tokensOut: number;
  latencyMs: number;
  llmCalls: number;
}

interface RunAccumulator {
  model: string | null;
  tokensIn: number;
  tokensOut: number;
  startedAt: number;
  llmCalls: number;
}

const runs = new Map<string, RunAccumulator>();
const callRuns = new Map<string, string>();

const EMPTY: RunMetrics = { model: null, tokensIn: 0, tokensOut: 0, latencyMs: 0, llmCalls: 0 };

function evictOldest(map: Map<string, unknown>, cap: number): void {
  if (map.size < cap) {
    return;
  }
  const oldest = map.keys().next();
  if (!oldest.done) {
    map.delete(oldest.value);
  }
}

function openRun(runId: string): RunAccumulator {
  const existing = runs.get(runId);
  if (existing) {
    return existing;
  }
  evictOldest(runs, MAX_TRACKED_RUNS);
  const acc: RunAccumulator = {
    model: null,
    tokensIn: 0,
    tokensOut: 0,
    startedAt: Date.now(),
    llmCalls: 0,
  };
  runs.set(runId, acc);
  return acc;
}

export function startRun(runId: string): void {
  if (!runId) {
    return;
  }
  openRun(runId);
}

export function startLlmCall(runId: string, model: string): void {
  if (!runId) {
    return;
  }
  const acc = openRun(runId);
  acc.llmCalls += 1;
  acc.model = model;
}

export function finishLlmCall(runId: string, tokensIn: number, tokensOut: number): void {
  const acc = runs.get(runId);
  if (!acc) {
    return;
  }
  acc.tokensIn += tokensIn;
  acc.tokensOut += tokensOut;
}

export function bindCallToRun(llmRunId: string, runId: string): void {
  if (!llmRunId || !runId) {
    return;
  }
  evictOldest(callRuns, MAX_TRACKED_CALLS);
  callRuns.set(llmRunId, runId);
}

export function resolveCallRun(llmRunId: string): string | undefined {
  const runId = callRuns.get(llmRunId);
  if (runId !== undefined) {
    callRuns.delete(llmRunId);
  }
  return runId;
}

export function drainRunMetrics(runId: string): RunMetrics {
  const acc = runs.get(runId);
  if (!acc) {
    return { ...EMPTY };
  }
  runs.delete(runId);
  return {
    model: acc.model,
    tokensIn: acc.tokensIn,
    tokensOut: acc.tokensOut,
    latencyMs: Date.now() - acc.startedAt,
    llmCalls: acc.llmCalls,
  };
}
```

- [x] **Step 4: Run the test to confirm it passes**

Run: `npm run test:unit -- run-metrics`
Expected: PASS, all eight cases — including the two binding cases, which are the regression guard for the concurrency defect described in Step 5.

- [x] **Step 5: Feed the accumulator from `LLMLogHandler`**

In `apps/server/src/infra/ai/model.factory.ts`, add the import:

```typescript
import { bindCallToRun, finishLlmCall, resolveCallRun, startLlmCall } from '@infra/ai/run-metrics';
```

Rename the discarded third parameter of `handleChatModelStart` from `_runId` to `llmRunId` so the call id is usable.

**Why not a `lastRunId` module variable** (the original form of this step, corrected 2026-09-12 before execution): `getModel()` caches the model in a module-level `_model` and constructs `new LLMLogHandler()` exactly once per process (`model.factory.ts:106-129`), so one handler instance serves every concurrent request. A module-level "id of the most recent start" is therefore shared process-wide, and with two users in flight — `start(A)`, `start(B)`, `end(A)` — the tokens of A's call are attributed to run B. This is not rare under load, and P5's per-`userId` mutex does **not** fix it: D-12 serialises one thread, while AC-1351 explicitly keeps different users concurrent. Since run rows are the measurement base for P1–P7, silently mixed token counts are worse than missing ones.

The fix keys the bridge on LangChain's own per-call run id, which both callbacks receive — `handleChatModelStart(llm, messages, runId, …)` and `handleLLMEnd(output, runId, …)` (verified in `@langchain/core/dist/callbacks/base.d.ts:67,72`). No state is shared between calls.

In `handleChatModelStart`, right after the existing `userId` extraction line, add:

```typescript
    const runId = (options?.['configurable'] as Record<string, unknown>)?.['runId'] as string | undefined;
    const invocationModel =
      ((extraParams?.['invocation_params'] as Record<string, unknown> | undefined)?.['model'] as string | undefined) ??
      config.LLM_MODEL;
    if (runId) {
      startLlmCall(runId, invocationModel);
      bindCallToRun(llmRunId, runId);
    }
```

`bindCallToRun` / `resolveCallRun` are two more exports of `run-metrics.ts` (implemented in Step 3) that map LangChain's per-call id to our conversation `runId` and drop the entry on read.

Replace `handleLLMEnd` with (note it now takes LangChain's `runId` as its second parameter):

```typescript
  handleLLMEnd(
    output: {
      generations: Array<Array<{ text: string }>>;
      llmOutput?: { tokenUsage?: { promptTokens?: number; completionTokens?: number } };
    },
    llmRunId: string,
  ): void {
    const text = output.generations?.[0]?.[0]?.text;
    const usage = output.llmOutput?.tokenUsage;
    const runId = resolveCallRun(llmRunId);
    if (runId) {
      finishLlmCall(runId, usage?.promptTokens ?? 0, usage?.completionTokens ?? 0);
    }
    log.debug(
      {
        responseLength: text?.length ?? 0,
        response: text ?? null,
      },
      'LLM response',
    );
  }
```

**Do not** move the response text to `info` — `LOGGING_GUIDE.md` forbids LLM response content above `debug`.

- [x] **Step 5a: Start the latency clock in the route**

`latencyMs` must cover the whole run, not just the model calls: P5.2 calibrates Fastify's
`requestTimeout` against the observed p95 of `conversation_runs.latency_ms`, and AC-1351
compares `[created_at, created_at + latency]` windows. Measuring from the first LLM call
would understate both.

In `apps/server/src/app/routes/chat.routes.ts`, add the import:

```typescript
import { startRun } from '@infra/ai/run-metrics';
```

and call it immediately after the id is generated (Task 2, Step 5):

```typescript
        const runId = randomUUID();
        startRun(runId);
```

- [x] **Step 6: Check the wiring compiles and nothing regressed**

Run: `npm run type-check && npm run test:unit`
Expected: exit 0.

- [x] **Step 7: Commit**

```bash
git add src/infra/ai/run-metrics.ts src/infra/ai/__tests__/run-metrics.unit.test.ts src/infra/ai/model.factory.ts
git commit -m "feat(ai): accumulate per-run model, token and latency metrics at the LLM boundary"
```

---

### Task 4: Write the run row from the persist node

The persist node is the one place that already runs exactly once per graph invocation and already knows the phase. It gains a second write, wrapped so a failure cannot break the user's reply.

**Files:**
- Create: `apps/server/src/domain/conversation/ports/conversation-run.ports.ts`
- Modify: `apps/server/src/domain/conversation/ports/index.ts` (export the new port)
- Create: `apps/server/src/infra/conversation/drizzle-conversation-run.service.ts`
- Create: `apps/server/src/infra/conversation/__tests__/conversation-run.service.unit.test.ts`
- Modify: `apps/server/src/infra/ai/graph/nodes/persist.node.ts` (accept the run service, write the row)
- Modify: `apps/server/src/infra/ai/graph/conversation.graph.ts:29-39,60-63` (`ConversationGraphDeps` gains `runService`; pass it to `buildPersistNode`)
- Modify: `apps/server/src/main/register-infra-services.ts:89-92` (construct and inject it)

**Interfaces:**
- Consumes: `conversationRuns` (Task 1), `ConversationStateType.runId` (Task 2), `drainRunMetrics` (Task 3).
- Produces:

```typescript
export interface ConversationRunRecord {
  runId: string;
  userId: string;
  phaseIn: ConversationPhase;
  phaseOut: ConversationPhase | null;
  model: string;
  promptVersions: Record<string, string>;
  tokensIn: number | null;
  tokensOut: number | null;
  latencyMs: number;
  toolCalls: Array<{ name: string; argsHash: string; outcomeKind: string }> | null;
  transition: { toPhase: string; reason?: string } | null;
  outcome: 'ok' | 'llm_unavailable' | 'core_error' | 'budget_exhausted';
}
export const CONVERSATION_RUN_SERVICE_TOKEN: symbol;
export interface IConversationRunService {
  recordRun(record: ConversationRunRecord): Promise<void>;
}
```

Task 5's integration test asserts against a row written through this port; Task 6's export script reads the same table.

- [x] **Step 1: Write the failing persist-node test**

Create `apps/server/src/infra/ai/graph/nodes/__tests__/persist.node.unit.test.ts`:

```typescript
import { buildPersistNode } from '@infra/ai/graph/nodes/persist.node';
import type { ConversationStateType } from '@domain/conversation/graph/conversation.state';

const baseState = (overrides: Partial<ConversationStateType> = {}): ConversationStateType =>
  ({
    userId: 'user-1',
    runId: 'run-1',
    phase: 'chat',
    userMessage: 'hello',
    responseMessage: 'hi there',
    user: null,
    activeSessionId: null,
    requestedTransition: null,
    ...overrides,
  }) as ConversationStateType;

describe('persist node run logging', () => {
  const contextService = { appendTurn: jest.fn().mockResolvedValue(undefined) } as never;

  beforeEach(() => jest.clearAllMocks());

  it('records exactly one run row per invocation', async () => {
    const runService = { recordRun: jest.fn().mockResolvedValue(undefined) };
    const node = buildPersistNode(contextService, runService);

    await node(baseState());

    expect(runService.recordRun).toHaveBeenCalledTimes(1);
    const record = runService.recordRun.mock.calls[0][0];
    expect(record.runId).toBe('run-1');
    expect(record.userId).toBe('user-1');
    expect(record.phaseIn).toBe('chat');
    expect(record.outcome).toBe('ok');
    expect(record.latencyMs).toBeGreaterThanOrEqual(0);
    expect(record.promptVersions).toEqual({ 'phase.chat': 'v0', directives: 'v0' });
  });

  it('records the requested transition as phase_out', async () => {
    const runService = { recordRun: jest.fn().mockResolvedValue(undefined) };
    const node = buildPersistNode(contextService, runService);

    await node(baseState({ requestedTransition: { toPhase: 'session_planning' } }));

    const record = runService.recordRun.mock.calls[0][0];
    expect(record.phaseOut).toBe('session_planning');
    expect(record.transition).toEqual({ toPhase: 'session_planning' });
  });

  it('still returns normally when the run write throws', async () => {
    const runService = { recordRun: jest.fn().mockRejectedValue(new Error('db down')) };
    const node = buildPersistNode(contextService, runService);

    await expect(node(baseState())).resolves.toEqual({});
    expect(contextService.appendTurn).toHaveBeenCalled();
  });

  it('writes no run row when there is no response to persist', async () => {
    const runService = { recordRun: jest.fn().mockResolvedValue(undefined) };
    const node = buildPersistNode(contextService, runService);

    await node(baseState({ responseMessage: '' }));

    expect(runService.recordRun).not.toHaveBeenCalled();
  });
});
```

- [x] **Step 2: Run it to confirm it fails**

Run: `npm run test:unit -- persist.node`
Expected: FAIL — `buildPersistNode` takes one argument and never calls `recordRun`.

- [x] **Step 3: Define the port**

Create `apps/server/src/domain/conversation/ports/conversation-run.ports.ts`:

```typescript
import type { ConversationPhase } from './conversation-context.ports';

export type ConversationRunOutcome = 'ok' | 'llm_unavailable' | 'core_error' | 'budget_exhausted';

/** One recorded conversation run — ADR-0013 §8. */
export interface ConversationRunRecord {
  runId: string;
  userId: string;
  phaseIn: ConversationPhase;
  phaseOut: ConversationPhase | null;
  model: string;
  promptVersions: Record<string, string>;
  tokensIn: number | null;
  tokensOut: number | null;
  latencyMs: number;
  toolCalls: Array<{ name: string; argsHash: string; outcomeKind: string }> | null;
  transition: { toPhase: string; reason?: string } | null;
  outcome: ConversationRunOutcome;
}

export const CONVERSATION_RUN_SERVICE_TOKEN = Symbol('ConversationRunService');

export interface IConversationRunService {
  recordRun(record: ConversationRunRecord): Promise<void>;
}
```

Add to `apps/server/src/domain/conversation/ports/index.ts`:

```typescript
export * from './conversation-run.ports';
```

- [x] **Step 4: Implement the persist node change**

Replace the body of `apps/server/src/infra/ai/graph/nodes/persist.node.ts`:

```typescript
import { ConversationStateType } from '@domain/conversation/graph/conversation.state';
import { IConversationContextService, IConversationRunService } from '@domain/conversation/ports';

import { drainRunMetrics } from '@infra/ai/run-metrics';
import { createLogger } from '@shared/logger';

const log = createLogger('persist-node');

export function buildPersistNode(contextService: IConversationContextService, runService: IConversationRunService) {
  return async function persistNode(state: ConversationStateType): Promise<Partial<ConversationStateType>> {
    const { userId, phase, userMessage, responseMessage, runId, requestedTransition } = state;

    if (!userMessage || !responseMessage) {
      return {};
    }

    try {
      await contextService.appendTurn(userId, phase, userMessage, responseMessage);
    } catch (err) {
      // Analytics failure must not break user response
      log.warn({ err, userId, phase }, 'Failed to persist conversation turn — continuing');
    }

    const metrics = drainRunMetrics(runId);
    try {
      await runService.recordRun({
        runId,
        userId,
        phaseIn: phase,
        phaseOut: requestedTransition?.toPhase ?? null,
        model: metrics.model ?? 'unknown',
        promptVersions: { [`phase.${phase}`]: 'v0', directives: 'v0' },
        tokensIn: metrics.tokensIn,
        tokensOut: metrics.tokensOut,
        latencyMs: metrics.latencyMs,
        toolCalls: null,
        transition: requestedTransition ? { toPhase: requestedTransition.toPhase } : null,
        outcome: 'ok',
      });
      log.info(
        {
          runId,
          phase,
          model: metrics.model,
          promptVersions: { [`phase.${phase}`]: 'v0', directives: 'v0' },
          tokensIn: metrics.tokensIn,
          tokensOut: metrics.tokensOut,
          latencyMs: metrics.latencyMs,
          llmCalls: metrics.llmCalls,
        },
        'Conversation run recorded',
      );
    } catch (err) {
      // Run logging is observability — never break the user response
      log.warn({ err, userId, phase, runId }, 'Failed to record conversation run — continuing');
    }

    return {};
  };
}
```

Note `toolCalls: null` — tool-call capture arrives with P3's shared tool executor; the column exists now so the shape is stable.

- [x] **Step 5: Run the test to confirm it passes**

Run: `npm run test:unit -- persist.node`
Expected: PASS, all four cases.

- [x] **Step 6: Write the failing repository test**

Create `apps/server/src/infra/conversation/__tests__/conversation-run.service.unit.test.ts`:

```typescript
import { DrizzleConversationRunService } from '@infra/conversation/drizzle-conversation-run.service';
import type { ConversationRunRecord } from '@domain/conversation/ports';

const values = jest.fn().mockResolvedValue(undefined);
const insert = jest.fn(() => ({ values }));

jest.mock('@infra/db/drizzle', () => ({ db: { insert: (...args: unknown[]) => insert(...args) } }));

const record: ConversationRunRecord = {
  runId: '11111111-1111-4111-8111-111111111111',
  userId: '22222222-2222-4222-8222-222222222222',
  phaseIn: 'chat',
  phaseOut: null,
  model: 'z-ai/glm-5.3',
  promptVersions: { 'phase.chat': 'v0', directives: 'v0' },
  tokensIn: 120,
  tokensOut: 40,
  latencyMs: 1500,
  toolCalls: null,
  transition: null,
  outcome: 'ok',
};

describe('DrizzleConversationRunService', () => {
  beforeEach(() => jest.clearAllMocks());

  it('inserts one row carrying every AC-1301 field', async () => {
    await new DrizzleConversationRunService().recordRun(record);

    expect(values).toHaveBeenCalledTimes(1);
    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: record.runId,
        userId: record.userId,
        phaseIn: 'chat',
        model: 'z-ai/glm-5.3',
        latencyMs: 1500,
        outcome: 'ok',
      }),
    );
  });
});
```

- [x] **Step 7: Run it to confirm it fails**

Run: `npm run test:unit -- conversation-run.service`
Expected: FAIL — module not found.

- [x] **Step 8: Implement the repository**

Create `apps/server/src/infra/conversation/drizzle-conversation-run.service.ts`:

```typescript
import type { ConversationRunRecord, IConversationRunService } from '@domain/conversation/ports';

export class DrizzleConversationRunService implements IConversationRunService {
  async recordRun(record: ConversationRunRecord): Promise<void> {
    const { db } = await import('@infra/db/drizzle');
    const { conversationRuns } = await import('@infra/db/schema');

    await db.insert(conversationRuns).values({
      runId: record.runId,
      userId: record.userId,
      phaseIn: record.phaseIn,
      phaseOut: record.phaseOut,
      trigger: 'user_message',
      client: 'telegram',
      model: record.model,
      promptVersions: record.promptVersions,
      tokensIn: record.tokensIn,
      tokensOut: record.tokensOut,
      latencyMs: record.latencyMs,
      toolCalls: record.toolCalls,
      transition: record.transition,
      outcome: record.outcome,
    });
  }
}
```

- [x] **Step 9: Run the test to confirm it passes**

Run: `npm run test:unit -- conversation-run.service`
Expected: PASS.

- [x] **Step 10: Wire the service through the graph deps and DI**

In `apps/server/src/infra/ai/graph/conversation.graph.ts`: add `IConversationRunService` to the `@domain/conversation/ports` import, add `runService: IConversationRunService;` to `ConversationGraphDeps`, destructure it in `buildGraph`, and change the persist-node construction to `buildPersistNode(contextService, runService)`.

In `apps/server/src/main/register-infra-services.ts`, before the graph registration around `:89`:

```typescript
  const { CONVERSATION_RUN_SERVICE_TOKEN } = await import('@domain/conversation/ports');
  const { DrizzleConversationRunService } = await import('@infra/conversation/drizzle-conversation-run.service');
  container.register(CONVERSATION_RUN_SERVICE_TOKEN, new DrizzleConversationRunService());
```

and add `runService: container.get(CONVERSATION_RUN_SERVICE_TOKEN)` to the object passed to `buildConversationGraph`.

- [x] **Step 11: Run every check**

Run: `npm run type-check && npm run lint && npm run test:unit`
Expected: exit 0 on all three.

- [x] **Step 12: Commit**

```bash
git add -A
git commit -m "feat(conversation): record one run row per conversation run"
```

---

### Task 5: Prove AC-1301 with a real graph and a mocked model

AC-1301 names its own verification: an integration test where the stub graph is replaced by a `MemorySaver` graph with a mocked model. This is the acceptance test, so it gets its own task.

**Files:**
- Modify: `apps/server/src/infra/ai/graph/conversation.graph.ts:38` (widen `checkpointer` from `PostgresSaver` to `BaseCheckpointSaver` so tests can pass `MemorySaver`)
- Create: `apps/server/tests/integration/api/chat-run-log.integration.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 1–4.
- Produces: the AC-1301 evidence.

- [x] **Step 1: Widen the checkpointer type**

In `apps/server/src/infra/ai/graph/conversation.graph.ts`, replace the `PostgresSaver` import with:

```typescript
import type { BaseCheckpointSaver } from '@langchain/langgraph';
```

and change the deps field to `checkpointer: BaseCheckpointSaver;`. `PostgresSaver` extends it, so production wiring is unaffected.

Run: `npm run type-check`
Expected: exit 0.

- [x] **Step 2: Write the failing integration test**

Create `apps/server/tests/integration/api/chat-run-log.integration.test.ts`:

```typescript
import { MemorySaver } from '@langchain/langgraph';

import { buildConversationGraph } from '../../../src/infra/ai/graph/conversation.graph';
import type { ConversationRunRecord } from '../../../src/domain/conversation/ports';

jest.mock('../../../src/infra/ai/model.factory', () => {
  const { AIMessage } = jest.requireActual('@langchain/core/messages');
  const invoke = jest.fn().mockResolvedValue(new AIMessage('Mocked coach reply'));
  return {
    getModel: () => ({ invoke, bindTools: () => ({ invoke }) }),
  };
});

describe('conversation run log — AC-1301', () => {
  const recorded: ConversationRunRecord[] = [];

  const runService = {
    recordRun: async (record: ConversationRunRecord) => {
      recorded.push(record);
    },
  };

  const contextService = {
    appendTurn: async () => undefined,
    getMessagesForPrompt: async () => [],
    insertContextReset: async () => undefined,
    insertPhaseSummary: async () => undefined,
    getLatestSummary: async () => null,
    getLastUserMessageTime: async () => null,
  };

  const userService = {
    getUserById: async () => ({
      id: '22222222-2222-4222-8222-222222222222',
      firstName: 'Test',
      languageCode: 'ru',
      timezone: 'Europe/Berlin',
      age: 30,
      gender: 'male',
      height: '180',
      weight: '80',
      fitnessLevel: 'intermediate',
      fitnessGoal: 'strength',
      registrationCompleted: true,
    }),
  };

  beforeEach(() => {
    recorded.length = 0;
  });

  it('writes exactly one run row with the AC-1301 non-null fields', async () => {
    const graph = buildConversationGraph({
      userService: userService as never,
      trainingService: {} as never,
      workoutPlanRepo: { getActivePlan: async () => null } as never,
      workoutSessionRepo: { getRecentSessions: async () => [], getActiveSession: async () => null } as never,
      exerciseRepository: {} as never,
      embeddingService: {} as never,
      contextService: contextService as never,
      runService: runService as never,
      checkpointer: new MemorySaver(),
    });

    const userId = '22222222-2222-4222-8222-222222222222';
    const runId = '11111111-1111-4111-8111-111111111111';

    await graph.invoke(
      { userId, userMessage: 'привет', runId },
      { configurable: { thread_id: userId, userId, runId }, recursionLimit: 50 },
    );

    expect(recorded).toHaveLength(1);
    const [row] = recorded;
    expect(row.runId).toBe(runId);
    expect(row.phaseIn).toBeTruthy();
    expect(row.model).toBeTruthy();
    expect(row.latencyMs).not.toBeNull();
    expect(row.outcome).toBe('ok');
  });
});
```

If the graph's router demands repository methods this stub does not provide, add the missing method to the relevant stub object returning an empty/null value — do **not** weaken the assertions.

- [x] **Step 3: Run it to confirm it fails for the right reason**

Run: `npm run test:integration -- chat-run-log`
Expected: FAIL. Confirm the failure is an assertion (`recorded` empty or a field null), not a module-resolution error. A resolution error means the mock path is wrong — fix that first.

- [x] **Step 4: Make it pass**

The production code from Tasks 1–4 should already satisfy this. If it does not, fix the production code (not the test) until the assertions hold. Re-run:

Run: `npm run test:integration -- chat-run-log`
Expected: PASS.

- [x] **Step 5: Run the whole suite**

Run: `npm run type-check && npm run lint && npm run test:unit && npm run test:integration`
Expected: exit 0 on all four.

- [x] **Step 6: Commit**

```bash
git add -A
git commit -m "test(graph): prove AC-1301 — one run row per chat request with a MemorySaver graph"
```

---

### Task 6: Deploy to dev and verify against the running system (AC-1304)

AC-1304 is a live check: a five-message registration flow produces five run rows with non-zero token counts. It cannot be faked in CI.

**Files:**
- Modify: this plan file (record the measured numbers under Step 4)

**Interfaces:**
- Consumes: the deployed result of Tasks 1–5.
- Produces: the AC-1304 evidence for close-out.

- [x] **Step 1: Push the branch and deploy to dev**

```bash
git push origin HEAD
```

Then (the deploy script does `git reset --hard origin/<branch>`, so the push must come first):

```bash
ssh filko.dev "cd /srv/docker/fitcoach && ./deploy/deploy.sh dev"
```

Expected: the migration step applies `0002_conversation_runs`, containers start, health check passes.

- [x] **Step 2: Confirm the migration landed**

```bash
ssh filko.dev "docker exec fitcoach-dev-db psql -U fitcoach_dev -d fitcoach_dev -c '\d conversation_runs'"
```

Expected: the table with all seventeen columns.

- [x] **Step 3: Run five messages through the dev bot**

In Telegram, send five messages to `@MyFitAiCoachDevBot` (a registration flow: greeting, then name/age/height/weight answers). Wait for a reply to each.

> **Deviation (owner-approved, 2026-09-12):** two messages instead of five. The
> owner declined to send five; two rows already demonstrate every property the AC
> guards — exactly one row per request, per-run drain isolation (the second row
> carries its own tokens, not the first run's), non-zero token counts, and a real
> model id. Both verification rounds below used two messages.

- [x] **Step 4: Count the rows and the tokens**

```bash
ssh filko.dev "docker exec fitcoach-dev-db psql -U fitcoach_dev -d fitcoach_dev -c \"SELECT run_id, phase_in, model, tokens_in, tokens_out, latency_ms, outcome FROM conversation_runs ORDER BY created_at DESC LIMIT 5;\""
```

Expected: five rows; every `tokens_in` and `tokens_out` greater than zero; `latency_ms` populated; `outcome = 'ok'`. Paste the output into the PR description — this is the AC-1304 evidence.

**Measured (dev, 2026-09-12):**

```
run_id                              | phase_in | model        | tokens_in | tokens_out | latency_ms | outcome | created_at
443aa652-623f-4166-9406-663739a1879b | chat     | z-ai/glm-5.3 |      5233 |        910 |      19873 | ok      | 13:55:39
a2d2c418-1037-4238-a440-039b5caf8e4e | chat     | z-ai/glm-5.3 |      5516 |       1102 |      24826 | ok      | 14:02:40
```

Two earlier rounds (6 rows at 09:42–09:46) recorded `model='unknown'`, tokens 0 —
two defects were found and fixed live during this task:

1. every model call site built a fresh config `{ configurable: { userId } }`,
   dropping the graph config (PR #4);
2. LangChain strips `configurable` from the options a callback handler receives
   (`runnables/base.js` `_separateRunnableConfigFromCallOptions` deletes it), so
   the handler never could read it — `runId`/`userId` now travel via config
   `metadata`, the channel LangChain inherits into nested runs (PR #5). The
   pre-existing `userId` debug logging had been silently broken the same way.

Those 6 zero-token rows are real pre-fix data left in the dev DB on purpose.

- [x] **Step 5: Check the rollback condition**

The master plan's rollback trigger for P0 item 2: run-row writes adding more than 100 ms p95 to `/api/bot/chat`, or any 5xx.

```bash
ssh filko.dev "docker logs fitcoach-dev-server --tail 200 | grep -i 'Conversation run recorded\|error\|5[0-9][0-9]'"
```

Expected: `Conversation run recorded` info lines carrying `runId`, `phase`, `promptVersions`, `tokensIn`, `tokensOut`, `latencyMs`; no 5xx; no `Failed to record conversation run`. Compare a few `latencyMs` values against the `responseTime` Fastify logs for the same requests — if the gap exceeds 100 ms consistently, stop and report before merging.

**Measured:** run-row overhead over the Fastify `responseTime` of the same
requests: ~23 ms (19896 vs 19873) and ~16 ms (24842 vs 24826) — far below the
100 ms p95 rollback trigger. Zero 5xx and zero `Failed to record` in the 4 h
window around the check. INFO lines present at both run timestamps.

- [x] **Step 6: Record the evidence and commit**

Add the row count and a representative token/latency pair to this plan under this task, then:

```bash
git add docs/superpowers/plans/refactor-p0-run-log.md
git commit -m "docs(plan): record AC-1304 dev verification for the run log"
```

---

## Close-out

Follow `superpowers:finishing-a-development-branch`. Before merge: run the `close-out-review` skill, tick every checkbox above, set `- Status: done`, run `node scripts/state.mjs --write` from the repo root, and commit. `node scripts/state.mjs --check` must pass.

## Review

**2026-09-12 — verdict: blocked** (R1, R2, R3, R4; no `- Review:` header line until a clean
re-run). Blocking findings, verbatim from the zones:

1. **OPEN** — `blocking | R2 | apps/server/src/app/routes/chat.routes.ts:90 | YAGNI
   (docs/CONTRIBUTING_AI.md "Principles & Boundaries") | configurable.runId has zero readers
   anywhere in the repo — the LLM callback channel is metadata (model.factory.ts:62-64,
   admitted by the adjacent comment at chat.routes.ts:91-92) and the persist node reads
   state.runId (persist.node.ts:22); it is a leftover of the plan's superseded Task-2 design
   ("the route... passes the id through configurable"), and four comments still credit it as
   the working metrics channel (chat.subgraph.ts:79-80, registration.subgraph.ts:72-73,
   invoke-with-retry.ts:61, phase-summary.node.ts:45), contradicting model.factory.ts:61-64
   and re-teaching the exact configurable bug that had to be fixed live on dev (plan Task 6,
   defect 2)`
2. **OPEN** — `blocking | R4 | docs/LLM_CORE_REFACTOR_PLAN.md:40 | SUPERPOWERS_INTEGRATION.md
   Rule 7 (docs reconcile) | P0 scope item 3 still says the "LLMLogHandler info line gains
   runId, phase, promptVersions, tokens, latencyMs", but the shipped code gives LLMLogHandler
   no info line at all (debug only, model.factory.ts:96-128) — the info line was implemented
   in persist.node.ts ("Conversation run recorded"). Also :39 claims tokens come "from
   response_metadata.tokenUsage"; the code reads llmOutput.tokenUsage (model.factory.ts:117)`
3. **OPEN** — `blocking | R4 | docs/domain/conversation.spec.md:40 | DOCUMENTATION_GUIDE
   ("Domain Spec … must reflect existing ports") | the Ports section lists only
   IConversationContextService; the diff adds IConversationRunService
   (CONVERSATION_RUN_SERVICE_TOKEN, recordRun) in conversation-run.ports.ts, unreflected`
4. **OPEN** — `blocking | R4 | docs/DB_SETUP.md:118 | DOCUMENTATION_GUIDE ("Every PR must
   include updated docs") | "Core Tables" still shows conversation_turns without
   run_id/kind/payload and contains no conversation_runs table, although migration
   0002_conversation_runs.sql shipped in this diff`
5. **OPEN** — `blocking | R4 | docs/ARCHITECTURE.md:74 | ARCHITECTURE.md rule 8 +
   DOCUMENTATION_GUIDE docs-first | the living doc layer misses the run-log structure: no
   run-metrics.ts, no conversation-run.ports.ts, no drizzle-conversation-run.service.ts in
   the file tree; persist.node described as "appendTurn" only (:74); the DB storage line
   (:259) lists the old conversation_turns column set and no conversation_runs`

Advisory findings (to be filed in `docs/BACKLOG.md` via the `backlog` skill, owner approval
pending): R1 ×4 (trigger/client hardcoded below the port; non-null `model` forcing the
`'unknown'` sentinel; model.factory.ts carrying four concerns; route owning the run-metrics
lifecycle), R2 ×2 (promptVersions literal duplicated in persist.node; hand-rolled
contextService stub vs InMemoryConversationContextService), R3 ×7 (AC-1301 wording vs
no-row-on-error paths and hardcoded outcome='ok'; post-drain background-summary orphan
accumulator; acceptance test satisfied by the 'unknown' fallback; missing AC/BR ids in test
names; untested kind backfill; AC-1304 5→2 deviation wording), R4 ×3 (ADR-0013 §8 emitter
wording + undocumented LangChain metadata constraint; LOGGING_GUIDE stale info-line
catalog; plan-vs-BACKLOG deploy-record contradiction).
