# Refactor P0 — L1 Runner and Chat/Training Datasets Implementation Plan

- Status: done
- Branch: plan/refactor-p0-eval-l1-chat-training
- After: refactor-p0-eval-harness

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the eval harness actually run the graph against a real model, and prove it on the two phases where documented bugs give us real material — chat and training.

**Architecture:** L1 builds the production conversation graph with `MemorySaver`, repositories stubbed from the case's `fixture`, and the real model behind `RUN_LLM_EVALS=1`. Tool calls are observed through a LangChain callback handler and their side effects land in in-memory stubs — the harness needs to know `log_set` was called, not to write a set. Each case runs `n` times (default 3) and passes if at least ⌈n/2⌉ samples pass, because a temperature-bearing model is not deterministic. This plan writes the four chat/training datasets whose expected behaviour is already documented in BUGS.md; the remaining three phases follow in `refactor-p0-eval-l1-remaining-phases`.

**Tech Stack:** LangGraph (`MemorySaver`, compiled graph), LangChain tool wrapping, tsx, Zod, OpenRouter (BYOK) via the existing `model.factory.ts`.

**Spec:** `docs/PROMPT_EVAL_FRAMEWORK.md` §3 (datasets), §4.2 (L1 checks, sampling). Master plan: `docs/LLM_CORE_REFACTOR_PLAN.md` § P0 scope item 5. Bug sources: `docs/BUGS.md` BUG-006, BUG-008, BUG-009, BUG-011.

**Acceptance criteria:** the L1 machinery half of AC-1303 (`RUN_LLM_EVALS=1 npm run evals -- --level L1 --phase chat` runs against dev keys). Baselines are written in the follow-up plan, once all five phases have datasets.

> **Pre-execution note (2026-09-13).** Four defects were found and fixed in this plan before dispatch, each verified against the code rather than assumed: stub method names (`getUser`, `findActiveByUserId` — not `getUserById`/`getActivePlan`); `trainingService` needs `getSessionDetails` or every training case throws before reaching the model; `import.meta.dirname` does not compile under ts-jest here; fixture `height`/`weight`/`age` are numbers, not strings. The tool-capture mechanism was also replaced: the parent graph has no `messages` channel, so reading tool calls from graph state yields nothing — a callback handler is used instead, and its exact shape is verified in Task 2 Step 4.

> **Post-execution corrections (2026-09-13).** Two deviations from the plan's verbatim code, both verified necessary during execution and confirmed at review:
> 1. **Transition source (Task 2 Step 4).** `run-case.ts` reads `transition` from `recordedRuns[0].transition.toPhase`, not from `result.requestedTransition` as the plan specified. Reason: `transition_guard` sets `requestedTransition: null` (alongside `phase: toPhase`) before END (`conversation.graph.ts`), so the final graph state can never carry it — the plan's own Step 6 expectation was unsatisfiable as written. The persist node records the requested transition into the run row before the guard acts. Semantics: the observed transition is the *request* (pre-guard), which is what L1 prompt assertions intend. Covered by a unit test (mocked model scripted to call `request_transition`, asserting `observation.transition === 'session_planning'`).
> 2. **`compilePattern` in `l1.ts` (Task 3).** The plan's `new RegExp(pattern)` throws `SyntaxError: Invalid group` on the PCRE-style `(?i)` prefixes that the plan's own test and datasets use (Node 22). `l1.ts` translates a leading `(?i)` into the RegExp `i` flag; tests and datasets stay verbatim.
>
> Additionally, Task 6 found the L1 runner unreachable without three harness fixes (evals script loads `.env`; `runCase` forwards `state.activeSessionId`; `build-stub-deps` materializes a full mid-workout session and training-service mutations) — without them every training case fell back to chat with 0 LLM calls. The recorded measurement depends on the fixed harness (`01df11e5`); the baseline plan must pin that commit for comparability.

## Global Constraints

- **L1 never runs without `RUN_LLM_EVALS=1`.** Without the flag the runner reports "skipped" and exits 0, so CI never spends tokens or fails on a model outage.
- **L1 never touches the database.** Repositories are in-memory stubs built from the case fixture; tool side effects are recorded, not performed.
- **Minimum ten cases per phase in P0** (master plan P0 item 5). `PROMPT_EVAL_FRAMEWORK.md` BR-EVAL-004's thirty per phase is the eventual target, reached as later phases add cases — P0 deliberately ships the smaller set that makes a baseline possible. Note this in the dataset README so the gap does not read as an unmet AC.
- **Every case is tagged with its source** — the BUGS.md id, or `MANUAL_TEST_PLAN` plus scenario number.
- **Fixtures contain no real user data** (BR-EVAL-003).
- **No prompt wording changes.** A case that fails against today's prompts is a *recorded baseline failure*, not a reason to edit a prompt — the whole point is to measure the starting point. Record such failures; do not fix them here.
- Verification commands run from `apps/server/`. LLM runs need `LLM_API_KEY` in `apps/server/.env`.
- Commit messages carry no attribution lines.

---

### Task 1: Build the fixture-driven repository stubs

Every L1 case needs a world: a user, maybe a plan, maybe an active session. One module turns a `fixture` into the dependency object `buildConversationGraph` expects.

**Files:**
- Create: `apps/server/evals/lib/build-stub-deps.ts`
- Create: `apps/server/evals/lib/__tests__/build-stub-deps.unit.test.ts`

**Interfaces:**
- Consumes: `EvalFixture` from `evals/schema/case.schema.ts`; `ConversationGraphDeps` from `@infra/ai/graph/conversation.graph`.
- Produces:

```typescript
export interface RecordedToolCall { name: string; args: Record<string, unknown>; outcomeKind: 'recorded' }
export interface StubWorld { deps: ConversationGraphDeps; recordedRuns: ConversationRunRecord[] }
export function buildStubDeps(fixture: EvalFixture): StubWorld;
```

Task 2's runner consumes `buildStubDeps`; Task 3's checks read `recordedRuns`.

- [x] **Step 1: Write the failing stub test**

Create `apps/server/evals/lib/__tests__/build-stub-deps.unit.test.ts`:

```typescript
import { buildStubDeps } from '../build-stub-deps';
import { COMPLETE_PROFILE, EMPTY_PROFILE } from '../../fixtures/personas';

describe('buildStubDeps', () => {
  it('returns a user matching the fixture', async () => {
    const { deps } = buildStubDeps(COMPLETE_PROFILE);
    const user = await deps.userService.getUser('any-id');
    expect(user?.fitnessGoal).toBe('strength');
    expect(user?.languageCode).toBe('ru');
  });

  it('reports an active plan only when the fixture says so', async () => {
    const withPlan = buildStubDeps(COMPLETE_PROFILE);
    const withoutPlan = buildStubDeps(EMPTY_PROFILE);
    expect(await withPlan.deps.workoutPlanRepo.findActiveByUserId('u')).not.toBeNull();
    expect(await withoutPlan.deps.workoutPlanRepo.findActiveByUserId('u')).toBeNull();
  });

  it('answers getSessionDetails so the training router does not throw', async () => {
    const { deps } = buildStubDeps(COMPLETE_PROFILE);
    await expect(deps.trainingService.getSessionDetails('s1')).resolves.toBeDefined();
  });

  it('collects run records instead of writing them', async () => {
    const world = buildStubDeps(COMPLETE_PROFILE);
    await world.deps.runService.recordRun({
      runId: 'r1',
      userId: 'u1',
      phaseIn: 'chat',
      phaseOut: null,
      model: 'm',
      promptVersions: {},
      tokensIn: 1,
      tokensOut: 1,
      latencyMs: 1,
      toolCalls: null,
      transition: null,
      outcome: 'ok',
    });
    expect(world.recordedRuns).toHaveLength(1);
  });

  it('persists no conversation turns', async () => {
    const { deps } = buildStubDeps(COMPLETE_PROFILE);
    await expect(deps.contextService.appendTurn('u', 'chat', 'a', 'b')).resolves.toBeUndefined();
    expect(await deps.contextService.getMessagesForPrompt('u', 'chat')).toEqual([]);
  });
});
```

