# Refactor P2 — Prompt Modules Implementation Plan

- Status: in progress
- Branch: plan/refactor-p2-prompt-modules
- After: refactor-p1-legacy-llm-retirement

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every string the model reads lives in a versioned module under `infra/ai/prompts/`, renders purely from a context object, is snapshot-tested byte-identical to today's text, is listed in one registry the L0 grid iterates, and is stamped on every run as a real `promptVersions` map instead of the `v0` placeholder.

**Architecture:** ADR-0013 §5: `PromptModule { id, version, directives, render(ctx) → Section[] }` composed by `compose()` in the exact order today's `composeDirectives` and template literals produce. Phase prompts become `phases/<phase>/v1.ts`; the nine directive functions become `directives/<name>.v1.ts`; the summariser prompt becomes `summarizer/v1.ts`; the four model-facing fragments the subgraphs build inline (training tool-results block, training history frame, previous-summary frame, post-tool nudge) become `blocks/*.v1.ts` — a small extension of the §5.1 layout, flagged for the owner. `render` never calls `new Date()`; `now` arrives in the context. A registry (`prompts/index.ts`) is the single list of modules: L0 renders whatever the registry contains, `persist` stamps whatever the registry says, and an ESLint rule plus a grep test make an inline `SystemMessage('...')` in graph code a build error. Behaviour is unchanged: the snapshot suite (captured before any refactor) is the arbiter.

**Why the inventory is explicit:** on 2026-09-13 the owner found the eval grid covered only the five phase system prompts although the codebase had more model-facing text. Half of that text was the legacy path (deleted by `refactor-p1-legacy-llm-retirement`); the rest is listed below, item by item, with its target file. An executor who finishes this plan with any inventory row unaddressed has not finished.

**Tech Stack:** TypeScript, Jest snapshots (`--ci`), the existing `evals/` tree (tsx, Zod), ESLint `no-restricted-syntax`.

**Spec:** `docs/adr/0013-llm-core-target-architecture.md` §5 (D-09, BR-LLM-007..010), §11. `docs/PROMPT_EVAL_FRAMEWORK.md` §4.1 (L0), §6 (versioning). Master plan: `docs/LLM_CORE_REFACTOR_PLAN.md` § P2 scope items 1, 2, 4, 5 (item 3 — the context assembler and `budgetReport` — is the follow-up plan `refactor-p2-context-assembler`, AC-1323).

**Acceptance criteria:** AC-1321 (rendered prompts byte-identical for all five phases × three fixtures — snapshot tests green), AC-1322 (L1 pass rates for `v1` within ±2 pp of the `v0` baseline on every dataset, n=3), AC-1324 (`grep -rn "new Date()" apps/server/src/infra/ai/prompts` → empty). Plus the L0 half of the backlog finding "section presence" (§4.1) — implemented here because the section contract now exists.

## Global Constraints

- **Zero wording changes.** Every module's text is moved verbatim — same characters, same order, same blank lines. A failing snapshot is a bug in the move, never a reason to update the snapshot. Jest runs with `--ci` so a missing or changed snapshot fails instead of being written. Any real wording finding goes to the backlog via the `backlog` skill.
- **Snapshots are captured from the old code first** (Task 1) and never regenerated in this plan. The `__snapshots__` files committed in Task 1 are the pre-refactor truth for AC-1321.
- **`render` is pure** (BR-LLM-007): no I/O, no `new Date()`, no `Date.now()`, no config reads, no logging. Time comes from `ctx.now`; the caller creates it once per run.
- **`now` for fixtures is `FIXED_NOW = 2026-09-13T10:00:00.000Z`** everywhere in tests and L0, so relative-time phrasing is stable.
- **Layout follows ADR-0013 §5.1 exactly, plus one accepted extension:** `blocks/` for model-facing fragments that are neither a phase system prompt nor a directive. **Owner ruling, 2026-09-13: accepted — build `prompts/blocks/`.** Rationale: the four fragments are structurally unlike directives (a directive is appended to a system prompt by `compose`; a block becomes its own `SystemMessage` at a specific position in the message array, and two of them take runtime data — tool results, history). Filing them under `directives/` would put two different lifecycles in one directory and make the registry's phase→blocks mapping read as nonsense. This is an addition to §5.1's tree, not a change to any rule in §5.2: blocks are ordinary `PromptModule`s with ids, versions and snapshots. Record it in the close-out as an ADR-0013 §5.1 layout extension so P7's docs reconciliation folds it into the ADR text rather than rediscovering it.
- **Message order per phase is untouched.** The subgraph `agentNode`s still assemble `[system, summary, history, human, in-flight, tool-results]` exactly as today; only the *text* of each piece now comes from a module. Reordering and budgeting is `refactor-p2-context-assembler`.
- **Russian user-facing error literals** in `training.subgraph.ts` (two `AIMessage`s) and the dedup node's `Unknown tool:`/`Error:` tool-message strings are **not** prompts and **not** in scope: they are P3's message catalog and `ToolOutcome`. They are listed in the inventory so nobody "discovers" them again.
- Verification commands run from `apps/server/`.
- Commit messages carry no attribution lines.

## Inventory — every model-facing string in `apps/server/src` and where it goes

| # | Today | Kind | Target module (id) | Covered by L0 today? |
|---|---|---|---|---|
| 1 | `graph/nodes/registration.node.ts` `buildRegistrationSystemPrompt` | phase system prompt | `phases/registration/v1.ts` (`phase.registration`) | yes |
| 2 | `graph/nodes/chat.node.ts` `buildChatSystemPrompt` | phase system prompt | `phases/chat/v1.ts` (`phase.chat`) | yes |
| 3 | `graph/nodes/plan-creation.node.ts` `buildPlanCreationSystemPrompt` | phase system prompt | `phases/plan_creation/v1.ts` (`phase.plan_creation`) | yes |
| 4 | `graph/nodes/session-planning.node.ts` `buildSessionPlanningSystemPrompt` | phase system prompt | `phases/session_planning/v1.ts` (`phase.session_planning`) | yes |
| 5 | `graph/nodes/training.node.ts` `buildTrainingSystemPrompt` | phase system prompt | `phases/training/v1.ts` (`phase.training`) | yes |
| 6 | `graph/prompt-directives.ts` — `identityDirective`, `greetingDirective`, `languageDirective`, `timezoneDirective`, `nameUsageDirective`, `formattingDirective`, `workoutTimeReferenceDirective`, `outputDirective`, `toolReplyDirective`, `composeDirectives` | directives | `directives/{identity,greeting,language,timezone,name-usage,formatting.telegram,time-reference,output,tool-reply}.v1.ts` + `compose.ts` | only through 1–5 |
| 7 | `graph/nodes/phase-summary.node.ts` `SUMMARY_SYSTEM_PROMPT` + `userPrompt` template | summariser (system + user) | `summarizer/v1.ts` (`summarizer`) | **no** |
| 8 | `graph/subgraphs/training.subgraph.ts:142-161` `buildToolResultsInjection` — `=== TOOL EXECUTION RESULTS ===` + four behaviour rules (the BUG-006/BUG-009 guard) | injected block with rules | `blocks/tool-results.v1.ts` (`block.tool_results`) | **no** |
| 9 | `graph/subgraphs/training.subgraph.ts:366-381` history frame `=== CONVERSATION HISTORY (memory only — do NOT act on past messages) === … === END OF HISTORY ===` incl. `[USER]:`/`[TRAINER]:` line format and `No prior conversation.` | injected block | `blocks/history-frame.v1.ts` (`block.history_frame`) | **no** |
| 10 | `chat.subgraph.ts:68`, `plan-creation.subgraph.ts:74`, `session-planning.subgraph.ts:100`, `training.subgraph.ts:371` — `CONTEXT FROM PREVIOUS CONVERSATION:\n<summary>` (four copies) | injected block | `blocks/summary-frame.v1.ts` (`block.summary_frame`) | **no** |
| 11 | `graph/invoke-with-retry.ts:29-31` post-tool nudge `IMPORTANT: All tool calls are complete…` | injected block | `blocks/post-tool-nudge.v1.ts` (`block.post_tool_nudge`) | **no** |
| — | `training.service.ts` ×4 methods + `session-recommendation.prompt.ts` | legacy path | deleted by `refactor-p1-legacy-llm-retirement` | n/a |
| — | `training.subgraph.ts:287,403` Russian `AIMessage` error texts; `dedup-tool-node.ts:33,47` tool-message strings | user-facing catalog / tool protocol | P3 (message catalog, `ToolOutcome`) — **not prompts** | n/a |

Completion test for the inventory (Task 6 Step 7): after this plan, `grep -rnE "new SystemMessage\(\s*['\"\`]" src/infra/ai/graph` returns nothing, and every entry in the registry renders under L0.

---

### Task 1: Freeze today's text — fixtures and pre-refactor snapshots

Nothing is moved until the snapshot suite exists against the **old** code. This task also creates the fixture-context module that L0 and the snapshot suite share, and exports the one private function (`buildToolResultsInjection`) so its text can be frozen.

**Files:**
- Create: `apps/server/evals/fixtures/prompt-contexts.ts`
- Create: `apps/server/evals/snapshots/__tests__/prompt-snapshots.unit.test.ts`
- Create: `apps/server/evals/snapshots/__tests__/__snapshots__/prompt-snapshots.unit.test.ts.snap` (generated once, then frozen)
- Modify: `apps/server/src/infra/ai/graph/subgraphs/training.subgraph.ts:142` (`export` the function; no other change)
- Modify: `apps/server/evals/levels/l0.ts` (import `toUser`/`buildFixtureSession`/`buildSessionPlanningContext` from the new fixtures module instead of defining them)

**Interfaces:**
- Produces:

```typescript
// evals/fixtures/prompt-contexts.ts
export const FIXED_NOW: Date;                       // 2026-09-13T10:00:00.000Z
export function toUser(fixture: EvalFixture): User;
export function buildFixtureSession(fixture: EvalFixture, now: Date): WorkoutSessionWithDetails;
export function buildSessionPlanningContext(fixture: EvalFixture, now: Date): SessionPlanningContextData;
export const FIXTURE_HISTORY: Array<{ role: 'user' | 'assistant'; content: string }>;   // 2 turns, hand-written
export const FIXTURE_SUMMARY: string;                // one hand-written previous summary
export const FIXTURE_TOOL_RESULTS: Array<{ ok: boolean; content: string }>; // one ok, one failed
```

- [x] **Step 1: Create the fixture-context module**

Create `apps/server/evals/fixtures/prompt-contexts.ts` — move the three helpers out of `evals/levels/l0.ts` (lines 96-141) and add the constants:

