# Refactor P0 — Dead Code Removal Implementation Plan

- Status: in progress
- Branch: plan/refactor-p0-dead-code
- After:
- Review: 2026-09-12 | clean | R1,R2,R3,R4

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

## Review

Close-out review run 2026-09-12, four zones (R1, R2, R3, R4). **First verdict: blocked** —
three blocking findings, all from R4, all the same class: the deletion removed seven
files and the living documentation layer still presents them as current. All three were
fixed on this branch at the owner's instruction and the phase was re-run; see the re-run
verdict at the end of this section.

The advisories below were **not** fixed here — each names a downstream owner (mostly P7)
or is pre-existing and untouched by this diff.

### Blocking

1. `blocking | R4 | apps/server/src/domain/user/services/README-parser.md:18 | DOCUMENTATION_GUIDE.md § Context hygiene ("Stale content is rewritten or deleted immediately") | The diff deletes domain/user/services/prompt.service.ts, but this in-tree doc still instructs import { FieldDefinition, UniversalParseRequest } from './prompt.service' — a sibling file in the very directory the diff emptied, now pointing at a nonexistent module (it also references profile-parser.service.ts, already gone). It is the only non-docs/ doc rot the diff creates, sits in the deletion's own blast radius, and no later phase owns it (P7's item 1 enumerates docs/** only).`
   — **Closed** (commit following the review): the file was **deleted**, not repaired. Its
   whole subject — `ProfileParserService`, `parseUniversal`, `UniversalParseRequest`,
   `FieldDefinition` — has zero references anywhere in `apps/server`; that API was removed by
   the earlier "unified registration + chat architecture" refactor, and `profile-parser.service.ts`
   with it. The document described a superseded design end to end, and this plan's deletion of
   `prompt.service.ts` only made the dangling import visible. Registration field extraction now
   lives in `infra/ai/graph/tools/registration.tools.ts` with validators in
   `domain/user/services/registration.validation.ts`.
2. `blocking | R4 | docs/ARCHITECTURE.md:41 | DOCUMENTATION_GUIDE.md § Document Types & Rules + AI Execution Order (ARCHITECTURE.md is architectural truth, step 4 of the execution order) | The module-layout tree still lists prompt.ports.ts and (line 44) prompt.service.ts as live files under domain/user/, each carrying a TODO: remove after Step 9 marker. Both files are deleted by this diff, so the canonical layout diagram now describes a directory that does not exist. P7 scope item 1 covers ARCHITECTURE.md's "Conversation Context" and "LLM Integration" sections and the module layout, but P7 depends on P4/P6 — the tree misleads every agent for six phases, and the fix here is deleting two lines.`
   — **Closed**: both lines removed from the module-layout tree. Two further inaccuracies in
   the same block were corrected while there: `registration.validation.ts` was shown under a
   `validation/` subdirectory that does not exist (it lives in `services/`), and `domain/ai/`
   was missing `types.ts`, added by this plan. The `ports.ts` TODO marker was re-worded from
   "after Step 9" (a step numbering no longer in use) to "in refactor P1", which is where
   `LLM_CORE_REFACTOR_PLAN.md` actually retires it.
3. `blocking | R4 | docs/ARCHITECTURE.md:128 | DOCUMENTATION_GUIDE.md § Context hygiene | The "Interface Organization Principles" section prescribes prompt.ports.ts - Specialized utility contracts as a required member of the domain/*/ports/ modular structure. This is a live prescriptive rule (not a historical record), so after the deletion it instructs the next agent to recreate the file this plan removed.`
   — **Closed**: the `prompt.ports.ts` bullet removed from the prescriptive list, so the rule
   no longer instructs the next agent to recreate the deleted file.

### Advisory

None were fixed on this branch; each is offered to `docs/BACKLOG.md` via the `backlog` skill.

