# Refactor P0 — Dead Code Removal Implementation Plan

- Status: planned
- Branch:
- After:

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Delete the zero-consumer prompt service, its ports, its prompt builders and three orphaned type modules, so every later P0 task touches less code.

**Architecture:** Pure deletion plus one relocation. `PromptService` and `IPromptService` have exactly one consumer — the DI registration that constructs them; nothing calls their methods. `domain/user/ports/prompt.ports.ts` also holds `ChatMsg`, which *is* live (the conversation context service and its port use it), so `ChatMsg` moves to `domain/ai/types.ts` before the file dies. `training-intent.types.ts` is imported only by a prompt builder that is itself deleted in the same task; `plan-creation.types.ts` has zero importers. `parseSessionPlanningResponse` and `SessionPlanningLLMResponseSchema` are used only inside their own module. `LLMService` stays — it is P1's job.

**Tech Stack:** TypeScript (ESM, path aliases `@domain/*`, `@infra/*`), Jest + ts-jest, ESLint, Drizzle (untouched here).

**Spec:** `docs/LLM_CORE_REFACTOR_PLAN.md` § "P0 — Safety net and measurement", scope item 4. Target architecture: `docs/adr/0013-llm-core-target-architecture.md`.

**Acceptance criteria:** AC-1302 (partial — the grep half and the green-checks half; the eval half of P0 belongs to other plans).

## Global Constraints

- **Do not touch `LLMService`, `domain/ai/ports.ts`'s `LLMService` interface, or `LLM_SERVICE_TOKEN`** — they are deleted in P1, not here (master plan P0 item 4: "Keep `LLMService` until P1").
- **No behaviour change.** Nothing a user can observe may differ after this plan.
- **Never run `npm run drizzle:push`** (root `CLAUDE.md`).
- **Docs in this repo are English-only** (root `CLAUDE.md`).
- Verification commands run from `apps/server/`.
- Commit messages carry no attribution lines.

---

### Task 1: Move `ChatMsg` out of the doomed ports file

`ChatMsg` is the one live export in `domain/user/ports/prompt.ports.ts`. It must land in a stable home before the file is deleted, and its two consumers must follow it. `domain/ai/` is where the master plan says to put it ("move `ChatMsg` to `domain/ai` temporarily").

**Files:**
- Create: `apps/server/src/domain/ai/types.ts`
- Modify: `apps/server/src/domain/conversation/ports/conversation-context.ports.ts:1` (import line)
- Modify: `apps/server/src/infra/conversation/drizzle-conversation-context.service.ts:4` (import line)
- Modify: `apps/server/src/infra/ai/llm.service.ts:5` (import line — the service survives P0, only its import moves)

**Interfaces:**
- Consumes: nothing.
- Produces: `export interface ChatMsg { role: 'system' | 'user' | 'assistant'; content: string }` from `@domain/ai/types`. Task 2 relies on this being the only remaining reference path to `ChatMsg`.

- [x] **Step 1: Create the new home for `ChatMsg`**

Create `apps/server/src/domain/ai/types.ts`:

```typescript
/**
 * Chat message shape used by the conversation context service and the legacy
 * LLMService. Temporary home: ADR-0013 replaces this with LangChain message
 * types in P1/P4. Moved here from domain/user/ports/prompt.ports.ts (P0).
 */
export interface ChatMsg {
  role: 'system' | 'user' | 'assistant';
  content: string;
}
```

- [x] **Step 2: Point the three consumers at the new module**

In `apps/server/src/domain/conversation/ports/conversation-context.ports.ts`, replace the first line:

```typescript
import { ChatMsg } from '@domain/ai/types';
```

In `apps/server/src/infra/conversation/drizzle-conversation-context.service.ts`, replace the `ChatMsg` import line:

```typescript
import { ChatMsg } from '@domain/ai/types';
```

In `apps/server/src/infra/ai/llm.service.ts`, replace the `ChatMsg` import line:

```typescript
import { ChatMsg } from '@domain/ai/types';
```

- [x] **Step 3: Verify nothing still imports `ChatMsg` from the old path**

Run: `grep -rn "ChatMsg" src --include="*.ts" | grep -v "@domain/ai/types" | grep -v "domain/ai/types.ts"`
Expected: only the *usages* of the type (e.g. `Promise<ChatMsg[]>`), no `from '@domain/user/ports'` import lines.

- [x] **Step 4: Type-check**

Run: `npm run type-check`
Expected: exit 0. (`prompt.ports.ts` still exists and still exports `ChatMsg`; nothing imports it from there any more.)

- [x] **Step 5: Commit**

```bash
git add src/domain/ai/types.ts src/domain/conversation/ports/conversation-context.ports.ts src/infra/conversation/drizzle-conversation-context.service.ts src/infra/ai/llm.service.ts
git commit -m "refactor(ai): move ChatMsg to domain/ai/types ahead of prompt.ports removal"
```

---