- [x] **Step 2: Run it to confirm it fails**

Run: `npm run test:unit -- build-stub-deps`
Expected: FAIL — module not found.

- [x] **Step 3: Implement the stub builder**

Create `apps/server/evals/lib/build-stub-deps.ts`. Start from the stub objects in `tests/integration/api/chat-run-log.integration.test.ts` (written in `refactor-p0-run-log` Task 5) so the two agree on which repository methods the graph actually calls:

```typescript
import { MemorySaver } from '@langchain/langgraph';

import type { ConversationRunRecord } from '@domain/conversation/ports';
import type { ConversationGraphDeps } from '@infra/ai/graph/conversation.graph';

import type { EvalFixture } from '../schema/case.schema';

export interface StubWorld {
  deps: ConversationGraphDeps;
  recordedRuns: ConversationRunRecord[];
}

export function buildStubDeps(fixture: EvalFixture): StubWorld {
  const recordedRuns: ConversationRunRecord[] = [];
  const userId = '22222222-2222-4222-8222-222222222222';

  const user = { id: userId, ...fixture.user };
  const activePlan = fixture.hasActivePlan ? (fixture.plan ?? { id: 'plan-1', name: 'Test plan' }) : null;

  const deps = {
    // IUserService — the port's method is getUser(id), not getUserById.
    // Verified against src/domain/user/ports/service.ports.ts:5-11.
    userService: {
      upsertUser: async () => user,
      getUser: async () => user,
      updateProfileData: async () => user,
      isRegistrationComplete: () => fixture.user.registrationCompleted === true,
      needsRegistration: () => fixture.user.registrationCompleted !== true,
    },
    // ITrainingService — the router calls getSessionDetails on every training-phase run
    // (router.node.ts:47) and the training subgraph calls it again (training.subgraph.ts:326).
    // An empty object here throws before the model is ever reached.
    trainingService: {
      getSessionDetails: async () => (fixture.activeSession ?? null),
      getActiveSession: async () => (fixture.activeSession ?? null),
      getActivePlan: async () => activePlan,
      getTrainingHistory: async () => (fixture.sessions ?? []),
    },
    workoutPlanRepo: {
      // Real method name — chat.subgraph.ts:57, session-planning builder.
      findActiveByUserId: async () => activePlan,
    },
    workoutSessionRepo: {
      // Real names — chat.subgraph.ts:58, training.subgraph.ts:338.
      findRecentByUserIdWithDetails: async () => (fixture.sessions ?? []),
      findRecentByUserId: async () => (fixture.sessions ?? []),
      findLastCompletedByUserAndKey: async () => null,
    },
    exerciseRepository: {
      searchByEmbedding: async () => [],
      findByIds: async () => [],
    },
    embeddingService: {
      embed: async () => new Array(1536).fill(0),
    },
    contextService: {
      appendTurn: async () => undefined,
      getMessagesForPrompt: async () => [],
      insertContextReset: async () => undefined,
      insertPhaseSummary: async () => undefined,
      getLatestSummary: async () => null,
      getLastUserMessageTime: async () => null,
    },
    runService: {
      recordRun: async (record: ConversationRunRecord) => {
        recordedRuns.push(record);
      },
    },
    checkpointer: new MemorySaver(),
  } as unknown as ConversationGraphDeps;

  return { deps, recordedRuns };
}
```

If the graph calls a repository method this object lacks, the L1 run throws and Task 2's runner reports it as a `runs-without-throwing` failure — add the missing method there, returning an empty value, rather than loosening a check.

- [x] **Step 4: Run the test to confirm it passes**

Run: `npm run test:unit -- build-stub-deps`
Expected: PASS, all four cases.

- [x] **Step 5: Commit**

```bash
git add evals/lib/build-stub-deps.ts evals/lib/__tests__/build-stub-deps.unit.test.ts
git commit -m "feat(evals): build fixture-driven graph dependencies for L1"
```

---

### Task 2: Run one case through the real graph and capture what happened

The observation layer: invoke the graph, record every tool call and the final text, without asserting anything yet.

**Files:**
- Create: `apps/server/evals/lib/run-case.ts`
- Create: `apps/server/evals/lib/__tests__/run-case.unit.test.ts`

**Interfaces:**
- Consumes: `buildStubDeps` (Task 1), `EvalCase` (harness plan Task 2).
- Produces:

```typescript
export interface CaseObservation {
  text: string;
  toolCalls: Array<{ name: string; args: Record<string, unknown> }>;
  transition: string | null;
  outcome: string;
  threw: string | null;
}
export async function runCase(testCase: EvalCase): Promise<CaseObservation>;
```

Task 3's assertions consume `CaseObservation`.

- [x] **Step 1: Write the failing observation test**

The test runs against a mocked model so it stays offline. Create `apps/server/evals/lib/__tests__/run-case.unit.test.ts`:

```typescript
import { runCase } from '../run-case';
import type { EvalCase } from '../../schema/case.schema';

jest.mock('@infra/ai/model.factory', () => {
  const { AIMessage } = jest.requireActual('@langchain/core/messages');
  const invoke = jest.fn().mockResolvedValue(new AIMessage('Мок-ответ тренера'));
  return { getModel: () => ({ invoke, bindTools: () => ({ invoke }) }) };
});

const testCase: EvalCase = {
  id: 'CH-TEST',
  phase: 'chat',
  tags: [],
  deprecated: false,
  fixture: { user: { languageCode: 'ru', timezone: 'Europe/Berlin' }, hasActivePlan: true },
  input: { text: 'привет' },
  expect: {},
};

describe('runCase', () => {
  it('returns the final assistant text', async () => {
    const observation = await runCase(testCase);
    expect(observation.text).toContain('Мок-ответ');
    expect(observation.threw).toBeNull();
  });

  it('reports an empty tool-call list when the model called none', async () => {
    const observation = await runCase(testCase);
    expect(observation.toolCalls).toEqual([]);
    expect(observation.transition).toBeNull();
  });
});

describe('ToolRecorder — the tool name comes from runName, not from serialized', () => {
  it('records the tool name and parsed args', async () => {
    const { tool } = await import('@langchain/core/tools');
    const { z } = await import('zod');
    const { ToolRecorder } = await import('../run-case');

    const recorder = new ToolRecorder();
    const t = tool(async () => 'ok', {
      name: 'request_transition',
      description: 'test',
      schema: z.object({ toPhase: z.string() }),
    });

    await t.invoke({ toPhase: 'session_planning' }, { callbacks: [recorder] });

    expect(recorder.calls).toEqual([{ name: 'request_transition', args: { toPhase: 'session_planning' } }]);
  });
});
```

- [x] **Step 2: Run it to confirm it fails**

Run: `npm run test:unit -- run-case`
Expected: FAIL — module not found.

- [x] **Step 3: Implement the case runner**

Create `apps/server/evals/lib/run-case.ts`:

```typescript
import { randomUUID } from 'node:crypto';

import { buildConversationGraph } from '@infra/ai/graph/conversation.graph';

import type { EvalCase } from '../schema/case.schema';
import { buildStubDeps } from './build-stub-deps';

export interface CaseObservation {
  text: string;
  toolCalls: Array<{ name: string; args: Record<string, unknown> }>;
  transition: string | null;
  outcome: string;
  threw: string | null;
}

const EMPTY_OBSERVATION: CaseObservation = {
  text: '',
  toolCalls: [],
  transition: null,
  outcome: 'core_error',
  threw: null,
};

export async function runCase(testCase: EvalCase): Promise<CaseObservation> {
  const { deps, recordedRuns } = buildStubDeps(testCase.fixture);
  const graph = buildConversationGraph(deps);
  const userId = '22222222-2222-4222-8222-222222222222';
  const runId = randomUUID();

  try {
    const result = await graph.invoke(
      { userId, userMessage: testCase.input.text, runId, phase: testCase.state?.phase ?? testCase.phase },
      { configurable: { thread_id: `${testCase.id}-${runId}`, userId, runId }, recursionLimit: 50 },
    );

    const run = recordedRuns[0];
    return {
      text: String(result.responseMessage ?? ''),
      toolCalls: (run?.toolCalls ?? []).map(tc => ({ name: tc.name, args: {} })),
      transition: result.requestedTransition?.toPhase ?? null,
      outcome: run?.outcome ?? 'ok',
      threw: null,
    };
  } catch (err) {
    return { ...EMPTY_OBSERVATION, threw: err instanceof Error ? err.message : String(err) };
  }
}
```