- `advisory | R2 | apps/server/src/domain/ai/types.ts:6 + apps/server/src/domain/ai/ports.ts:1 | YAGNI (docs/CONTRIBUTING_AI.md, "Principles & Boundaries") | New 9-line module holding a single 4-line interface, imported by ports.ts sitting next to it; domain/ai/ports.ts is 13 lines and the two could be one file under the 50-line ports rule. Not blocking: the master plan (docs/LLM_CORE_REFACTOR_PLAN.md P0 item 4) explicitly prescribes "move ChatMsg to domain/ai temporarily", and ADR-0013:307 rewrites ports.ts without ChatMsg in P1 — a separate file is the cheaper seam for that deletion.`
- `advisory | R2 | apps/server/src/infra/conversation/conversation-context.service.ts:6,34 | DRY (docs/CONTRIBUTING_AI.md, "Principles & Boundaries") | The in-memory double declares Array<{ role: 'user' | 'assistant'; content: string }> inline and then casts it as ChatMsg[] at line 34, reinventing the ChatMsg shape it imports on line 2. Pre-existing; this branch only retargeted the import. ADR-0013:309 slates the whole class for deletion, so it should not be fixed here.`
- `advisory | R2 | apps/server/src/domain/training/types.ts:269 + apps/server/src/domain/training/session-planning.types.ts:33 | DRY (docs/CONTRIBUTING_AI.md, "Principles & Boundaries") | SessionRecommendation (hand-written interface) and SessionRecommendationSchema (Zod) define the same shape in two places and must be kept in sync by hand; same for RecommendedExercise (types.ts:~255) vs RecommendedExerciseSchema (session-planning.types.ts:6). z.infer from the schema would collapse them. Pre-existing and untouched by the diff.`
- `advisory | R3 | apps/server/src/main/register-infra-services.ts:48 | — | The only runtime-behaviour change in the diff (dropping a DI registration) is covered by no check in AC-1302: type-check/lint/test:unit cannot prove the container still resolves, and the integration suite that loads this module is gated behind RUN_DB_TESTS=1. I verified it manually by invoking registerInfraServices() against .env.test (passes), but the plan's evidence set does not include that proof. A pure-deletion plan touching DI would benefit from npm run test:integration in its verification line.`
- `advisory | R3 | apps/server/src/domain/training/session-planning.types.ts:43 | — | parseSessionPlanningResponse carried non-trivial, untested error-path logic (the "strip an invalid phaseTransition rather than lose the user-facing message" fallback and its droppedPhaseTransition flag). Deleting it is correct — it was dead — but that lenient-parse behaviour is a design decision now recorded nowhere. If P2/P4 reintroduce structured phase-transition parsing, the same edge case will have to be rediscovered.`
- `advisory | R4 | docs/CONTRIBUTING_AI.md:130 | — | The "Adjust Registration Flow / Prompts" recipe tells the agent to edit domain/user/services/prompt.service.ts:1 and domain/user/ports/prompt.ports.ts (also listed at :178 in the Tokens and Ports reference). P7 scope item 3 explicitly reopens CONTRIBUTING_AI.md, so this file has a named owner downstream; the stale paths are a real hazard but not this branch's to fix.`
- `advisory | R4 | docs/features/FEAT-0006-registration-data-collection.md:20 | — | Marked Status: ✅ Implemented while describing PromptService.buildUnifiedRegistrationPrompt(user) as the live registration prompt mechanism (also :38, :77, :83-84, :324, :346, :348). The method was already a stub returning '' before this diff, so the spec was drifting before the branch; the deletion only makes it unambiguous. FEAT-0003:354/357 has the same rot in its service-dependency tree. P7 item 1 names FEAT-0003 but not FEAT-0006.`
- `advisory | R4 | docs/CONVERSATION_CONTEXT_ARCHITECTURE.md:58 | — | Says "ChatMsg already exists in domain/user/ports (prompt.ports.ts) — reuse it or re-export from a shared place". The diff performs exactly the "shared place" the sentence recommends (@domain/ai/types), so the doc now records the open question rather than the answer. P7 item 1 archives this whole file to docs/archive/, which is why this is not blocking.`
- `advisory | R4 | docs/CHAT_PHASE_JSON_FIX.md:32 | — | A one-off fix note describing edits to prompt.service.ts buildChatSystemPrompt(), now a file that does not exist. It is a root-level docs/ file governed by no document type in DOCUMENTATION_GUIDE § Structure and owned by no phase — a candidate for docs/archive/ alongside CONVERSATION_CONTEXT_ARCHITECTURE.md in P7.`

### Advisories raised by the re-run

- `advisory | R4 | docs/adr/0002-interface-organization-principles.md:32,40,107 | — | The fix removed prompt.ports.ts from ARCHITECTURE.md's prescriptive Interface Organization Principles, but ADR-0002 — the ADR that ARCHITECTURE.md:298 names as the source of that very rule — still prescribes the identical four-file structure including prompt.ports.ts in its Decision section (:32 tree, :40 organization principles). The two statements of one rule have now diverged. ADR-0002's "Implementation Status" block (:107) recording the historical four-file layout is correct-by-design per DOCUMENTATION_GUIDE:17; the Decision section at :32/:40 is the forward-looking half and is the divergent part. Not blocking: ADR-0002 is a durable spec, and editing it is R1's territory and the owner's call per SUPERPOWERS_INTEGRATION rule 3 (escalation, never silent edits) — the branch was right not to touch it.`
- `advisory | R4 | docs/ARCHITECTURE.md:129 | — | The surviving "Backward Compatibility: Main ports.ts re-exports from modular structure" bullet in the same edited list is now false for every domain: neither domain/user/ports.ts nor domain/training/ports.ts exists — the modular ports/ directory with an index.ts barrel is the only structure. Pre-existing (not introduced by this diff), and the fix commit narrowed the list without inheriting responsibility for the untouched sibling bullet.`

### Re-run verdict

Zones R1 and R4 were re-run after the fix commit (`7b34e937`); R2 and R3 were not, as the fix
touched no code they read. **Verdict: clean.**

- R4 confirmed all three blocking findings closed, verified against the filesystem rather than
  against the closure claims: the deleted doc's entire subject API has zero references in
  `apps/server`; every path remaining in the module tree resolves; the prescriptive list now
  names exactly the three files that exist. It re-confirmed the eight earlier advisories are
  still present and were not silently altered by the fix.
- R1 judged the `docs/ARCHITECTURE.md` edit a legitimate discharged escalation rather than a
  silent durable-spec edit, on all three tests of `SUPERPOWERS_INTEGRATION.md` rule 3: the
  finding was surfaced to the owner and fixed on their instruction, the change is recorded in
  the open in a purpose-titled commit and in this section, and no `AC-`/`BR-`/`INV-`/`S-` ID
  was touched. It added the substantive point that leaving the deleted files listed would have
  put `ARCHITECTURE.md` in contradiction with `LLM_CORE_REFACTOR_PLAN.md` P0 item 4 and
  ADR-0013, both of which ordered the deletion — so refusing the reconciliation would itself
  have been the violation.

### Zones reporting clean

R1 (architecture), R2 (duplication), R3 (correctness) each returned no blocking findings.
R3 re-executed every AC-1302 check independently and confirmed the plan's recorded numbers,
additionally verifying that the test file set is byte-identical between base and HEAD — so
240/240 is a like-for-like baseline, not a count preserved by deleting tests.

## Close-out

Follow `superpowers:finishing-a-development-branch`. Before merge: run the `close-out-review` skill, tick every checkbox above, set `- Status: done` in this file's header, run `node scripts/state.mjs --write` from the repo root, and commit. `node scripts/state.mjs --check` must pass.