### Task 2: Delete the prompt service, its ports and its prompt builders

With `ChatMsg` relocated, `prompt.ports.ts` holds only `IPromptService`, `PROMPT_SERVICE_TOKEN` and three context interfaces that exist solely for that service's method signatures. `PromptService` implements it; `domain/user/services/prompts/*` are the three builders it delegates to. The DI registration is the only construction site.

**Files:**
- Delete: `apps/server/src/domain/user/services/prompt.service.ts`
- Delete: `apps/server/src/domain/user/ports/prompt.ports.ts`
- Delete: `apps/server/src/domain/user/services/prompts/plan-creation.prompt.ts`
- Delete: `apps/server/src/domain/user/services/prompts/session-planning.prompt.ts`
- Delete: `apps/server/src/domain/user/services/prompts/training.prompt.ts`
- Delete: `apps/server/src/domain/training/training-intent.types.ts` (its only importer is `prompts/training.prompt.ts`, deleted above)
- Delete: `apps/server/src/domain/training/plan-creation.types.ts` (zero importers)
- Modify: `apps/server/src/domain/user/ports/index.ts:4` (drop the `export * from './prompt.ports'` line)
- Modify: `apps/server/src/main/register-infra-services.ts:18,24,52` (drop the import of `PromptService`, drop `PROMPT_SERVICE_TOKEN` from the destructured import, drop the `container.register(PROMPT_SERVICE_TOKEN, …)` line)

**Interfaces:**
- Consumes: `@domain/ai/types`'s `ChatMsg` from Task 1 — nothing here may re-introduce an import from `@domain/user/ports` for it.
- Produces: an absence. Task 3 asserts that absence with greps.

- [x] **Step 1: Confirm the builders are genuinely unreferenced outside the doomed set**

Run: `grep -rn "services/prompts/\|buildPlanCreationPrompt\|buildSessionPlanningPrompt\|buildTrainingPrompt\|buildUnifiedRegistrationPrompt\|buildChatSystemPrompt" src --include="*.ts"`
Expected: hits only inside the files listed for deletion, **plus** `src/infra/ai/graph/nodes/chat.node.ts` and its subgraph/test, which define and use their *own* `buildChatSystemPrompt`. That infra one is live — do not delete it. If any other file references the `@domain/user/services/prompts/*` modules, stop and report: the premise of this task is wrong.

- [x] **Step 2: Delete the files**

```bash
git rm src/domain/user/services/prompt.service.ts \
       src/domain/user/ports/prompt.ports.ts \
       src/domain/user/services/prompts/plan-creation.prompt.ts \
       src/domain/user/services/prompts/session-planning.prompt.ts \
       src/domain/user/services/prompts/training.prompt.ts \
       src/domain/training/training-intent.types.ts \
       src/domain/training/plan-creation.types.ts
rmdir src/domain/user/services/prompts 2>/dev/null || true
```

- [x] **Step 3: Drop the re-export from the ports barrel**

In `apps/server/src/domain/user/ports/index.ts`, remove this line:

```typescript
export * from './prompt.ports';
```

Leaving the file as:

```typescript
// Re-export all ports for convenient importing
export * from './repository.ports';
export * from './service.ports';
```

- [x] **Step 4: Unregister the service from the DI container**

In `apps/server/src/main/register-infra-services.ts`:

Remove the import line:

```typescript
  const { PromptService } = await import('@domain/user/services/prompt.service');
```

Change the destructured ports import from:

```typescript
  const { PROMPT_SERVICE_TOKEN, USER_REPOSITORY_TOKEN, USER_SERVICE_TOKEN } = await import('@domain/user/ports');
```

to:

```typescript
  const { USER_REPOSITORY_TOKEN, USER_SERVICE_TOKEN } = await import('@domain/user/ports');
```

Remove the registration line:

```typescript
  container.register(PROMPT_SERVICE_TOKEN, new PromptService());
```

- [x] **Step 5: Type-check and lint**

Run: `npm run type-check && npm run lint`
Expected: exit 0 on both. A failure here means a consumer was missed — fix the consumer, do not restore the file.