```typescript
import type { SessionPlanningContextData } from '@domain/training/services/session-planning-context.builder';
import type { WorkoutSessionWithDetails } from '@domain/training/types';
import type { User } from '@domain/user/services/user.service';

import type { EvalFixture } from '../schema/case.schema';

/** One clock for every rendered fixture — relative-time phrasing must be stable. */
export const FIXED_NOW = new Date('2026-09-13T10:00:00.000Z');

/** BR-EVAL-003: hand-written, no real user data. */
export const FIXTURE_HISTORY: Array<{ role: 'user' | 'assistant'; content: string }> = [
  { role: 'user', content: 'Сегодня жим лёжа, 60 кг на 8' },
  { role: 'assistant', content: 'Записал: жим лёжа 60 кг × 8. Следующий подход — 62.5 кг.' },
];

export const FIXTURE_SUMMARY = 'User trains 3x/week, prefers upper/lower split, reported mild shoulder discomfort.';

export const FIXTURE_TOOL_RESULTS: Array<{ ok: boolean; content: string }> = [
  { ok: true, content: 'Set 2 logged: 60 kg × 8 (RPE 7)' },
  { ok: false, content: 'exercise id not found in session' },
];

export function toUser(fixture: EvalFixture): User {
  const { registrationCompleted, ...profile } = fixture.user;
  return {
    id: 'eval-user-1',
    profileStatus: registrationCompleted === true ? 'complete' : 'collecting',
    ...profile,
  };
}

export function buildFixtureSession(fixture: EvalFixture, now: Date): WorkoutSessionWithDetails {
  const active = fixture.activeSession as { id?: string; sessionKey?: string } | undefined;
  return {
    id: active?.id ?? 'eval-session-1',
    userId: 'eval-user-1',
    planId: 'eval-plan-1',
    sessionKey: active?.sessionKey ?? 'Upper A',
    status: 'in_progress',
    startedAt: now,
    completedAt: null,
    durationMinutes: null,
    userContextJson: null,
    sessionPlanJson: null,
    lastActivityAt: now,
    autoCloseReason: null,
    createdAt: now,
    updatedAt: now,
    exercises: [],
  };
}

export function buildSessionPlanningContext(fixture: EvalFixture, now: Date): SessionPlanningContextData {
  return {
    activePlan: null,
    recentSessions: fixture.activeSession ? [buildFixtureSession(fixture, now)] : [],
    daysSinceLastWorkout: fixture.activeSession ? 0 : null,
  };
}
```

In `evals/levels/l0.ts` delete the three local helpers and import them from the new module; pass `FIXED_NOW` where a `now` argument is now required. Until Task 3 replaces the old builders, L0 still renders them with real time (they call `new Date()` internally) — exactly as today. L0 becomes time-stable in Task 6 when it renders modules with `ctx.now = FIXED_NOW`. Only the snapshot suite (Jest) needs fake timers, and it gets them in Step 3.

- [x] **Step 2: Export `buildToolResultsInjection`**

In `apps/server/src/infra/ai/graph/subgraphs/training.subgraph.ts:142` change `function buildToolResultsInjection` to `export function buildToolResultsInjection`. Nothing else.

- [x] **Step 3: Write the snapshot suite against the old code**

Create `apps/server/evals/snapshots/__tests__/prompt-snapshots.unit.test.ts`:

```typescript
/**
 * AC-1321 — pre-refactor truth. Captured from the OLD builders in
 * refactor-p2-prompt-modules Task 1 and never regenerated in that plan.
 * Fake timers pin `new Date()` inside the old builders to FIXED_NOW.
 */
import { ToolMessage } from '@langchain/core/messages';

import { buildChatSystemPrompt } from '@infra/ai/graph/nodes/chat.node';
import { buildPlanCreationSystemPrompt } from '@infra/ai/graph/nodes/plan-creation.node';
import { buildRegistrationSystemPrompt } from '@infra/ai/graph/nodes/registration.node';
import { buildSessionPlanningSystemPrompt } from '@infra/ai/graph/nodes/session-planning.node';
import { buildTrainingSystemPrompt } from '@infra/ai/graph/nodes/training.node';
import { buildToolResultsInjection } from '@infra/ai/graph/subgraphs/training.subgraph';

import { ALL_FIXTURES } from '../../fixtures/personas';
import {
  FIXED_NOW,
  FIXTURE_HISTORY,
  FIXTURE_SUMMARY,
  FIXTURE_TOOL_RESULTS,
  buildFixtureSession,
  buildSessionPlanningContext,
  toUser,
} from '../../fixtures/prompt-contexts';

const LAST_MESSAGE_YESTERDAY = new Date('2026-09-12T08:00:00.000Z');

describe('prompt snapshots (AC-1321, BR-LLM-007 — byte-identical across the P2 move)', () => {
  beforeAll(() => {
    jest.useFakeTimers({ now: FIXED_NOW });
  });
  afterAll(() => {
    jest.useRealTimers();
  });

  for (const { name, fixture } of ALL_FIXTURES) {
    const user = toUser(fixture);

    it(`phase.registration / ${name}`, () => {
      expect(buildRegistrationSystemPrompt(user)).toMatchSnapshot();
    });

    it(`phase.chat / ${name}`, () => {
      expect(buildChatSystemPrompt(user, fixture.hasActivePlan ?? false, [], LAST_MESSAGE_YESTERDAY)).toMatchSnapshot();
    });

    it(`phase.plan_creation / ${name}`, () => {
      expect(buildPlanCreationSystemPrompt(user)).toMatchSnapshot();
    });

    it(`phase.session_planning / ${name}`, () => {
      expect(buildSessionPlanningSystemPrompt(user, buildSessionPlanningContext(fixture, FIXED_NOW))).toMatchSnapshot();
    });

    it(`phase.training / ${name}`, () => {
      expect(buildTrainingSystemPrompt(user, buildFixtureSession(fixture, FIXED_NOW), null)).toMatchSnapshot();
    });
  }

  it('summarizer / system', () => {
    // SUMMARY_SYSTEM_PROMPT is module-private today; the literal is copied here verbatim
    // from src/infra/ai/graph/nodes/phase-summary.node.ts:13-21 so Task 4 has a target.
    const SUMMARY_SYSTEM_PROMPT = `You are a concise note-taker. Summarize the conversation below into a brief context memo (3-8 sentences).
Focus on:
- Key decisions made or agreements reached
- Important facts mentioned by the user (injuries, preferences, feedback, complaints)
- Any unfinished topics or pending actions
- Relevant numbers (weights, reps, dates, plans)