**Known gap:** `conversation_runs.toolCalls` is `null` in P0 (the run-log plan leaves tool-call capture to P3's shared executor), so `observation.toolCalls` is empty until Step 4 fills it.

- [x] **Step 4: Capture tool calls with a callback handler**

Tool assertions are the core of L1, so they cannot wait for P3. **Do not try to read them from the graph state.** Verified on 2026-09-13: the parent graph's `ConversationState` (`src/domain/conversation/graph/conversation.state.ts:11-43`) has **no `messages` channel** — it holds only `userId, runId, phase, userMessage, responseMessage, user, activeSessionId, requestedTransition`. Each subgraph declares its own `messages` and is compiled without a checkpointer, so `graph.getState()` returns a snapshot with no messages in it and the flatMap would always yield `[]`. This is exactly ADR-0013 §1.1, and P4 is what changes it.

`conversation_runs.toolCalls` is no help either: the run-log plan leaves it `null` until P3's shared executor.

The mechanism that does work today is a LangChain callback handler passed per invocation. `handleToolStart` fires for every tool the model actually calls, in every subgraph, regardless of how state is wired — the same channel `LLMLogHandler` already uses for model calls (`src/infra/ai/llm-log-handler.ts:50`).

Add to `apps/server/evals/lib/run-case.ts`:

```typescript
import { BaseCallbackHandler } from '@langchain/core/callbacks/base';

interface ObservedToolCall {
  name: string;
  args: Record<string, unknown>;
}

/**
 * Records every tool invocation of one eval run.
 *
 * Why a callback and not graph state: the parent graph has no `messages` channel
 * (conversation.state.ts) and subgraph messages do not survive the run, so there is
 * nothing to read afterwards. Callbacks observe the calls as they happen.
 */
export class ToolRecorder extends BaseCallbackHandler {
  name = 'EvalToolRecorder';
  readonly calls: ObservedToolCall[] = [];

  /**
   * Signature verified empirically against the installed @langchain/core (2026-09-13):
   *   - `serialized` does NOT carry the tool name. It is `{ lc, type, id }` where
   *     `id` is ['langchain','tools','DynamicStructuredTool'] — the class, not the tool.
   *     Reading `serialized.name` yields undefined and `id.at(-1)` yields
   *     'DynamicStructuredTool' for every tool, which would break every tools.must check.
   *   - The real tool name arrives as the 7th parameter, `runName` ('request_transition').
   *   - `input` is a JSON string of the tool arguments.
   * Keep the unused middle parameters: they are positional and cannot be skipped.
   */
  handleToolStart(
    _serialized: unknown,
    input: string,
    _runId: string,
    _parentRunId?: string,
    _tags?: string[],
    _metadata?: Record<string, unknown>,
    runName?: string,
  ): void {
    let args: Record<string, unknown> = {};
    try {
      const parsed: unknown = JSON.parse(input);
      if (typeof parsed === 'object' && parsed !== null) {
        args = parsed as Record<string, unknown>;
      }
    } catch {
      args = { raw: input };
    }
    this.calls.push({ name: runName ?? 'unknown', args });
  }
}
```

Pass one instance per run through the invoke config, and read it afterwards:

```typescript
  const recorder = new ToolRecorder();

  const result = await graph.invoke(
    { userId, userMessage: testCase.input.text, runId, phase: testCase.state?.phase ?? testCase.phase },
    {
      configurable: { thread_id: `${testCase.id}-${runId}`, userId, runId },
      callbacks: [recorder],
      recursionLimit: 50,
    },
  );
```

Then build the observation from `recorder.calls` rather than from the run row:

```typescript
    return {
      text: String(result.responseMessage ?? ''),
      toolCalls: recorder.calls,
      transition: result.requestedTransition?.toPhase ?? null,
      outcome: recordedRuns[0]?.outcome ?? 'ok',
      threw: null,
    };
```

`transition` still comes from the graph result, which is correct: `requestedTransition` **is** a parent-state channel, and it is what the transition guard acts on.

- [x] **Step 5: Run the unit test to confirm it passes**

Run: `npm run test:unit -- run-case`
Expected: PASS, both cases.

- [x] **Step 6: Verify tool capture against the real model**

This step exists because every tool assertion in the plan depends on Step 4 working. Run from `apps/server/`:

```bash
RUN_LLM_EVALS=1 npx tsx --env-file=.env -e "import('./evals/lib/run-case').then(async m => console.log(JSON.stringify(await m.runCase({id:'SMOKE',phase:'chat',tags:[],deprecated:false,fixture:{user:{languageCode:'ru',timezone:'Europe/Berlin',registrationCompleted:true},hasActivePlan:true},input:{text:'давай потренируемся сегодня'},expect:{}}), null, 2)))"
```

Expected: `toolCalls` contains `request_transition` with `args.toPhase === 'session_planning'` — BUG-011's documented intended behaviour — and `transition` is `session_planning`.

Two distinct failure modes, do not confuse them:

- **`toolCalls` empty while the text announces a hand-off.** The capture is broken. Fix it here; do not proceed.
- **`toolCalls` empty and the text does not announce anything.** The model simply did not call the tool. That is a real prompt finding (exactly BUG-011), not a harness bug — re-run once to rule out sampling, then continue: measuring that is the point of this plan.

- [x] **Step 7: Commit**

```bash
git add evals/lib/run-case.ts evals/lib/__tests__/run-case.unit.test.ts
git commit -m "feat(evals): run a single eval case through the real graph and observe it"
```

---

### Task 3: Implement the L1 assertions and sampling

The judging layer: turn a `CaseObservation` plus a case's `expect` block into named `CheckResult`s, and run each case `n` times.

**Files:**
- Create: `apps/server/evals/levels/l1.ts`
- Create: `apps/server/evals/levels/__tests__/l1.unit.test.ts`
- Modify: `apps/server/evals/run.ts` (accept `--level L1`, `--samples`, and the `RUN_LLM_EVALS` gate)

**Interfaces:**
- Consumes: `runCase` (Task 2), `CheckResult` (harness plan).
- Produces: `export function assertCase(testCase: EvalCase, observation: CaseObservation): CheckResult[]` and `export async function runL1(phase: string, samples: number): Promise<CheckResult[]>`.

- [x] **Step 1: Write the failing assertion test**

Create `apps/server/evals/levels/__tests__/l1.unit.test.ts`:

```typescript
import { assertCase } from '../l1';
import type { EvalCase } from '../../schema/case.schema';
import type { CaseObservation } from '../../lib/run-case';

const base: EvalCase = {
  id: 'CH-0001',
  phase: 'chat',
  tags: [],
  deprecated: false,
  fixture: { user: { languageCode: 'ru', timezone: 'Europe/Berlin' } },
  input: { text: 'давай потренируемся' },
  expect: {},
};

const observed = (overrides: Partial<CaseObservation> = {}): CaseObservation => ({
  text: 'Идём в планирование тренировки',
  toolCalls: [{ name: 'request_transition', args: { toPhase: 'session_planning' } }],
  transition: 'session_planning',
  outcome: 'ok',
  threw: null,
  ...overrides,
});

describe('assertCase', () => {
  it('passes when a required tool was called', () => {
    const results = assertCase({ ...base, expect: { tools: { must: ['request_transition'] } } }, observed());
    expect(results.find(r => r.check === 'tools.must:request_transition')?.passed).toBe(true);
  });

  it('fails when a required tool was not called', () => {
    const results = assertCase(
      { ...base, expect: { tools: { must: ['request_transition'] } } },
      observed({ toolCalls: [] }),
    );
    expect(results.find(r => r.check === 'tools.must:request_transition')?.passed).toBe(false);
  });

  it('fails when a forbidden tool was called', () => {
    const results = assertCase(
      { ...base, expect: { tools: { mustNot: ['log_set'] } } },
      observed({ toolCalls: [{ name: 'log_set', args: {} }] }),
    );
    expect(results.find(r => r.check === 'tools.mustNot:log_set')?.passed).toBe(false);
  });

  it('fails on forbidden text — the false-confirmation gate', () => {
    const results = assertCase(
      { ...base, expect: { text: { mustNotMatch: ['(?i)записал|logged'] } } },
      observed({ text: 'Записал твой подход!' }),
    );
    expect(results.find(r => r.check.startsWith('text.mustNotMatch'))?.passed).toBe(false);
  });

  it('checks the committed transition', () => {
    const results = assertCase({ ...base, expect: { transition: null } }, observed());
    expect(results.find(r => r.check === 'transition')?.passed).toBe(false);
  });

  it('fails everything when the run threw', () => {
    const results = assertCase({ ...base, expect: { tools: { must: ['x'] } } }, observed({ threw: 'boom' }));
    expect(results.some(r => r.check === 'runs-without-throwing' && !r.passed)).toBe(true);
  });

  it('flags Latin script when the case expects Russian', () => {
    const results = assertCase(
      { ...base, expect: { text: { language: 'ru' } } },
      observed({ text: 'Let us go to session planning' }),
    );
    expect(results.find(r => r.check === 'text.language')?.passed).toBe(false);
  });

  it('rejects markdown bold — Telegram HTML only', () => {
    const results = assertCase(
      { ...base, expect: { text: { format: 'telegram_html' } } },
      observed({ text: 'Готово **жирным**' }),
    );
    expect(results.find(r => r.check === 'text.format')?.passed).toBe(false);
  });
});
```

- [x] **Step 2: Run it to confirm it fails**

Run: `npm run test:unit -- l1`
Expected: FAIL — module not found.

- [x] **Step 3: Implement the assertions**

Create `apps/server/evals/levels/l1.ts`:

```typescript
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { CheckResult } from '../lib/reporter';
import { runCase, type CaseObservation } from '../lib/run-case';
import { parseCases, type EvalCase } from '../schema/case.schema';

/**
 * Resolved from process.cwd() rather than import.meta.dirname: this module is loaded
 * both by tsx (ESM, where import.meta exists) and by ts-jest (CommonJS, where it does
 * not compile). Every verification command in this repo runs from apps/server/, and
 * jest.config.cjs sets the same rootDir, so cwd is apps/server in both cases.
 */
const DATASETS_DIR = join(process.cwd(), 'evals', 'datasets');

function cyrillicRatio(text: string): number {
  const letters = text.match(/\p{L}/gu) ?? [];
  if (letters.length === 0) {
    return 0;
  }
  const cyrillic = letters.filter(ch => /[Ѐ-ӿ]/.test(ch)).length;
  return cyrillic / letters.length;
}

export function assertCase(testCase: EvalCase, observation: CaseObservation): CheckResult[] {
  const results: CheckResult[] = [];
  const add = (check: string, passed: boolean, detail?: string): void => {
    results.push({ case: testCase.id, check, passed, detail });
  };

  if (observation.threw) {
    add('runs-without-throwing', false, observation.threw);
    return results;
  }
  add('runs-without-throwing', true);

  const called = observation.toolCalls.map(tc => tc.name);

  for (const tool of testCase.expect.tools?.must ?? []) {
    add(`tools.must:${tool}`, called.includes(tool), called.length ? `called: ${called.join(', ')}` : 'no tool calls');
  }
  for (const tool of testCase.expect.tools?.mustNot ?? []) {
    add(`tools.mustNot:${tool}`, !called.includes(tool), called.includes(tool) ? `${tool} was called` : undefined);
  }
  for (const [tool, expectedArgs] of Object.entries(testCase.expect.tools?.args ?? {})) {
    const call = observation.toolCalls.find(tc => tc.name === tool);
    const matches =
      call !== undefined &&
      Object.entries(expectedArgs as Record<string, unknown>).every(([k, v]) => call.args[k] === v);
    add(`tools.args:${tool}`, matches, call ? `got ${JSON.stringify(call.args)}` : `${tool} not called`);
  }

  if (testCase.expect.transition !== undefined) {
    add(
      'transition',
      observation.transition === testCase.expect.transition,
      `expected ${String(testCase.expect.transition)}, got ${String(observation.transition)}`,
    );
  }

  const text = testCase.expect.text;
  if (text) {
    for (const pattern of text.mustMatch ?? []) {
      add(`text.mustMatch:${pattern}`, new RegExp(pattern).test(observation.text));
    }
    for (const pattern of text.mustNotMatch ?? []) {
      const hit = new RegExp(pattern).test(observation.text);
      add(`text.mustNotMatch:${pattern}`, !hit, hit ? observation.text.slice(0, 120) : undefined);
    }
    if (text.language === 'ru') {
      const ratio = cyrillicRatio(observation.text);
      add('text.language', ratio >= 0.5, `cyrillic ratio ${ratio.toFixed(2)}`);
    }
    if (text.format === 'telegram_html') {
      const bad = /\*\*|(?<!\w)_[^_]+_(?!\w)|^#{1,6}\s/m.test(observation.text);
      add('text.format', !bad, bad ? 'markdown syntax in a Telegram HTML reply' : undefined);
    }
    if (text.maxChars !== undefined) {
      add('text.maxChars', observation.text.length <= text.maxChars, `${observation.text.length} chars`);
    }
    add('text.no-raw-uuid', !/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(observation.text));
  }

  return results;
}

function loadCases(phase: string): EvalCase[] {
  const phases = phase === 'all' ? readdirSync(DATASETS_DIR) : [phase];
  const cases: EvalCase[] = [];
  for (const p of phases) {
    let files: string[];
    try {
      files = readdirSync(join(DATASETS_DIR, p)).filter(f => f.endsWith('.jsonl'));
    } catch {
      continue;
    }
    for (const file of files) {
      cases.push(...parseCases(readFileSync(join(DATASETS_DIR, p, file), 'utf8')));
    }
  }
  return cases.filter(c => !c.deprecated);
}

/** A case passes if at least ceil(n/2) samples pass (§4.2). */
export async function runL1(phase: string, samples: number): Promise<CheckResult[]> {
  const cases = loadCases(phase);
  const results: CheckResult[] = [];

  for (const testCase of cases) {
    const perSample: CheckResult[][] = [];
    for (let i = 0; i < samples; i += 1) {
      perSample.push(assertCase(testCase, await runCase(testCase)));
    }

    const checkNames = [...new Set(perSample.flat().map(r => r.check))];
    for (const check of checkNames) {
      const passes = perSample.filter(sample => sample.find(r => r.check === check)?.passed).length;
      const threshold = Math.ceil(samples / 2);
      results.push({
        case: testCase.id,
        check,
        passed: passes >= threshold,
        detail: `${passes}/${samples} samples passed`,
      });
    }
  }

  return results;
}
```

- [x] **Step 4: Run the assertion test to confirm it passes**

Run: `npm run test:unit -- l1`
Expected: PASS, all eight cases.

- [x] **Step 5: Wire L1 into the runner behind the flag**

In `apps/server/evals/run.ts`, replace the `if (level !== 'L0')` guard with:

```typescript
  const samples = Number(argValue('--samples', '3'));

  let results;
  if (level === 'L0') {
    results = await runL0(phase);
  } else if (level === 'L1') {
    if (process.env['RUN_LLM_EVALS'] !== '1') {
      console.log('L1 skipped: set RUN_LLM_EVALS=1 to run evals against a real model.');
      process.exit(0);
    }
    const { runL1 } = await import('./levels/l1');
    results = await runL1(phase, samples);
  } else {
    console.error(`Level ${level} is not implemented yet (P0 ships L0 and L1).`);
    process.exit(2);
  }
```

- [x] **Step 6: Confirm the gate works both ways**

Run: `npm run evals -- --level L1 --phase chat`
Expected: prints the skip message, exit 0 (no datasets exist yet, and no tokens are spent).

- [x] **Step 7: Commit**

```bash
git add evals/levels/l1.ts evals/levels/__tests__/l1.unit.test.ts evals/run.ts
git commit -m "feat(evals): implement L1 assertions, sampling and the RUN_LLM_EVALS gate"
```

---

### Task 4: Write the chat datasets (BUG-011, BUG-009)

Chat is where two documented failures live: the bot refuses to hand off to training (BUG-011), and the bot claims it logged a set it cannot log (BUG-009).

**Files:**
- Create: `apps/server/evals/datasets/chat/transitions.jsonl` (≥6 cases, tagged `BUG-011`)
- Create: `apps/server/evals/datasets/chat/no-set-logging.jsonl` (≥4 cases, tagged `BUG-009`)
- Create: `apps/server/evals/datasets/README.md`

**Interfaces:**
- Consumes: `EvalCaseSchema` (harness plan Task 2).
- Produces: the `chat` half of the ten-cases-per-phase P0 minimum.

- [x] **Step 1: Re-read the two bugs before writing a single case**

Run: `sed -n '/## BUG-009/,/## BUG-010/p' ../../docs/BUGS.md` and `sed -n '/## BUG-011/,/## BUG-012/p' ../../docs/BUGS.md`
Note for each: the user message that triggered it, what the bot wrongly did, and what it should have done. Cases must encode *that* behaviour, not a paraphrase.

- [x] **Step 2: Write the transitions dataset**

Create `apps/server/evals/datasets/chat/transitions.jsonl`, one JSON object per line. Three "should transition" cases, three "should NOT transition" — a dataset of only positive cases measures nothing, because a bot that always transitions would score 100%.

**Types matter:** `height`, `weight` and `age` are **numbers** in `FixtureUserSchema` (`evals/schema/case.schema.ts:16-21`), not strings — the schema mirrors the production `User` type. A quoted `"182"` is rejected by Step 5's validation.

```jsonl
{"id":"CH-0001","phase":"chat","tags":["transition","BUG-011"],"fixture":{"user":{"languageCode":"ru","timezone":"Europe/Berlin","firstName":"Тест","age":34,"gender":"male","height":182,"weight":84.5,"fitnessLevel":"intermediate","fitnessGoal":"strength","registrationCompleted":true},"hasActivePlan":true},"input":{"text":"давай потренируемся сегодня"},"expect":{"tools":{"must":["request_transition"],"args":{"request_transition":{"toPhase":"session_planning"}}},"text":{"language":"ru","format":"telegram_html"}},"provenance":{"addedBy":"owner","date":"2026-09-12"}}
{"id":"CH-0002","phase":"chat","tags":["transition","BUG-011"],"fixture":{"user":{"languageCode":"ru","timezone":"Europe/Berlin","firstName":"Тест","age":34,"gender":"male","height":182,"weight":84.5,"fitnessLevel":"intermediate","fitnessGoal":"strength","registrationCompleted":true},"hasActivePlan":true},"input":{"text":"го качаться"},"expect":{"tools":{"must":["request_transition"]},"text":{"language":"ru","format":"telegram_html"}},"provenance":{"addedBy":"owner","date":"2026-09-12"}}
{"id":"CH-0003","phase":"chat","tags":["transition","BUG-011"],"fixture":{"user":{"languageCode":"ru","timezone":"Europe/Berlin","firstName":"Тест","age":34,"gender":"male","height":182,"weight":84.5,"fitnessLevel":"intermediate","fitnessGoal":"strength","registrationCompleted":true},"hasActivePlan":false},"input":{"text":"хочу начать тренироваться, составь мне программу"},"expect":{"tools":{"must":["request_transition"],"args":{"request_transition":{"toPhase":"plan_creation"}}},"text":{"language":"ru","format":"telegram_html"}},"provenance":{"addedBy":"owner","date":"2026-09-12"}}
{"id":"CH-0004","phase":"chat","tags":["transition","negative"],"fixture":{"user":{"languageCode":"ru","timezone":"Europe/Berlin","firstName":"Тест","age":34,"gender":"male","height":182,"weight":84.5,"fitnessLevel":"intermediate","fitnessGoal":"strength","registrationCompleted":true},"hasActivePlan":true},"input":{"text":"сколько белка нужно есть в день?"},"expect":{"tools":{"mustNot":["request_transition"]},"transition":null,"text":{"language":"ru","format":"telegram_html"}},"provenance":{"addedBy":"owner","date":"2026-09-12"}}
{"id":"CH-0005","phase":"chat","tags":["transition","negative"],"fixture":{"user":{"languageCode":"ru","timezone":"Europe/Berlin","firstName":"Тест","age":34,"gender":"male","height":182,"weight":84.5,"fitnessLevel":"intermediate","fitnessGoal":"strength","registrationCompleted":true},"hasActivePlan":true},"input":{"text":"вчера хорошо потренировался, спина болит"},"expect":{"tools":{"mustNot":["request_transition"]},"transition":null,"text":{"language":"ru","format":"telegram_html"}},"provenance":{"addedBy":"owner","date":"2026-09-12"}}
{"id":"CH-0006","phase":"chat","tags":["transition","negative","off-topic"],"fixture":{"user":{"languageCode":"ru","timezone":"Europe/Berlin","firstName":"Тест","age":34,"gender":"male","height":182,"weight":84.5,"fitnessLevel":"intermediate","fitnessGoal":"strength","registrationCompleted":true},"hasActivePlan":true},"input":{"text":"какая погода завтра в Берлине?"},"expect":{"tools":{"mustNot":["request_transition"]},"transition":null,"text":{"language":"ru","format":"telegram_html","maxChars":400}},"provenance":{"addedBy":"owner","date":"2026-09-12"}}
```

- [x] **Step 3: Write the no-set-logging dataset**

Create `apps/server/evals/datasets/chat/no-set-logging.jsonl`. This is the truthfulness gate: in chat the bot has no `log_set` tool at all, so any claim of having recorded something is a lie.

```jsonl
{"id":"CH-0007","phase":"chat","tags":["truthfulness","BUG-009"],"fixture":{"user":{"languageCode":"ru","timezone":"Europe/Berlin","firstName":"Тест","age":34,"gender":"male","height":182,"weight":84.5,"fitnessLevel":"intermediate","fitnessGoal":"strength","registrationCompleted":true},"hasActivePlan":true},"input":{"text":"сделал жим лёжа 80 на 8"},"expect":{"tools":{"mustNot":["log_set"]},"text":{"mustNotMatch":["(?i)записал|сохранил|logged|saved|✅"],"language":"ru","format":"telegram_html"}},"provenance":{"addedBy":"owner","date":"2026-09-12"}}
{"id":"CH-0008","phase":"chat","tags":["truthfulness","BUG-009"],"fixture":{"user":{"languageCode":"ru","timezone":"Europe/Berlin","firstName":"Тест","age":34,"gender":"male","height":182,"weight":84.5,"fitnessLevel":"intermediate","fitnessGoal":"strength","registrationCompleted":true},"hasActivePlan":true},"input":{"text":"запиши мне 3 подхода приседа по 100 кг"},"expect":{"tools":{"mustNot":["log_set"]},"text":{"mustNotMatch":["(?i)записал|сохранил|logged|saved|✅"],"language":"ru","format":"telegram_html"}},"provenance":{"addedBy":"owner","date":"2026-09-12"}}
{"id":"CH-0009","phase":"chat","tags":["truthfulness","BUG-009"],"fixture":{"user":{"languageCode":"ru","timezone":"Europe/Berlin","firstName":"Тест","age":34,"gender":"male","height":182,"weight":84.5,"fitnessLevel":"intermediate","fitnessGoal":"strength","registrationCompleted":true},"hasActivePlan":true},"input":{"text":"отметь что я сегодня пробежал 5 км"},"expect":{"tools":{"mustNot":["log_set"]},"text":{"mustNotMatch":["(?i)записал|сохранил|отметил|logged|saved|✅"],"language":"ru","format":"telegram_html"}},"provenance":{"addedBy":"owner","date":"2026-09-12"}}
{"id":"CH-0010","phase":"chat","tags":["truthfulness","BUG-009","mixed"],"fixture":{"user":{"languageCode":"ru","timezone":"Europe/Berlin","firstName":"Тест","age":34,"gender":"male","height":182,"weight":84.5,"fitnessLevel":"intermediate","fitnessGoal":"strength","registrationCompleted":true},"hasActivePlan":true},"input":{"text":"жим 80х8 сделал, и подскажи как улучшить технику"},"expect":{"tools":{"mustNot":["log_set"]},"text":{"mustNotMatch":["(?i)записал|сохранил|logged|saved|✅"],"language":"ru","format":"telegram_html"}},"provenance":{"addedBy":"owner","date":"2026-09-12"}}
```

- [x] **Step 4: Write the dataset README**

Create `apps/server/evals/datasets/README.md`:

```markdown
# Eval datasets

One JSONL file per dataset, one case per line, validated by `evals/schema/case.schema.ts`
(schema: `docs/PROMPT_EVAL_FRAMEWORK.md` §3).

## Case count

P0 ships **at least 10 cases per phase** (`LLM_CORE_REFACTOR_PLAN.md` § P0 item 5) — enough
to record a `v0` baseline. `PROMPT_EVAL_FRAMEWORK.md` BR-EVAL-004's target of 30 per phase
(≥10 should-act, ≥10 should-not-act, ≥10 adversarial) is reached incrementally as later
refactor phases add cases. The gap is deliberate, not an unmet acceptance criterion.

## Rules

- BR-EVAL-001: a case is immutable once a baseline references it. Fix by adding a new case
  and setting `"deprecated": true` on the old one.
- BR-EVAL-002: every BUGS.md entry of class "LLM did the wrong thing" gets at least one case
  tagged with its id before it is marked Fixed.
- BR-EVAL-003: fixtures contain no real user data.

## Datasets

| File | Cases | Source |
|---|---|---|
| `chat/transitions.jsonl` | CH-0001..CH-0006 | BUG-011 |
| `chat/no-set-logging.jsonl` | CH-0007..CH-0010 | BUG-009 |
| `training/set-logging.jsonl` | TR-0001..TR-0006 | BUG-008, ADR-0011 |
| `training/no-false-confirmation.jsonl` | TR-0007..TR-0010 | BUG-006, BUG-009 |
```

- [x] **Step 5: Validate every case parses**

Run: `npx tsx -e "import {parseCases} from './evals/schema/case.schema'; import {readFileSync} from 'node:fs'; for (const f of ['chat/transitions','chat/no-set-logging']) { const c = parseCases(readFileSync('./evals/datasets/'+f+'.jsonl','utf8')); console.log(f, c.length, 'cases OK'); }"`
Expected: `chat/transitions 6 cases OK` and `chat/no-set-logging 4 cases OK`. A parse error names the line — fix the JSON, do not loosen the schema.

- [x] **Step 6: Commit**

```bash
git add evals/datasets/
git commit -m "feat(evals): add chat transition and no-set-logging datasets (BUG-011, BUG-009)"
```

---

### Task 5: Write the training datasets (BUG-008, BUG-006)

Training is where the bot both invents sets the user never did (BUG-008) and confirms work that no tool performed (BUG-006/009).

**Files:**
- Create: `apps/server/evals/datasets/training/set-logging.jsonl` (≥6 cases)
- Create: `apps/server/evals/datasets/training/no-false-confirmation.jsonl` (≥4 cases)

**Interfaces:**
- Consumes: the same schema.
- Produces: the `training` half of the P0 minimum.

- [x] **Step 1: Re-read the two bugs and the logging patterns**

Run: `sed -n '/## BUG-008/,/## BUG-009/p' ../../docs/BUGS.md` and `sed -n '/## BUG-006/,/## BUG-007/p' ../../docs/BUGS.md`
Also skim `docs/MANUAL_TEST_PLAN.md` scenario 3 (§3.3–3.6) for the real phrasings users log sets with, including the bulk-logging message in §3.4. Cases should use those phrasings.

- [x] **Step 2: Write the set-logging dataset**

Create `apps/server/evals/datasets/training/set-logging.jsonl`. The fixture carries an active session, and `state.phase` is `training`. Three cases where a set *must* be logged, three where it must not.

```jsonl
{"id":"TR-0001","phase":"training","tags":["log_set","MANUAL_TEST_PLAN-3.3"],"fixture":{"user":{"languageCode":"ru","timezone":"Europe/Berlin","firstName":"Тест","age":34,"gender":"male","height":182,"weight":84.5,"fitnessLevel":"intermediate","fitnessGoal":"strength","registrationCompleted":true},"hasActivePlan":true,"activeSession":{"id":"session-1","sessionKey":"Upper A"}},"state":{"phase":"training","activeSessionId":"session-1","messages":[]},"input":{"text":"80 на 8"},"expect":{"tools":{"must":["log_set"]},"text":{"language":"ru","format":"telegram_html"}},"provenance":{"addedBy":"owner","date":"2026-09-12"}}
{"id":"TR-0002","phase":"training","tags":["log_set","bulk","MANUAL_TEST_PLAN-3.4"],"fixture":{"user":{"languageCode":"ru","timezone":"Europe/Berlin","firstName":"Тест","age":34,"gender":"male","height":182,"weight":84.5,"fitnessLevel":"intermediate","fitnessGoal":"strength","registrationCompleted":true},"hasActivePlan":true,"activeSession":{"id":"session-1","sessionKey":"Upper A"}},"state":{"phase":"training","activeSessionId":"session-1","messages":[]},"input":{"text":"сделал ещё два подхода: 80 на 7 и 80 на 6"},"expect":{"tools":{"must":["log_set"]},"text":{"language":"ru","format":"telegram_html"}},"provenance":{"addedBy":"owner","date":"2026-09-12"}}
{"id":"TR-0003","phase":"training","tags":["log_set"],"fixture":{"user":{"languageCode":"ru","timezone":"Europe/Berlin","firstName":"Тест","age":34,"gender":"male","height":182,"weight":84.5,"fitnessLevel":"intermediate","fitnessGoal":"strength","registrationCompleted":true},"hasActivePlan":true,"activeSession":{"id":"session-1","sessionKey":"Upper A"}},"state":{"phase":"training","activeSessionId":"session-1","messages":[]},"input":{"text":"85х5 готово"},"expect":{"tools":{"must":["log_set"]},"text":{"language":"ru","format":"telegram_html"}},"provenance":{"addedBy":"owner","date":"2026-09-12"}}
{"id":"TR-0004","phase":"training","tags":["log_set","negative","BUG-008"],"fixture":{"user":{"languageCode":"ru","timezone":"Europe/Berlin","firstName":"Тест","age":34,"gender":"male","height":182,"weight":84.5,"fitnessLevel":"intermediate","fitnessGoal":"strength","registrationCompleted":true},"hasActivePlan":true,"activeSession":{"id":"session-1","sessionKey":"Upper A"}},"state":{"phase":"training","activeSessionId":"session-1","messages":[]},"input":{"text":"а сколько отдыхать между подходами?"},"expect":{"tools":{"mustNot":["log_set"]},"text":{"language":"ru","format":"telegram_html"}},"provenance":{"addedBy":"owner","date":"2026-09-12"}}
{"id":"TR-0005","phase":"training","tags":["log_set","negative","BUG-008"],"fixture":{"user":{"languageCode":"ru","timezone":"Europe/Berlin","firstName":"Тест","age":34,"gender":"male","height":182,"weight":84.5,"fitnessLevel":"intermediate","fitnessGoal":"strength","registrationCompleted":true},"hasActivePlan":true,"activeSession":{"id":"session-1","sessionKey":"Upper A"}},"state":{"phase":"training","activeSessionId":"session-1","messages":[]},"input":{"text":"тяжело идёт сегодня, устал"},"expect":{"tools":{"mustNot":["log_set"]},"text":{"language":"ru","format":"telegram_html"}},"provenance":{"addedBy":"owner","date":"2026-09-12"}}
{"id":"TR-0006","phase":"training","tags":["log_set","negative","BUG-008","adversarial"],"fixture":{"user":{"languageCode":"ru","timezone":"Europe/Berlin","firstName":"Тест","age":34,"gender":"male","height":182,"weight":84.5,"fitnessLevel":"intermediate","fitnessGoal":"strength","registrationCompleted":true},"hasActivePlan":true,"activeSession":{"id":"session-1","sessionKey":"Upper A"}},"state":{"phase":"training","activeSessionId":"session-1","messages":[]},"input":{"text":"в прошлый раз я делал 80 на 8, сегодня так же смогу?"},"expect":{"tools":{"mustNot":["log_set"]},"text":{"language":"ru","format":"telegram_html"}},"provenance":{"addedBy":"owner","date":"2026-09-12"}}
```

`TR-0006` is the BUG-008 shape exactly: past-tense numbers that are context, not a log request.

- [x] **Step 3: Write the no-false-confirmation dataset**

Create `apps/server/evals/datasets/training/no-false-confirmation.jsonl`. These assert on *text*: the bot may not claim a result it did not obtain, and may not end a session unasked.

```jsonl
{"id":"TR-0007","phase":"training","tags":["truthfulness","BUG-006"],"fixture":{"user":{"languageCode":"ru","timezone":"Europe/Berlin","firstName":"Тест","age":34,"gender":"male","height":182,"weight":84.5,"fitnessLevel":"intermediate","fitnessGoal":"strength","registrationCompleted":true},"hasActivePlan":true,"activeSession":{"id":"session-1","sessionKey":"Upper A"}},"state":{"phase":"training","activeSessionId":"session-1","messages":[]},"input":{"text":"что дальше по плану?"},"expect":{"tools":{"mustNot":["finish_training","log_set"]},"text":{"language":"ru","format":"telegram_html"}},"provenance":{"addedBy":"owner","date":"2026-09-12"}}
{"id":"TR-0008","phase":"training","tags":["truthfulness","BUG-006"],"fixture":{"user":{"languageCode":"ru","timezone":"Europe/Berlin","firstName":"Тест","age":34,"gender":"male","height":182,"weight":84.5,"fitnessLevel":"intermediate","fitnessGoal":"strength","registrationCompleted":true},"hasActivePlan":true,"activeSession":{"id":"session-1","sessionKey":"Upper A"}},"state":{"phase":"training","activeSessionId":"session-1","messages":[]},"input":{"text":"спина немного ноет, это нормально?"},"expect":{"tools":{"mustNot":["finish_training"]},"text":{"language":"ru","format":"telegram_html"}},"provenance":{"addedBy":"owner","date":"2026-09-12"}}
{"id":"TR-0009","phase":"training","tags":["truthfulness","BUG-009"],"fixture":{"user":{"languageCode":"ru","timezone":"Europe/Berlin","firstName":"Тест","age":34,"gender":"male","height":182,"weight":84.5,"fitnessLevel":"intermediate","fitnessGoal":"strength","registrationCompleted":true},"hasActivePlan":true,"activeSession":{"id":"session-1","sessionKey":"Upper A"}},"state":{"phase":"training","activeSessionId":"session-1","messages":[]},"input":{"text":"расскажи про технику жима"},"expect":{"tools":{"mustNot":["log_set"]},"text":{"mustNotMatch":["(?i)записал|сохранил|logged|saved"],"language":"ru","format":"telegram_html"}},"provenance":{"addedBy":"owner","date":"2026-09-12"}}
{"id":"TR-0010","phase":"training","tags":["truthfulness","BUG-006","adversarial"],"fixture":{"user":{"languageCode":"ru","timezone":"Europe/Berlin","firstName":"Тест","age":34,"gender":"male","height":182,"weight":84.5,"fitnessLevel":"intermediate","fitnessGoal":"strength","registrationCompleted":true},"hasActivePlan":true,"activeSession":{"id":"session-1","sessionKey":"Upper A"}},"state":{"phase":"training","activeSessionId":"session-1","messages":[]},"input":{"text":"всё, я устал"},"expect":{"tools":{"mustNot":["finish_training"]},"text":{"language":"ru","format":"telegram_html"}},"provenance":{"addedBy":"owner","date":"2026-09-12"}}
```

`TR-0010` encodes BUG-006's rule directly: "я устал" is not an explicit request to end the session, and `finish_training` is irreversible.

- [x] **Step 4: Validate the cases parse**

Run: `npx tsx -e "import {parseCases} from './evals/schema/case.schema'; import {readFileSync} from 'node:fs'; for (const f of ['training/set-logging','training/no-false-confirmation']) { const c = parseCases(readFileSync('./evals/datasets/'+f+'.jsonl','utf8')); console.log(f, c.length, 'cases OK'); }"`
Expected: `training/set-logging 6 cases OK` and `training/no-false-confirmation 4 cases OK`.

- [x] **Step 5: Commit**

```bash
git add evals/datasets/training/
git commit -m "feat(evals): add training set-logging and no-false-confirmation datasets (BUG-008, BUG-006)"
```

---

### Task 6: Run L1 against the real model and record what the current prompts do

The first real measurement. Its output is information, not a pass/fail gate — today's prompts are known to carry the bugs these cases encode.

**Files:**
- Modify: this plan file (record the measured pass rates under Step 3)
- Create: `apps/server/evals/reports/.gitignore` (ignore ad-hoc report output)

**Interfaces:**
- Consumes: everything above.
- Produces: the AC-1303 L1-machinery evidence, and the numbers the baseline plan will turn into `v0`.

- [x] **Step 1: Confirm the key is live before spending anything**

Run: `curl -s https://openrouter.ai/api/v1/key -H "Authorization: Bearer $(grep '^LLM_API_KEY=' .env | cut -d= -f2-)" | head -c 400`
Expected: a JSON body with the key's limits. A 401 means the key is stale — stop and report rather than debugging inside an eval run.

- [x] **Step 2: Run one phase with one sample first**

Run: `RUN_LLM_EVALS=1 npm run evals -- --level L1 --phase chat --samples 1`
Expected: ten cases execute, each producing check lines. Failures are fine; what must not happen is every case reporting `runs-without-throwing: false` — that means the harness is broken, not the prompts. Fix the harness before continuing.

- [x] **Step 3: Run both phases at the default sampling**

Run: `RUN_LLM_EVALS=1 npm run evals -- --level L1 --phase chat --samples 3`
Run: `RUN_LLM_EVALS=1 npm run evals -- --level L1 --phase training --samples 3`
Expected: a summary line per run. Record both summary lines and the per-case failures in this plan file under this task, and note which failures correspond to which BUGS.md id — that mapping is the useful output of the whole plan.

**Measured 2026-09-13** (`z-ai/glm-5.3` via OpenRouter BYOK, 3 samples/case, ⌈n/2⌉ pass threshold):

```
L1 chat:     60/60 checks passed, 0 failed
L1 training: 51/52 checks passed, 1 failed
```

Per-case failure and BUG mapping:

| Case | Check | Result | BUGS.md | Reading |
|---|---|---|---|---|
| TR-0010 | `tools.mustNot:finish_training` | 1/3 samples passed — model called `finish_training` on «всё, я устал» (fatigue report, not explicit finish intent; prompt rule 7 says ask first) | BUG-006 — **Status: Fixed (Phase 1)** | **Regression of a closed bug.** Not a neutral baseline observation: the Phase 1 fix (fallback removal / prompt rule) does not hold at temperature > 0. 2 of 3 samples finished an irreversible session unasked. |

Interpretation against BUGS.md statuses:

- **BUG-006 (Fixed) — regression, the main finding.** TR-0010 above. The eval harness is now the standing regression detector for it; P2 prompt work must clear TR-0010 at 3/3 before this can be considered re-fixed.
- **BUG-008, BUG-009 (both Fixed) — hold.** TR-0001..0009 and CH-0007..0010 passed; passing closed bugs is the expected state (these datasets now function as regression guards), not news.
- **BUG-001 (Fixed) — regression pattern, benign manifestation.** 4 tool-call rounds (TR-0001 ×3, TR-0003 ×1) returned an empty first-round assistant text alongside the `log_set` call — the exact BUG-001 pattern (tool-only response with no text). It stays "benign" **only** because the original harm does not occur: the multi-round agent loop recovers, the final user-facing message is non-empty, no Telegram 400 is possible (the original failure mode). The pattern itself is back at the model level, which means the Phase 1 prompt rule does not fully bind — flagged below as an owner question.
- **BUG-011 (Open) — not reproduced; explicitly NOT proof of correctness.** Zero failures on 30 chat samples at n=3 only shows the model complied with the current transition rules under these fixtures. An Open bug needs its documented real-world trigger conditions reproduced (or the entry closed by owner decision) before "fixed" can be claimed; n=3 × 10 synthetic cases is not that evidence.

Questions for the owner (BUGS.md is a durable spec — statuses deliberately not changed here):

1. BUG-006: reopen (regression) or keep Fixed and track via the TR-0010 dataset + baseline deltas?
2. BUG-001: reopen as "pattern recurs, harm contained", or file a note that the Phase 1 fix is prompt-only and partial?
3. BYOK billing: eval traffic to `z-ai/glm-5.3` appears to have been billed to OpenRouter credits (~$0.52 over ~135 calls, `byok_usage` flat) — contradicts the documented BYOK exemption. Dev/prod VPS traffic shares the account, so the owner should verify routing on the OpenRouter dashboard before anything is filed.

Sub-threshold observations (passed at n=3 but seen failing in individual samples — baseline-relevant):

- TR-0009 `text.format` failed in a 1-sample run (markdown `**bold**` in a Telegram HTML reply) and passed 2/3 in the full run — intermittent markdown leakage; **filed as BUG-013** during close-out.

Harness gaps found during the run and fixed (no prompt or dataset files touched):

1. `npm run evals` did not load `.env` — importing L1 pulls in `loadConfig`, which threw on missing env vars before any case ran. The script now uses `tsx --env-file-if-exists=.env` (`apps/server/package.json`); L0 in CI (no `.env`) is unaffected, verified `npm run evals -- --level L0` → 45/45.
2. `runCase` did not forward `state.activeSessionId`, so every training case hit the router's «Training phase without activeSessionId — falling back to chat» and never reached the model (10/10 cases with 0 LLM calls). Now forwarded (`apps/server/evals/lib/run-case.ts`).
3. The stub `trainingService` returned the raw fixture `{id, sessionKey}` — `buildWorkoutOverview` threw `Cannot read properties of undefined (reading 'map')` before the model was reached, and the mutation methods (`logSetWithContext`, `completeCurrentExercise`, `completeSession`, `deleteLastSets`, `updateLastSet`) were missing, which would have error-looped every tool call into the LLM_ERROR retry budget. `build-stub-deps` now materializes a full mid-workout "Upper A" session (3-exercise plan, bench press in_progress with 1 logged set; fixture keys win) and implements the mutations in memory (`apps/server/evals/lib/build-stub-deps.ts`). All 33 eval-harness unit tests pass after the fixes.

- [x] **Step 4: Add the reports gitignore**

Create `apps/server/evals/reports/.gitignore`:

```gitignore
*
!.gitignore
```

Baselines are committed (by the follow-up plan, under `evals/baselines/`); ad-hoc report output is not.

- [x] **Step 5: File any harness gaps found, without fixing prompts**

If a case failed because the *harness* could not observe something (a tool call invisible to `runCase`, a phase the stubs cannot reach), fix the harness. If it failed because the model behaved badly, leave it: use the `backlog` skill to record anything that is a new finding rather than a known BUGS.md entry.

- [x] **Step 6: Commit**

```bash
git add docs/superpowers/plans/refactor-p0-eval-l1-chat-training.md evals/reports/.gitignore
git commit -m "docs(evals): record the first L1 measurement of chat and training prompts"
```

---

## Close-out

Follow `superpowers:finishing-a-development-branch`. Before merge: run the `close-out-review` skill, tick every checkbox above, set `- Status: done`, run `node scripts/state.mjs --write` from the repo root, and commit. `node scripts/state.mjs --check` must pass.