- [x] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor(user): delete zero-consumer PromptService, its ports and prompt builders"
```

---

### Task 3: Delete the unused session-planning response parser

`parseSessionPlanningResponse` and `SessionPlanningLLMResponseSchema` live in `domain/training/session-planning.types.ts` and are referenced only from inside that same file. The module has other live exports, so this is an edit, not a deletion.

**Files:**
- Modify: `apps/server/src/domain/training/session-planning.types.ts:60-110` (remove the schema, the inferred type and the parser function; keep everything else the module exports)
- Modify (if present): the unit test covering the parser — delete the `describe` block that tests it, or the whole test file if it only tests the parser

**Interfaces:**
- Consumes: nothing.
- Produces: nothing. Purely subtractive.

- [x] **Step 1: Find every reference, including tests**

Run: `grep -rn "parseSessionPlanningResponse\|SessionPlanningLLMResponseSchema\|SessionPlanningLLMResponse" src tests --include="*.ts"`
Expected: hits inside `src/domain/training/session-planning.types.ts` only, possibly plus a test file. Note each one. If a production file outside that module uses them, stop and report.

- [x] **Step 2: Remove the three exports**

In `apps/server/src/domain/training/session-planning.types.ts`, delete:
- the `export const SessionPlanningLLMResponseSchema = z.object({ … });` declaration,
- the `export type SessionPlanningLLMResponse = z.infer<typeof SessionPlanningLLMResponseSchema>;` line,
- the whole `export function parseSessionPlanningResponse(…) { … }` body.

If `z` (from `zod`) becomes unused in the file after this, remove its import too; if other schemas in the file still use it, keep it.

- [x] **Step 3: Remove the parser's tests**

Delete the `describe`/`it` blocks found in Step 1 that exercise `parseSessionPlanningResponse`. If that leaves a test file with no tests, `git rm` the file.

- [x] **Step 4: Run the checks**

Run: `npm run type-check && npm run lint && npm run test:unit`
Expected: all three exit 0, with no test suite reporting zero tests.

- [x] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor(training): drop unused session-planning LLM response parser"
```

---

### Task 4: Prove the removal is complete (AC-1302)

AC-1302 is a grep plus three green checks. This task runs them as written in the master plan and records the result, so close-out has evidence rather than a claim.

**Files:**
- Modify: this plan file (tick the boxes; the close-out phase sets `Status: done`)

**Interfaces:**
- Consumes: the deletions from Tasks 2 and 3.
- Produces: the verified AC-1302 evidence quoted in the PR description.

- [x] **Step 1: Run the AC-1302 grep**

Run: `grep -rn "PromptService\|training-intent.types\|plan-creation.types" src`
Expected: **no output** (exit code 1). Any hit is a failure — chase it down before continuing.

- [x] **Step 2: Run the three AC-1302 checks**

Run: `npm run type-check && npm run lint && npm run test:unit`
Expected: all three exit 0. Copy the unit-test summary line (suites/tests passed) into the PR description.

- [x] **Step 3: Confirm the P1-owned code is still standing**

Run: `grep -rn "LLMService\|LLM_SERVICE_TOKEN" src | head`
Expected: hits in `src/infra/ai/llm.service.ts`, `src/domain/ai/ports.ts` and `src/main/register-infra-services.ts`. **Their presence is correct** — P1 deletes them. An empty result means this plan overreached.

- [x] **Step 4: Commit the ticked plan**

```bash
git add docs/superpowers/plans/refactor-p0-dead-code.md
git commit -m "docs(plan): tick refactor-p0-dead-code steps"
```

---

## Execution notes

Two places where the code differed from the plan's survey, both found by the
plan's own verification steps:

1. **`ChatMsg` had six consumers, not three.** Task 1 listed
   `conversation-context.ports.ts`, `drizzle-conversation-context.service.ts` and
   `llm.service.ts`; the grep in Step 3 also turned up
   `infra/conversation/conversation-context.service.ts` (the in-memory test double),
   `domain/ai/ports.ts` and `domain/training/services/training.service.ts`. All six
   now import from `@domain/ai/types`. In `training.service.ts` the import was a
   combined `import type { ChatMsg, UserRepository }`, so it was split rather than
   rewritten.

2. **`SessionPlanningPhaseTransitionSchema` died with the parser.** Task 3 named
   three exports; that fourth one was used only by
   `SessionPlanningLLMResponseSchema`, so removing the parser left it with no
   consumer. It was removed too, along with the trailing comment block documenting
   the parser's JSON examples and the now-unused `ConversationPhase` import.
   `RecommendedExerciseSchema` and `SessionRecommendationSchema` were kept —
   `infra/ai/graph/tools/session-planning.tools.ts` imports both.

## AC-1302 evidence

- `grep -rn "PromptService\|training-intent.types\|plan-creation.types" src` → no output (exit 1).
- `npm run type-check` → exit 0.
- `npm run lint` → 12 problems, **0 errors**, 12 warnings (all pre-existing on `dev`:
  magic numbers in `config/index.ts` and `date-utils.ts`, function length in
  `register-infra-services.ts`).
- `npm run test:unit` → Test Suites: 27 passed, 27 total; Tests: 240 passed, 240 total.
  Identical to the pre-change baseline on `dev`.
- `grep -rn "LLMService\|LLM_SERVICE_TOKEN" src` → still present in `infra/ai/llm.service.ts`,
  `domain/ai/ports.ts`, `main/register-infra-services.ts`, `app/test/setup.ts`, as P1 requires.

## Close-out

Follow `superpowers:finishing-a-development-branch`. Before merge: run the `close-out-review` skill, tick every checkbox above, set `- Status: done` in this file's header, run `node scripts/state.mjs --write` from the repo root, and commit. `node scripts/state.mjs --check` must pass.