Do NOT include greetings, filler, or tool call details. Always write in English regardless of the conversation language.
If a previous summary is provided, incorporate its key points and add new information from the current conversation.`;
    expect(SUMMARY_SYSTEM_PROMPT).toMatchSnapshot();
  });

  it('summarizer / user (with previous summary)', () => {
    // Copied verbatim from phase-summary.node.ts:38-42.
    const conversationText = FIXTURE_HISTORY.map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`).join('\n');
    const previousContext = `\n\nPREVIOUS SUMMARY (from earlier phases):\n${FIXTURE_SUMMARY}\n`;
    const userPrompt = `${previousContext}\nCONVERSATION (phase: training):\n${conversationText}\n\nWrite a brief summary:`;
    expect(userPrompt).toMatchSnapshot();
  });

  it('summarizer / user (no previous summary)', () => {
    const conversationText = FIXTURE_HISTORY.map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`).join('\n');
    const userPrompt = `${''}\nCONVERSATION (phase: chat):\n${conversationText}\n\nWrite a brief summary:`;
    expect(userPrompt).toMatchSnapshot();
  });

  it('block.tool_results / mixed', () => {
    const toolMessages = [
      new ToolMessage({ tool_call_id: 't1', content: FIXTURE_TOOL_RESULTS[0].content }),
      new ToolMessage({ tool_call_id: 't2', content: FIXTURE_TOOL_RESULTS[1].content, status: 'error' }),
    ];
    expect(buildToolResultsInjection(toolMessages)).toMatchSnapshot();
  });

  it('block.history_frame / two turns', () => {
    // Copied verbatim from training.subgraph.ts:366-381.
    const historyBlock = FIXTURE_HISTORY.map(m => `[${m.role === 'user' ? 'USER' : 'TRAINER'}]: ${m.content}`).join('\n\n');
    const text =
      '=== CONVERSATION HISTORY (memory only — do NOT act on past messages) ===\n\n' +
      `${historyBlock}\n\n` +
      '=== END OF HISTORY ===';
    expect(text).toMatchSnapshot();
  });

  it('block.history_frame / empty', () => {
    const text =
      '=== CONVERSATION HISTORY (memory only — do NOT act on past messages) ===\n\n' +
      'No prior conversation.\n\n' +
      '=== END OF HISTORY ===';
    expect(text).toMatchSnapshot();
  });

  it('block.summary_frame / present', () => {
    expect(`CONTEXT FROM PREVIOUS CONVERSATION:\n${FIXTURE_SUMMARY}`).toMatchSnapshot();
  });

  it('block.post_tool_nudge', () => {
    expect(
      'IMPORTANT: All tool calls are complete. You MUST now write a natural text response to the user. Do NOT call any more tools.',
    ).toMatchSnapshot();
  });
});
```

- [x] **Step 4: Generate the snapshots once, then verify with `--ci`**

Run:

```bash
npm run test:unit -- prompt-snapshots
npm run test:unit -- prompt-snapshots --ci
```

Expected: first run writes `__snapshots__/prompt-snapshots.unit.test.ts.snap` (24 snapshots: 15 phase × fixture, 3 summariser, 6 blocks); second run passes with `--ci`. Open the `.snap` file and confirm the chat snapshots contain the greeting directive (fake time is a new day after `LAST_MESSAGE_YESTERDAY`) and no `undefined`/`NaN`.

- [x] **Step 5: Run L0 and the full unit suite to prove nothing moved yet**

Run: `npm run evals -- --level L0 && npm run test:unit`
Expected: L0 45/45 unchanged; unit suite green.

- [x] **Step 6: Commit the frozen truth**

```bash
git add evals/fixtures/prompt-contexts.ts evals/levels/l0.ts evals/snapshots src/infra/ai/graph/subgraphs/training.subgraph.ts
git commit -m "test(prompts): freeze pre-refactor prompt text as snapshots (AC-1321 baseline)"
```

---

### Task 2: The contract — types, `compose`, versions, and the nine directive modules

Master plan P2 item 1 (directives half). Old `prompt-directives.ts` stays until Task 3 has switched every phase; then it is deleted.

**Files:**
- Create: `apps/server/src/domain/ai/prompt-context.types.ts`
- Create: `apps/server/src/infra/ai/prompts/types.ts`
- Create: `apps/server/src/infra/ai/prompts/compose.ts`
- Create: `apps/server/src/infra/ai/prompts/__tests__/compose.unit.test.ts`
- Create: `apps/server/src/infra/ai/prompts/directives/{identity,greeting,language,timezone,name-usage,formatting.telegram,time-reference,output,tool-reply}.v1.ts`
- Create: `apps/server/src/infra/ai/prompts/directives/index.ts`
- Create: `apps/server/src/infra/ai/prompts/directives/__tests__/directives.v1.unit.test.ts`

**Interfaces:**
- Produces:

```typescript
// domain/ai/prompt-context.types.ts
export interface PromptContextBase { now: Date; timezone: string | null; client: 'telegram' }

// infra/ai/prompts/types.ts
export interface Section { id: string; text: string; required: boolean }
export interface DirectiveContext extends PromptContextBase { user: User | null; lastMessageTime: Date | null }
export interface DirectiveModule { id: string; version: string; render(ctx: DirectiveContext): Section | null }
export interface PromptModule<TCtx> { id: string; version: string; directives: readonly DirectiveModule[]; render(ctx: TCtx): Section[] }

// infra/ai/prompts/compose.ts
export const SECTION_SEPARATOR = '\n\n';
export function renderDirectives(directives: readonly DirectiveModule[], ctx: DirectiveContext): Section[];
export function compose(sections: Section[]): string;
export function sectionText(sections: Section[], id: string): string;      // throws if absent
export function promptVersionsOf(module: PromptModule<unknown>): Record<string, string>;

// infra/ai/prompts/directives/index.ts
export const IDENTITY_V1, GREETING_V1, LANGUAGE_V1, TIMEZONE_V1, NAME_USAGE_V1, FORMATTING_TELEGRAM_V1,
             TIME_REFERENCE_V1, OUTPUT_V1, TOOL_REPLY_V1: DirectiveModule;
export const DEFAULT_DIRECTIVES_V1: readonly DirectiveModule[];   // today's composeDirectives order WITH identity
export const DIRECTIVES_WITHOUT_IDENTITY_V1: readonly DirectiveModule[];  // training's includeIdentity:false
```

Order in `DEFAULT_DIRECTIVES_V1` is today's `composeDirectives` order (`prompt-directives.ts:109-128`): identity, greeting, language, timezone, name-usage, formatting, time-reference, output, tool-reply. `greeting` renders `null` when not applicable — `renderDirectives` drops nulls, which is exactly what `parts.push` skipping did.

- [x] **Step 1: Write the failing compose test**

Create `apps/server/src/infra/ai/prompts/__tests__/compose.unit.test.ts`:

```typescript
import type { DirectiveModule, PromptModule, Section } from '../types';
import { SECTION_SEPARATOR, compose, promptVersionsOf, renderDirectives, sectionText } from '../compose';

const section = (id: string, text: string): Section => ({ id, text, required: true });

const always: DirectiveModule = { id: 'always', version: 'v1', render: () => section('always', 'A') };
const never: DirectiveModule = { id: 'never', version: 'v3', render: () => null };

const ctx = { now: new Date('2026-09-13T10:00:00Z'), timezone: null, client: 'telegram' as const, user: null, lastMessageTime: null };

describe('compose (ADR-0013 §5.2, BR-LLM-007 — deterministic composition)', () => {
  it('joins section texts with exactly one blank line', () => {
    expect(compose([section('a', 'one'), section('b', 'two')])).toBe(`one${SECTION_SEPARATOR}two`);
    expect(SECTION_SEPARATOR).toBe('\n\n');
  });

  it('renderDirectives keeps order and drops directives that render null', () => {
    const rendered = renderDirectives([never, always, never], ctx);
    expect(rendered.map(s => s.id)).toEqual(['always']);
  });

  it('sectionText returns the text by id and throws for a missing id', () => {
    expect(sectionText([section('x', 'X')], 'x')).toBe('X');
    expect(() => sectionText([section('x', 'X')], 'y')).toThrow(/y/);
  });

  it('promptVersionsOf lists the module and every directive as directive.<id> (BR-LLM-008)', () => {
    const module: PromptModule<unknown> = { id: 'phase.chat', version: 'v1', directives: [always, never], render: () => [] };
    expect(promptVersionsOf(module)).toEqual({ 'phase.chat': 'v1', 'directive.always': 'v1', 'directive.never': 'v3' });
  });
});
```

- [x] **Step 2: Run it to confirm it fails**

Run: `npm run test:unit -- prompts/__tests__/compose`
Expected: FAIL — module not found.

- [x] **Step 3: Write the types and compose**

Create `apps/server/src/domain/ai/prompt-context.types.ts`:

```typescript
/** ADR-0013 §5.2 — what every prompt render receives; `now` is injected, never read from the clock. */
export interface PromptContextBase {
  now: Date;
  timezone: string | null;
  client: 'telegram';
}
```

Create `apps/server/src/infra/ai/prompts/types.ts`:

```typescript
import type { PromptContextBase } from '@domain/ai/prompt-context.types';
import type { User } from '@domain/user/services/user.service';

/** ADR-0013 §5.2 */
export interface Section {
  id: string;
  text: string;
  /** L0 asserts every required section of the phase contract is present (PROMPT_EVAL_FRAMEWORK §4.1). */
  required: boolean;
}

export interface DirectiveContext extends PromptContextBase {
  user: User | null;
  lastMessageTime: Date | null;
}

export interface DirectiveModule {
  id: string;
  version: string;
  /** Pure. Returns null when the directive does not apply (e.g. greeting). */
  render(ctx: DirectiveContext): Section | null;
}

export interface PromptModule<TCtx> {
  id: string;
  version: string;
  directives: readonly DirectiveModule[];
  /** Pure (BR-LLM-007): no I/O, no Date.now(). */
  render(ctx: TCtx): Section[];
}
```

Create `apps/server/src/infra/ai/prompts/compose.ts`:

```typescript
import type { DirectiveContext, DirectiveModule, PromptModule, Section } from './types';

/** Today's composeDirectives joined parts with one blank line; phase templates did the same. */
export const SECTION_SEPARATOR = '\n\n';

export function renderDirectives(directives: readonly DirectiveModule[], ctx: DirectiveContext): Section[] {
  const sections: Section[] = [];
  for (const directive of directives) {
    const section = directive.render(ctx);
    if (section) sections.push(section);
  }
  return sections;
}

export function compose(sections: Section[]): string {
  return sections.map(s => s.text).join(SECTION_SEPARATOR);
}

export function sectionText(sections: Section[], id: string): string {
  const found = sections.find(s => s.id === id);
  if (!found) throw new Error(`Prompt section '${id}' not rendered`);
  return found.text;
}

/** BR-LLM-008 — the map recorded on every run (conversation_runs.prompt_versions). */
export function promptVersionsOf(module: PromptModule<unknown>): Record<string, string> {
  const versions: Record<string, string> = { [module.id]: module.version };
  for (const directive of module.directives) {
    versions[`directive.${directive.id}`] = directive.version;
  }
  return versions;
}
```

- [x] **Step 4: Run the compose test**

Run: `npm run test:unit -- prompts/__tests__/compose`
Expected: PASS (4 tests).

- [x] **Step 5: Write the failing directive tests**

Create `apps/server/src/infra/ai/prompts/directives/__tests__/directives.v1.unit.test.ts` — the semantic assertions from `src/infra/ai/graph/__tests__/prompt-directives.unit.test.ts` re-targeted at modules, plus the greeting time rule now driven by `ctx.now`:

```typescript
import { compose, renderDirectives } from '../../compose';
import type { DirectiveContext } from '../../types';
import {
  DEFAULT_DIRECTIVES_V1,
  DIRECTIVES_WITHOUT_IDENTITY_V1,
  FORMATTING_TELEGRAM_V1,
  GREETING_V1,
  IDENTITY_V1,
  LANGUAGE_V1,
  OUTPUT_V1,
  TIMEZONE_V1,
} from '..';

const NOW = new Date('2026-09-13T10:00:00.000Z');
const ctx = (over: Partial<DirectiveContext> = {}): DirectiveContext => ({
  now: NOW,
  timezone: null,
  client: 'telegram',
  user: null,
  lastMessageTime: null,
  ...over,
});
const user = { id: 'u', profileStatus: 'complete', languageCode: 'ru', timezone: 'Europe/Berlin' } as never;

describe('directive modules v1 (ADR-0013 §5, BR-LLM-007 — pure, versioned directives)', () => {
  it('identity names FitCoach and forbids AI mentions', () => {
    const text = IDENTITY_V1.render(ctx())!.text;
    expect(text).toContain('FitCoach');
    expect(text).toContain('NOT an AI assistant');
  });

  it('formatting.telegram has the FORMATTING header and forbids Markdown', () => {
    const text = FORMATTING_TELEGRAM_V1.render(ctx())!.text;
    expect(text).toContain('=== FORMATTING ===');
    expect(text).toContain('Do NOT use Markdown');
  });

  it('language uses the user language code, else the generic instruction', () => {
    expect(LANGUAGE_V1.render(ctx({ user }))!.text).toContain("'ru'");
    expect(LANGUAGE_V1.render(ctx())!.text).toContain('same language the user writes in');
  });

  it('timezone uses the user timezone, else asks for it', () => {
    expect(TIMEZONE_V1.render(ctx({ user }))!.text).toContain('Europe/Berlin');
    expect(TIMEZONE_V1.render(ctx())!.text).toContain('unknown');
  });

  it('output forbids JSON', () => {
    expect(OUTPUT_V1.render(ctx())!.text).toContain('Do NOT include JSON');
  });

  it('greeting applies only on a new calendar day and after 4 hours, using ctx.now', () => {
    expect(GREETING_V1.render(ctx({ lastMessageTime: null }))).toBeNull();
    expect(GREETING_V1.render(ctx({ lastMessageTime: new Date('2026-09-13T08:00:00.000Z') }))).toBeNull();
    expect(GREETING_V1.render(ctx({ lastMessageTime: new Date('2026-09-12T08:00:00.000Z') }))!.text).toContain('GREETING');
  });

  it('DEFAULT_DIRECTIVES_V1 reproduces the pre-refactor order; the no-identity variant drops only identity', () => {
    expect(DEFAULT_DIRECTIVES_V1.map(d => d.id)).toEqual([
      'identity', 'greeting', 'language', 'timezone', 'name-usage', 'formatting.telegram', 'time-reference', 'output', 'tool-reply',
    ]);
    expect(DIRECTIVES_WITHOUT_IDENTITY_V1.map(d => d.id)).toEqual(DEFAULT_DIRECTIVES_V1.map(d => d.id).slice(1));
    const text = compose(renderDirectives(DEFAULT_DIRECTIVES_V1, ctx()));
    expect(text.startsWith('You are FitCoach')).toBe(true);
    expect(text.endsWith('text: ""  ← empty, user sees nothing')).toBe(true);
  });

  it('every directive is v1', () => {
    for (const d of DEFAULT_DIRECTIVES_V1) expect(d.version).toBe('v1');
  });
});
```

- [x] **Step 6: Run it to confirm it fails**

Run: `npm run test:unit -- directives.v1`
Expected: FAIL — module not found.

- [x] **Step 7: Write the nine directive modules, verbatim text**

Each file takes its text from `src/infra/ai/graph/prompt-directives.ts` **unchanged**. Two examples define the pattern; the other seven follow it exactly (ids as listed in Step 5's order test).

`apps/server/src/infra/ai/prompts/directives/identity.v1.ts`:

```typescript
import type { DirectiveModule } from '../types';

export const IDENTITY_V1: DirectiveModule = {
  id: 'identity',
  version: 'v1',
  render: () => ({
    id: 'directive.identity',
    required: true,
    text: [
      'You are FitCoach — a professional fitness coach and personal trainer.',
      'You are NOT an AI assistant. Never mention AI, language models, or tech companies. Always stay in character.',
    ].join('\n'),
  }),
};
```

`apps/server/src/infra/ai/prompts/directives/greeting.v1.ts` (the one directive that used `new Date()` — now `ctx.now`):

```typescript
import { calendarDaysAgo } from '@shared/date-utils';

import type { DirectiveModule } from '../types';

const MIN_HOURS_SINCE_LAST_MESSAGE = 4;

export const GREETING_V1: DirectiveModule = {
  id: 'greeting',
  version: 'v1',
  render: ({ now, user, lastMessageTime }) => {
    if (!lastMessageTime) return null;

    const daysSinceLastMsg = calendarDaysAgo(lastMessageTime, now, user?.timezone);
    if (daysSinceLastMsg < 1) return null;

    const hoursSince = (now.getTime() - lastMessageTime.getTime()) / (1000 * 60 * 60);
    if (hoursSince < MIN_HOURS_SINCE_LAST_MESSAGE) return null;

    return {
      id: 'directive.greeting',
      required: false,
      text: [
        "GREETING: This is the user's first message today (new day since last activity).",
        'Start your response with a brief, warm greeting appropriate to the time of day',
        '(e.g. "Доброе утро!", "Привет!", "Добрый вечер!").',
        "Then address the user's message as usual.",
      ].join(' '),
    };
  },
};
```

Remaining files (same shape; `required: true`; text copied from the named function):
- `language.v1.ts` ← `languageDirective(user)` (reads `ctx.user`)
- `timezone.v1.ts` ← `timezoneDirective(user)` (reads `ctx.user`)
- `name-usage.v1.ts` ← `nameUsageDirective()`
- `formatting.telegram.v1.ts` ← `formattingDirective()` (id `formatting.telegram`, BR-LLM-010 selects by `ctx.client` later; v1 has one client)
- `time-reference.v1.ts` ← `workoutTimeReferenceDirective()`
- `output.v1.ts` ← `outputDirective()`
- `tool-reply.v1.ts` ← `toolReplyDirective()`

`apps/server/src/infra/ai/prompts/directives/index.ts`:

```typescript
import { FORMATTING_TELEGRAM_V1 } from './formatting.telegram.v1';
import { GREETING_V1 } from './greeting.v1';
import { IDENTITY_V1 } from './identity.v1';
import { LANGUAGE_V1 } from './language.v1';
import { NAME_USAGE_V1 } from './name-usage.v1';
import { OUTPUT_V1 } from './output.v1';
import { TIME_REFERENCE_V1 } from './time-reference.v1';
import { TIMEZONE_V1 } from './timezone.v1';
import { TOOL_REPLY_V1 } from './tool-reply.v1';

export {
  FORMATTING_TELEGRAM_V1, GREETING_V1, IDENTITY_V1, LANGUAGE_V1, NAME_USAGE_V1, OUTPUT_V1,
  TIME_REFERENCE_V1, TIMEZONE_V1, TOOL_REPLY_V1,
};

/** Pre-refactor composeDirectives order (graph/prompt-directives.ts:109-128). Do not reorder in v1. */
export const DEFAULT_DIRECTIVES_V1: readonly DirectiveModule[] = [
  IDENTITY_V1, GREETING_V1, LANGUAGE_V1, TIMEZONE_V1, NAME_USAGE_V1,
  FORMATTING_TELEGRAM_V1, TIME_REFERENCE_V1, OUTPUT_V1, TOOL_REPLY_V1,
];

/** training passed includeIdentity: false. */
export const DIRECTIVES_WITHOUT_IDENTITY_V1: readonly DirectiveModule[] = DEFAULT_DIRECTIVES_V1.slice(1);
```

(`DirectiveModule` is imported from `../types`.)

- [x] **Step 8: Run the directive tests and the whole unit suite**

Run: `npm run test:unit -- directives.v1 && npm run test:unit && npm run type-check && npm run lint`
Expected: green. `graph/prompt-directives.ts` still exists and is still used — nothing switched yet.

- [x] **Step 9: Commit**

```bash
git add src/domain/ai/prompt-context.types.ts src/infra/ai/prompts
git commit -m "feat(prompts): add PromptModule contract, compose(), and v1 directive modules (verbatim text)"
```

---

### Task 3: Phase modules — five moves, one snapshot each

Master plan P2 items 1, 2, 5 (phase half). One sub-cycle per phase: create the module, switch the subgraph to it, retarget the snapshot test, prove `--ci` green, delete the old builder, commit. Do the phases in this order (smallest first): plan_creation, registration, chat, session_planning, training.

**Files (per phase `<p>` ∈ plan_creation, registration, chat, session_planning, training):**
- Create: `apps/server/src/infra/ai/prompts/phases/<p>/v1.ts`
- Create: `apps/server/src/infra/ai/prompts/phases/<p>/index.ts`
- Modify: `apps/server/src/infra/ai/graph/subgraphs/<p>.subgraph.ts` (agentNode builds a context and calls `compose(current.render(ctx))`)
- Modify: `apps/server/evals/snapshots/__tests__/prompt-snapshots.unit.test.ts` (that phase's `it` now renders the module with `now: FIXED_NOW`)
- Delete: `apps/server/src/infra/ai/graph/nodes/<p>.node.ts` and (chat only) `nodes/__tests__/chat.node.unit.test.ts` → its semantic assertions move to `prompts/phases/chat/__tests__/v1.unit.test.ts`
- Delete after the fifth phase: `apps/server/src/infra/ai/graph/prompt-directives.ts` and `graph/__tests__/prompt-directives.unit.test.ts` (Task 2's directive tests replace it)

**Interfaces:**
- Consumes: Task 2 (`PromptModule`, `Section`, `compose`, `renderDirectives`, `DEFAULT_DIRECTIVES_V1`, `DIRECTIVES_WITHOUT_IDENTITY_V1`).
- Produces (each `index.ts` exports the same shape; Task 5's registry consumes it):

```typescript
export interface PhasePromptEntry<TCtx> { current: PromptModule<TCtx>; requiredSections: readonly string[] }

// phases/plan_creation/index.ts
export interface PlanCreationPromptContext extends DirectiveContext {}          // user, now, timezone
export const PLAN_CREATION_PROMPT: PhasePromptEntry<PlanCreationPromptContext>;
// phases/registration/index.ts
export interface RegistrationPromptContext extends DirectiveContext {}
export const REGISTRATION_PROMPT: PhasePromptEntry<RegistrationPromptContext>;
// phases/chat/index.ts
export interface ChatPromptContext extends DirectiveContext { hasActivePlan: boolean; recentSessions: WorkoutSessionWithDetails[] }
export const CHAT_PROMPT: PhasePromptEntry<ChatPromptContext>;
// phases/session_planning/index.ts
export interface SessionPlanningPromptContext extends DirectiveContext { context: SessionPlanningContextData }
export const SESSION_PLANNING_PROMPT: PhasePromptEntry<SessionPlanningPromptContext>;
// phases/training/index.ts
export interface TrainingPromptContext extends DirectiveContext { session: WorkoutSessionWithDetails; previousSession: WorkoutSessionWithDetails | null }
export const TRAINING_PROMPT: PhasePromptEntry<TrainingPromptContext>;
```

`PhasePromptEntry` lives in `prompts/types.ts` (add it there in this task).

**Section-boundary rule (applies to all five, the snapshot is the judge):** a section boundary may only be placed where the original template has exactly one blank line (`\n\n`) between two parts, so `compose` (`join('\n\n')`) reproduces the bytes. Sections carry no leading or trailing newline. Where the original has a `=== HEADER ===` line preceded by a blank line, start a section there (id = lower-snake of the header). Conditional fragments that today render as `''` (training's `staleSection`, `previousSession` block) become sections with `required: false` that are simply omitted when absent — check that omission does not swallow a blank line the old template kept; if it does, fold the conditional fragment into the neighbouring section instead of splitting.

Directive placement: every phase template ended with `\n\n${composeDirectives(...)}`, so each `render` returns `[...bodySections, ...renderDirectives(this.directives, ctx)]`.

`now` handling (AC-1324): `formatInUserTz(new Date(), …)` → `formatInUserTz(ctx.now, …)`; `const now = new Date()` → `const { now } = ctx`; chat's `humanTimeAgo(new Date(date), new Date(), tz)` → `humanTimeAgo(new Date(date), ctx.now, tz)`. `SESSION_TIMEOUT_MS` and the age computation in training stay, computed from `ctx.now`.

- [x] **Step 1: plan_creation — write the module**

Create `apps/server/src/infra/ai/prompts/phases/plan_creation/v1.ts` by moving the body of `buildPlanCreationSystemPrompt` (`nodes/plan-creation.node.ts:6-77`) into `render`, split at its five `===` headers:

```typescript
import { formatInUserTz } from '@shared/date-utils';

import { renderDirectives } from '../../compose';
import { DEFAULT_DIRECTIVES_V1 } from '../../directives';
import type { DirectiveContext, PromptModule, Section } from '../../types';

export interface PlanCreationPromptContext extends DirectiveContext {}

export const PLAN_CREATION_V1: PromptModule<PlanCreationPromptContext> = {
  id: 'phase.plan_creation',
  version: 'v1',
  directives: DEFAULT_DIRECTIVES_V1,
  render(ctx): Section[] {
    const { user } = ctx;
    const { dateOnly } = formatInUserTz(ctx.now, user?.timezone);

    const profileSection = user
      ? [
          `Name: ${user.firstName ?? 'Unknown'}`,
          `Age: ${user.age ?? '?'}`,
          `Gender: ${user.gender ?? '?'}`,
          `Height: ${user.height ?? '?'} cm`,
          `Weight: ${user.weight ?? '?'} kg`,
          `Fitness Level: ${user.fitnessLevel ?? '?'}`,
          `Fitness Goal: ${user.fitnessGoal ?? '?'}`,
        ].join('\n')
      : 'Profile not loaded.';

    return [
      { id: 'date', required: true, text: `Current Date: ${dateOnly}` },
      { id: 'client_profile', required: true, text: `=== CLIENT PROFILE ===\n\n${profileSection}` },
      { id: 'task', required: true, text: TASK_TEXT },                    // '=== YOUR TASK ===' … (nodes/plan-creation.node.ts:27-35)
      { id: 'conversation_flow', required: true, text: FLOW_TEXT },       // '=== CONVERSATION FLOW ===' … (:36-53)
      { id: 'rules', required: true, text: RULES_TEXT },                  // '=== RULES ===' … (:54-64)
      { id: 'tools', required: true, text: TOOLS_TEXT },                  // '=== TOOLS ===' … (:65-74)
      ...renderDirectives(DEFAULT_DIRECTIVES_V1, ctx),
    ];
  },
};
```

`TASK_TEXT`, `FLOW_TEXT`, `RULES_TEXT`, `TOOLS_TEXT` are module-level template-literal constants holding the four static blocks of `nodes/plan-creation.node.ts:27-76` **copied verbatim**, each starting at its `=== HEADER ===` line and ending before the blank line that precedes the next header (no leading/trailing newline). The plan does not reproduce those 50 lines because the Task 1 snapshot already pins them byte for byte; the rendered result must equal that snapshot and nothing else is acceptable. The same convention (named constants for static blocks, verbatim) applies to the other four phases.

Create `apps/server/src/infra/ai/prompts/phases/plan_creation/index.ts`:

```typescript
import type { PhasePromptEntry } from '../../types';
import { PLAN_CREATION_V1, type PlanCreationPromptContext } from './v1';

export type { PlanCreationPromptContext };

/** Section contract — a future version must still emit these ids (L0 required-sections check). */
export const PLAN_CREATION_PROMPT: PhasePromptEntry<PlanCreationPromptContext> = {
  current: PLAN_CREATION_V1,
  requiredSections: ['date', 'client_profile', 'task', 'conversation_flow', 'rules', 'tools', 'directive.identity', 'directive.tool-reply'],
};
```

Add to `prompts/types.ts`:

```typescript
export interface PhasePromptEntry<TCtx> {
  current: PromptModule<TCtx>;
  requiredSections: readonly string[];
}
```

- [x] **Step 2: plan_creation — retarget the snapshot test and prove identity**

In `prompt-snapshots.unit.test.ts` replace the plan_creation `it` body:

```typescript
    it(`phase.plan_creation / ${name}`, () => {
      const ctx = { now: FIXED_NOW, timezone: user.timezone ?? null, client: 'telegram' as const, user, lastMessageTime: null };
      expect(compose(PLAN_CREATION_PROMPT.current.render(ctx))).toMatchSnapshot();
    });
```

(import `compose` from `@infra/ai/prompts/compose` and `PLAN_CREATION_PROMPT` from `@infra/ai/prompts/phases/plan_creation`; drop the old builder import once the phase is switched.)

Run: `npm run test:unit -- prompt-snapshots --ci`
Expected: PASS — the module reproduces the frozen bytes. If it fails, fix the section split (never the snapshot).

- [x] **Step 3: plan_creation — switch the subgraph**

In `apps/server/src/infra/ai/graph/subgraphs/plan-creation.subgraph.ts:69` replace

```typescript
    const systemPrompt = buildPlanCreationSystemPrompt(freshUser ?? user);
```

with

```typescript
    const promptUser = freshUser ?? user;
    const systemPrompt = compose(
      PLAN_CREATION_PROMPT.current.render({
        now: new Date(),
        timezone: promptUser?.timezone ?? null,
        client: 'telegram',
        user: promptUser,
        lastMessageTime: null,
      }),
    );
```

Imports: `compose` from `@infra/ai/prompts/compose`, `PLAN_CREATION_PROMPT` from `@infra/ai/prompts/phases/plan_creation`; remove the `plan-creation.node` import. `new Date()` now lives in the caller — that is the point of AC-1324.

- [x] **Step 4: plan_creation — delete the old builder and commit**

```bash
git rm src/infra/ai/graph/nodes/plan-creation.node.ts
npm run type-check && npm run test:unit -- --ci && npm run evals -- --level L0
```

Expected: type-check clean (no remaining importer); unit suite green; **L0 fails for plan_creation** with "No L0 renderer wired" — expected until Task 6 rewires L0 to the registry. To keep every commit green, update `evals/levels/l0.ts` `renderPrompt` case `'plan_creation'` now to render the module with `now: FIXED_NOW` (the same five lines as the snapshot test). L0 → 45/45 again.

```bash
git add -A src/infra/ai evals
git commit -m "refactor(prompts): move plan_creation system prompt to phases/plan_creation/v1 (byte-identical)"
```

- [x] **Step 5: registration — same cycle**

Module `phases/registration/v1.ts`: body of `buildRegistrationSystemPrompt` (`nodes/registration.node.ts:16-85`) with sections `name_context`, `collected`, `missing`, `behavior_rules` (from `BEHAVIOR RULES:` through the conditional 6/7/8 block — keep the conditional inside this one section: the template literal inserts `\n6.` immediately after `5. …valid.\n`, which produces a blank line the split rule must not cut), `tools`, then directives. `PROFILE_FIELDS`, `FIELD_LABELS`/`FIELD_HINTS` imports move with it. `requiredSections: ['name_context', 'collected', 'missing', 'behavior_rules', 'tools', 'directive.identity', 'directive.tool-reply']`. Switch `registration.subgraph.ts:58`; retarget the snapshot `it` (`lastMessageTime: null`); `--ci` green; L0 case rewired; delete `nodes/registration.node.ts`; commit `refactor(prompts): move registration system prompt to phases/registration/v1 (byte-identical)`.

- [x] **Step 6: chat — same cycle plus test migration**

Module `phases/chat/v1.ts`: body of `buildChatSystemPrompt` (`nodes/chat.node.ts:13-79`). Context adds `hasActivePlan`, `recentSessions`; `humanTimeAgo(new Date(date), ctx.now, user?.timezone)`. Sections: `context` (`CLIENT NAME:` … recent sessions list), `rules` (`RULES:` …5.), `tools` (`TOOLS (use when needed):` …), `no_set_logging` (`IMPORTANT: You do NOT have log_set…`), then directives (chat passes `lastMessageTime` through — the subgraph sets `lastMessageTime` from `contextService.getLastUserMessageTime`). `requiredSections: ['context', 'rules', 'tools', 'no_set_logging', 'directive.identity', 'directive.tool-reply']` — `no_set_logging` is the BUG-009 guard; L0 will now fail any v2 that drops it.

Move the seven assertions of `nodes/__tests__/chat.node.unit.test.ts` to `prompts/phases/chat/__tests__/v1.unit.test.ts`, rendering through `compose(CHAT_PROMPT.current.render(ctx))` with a fixed `now`; name the describe `phase.chat v1 (ADR-0013 §5, BUG-009 guard section)` and add:

```typescript
  it('always emits the no_set_logging section (BUG-009)', () => {
    const ids = CHAT_PROMPT.current.render(ctx({ hasActivePlan: false })).map(s => s.id);
    expect(ids).toContain('no_set_logging');
  });
```

Switch `chat.subgraph.ts:63` (context: `now: new Date()`, `lastMessageTime`, `hasActivePlan: !!activePlan`, `recentSessions`); snapshot `--ci`; L0 case; delete `nodes/chat.node.ts` and its old test; commit `refactor(prompts): move chat system prompt to phases/chat/v1 (byte-identical)`.

- [x] **Step 7: session_planning — same cycle**

Module `phases/session_planning/v1.ts`: body of `buildSessionPlanningSystemPrompt` (`nodes/session-planning.node.ts:9-133`; the helper functions below line 133 in that file move too). Context adds `context: SessionPlanningContextData`; `const now = ctx.now`. Sections at the six headers: `client_profile`, `active_plan`, `recent_history`, `recovery_timeline`, `task`, `tools`, then directives. `requiredSections`: all six + `directive.identity`, `directive.tool-reply`. Switch `session-planning.subgraph.ts:95`; snapshot; L0; delete; commit.

Record in the PR description the session_planning prompt size from the L0 token line (master plan P2 note: "measure the session-planning system prompt size here … it sets P4's budget defaults").

- [x] **Step 8: training — same cycle, no identity directive**

Module `phases/training/v1.ts`: body of `buildTrainingSystemPrompt` (`nodes/training.node.ts:10-115`) plus its private helpers (`buildWorkoutOverview`, `buildPreviousSessionSection`, `formatSetData`, `formatDuration`, `buildStaleSessionSection`) moved into the same file (or a sibling `v1.helpers.ts` if the file exceeds the lint line limit). `directives: DIRECTIVES_WITHOUT_IDENTITY_V1` (today: `includeIdentity: false`). Context adds `session`, `previousSession`; `const now = ctx.now`. Sections: `client`, `workout_overview`, `stale_session` (`required: false`), `previous_session` (`required: false`), `tools`, `rules` (RULE 0…), then directives — verify against the snapshot that the conditional sections' surrounding newlines match; fold if not. `requiredSections: ['client', 'workout_overview', 'tools', 'rules', 'directive.tool-reply']`.

The L0 `FORBIDDEN_STRING_ALLOWLIST` comment cites `training.node.ts:94`; update the citation to the new file (the phrase is unchanged).

Switch `training.subgraph.ts:341`; snapshot; L0; delete `nodes/training.node.ts`; commit.

- [x] **Step 9: Delete `prompt-directives.ts` and verify AC-1324**

```bash
git rm src/infra/ai/graph/prompt-directives.ts src/infra/ai/graph/__tests__/prompt-directives.unit.test.ts
npm run type-check && npm run lint && npm run test:unit -- --ci && npm run evals -- --level L0
grep -rn "new Date()\|Date.now()" src/infra/ai/prompts
```

Expected: all green; the grep prints nothing (AC-1324).

```bash
git add -A src/infra/ai
git commit -m "refactor(prompts): delete graph/prompt-directives.ts — directives live in prompts/directives (AC-1324)"
```

---

### Task 4: Blocks and the summariser — the text L0 never saw

Inventory rows 7–11. Same discipline: module, switch the caller, snapshot `--ci`, commit.

**Files:**
- Create: `apps/server/src/infra/ai/prompts/blocks/{tool-results,history-frame,summary-frame,post-tool-nudge}.v1.ts` and `blocks/index.ts`
- Create: `apps/server/src/infra/ai/prompts/summarizer/v1.ts` and `summarizer/index.ts`
- Modify: `apps/server/src/infra/ai/graph/subgraphs/training.subgraph.ts` (rows 8, 9, 10), `chat.subgraph.ts:68`, `plan-creation.subgraph.ts:74`, `session-planning.subgraph.ts:100` (row 10), `graph/invoke-with-retry.ts:29-31` (row 11), `graph/nodes/phase-summary.node.ts:13-21,38-42` (row 7)
- Modify: `apps/server/evals/snapshots/__tests__/prompt-snapshots.unit.test.ts` (the 9 non-phase `it`s now render modules)

**Interfaces:**
- Produces:

```typescript
// blocks — PromptModule with no directives; ids are stable across versions
export interface ToolResultsContext { results: Array<{ ok: boolean; content: string }> }
export const TOOL_RESULTS_V1: PromptModule<ToolResultsContext>;          // id 'block.tool_results'
export interface HistoryFrameContext { history: Array<{ role: 'user' | 'assistant'; content: string }> }
export const HISTORY_FRAME_V1: PromptModule<HistoryFrameContext>;        // id 'block.history_frame'
export interface SummaryFrameContext { previousSummary: string }
export const SUMMARY_FRAME_V1: PromptModule<SummaryFrameContext>;        // id 'block.summary_frame'
export const POST_TOOL_NUDGE_V1: PromptModule<Record<string, never>>;    // id 'block.post_tool_nudge'
export function renderBlock<TCtx>(module: PromptModule<TCtx>, ctx: TCtx): string;   // compose(render(ctx))

// summarizer
export interface SummarizerContext { phase: ConversationPhase; previousSummary: string | null; history: Array<{ role: 'user' | 'assistant'; content: string }> }
export const SUMMARIZER_V1: PromptModule<SummarizerContext>;             // id 'summarizer'; sections 'system' and 'user'
```

- [ ] **Step 1: Write the four block modules**

`apps/server/src/infra/ai/prompts/blocks/tool-results.v1.ts` — text from `training.subgraph.ts:142-161`, classification stays in the subgraph:

```typescript
import type { PromptModule, Section } from '../types';

export interface ToolResultsContext {
  results: Array<{ ok: boolean; content: string }>;
}

/** Row 8 of the P2 inventory — the BUG-006/BUG-009 "report only what tools confirmed" block. */
export const TOOL_RESULTS_V1: PromptModule<ToolResultsContext> = {
  id: 'block.tool_results',
  version: 'v1',
  directives: [],
  render({ results }): Section[] {
    const lines = results.map(r => (r.ok ? `• ✅ SAVED — ${r.content}` : `• ❌ NOT SAVED — ${r.content}`));
    return [
      {
        id: 'tool_results',
        required: true,
        text: [
          '=== TOOL EXECUTION RESULTS ===',
          ...lines,
          '',
          'Your response MUST start by reporting each result above to the user.',
          'For each ✅ SAVED line: tell the user the set was recorded with exact numbers.',
          'For each ❌ NOT SAVED line: tell the user the set was NOT recorded and ask them to retry.',
          'Do NOT invent or assume any result not listed here.',
        ].join('\n'),
      },
    ];
  },
};
```

`history-frame.v1.ts`:

```typescript
import type { PromptModule, Section } from '../types';

export interface HistoryFrameContext {
  history: Array<{ role: 'user' | 'assistant'; content: string }>;
}

/** Row 9 — training's system-block history (P4 replaces it with the messages channel). */
export const HISTORY_FRAME_V1: PromptModule<HistoryFrameContext> = {
  id: 'block.history_frame',
  version: 'v1',
  directives: [],
  render({ history }): Section[] {
    const historyBlock =
      history.length > 0
        ? history.map(m => `[${m.role === 'user' ? 'USER' : 'TRAINER'}]: ${m.content}`).join('\n\n')
        : 'No prior conversation.';
    return [
      {
        id: 'history_frame',
        required: true,
        text:
          '=== CONVERSATION HISTORY (memory only — do NOT act on past messages) ===\n\n' +
          `${historyBlock}\n\n` +
          '=== END OF HISTORY ===',
      },
    ];
  },
};
```

`summary-frame.v1.ts`:

```typescript
import type { PromptModule, Section } from '../types';

export interface SummaryFrameContext {
  previousSummary: string;
}

/** Row 10 — one module replaces four identical literals. */
export const SUMMARY_FRAME_V1: PromptModule<SummaryFrameContext> = {
  id: 'block.summary_frame',
  version: 'v1',
  directives: [],
  render({ previousSummary }): Section[] {
    return [{ id: 'summary_frame', required: true, text: `CONTEXT FROM PREVIOUS CONVERSATION:\n${previousSummary}` }];
  },
};
```

`post-tool-nudge.v1.ts`:

```typescript
import type { PromptModule, Section } from '../types';

/** Row 11 — invoke-with-retry's nudge. */
export const POST_TOOL_NUDGE_V1: PromptModule<Record<string, never>> = {
  id: 'block.post_tool_nudge',
  version: 'v1',
  directives: [],
  render(): Section[] {
    return [
      {
        id: 'post_tool_nudge',
        required: true,
        text: 'IMPORTANT: All tool calls are complete. You MUST now write a natural text response to the user. Do NOT call any more tools.',
      },
    ];
  },
};
```

`blocks/index.ts` re-exports the four and adds:

```typescript
import { compose } from '../compose';
import type { PromptModule } from '../types';

export function renderBlock<TCtx>(module: PromptModule<TCtx>, ctx: TCtx): string {
  return compose(module.render(ctx));
}
```

- [ ] **Step 2: Write the summariser module**

`apps/server/src/infra/ai/prompts/summarizer/v1.ts` — both strings from `phase-summary.node.ts` verbatim:

```typescript
import type { ConversationPhase } from '@domain/conversation/ports';

import type { PromptModule, Section } from '../types';

export interface SummarizerContext {
  phase: ConversationPhase;
  previousSummary: string | null;
  history: Array<{ role: 'user' | 'assistant'; content: string }>;
}

/** Row 7. Two sections, consumed as two messages (system, user) — not composed into one string. */
export const SUMMARIZER_V1: PromptModule<SummarizerContext> = {
  id: 'summarizer',
  version: 'v1',
  directives: [],
  render({ phase, previousSummary, history }): Section[] {
    const conversationText = history.map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`).join('\n');
    const previousContext = previousSummary ? `\n\nPREVIOUS SUMMARY (from earlier phases):\n${previousSummary}\n` : '';
    return [
      {
        id: 'system',
        required: true,
        text: `You are a concise note-taker. Summarize the conversation below into a brief context memo (3-8 sentences).
Focus on:
- Key decisions made or agreements reached
- Important facts mentioned by the user (injuries, preferences, feedback, complaints)
- Any unfinished topics or pending actions
- Relevant numbers (weights, reps, dates, plans)

Do NOT include greetings, filler, or tool call details. Always write in English regardless of the conversation language.
If a previous summary is provided, incorporate its key points and add new information from the current conversation.`,
      },
      {
        id: 'user',
        required: true,
        text: `${previousContext}\nCONVERSATION (phase: ${phase}):\n${conversationText}\n\nWrite a brief summary:`,
      },
    ];
  },
};
```

`summarizer/index.ts`: `export { SUMMARIZER_V1 as SUMMARIZER_PROMPT, type SummarizerContext } from './v1';`

- [ ] **Step 3: Retarget the nine non-phase snapshot tests**

In `prompt-snapshots.unit.test.ts` replace the summariser/block `it` bodies with module renders (same test names):
- `summarizer / system` → `sectionText(SUMMARIZER_PROMPT.render({ phase: 'training', previousSummary: FIXTURE_SUMMARY, history: FIXTURE_HISTORY }), 'system')`
- `summarizer / user (with previous summary)` → same render, `'user'`
- `summarizer / user (no previous summary)` → `{ phase: 'chat', previousSummary: null, history: FIXTURE_HISTORY }`, `'user'`
- `block.tool_results / mixed` → `renderBlock(TOOL_RESULTS_V1, { results: FIXTURE_TOOL_RESULTS })`
- `block.history_frame / two turns` → `renderBlock(HISTORY_FRAME_V1, { history: FIXTURE_HISTORY })`; `/ empty` → `{ history: [] }`
- `block.summary_frame / present` → `renderBlock(SUMMARY_FRAME_V1, { previousSummary: FIXTURE_SUMMARY })`
- `block.post_tool_nudge` → `renderBlock(POST_TOOL_NUDGE_V1, {})`

Run: `npm run test:unit -- prompt-snapshots --ci`
Expected: PASS (24/24 against the Task 1 files).

- [ ] **Step 4: Switch the callers**

`training.subgraph.ts`:
- `buildToolResultsInjection(toolMessages)` body becomes: classify each `ToolMessage` exactly as today (`status === 'error' || startsWith(LLM_ERROR_PREFIX) || startsWith(SYSTEM_ERROR_PREFIX)`), strip the prefixes as today, then `return renderBlock(TOOL_RESULTS_V1, { results })`. Keep the function (and its export) — it is now protocol logic + one render.
- lines 366-381: `new SystemMessage(renderBlock(HISTORY_FRAME_V1, { history }))` and `new SystemMessage(renderBlock(SUMMARY_FRAME_V1, { previousSummary }))`.

`chat.subgraph.ts:68`, `plan-creation.subgraph.ts:74`, `session-planning.subgraph.ts:100`: the summary literal → `renderBlock(SUMMARY_FRAME_V1, { previousSummary })`.

`invoke-with-retry.ts:29-31`: `const nudge = new SystemMessage(renderBlock(POST_TOOL_NUDGE_V1, {}));`.

`phase-summary.node.ts`: delete `SUMMARY_SYSTEM_PROMPT` and the `userPrompt` template; build

```typescript
    const sections = SUMMARIZER_PROMPT.render({ phase, previousSummary, history });
    const response = await model.invoke(
      [
        { role: 'system', content: sectionText(sections, 'system') },
        { role: 'user', content: sectionText(sections, 'user') },
      ],
      { ...config, metadata: { userId, ...config?.metadata, runId: undefined } },
    );
```

(`history` here is the `ChatMsg[]` from `getMessagesForPrompt` — its `role` union includes `'system'`; map it to the module's `{ role: 'user' | 'assistant' }` by filtering `m.role !== 'system'` exactly as the old `conversationText` mapping implied (it treated everything non-user as Assistant — keep that: `role: m.role === 'user' ? 'user' : 'assistant'`).)

- [ ] **Step 5: Verify and commit**

Run: `npm run type-check && npm run lint && npm run test:unit -- --ci && npm run evals -- --level L0`
Expected: green.

```bash
git add -A src/infra/ai evals
git commit -m "refactor(prompts): move summariser and the four injected blocks into versioned modules (byte-identical)"
```

---

### Task 5: The registry and real `promptVersions` on every run

Master plan P2 item 4. One list of modules; `persist` stamps from it.

**Files:**
- Create: `apps/server/src/infra/ai/prompts/index.ts`
- Create: `apps/server/src/infra/ai/prompts/__tests__/registry.unit.test.ts`
- Modify: `apps/server/src/infra/ai/graph/nodes/persist.node.ts:26`
- Modify: `apps/server/src/infra/ai/graph/nodes/__tests__/persist.node.unit.test.ts:35`

**Interfaces:**
- Produces:

```typescript
// infra/ai/prompts/index.ts
export interface PhaseRegistryEntry { entry: PhasePromptEntry<unknown>; blocks: readonly PromptModule<unknown>[] }
export const PHASE_PROMPTS: Record<ConversationPhase, PhaseRegistryEntry>;
export const STANDALONE_PROMPTS: readonly PromptModule<unknown>[];   // summarizer + every block (for L0)
export function promptVersionsForPhase(phase: ConversationPhase): Record<string, string>;
```

Blocks per phase, from today's assembly code: chat → `[SUMMARY_FRAME_V1]`; registration → `[]`; plan_creation → `[SUMMARY_FRAME_V1, POST_TOOL_NUDGE_V1]`; session_planning → `[SUMMARY_FRAME_V1, POST_TOOL_NUDGE_V1]`; training → `[SUMMARY_FRAME_V1, HISTORY_FRAME_V1, TOOL_RESULTS_V1, POST_TOOL_NUDGE_V1]`.

- [ ] **Step 1: Write the failing registry test**

```typescript
import { PHASE_PROMPTS, STANDALONE_PROMPTS, promptVersionsForPhase } from '..';

describe('prompt registry (ADR-0013 §5, BR-LLM-008 — one list, real promptVersions)', () => {
  it('has an entry for every conversation phase', () => {
    expect(Object.keys(PHASE_PROMPTS).sort()).toEqual(['chat', 'plan_creation', 'registration', 'session_planning', 'training']);
  });

  it('promptVersionsForPhase(training) lists the phase, its directives and its blocks, all v1', () => {
    const versions = promptVersionsForPhase('training');
    expect(versions['phase.training']).toBe('v1');
    expect(versions['directive.identity']).toBeUndefined();          // training has no identity directive
    expect(versions['directive.tool-reply']).toBe('v1');
    expect(versions['block.tool_results']).toBe('v1');
    expect(versions['block.history_frame']).toBe('v1');
    expect(Object.values(versions).every(v => v === 'v1')).toBe(true);
  });

  it('promptVersionsForPhase(registration) has no blocks', () => {
    expect(Object.keys(promptVersionsForPhase('registration')).some(k => k.startsWith('block.'))).toBe(false);
  });

  it('every module id in the registry is unique', () => {
    const ids = [
      ...Object.values(PHASE_PROMPTS).map(p => p.entry.current.id),
      ...STANDALONE_PROMPTS.map(m => m.id),
    ];
    expect(new Set(ids).size).toBe(ids.length);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npm run test:unit -- prompts/__tests__/registry`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the registry**

`apps/server/src/infra/ai/prompts/index.ts`:

```typescript
import type { ConversationPhase } from '@domain/conversation/ports';

import { HISTORY_FRAME_V1, POST_TOOL_NUDGE_V1, SUMMARY_FRAME_V1, TOOL_RESULTS_V1 } from './blocks';
import { promptVersionsOf } from './compose';
import { CHAT_PROMPT } from './phases/chat';
import { PLAN_CREATION_PROMPT } from './phases/plan_creation';
import { REGISTRATION_PROMPT } from './phases/registration';
import { SESSION_PLANNING_PROMPT } from './phases/session_planning';
import { TRAINING_PROMPT } from './phases/training';
import { SUMMARIZER_PROMPT } from './summarizer';
import type { PhasePromptEntry, PromptModule } from './types';

export interface PhaseRegistryEntry {
  entry: PhasePromptEntry<unknown>;
  /** Blocks the phase's agentNode injects — from today's message assembly, per subgraph. */
  blocks: readonly PromptModule<unknown>[];
}

/** The one list. L0 renders it; persist stamps from it; nothing outside it reaches the model. */
export const PHASE_PROMPTS: Record<ConversationPhase, PhaseRegistryEntry> = {
  registration: { entry: REGISTRATION_PROMPT as PhasePromptEntry<unknown>, blocks: [] },
  chat: { entry: CHAT_PROMPT as PhasePromptEntry<unknown>, blocks: [SUMMARY_FRAME_V1] },
  plan_creation: { entry: PLAN_CREATION_PROMPT as PhasePromptEntry<unknown>, blocks: [SUMMARY_FRAME_V1, POST_TOOL_NUDGE_V1] },
  session_planning: { entry: SESSION_PLANNING_PROMPT as PhasePromptEntry<unknown>, blocks: [SUMMARY_FRAME_V1, POST_TOOL_NUDGE_V1] },
  training: {
    entry: TRAINING_PROMPT as PhasePromptEntry<unknown>,
    blocks: [SUMMARY_FRAME_V1, HISTORY_FRAME_V1, TOOL_RESULTS_V1, POST_TOOL_NUDGE_V1],
  },
};

export const STANDALONE_PROMPTS: readonly PromptModule<unknown>[] = [
  SUMMARIZER_PROMPT as PromptModule<unknown>,
  SUMMARY_FRAME_V1 as PromptModule<unknown>,
  HISTORY_FRAME_V1 as PromptModule<unknown>,
  TOOL_RESULTS_V1 as PromptModule<unknown>,
  POST_TOOL_NUDGE_V1 as PromptModule<unknown>,
];

export function promptVersionsForPhase(phase: ConversationPhase): Record<string, string> {
  const { entry, blocks } = PHASE_PROMPTS[phase];
  const versions = promptVersionsOf(entry.current);
  for (const block of blocks) versions[block.id] = block.version;
  return versions;
}
```

- [ ] **Step 4: Stamp real versions in `persist`**

In `persist.node.ts:26` replace the placeholder with `const promptVersions = promptVersionsForPhase(phase);` (import from `@infra/ai/prompts`; delete the "P0 placeholder" comment). In `persist.node.unit.test.ts:35` replace the `v0` expectation with:

```typescript
    expect(record.promptVersions).toMatchObject({ 'phase.chat': 'v1', 'directive.identity': 'v1', 'block.summary_frame': 'v1' });
```

- [ ] **Step 5: Run and commit**

Run: `npm run test:unit -- --ci && npm run type-check && npm run lint`
Expected: green.

```bash
git add src/infra/ai/prompts/index.ts src/infra/ai/prompts/__tests__/registry.unit.test.ts src/infra/ai/graph/nodes/persist.node.ts src/infra/ai/graph/nodes/__tests__/persist.node.unit.test.ts
git commit -m "feat(prompts): registry of prompt modules; persist records real promptVersions (BR-LLM-008)"
```

---

### Task 6: L0 renders the registry — and the rails that keep prompts inside it

L0 stops hard-coding five phases. It iterates the registry (phase modules + standalone modules), renders each with fixture contexts at `FIXED_NOW`, and adds the `required-sections-present` check (backlog finding, §4.1). Two guards make an inline prompt a build failure: an ESLint rule and a grep test.

**Files:**
- Modify: `apps/server/evals/levels/l0.ts` (registry iteration, section check, module-keyed budgets)
- Modify: `apps/server/evals/levels/__tests__/l0.unit.test.ts`
- Create: `apps/server/evals/fixtures/prompt-contexts.ts` additions: `contextsForModule(moduleId, fixture)` (see Interfaces)
- Create: `apps/server/evals/levels/__tests__/no-inline-prompts.unit.test.ts`
- Modify: `apps/server/eslint.config.js` (rule for `src/infra/ai/graph/**`)
- Modify: `docs/BACKLOG.md` — remove the "section presence" clause from the L0 finding (promoted here); leave "version discipline" and "message-catalog completeness" (P7/P3). Owner approval for the backlog edit is implied by this plan's approval; state it in the commit.

**Interfaces:**

```typescript
// evals/fixtures/prompt-contexts.ts
export function contextsForModule(moduleId: string, fixture: EvalFixture): unknown;
// phase.* → the phase context at FIXED_NOW (lastMessageTime = 2026-09-12T08:00Z for chat so the greeting renders)
// summarizer → { phase: 'training', previousSummary: FIXTURE_SUMMARY, history: FIXTURE_HISTORY }
// block.tool_results → { results: FIXTURE_TOOL_RESULTS }; block.history_frame → { history: FIXTURE_HISTORY }
// block.summary_frame → { previousSummary: FIXTURE_SUMMARY }; block.post_tool_nudge → {}
```

- [ ] **Step 1: Write the failing L0 tests**

Add to `evals/levels/__tests__/l0.unit.test.ts`:

```typescript
  it('fails when a required section is missing (§4.1 section presence)', () => {
    const results = checkSections('phase.chat', 'empty-profile', ['context', 'rules'], ['context', 'rules', 'tools']);
    const check = results.find(r => r.check === 'required-sections-present');
    expect(check?.passed).toBe(false);
    expect(check?.detail).toContain('tools');
  });

  it('renders every registry module for every fixture', async () => {
    const results = await runL0('all');
    const cases = new Set(results.map(r => r.case));
    expect(cases.has('phase.chat/empty-profile')).toBe(true);
    expect(cases.has('summarizer/empty-profile')).toBe(true);
    expect(cases.has('block.tool_results/empty-profile')).toBe(true);
    expect(results.every(r => r.passed)).toBe(true);
  });
```

(`checkSections(moduleId, fixtureName, renderedIds, requiredIds): CheckResult[]` is the new pure check; `runL0` keeps its signature but `--phase` now filters by module id prefix: `chat` → `phase.chat`, `all` → everything.)

- [ ] **Step 2: Run to confirm failure**

Run: `npm run test:unit -- l0.unit`
Expected: FAIL — `checkSections` not exported; `summarizer/...` case absent.

- [ ] **Step 3: Rewrite `renderPrompt`/`runL0` over the registry**

In `evals/levels/l0.ts`:

```typescript
import { PHASE_PROMPTS, STANDALONE_PROMPTS } from '@infra/ai/prompts';
import { compose } from '@infra/ai/prompts/compose';
import type { PromptModule } from '@infra/ai/prompts/types';

import { ALL_FIXTURES } from '../fixtures/personas';
import { contextsForModule } from '../fixtures/prompt-contexts';

export function checkSections(moduleId: string, fixtureName: string, renderedIds: string[], requiredIds: readonly string[]): CheckResult[] {
  const missing = requiredIds.filter(id => !renderedIds.includes(id));
  return [
    {
      case: `${moduleId}/${fixtureName}`,
      check: 'required-sections-present',
      passed: missing.length === 0,
      detail: missing.length ? `missing sections: ${missing.join(', ')}` : undefined,
    },
  ];
}

interface Target { module: PromptModule<unknown>; requiredSections: readonly string[] }

function targets(phaseArg: string): Target[] {
  const phases = Object.entries(PHASE_PROMPTS)
    .filter(([phase]) => phaseArg === 'all' || phase === phaseArg)
    .map(([, { entry }]) => ({ module: entry.current, requiredSections: entry.requiredSections }));
  const standalone = phaseArg === 'all' ? STANDALONE_PROMPTS.map(module => ({ module, requiredSections: module.render(contextsForModule(module.id, ALL_FIXTURES[0].fixture)).map(s => s.id) })) : [];
  return [...phases, ...standalone];
}

export async function runL0(phaseArg: string): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  for (const { module, requiredSections } of targets(phaseArg)) {
    for (const { name, fixture } of ALL_FIXTURES) {
      try {
        const sections = module.render(contextsForModule(module.id, fixture));
        results.push(...checkRenderedPrompt(module.id, name, compose(sections)));
        results.push(...checkSections(module.id, name, sections.map(s => s.id), requiredSections));
      } catch (err) {
        results.push({ case: `${module.id}/${name}`, check: 'renders-without-throwing', passed: false, detail: err instanceof Error ? err.message : String(err) });
      }
    }
  }
  return results;
}
```

`PHASE_TOKEN_BUDGET` keys become module ids (`'phase.chat': 4000`, …) plus `'summarizer': 2000` and `'block.*'` fall through to the default `8000` (they are tiny). Update the headroom comment with the measured numbers from this run. `checkRenderedPrompt(moduleId, …)` reads the budget by module id.

- [ ] **Step 4: Run L0 and its tests**

Run: `npm run test:unit -- l0.unit && npm run evals -- --level L0 && npm run evals -- --level L0 --phase chat`
Expected: tests green; full L0 reports 10 modules × 3 fixtures × 4 checks = 120 checks, all passed; `--phase chat` reports 12.

- [ ] **Step 5: Add the ESLint rail**

In `apps/server/eslint.config.js` add a config object after the main `src/**` block:

```javascript
  // ADR-0013 §5 / BR-LLM-009: model-facing text lives in prompts/ modules, never inline in graph code.
  {
    files: ['src/infra/ai/graph/**/*.ts', 'src/infra/ai/*.ts'],
    ignores: ['**/__tests__/**'],
    rules: {
      'no-restricted-syntax': ['error',
        {
          selector: "NewExpression[callee.name='SystemMessage'] > Literal.arguments",
          message: 'Inline system prompt text. Render it from a module in src/infra/ai/prompts/ (ADR-0013 §5).',
        },
        {
          selector: "NewExpression[callee.name='SystemMessage'] > TemplateLiteral.arguments",
          message: 'Inline system prompt text. Render it from a module in src/infra/ai/prompts/ (ADR-0013 §5).',
        },
        {
          selector: "Property[key.name='role'][value.value='system'] ~ Property[key.name='content'] > :matches(Literal, TemplateLiteral)",
          message: 'Inline system prompt text. Render it from a module in src/infra/ai/prompts/ (ADR-0013 §5).',
        },
      ],
    },
  },
```

Run: `npm run lint`
Expected: clean (Task 4 removed every offender). Prove the rail bites: temporarily add `new SystemMessage('x')` to `chat.subgraph.ts`, run `npm run lint`, expect the error, revert.

- [ ] **Step 6: Add the grep test (belt and braces — catches string concatenation the selector misses)**

Create `apps/server/evals/levels/__tests__/no-inline-prompts.unit.test.ts`:

```typescript
import { execFileSync } from 'node:child_process';
import path from 'node:path';

describe('no inline prompt text outside src/infra/ai/prompts (ADR-0013 §5, BR-LLM-009)', () => {
  const graphDir = path.resolve(__dirname, '../../../src/infra/ai/graph');

  function grep(pattern: string): string[] {
    try {
      return execFileSync('grep', ['-rnE', pattern, graphDir, '--include=*.ts', '--exclude-dir=__tests__'], { encoding: 'utf8' })
        .trim()
        .split('\n')
        .filter(Boolean);
    } catch (err) {
      if ((err as { status?: number }).status === 1) return []; // grep: no matches
      throw err;
    }
  }

  it('has no SystemMessage built from a literal', () => {
    expect(grep(`new SystemMessage\\(\\s*['"\`]`)).toEqual([]);
  });

  it('has no === HEADER === prompt text', () => {
    expect(grep(`['"\`]=== [A-Z ]+`)).toEqual([]);
  });

  it('has no role: system message with literal content', () => {
    expect(grep(`role: 'system', content: ['"\`]`)).toEqual([]);
  });
});
```

Run: `npm run test:unit -- no-inline-prompts`
Expected: PASS.

- [ ] **Step 7: Inventory completion check and commit**

Run:

```bash
grep -rnE "new SystemMessage\(\s*['\"\`]" src/infra/ai/graph; echo "exit=$?"
npm run check-all && npm run test:unit -- --ci && npm run evals -- --level L0
```

Expected: grep exit=1 (no matches); everything green.

Edit `docs/BACKLOG.md` → Findings, first entry: remove "section presence" from the list of unimplemented L0 checks and note "(section presence shipped in refactor-p2-prompt-modules)". Keep the other two.

```bash
git add evals eslint.config.js ../../docs/BACKLOG.md
git commit -m "feat(evals): L0 renders the prompt registry, checks required sections; lint + grep rails against inline prompts"
```

---

### Task 7: AC-1322 — prove `v1` behaves like `v0`

The point of the whole exercise. Requires the `v0` baseline from `refactor-p0-eval-baseline` (guaranteed by the `After:` chain) and dev keys in `.env`.

- [ ] **Step 1: Run L1 against the baseline**

```bash
RUN_LLM_EVALS=1 npm run evals -- --level L1 --phase all --samples 3 --baseline compare --baseline-version v0
```

Expected: the compare report shows every dataset within ±2 pp of `v0`. Paste the per-dataset table into this plan under "## AC-1322 result" and into the PR description.

- [ ] **Step 2: If any dataset is outside the band**

It cannot be the prompt text (snapshots are byte-identical), so it is either sampling noise or a context difference in the caller (a wrong `lastMessageTime`, a `now` that moved). Re-run that phase once with `--samples 5`. If still outside: stop, keep `Status: in progress`, record the table, and surface to the owner — the master plan's rollback condition (AC-1322 after two attempts) applies to the *assembler* wiring, which this plan does not touch, so the finding is new information for the owner, not a revert.

- [ ] **Step 3: Record**

Fill in "## AC-1322 result" with date, git SHA, model, `n`, and the table.

---

### Task 8: Docs reconcile and close-out

- [ ] **Step 1: `docs/ARCHITECTURE.md` module layout**

Under `infra/ai/` (around line 48-60) add the `prompts/` tree exactly as it now exists (`directives/`, `phases/<phase>/{v1.ts,index.ts}`, `blocks/`, `summarizer/`, `compose.ts`, `types.ts`, `index.ts`) and remove the `nodes/*.node.ts` prompt-builder entries and `prompt-directives.ts`.

- [ ] **Step 2: `docs/CONTRIBUTING_AI.md` § "Adjust Registration Flow / Prompts"**

Replace the path `apps/server/src/infra/ai/graph/nodes/registration.node.ts:1 (system prompt)` with `apps/server/src/infra/ai/prompts/phases/registration/vN.ts` and add one sentence: "Prompt changes follow `docs/PROMPT_EVAL_FRAMEWORK.md` §8 (new version file, keep the old one, run L1 for the phase) — recommended from P2, mandatory after P7."

- [ ] **Step 3: Full verification**

```bash
npm run check-all && npm run test:unit -- --ci && npm run evals -- --level L0
RUN_DB_TESTS=1 npm run test:integration
```

- [ ] **Step 4: Deploy to dev and smoke**

After merge: `ssh filko.dev "cd /srv/docker/fitcoach && ./deploy/deploy.sh dev"`, health `200`, the `MANUAL_TEST_PLAN.md` § Smoke list on `@MyFitAiCoachDevBot`, then confirm real versions are recorded:

```bash
ssh filko.dev "docker exec fitcoach-dev-db psql -U \$DB_USER -d \$DB_NAME -c \"SELECT phase_in, prompt_versions FROM conversation_runs ORDER BY created_at DESC LIMIT 3;\""
```

Expected: `prompt_versions` JSON contains `phase.<x>: v1` and `directive.*`/`block.*` keys — no `v0`.

## AC-1322 result

_(filled in by Task 7)_

## Follow-up plan (not part of this one)

`refactor-p2-context-assembler` — master plan P2 item 3 (AC-1323): `infra/ai/context/assemble-context.ts` replaces the per-subgraph message assembly with one assembler that reports `budgetReport`, reusing this plan's modules and the `evals/lib/token-estimator.ts`; `After: refactor-p2-prompt-modules`. Its plan file is written once this plan's `PhasePromptEntry`/registry shapes are merged, so it argues from real interfaces.

## Close-out

Follow `superpowers:finishing-a-development-branch`. Before merge: run the `close-out-review` skill, tick every checkbox above, close every check with its result (snapshot count, L0 check count, the AC-1322 table, the two grep outputs, the dev `prompt_versions` query), set `- Status: done`, run `node scripts/state.mjs --write` from the repo root, and commit. `node scripts/state.mjs --check` must pass. Also record that `prompts/blocks/` is an accepted extension of the ADR-0013 §5.1 layout, so P7 (AC-1371 docs reconciliation) writes it into the ADR instead of treating it as drift.

## Review

_(recorded by close-out-review)_
