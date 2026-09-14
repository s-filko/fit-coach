# Lint Glob Fix Implementation Plan

- Status: in progress
- Branch: plan/lint-glob-fix

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `npm run lint` (in `apps/server`) actually check all 137 `.ts` files under `src/` instead of the 7 it silently checks today, and get it to a clean pass (0 errors) at the new, true scope.

**Architecture:** The `lint`/`lint:fix` scripts in `apps/server/package.json` pass an unquoted glob (`eslint src/**/*.ts`) to npm, which runs scripts through `sh`. In `sh`, `**` is not a recursive-glob operator (that's a bash `globstar` feature) — it collapses to the same as `*`, so the shell expands the pattern to 7 depth-2 files before eslint ever sees it. `format`/`format:check` already quote their globs (`'src/**/*.ts'`) and are unaffected. The fix is: (1) quote the glob so eslint itself does the recursive expansion, (2) exclude `src/infra/db/scripts/` from eslint (it's deliberately excluded from `tsconfig.json` — standalone maintenance scripts, not part of the build — and eslint's type-aware parser fails on files outside the TS project), (3) run `eslint --fix` to mechanically clear the auto-fixable subset, (4) hand-fix the remainder. Warnings (650, mostly `space-before-function-paren`, `no-magic-numbers`, `boundaries/element-types`) are explicitly out of scope for this plan — see Global Constraints.

**Tech Stack:** ESLint 9 flat config (`typescript-eslint`), npm scripts, TypeScript, Jest.

**Spec:** `docs/BACKLOG.md` Findings — "`npm run lint` inspects ~5% of `src/`" (close-out-review R1/R3 + owner-verified measurement, 2026-09-14). No separate spec doc; this plan promotes that backlog finding directly (owner-approved scope: fix the glob, fix all 61 errors, run `--fix` for the mechanically auto-fixable subset of the 650 warnings, leave the rest of the warnings for a future task).

## Global Constraints

- Do not touch the 650 ESLint **warnings** beyond what `eslint --fix` clears automatically. Warnings needing real refactoring judgment (`max-lines-per-function`, `complexity`, `no-explicit-any`, `boundaries/element-types` warnings in test files, etc.) are out of scope — do not hand-fix any warning.
- Do not change prompt template string *content* (the text fed to the LLM) to satisfy `max-len` — use a scoped `eslint-disable-next-line max-len` comment instead. Prompt text is behavior-sensitive; reflowing it is a content change, not a lint fix.
- Do not invent a new architectural abstraction (e.g. a new domain port) to resolve the `boundaries/element-types` violation in `chat.routes.ts`. `src/infra/ai/run-metrics.ts` is documented in its own file header as a temporary P3-bound module ("Temporary home: P3 moves this into the `commit` node's run context"), and there is already a separate backlog finding about this exact file's binding contract. Use a scoped, commented `eslint-disable-next-line boundaries/element-types` referencing that context instead of redesigning it now.
- Every task must end with `npm run lint` (in `apps/server`) showing a strictly lower error count than before the task, and the final task must end at **0 errors**. Warning count must not increase from what Task 2's `--fix` leaves it at.
- Do not run `eslint --fix` more than once (Task 2) — later tasks fix remaining errors by hand so each fix is reviewable.
- Run all commands from `apps/server/` (the `lint` script lives in `apps/server/package.json`).

---

## Task 1: Quote the lint globs and exclude `db/scripts/` from ESLint

**Files:**
- Modify: `apps/server/package.json:41-42`
- Modify: `apps/server/eslint.config.js:270-277` (the trailing `ignores` block)

**Interfaces:**
- Consumes: nothing (first task)
- Produces: `npm run lint` now expands to all `src/**/*.ts` files; `src/infra/db/scripts/**` is excluded from linting (mirrors its `tsconfig.json` `exclude` entry) so it no longer throws a type-aware-parser error.

- [x] **Step 1: Confirm current (broken) scope**

Run: `cd apps/server && npm run lint 2>&1 | tail -5`
Expected output ends with something like `7 problems` or a small number — confirms the glob is currently under-matching (today's baseline: 0 errors, a handful of warnings, only 7 files touched).

- [x] **Step 2: Quote the globs in package.json**

In `apps/server/package.json`, change:

```json
    "lint": "eslint src/**/*.ts",
    "lint:fix": "eslint src/**/*.ts --fix",
```

to:

```json
    "lint": "eslint 'src/**/*.ts'",
    "lint:fix": "eslint 'src/**/*.ts' --fix",
```

- [x] **Step 3: Exclude `src/infra/db/scripts/` in eslint.config.js**

`src/infra/db/scripts/` is deliberately excluded from `tsconfig.json`'s `include` (see `apps/server/tsconfig.json:23`, `"exclude": ["node_modules", "dist", "src/infra/db/scripts"]`) — these are three standalone maintenance scripts, not part of the built app. ESLint's type-aware parser (`parserOptions.project: true`) throws a parse error on any file outside the TS project, so it must be excluded from lint too, matching tsconfig's existing intent.

In `apps/server/eslint.config.js`, change the trailing block:

```js
  {
    ignores: [
      'dist/',
      'node_modules/',
      'coverage/',
      '*.js',
      '*.d.ts',
      'jest.config.cjs',
    ],
  }
);
```

to:

```js
  {
    ignores: [
      'dist/',
      'node_modules/',
      'coverage/',
      '*.js',
      '*.d.ts',
      'jest.config.cjs',
      'src/infra/db/scripts/',
    ],
  }
);
```

- [x] **Step 4: Verify the new scope and count**

Run: `cd apps/server && npm run lint 2>&1 | tail -5`
Expected: `✖ 711 problems (61 errors, 650 warnings)` (or close to it — a handful may drift if other work landed since this plan was written; the important thing is it's now in the hundreds, not single digits, and the 3 `src/infra/db/scripts/*.ts` parse errors are gone).

- [x] **Step 5: Commit**

```bash
git add apps/server/package.json apps/server/eslint.config.js
git commit -m "fix(lint): quote lint globs so npm actually expands src/**/*.ts"
```

---

## Task 2: Run `eslint --fix` to clear the mechanically auto-fixable fallout

**Files:**
- Modify: all files under `apps/server/src/**/*.ts` that `--fix` touches (do not hand-pick — let eslint decide; expect ~69 files, e.g. import-order reshuffles, `curly` brace insertion, `space-before-function-paren` spacing, `sort-imports` reordering)

**Interfaces:**
- Consumes: Task 1's now-correct lint scope
- Produces: error count drops from 61 to ~22 (the remainder Task 3+ fix by hand); warning count drops from 650 to ~395

- [x] **Step 1: Run the autofixer**

Run: `cd apps/server && npm run lint:fix`
This will still exit non-zero (unfixable errors remain) — that's expected, don't treat a non-zero exit as failure here.

- [x] **Step 2: Review the diff for anything unexpected**

Run: `cd apps/server && git diff --stat src/`
Expected: many files touched (~69), all mechanical (import reordering, brace insertion, spacing). Skim `git diff src/` for anything that looks like a semantic change rather than a style fix — `eslint --fix` should never change runtime behavior, but confirm no accidental match (e.g. `prefer-destructuring` autofix is not in this run's autofix set, so no destructuring changes should appear).

- [x] **Step 3: Run the test suite to confirm no behavior changed**

Run: `cd apps/server && npm test`
Expected: same pass/fail state as before Task 1 (no new failures introduced by the reformatting).

- [x] **Step 4: Verify new counts**

Run: `cd apps/server && npm run lint 2>&1 | tail -3`
Expected: `✖ 420 problems (25 errors, 395 warnings)` or close — confirms the mechanical fixes landed and ~36 fewer errors, ~255 fewer warnings remain than Task 1's baseline.

- [x] **Step 5: Commit**

```bash
git add -A apps/server/src
git commit -m "style(lint): apply eslint --fix for the newly-linted src/ tree"
```

---

## Task 3: Fix remaining `no-unused-vars` and `no-duplicate-imports` errors

**Files:**
- Modify: `apps/server/src/infra/db/schema.ts:13` (remove unused `serial` import)
- Modify: `apps/server/src/infra/conversation/conversation-context.service.ts:53`
- Modify: `apps/server/src/infra/ai/graph/conversation.graph.ts:2-3`

**Interfaces:**
- Consumes: Task 2's reduced error set
- Produces: 3 fewer errors (schema.ts unused import, conversation-context.service.ts unused param, conversation.graph.ts duplicate import)

- [x] **Step 1: Remove the unused `serial` import in schema.ts**

In `apps/server/src/infra/db/schema.ts`, the `drizzle-orm/pg-core` import list includes `serial`, which has no usages in the file. Remove it from the import list (keep the rest of the multi-line import as-is, just delete the `serial,` line).

- [x] **Step 2: Verify no other usage before deleting**

Run: `cd apps/server && grep -n '\bserial(' src/infra/db/schema.ts`
Expected: no output (confirms it's genuinely unused, not just unused by that exact token match).

- [x] **Step 3: Handle the unused `_userId` param in conversation-context.service.ts**

`InMemoryConversationContextService` (marked `// TODO: remove — in-memory implementation kept only for tests` at the top of the file) implements `IConversationContextService.getLastUserMessageTime(userId: string)`, but the in-memory stub never uses the parameter. The project's `no-unused-vars` config deliberately forbids the underscore-prefix escape hatch in production code (`argsIgnorePattern: '(^$)'` in `eslint.config.js`), so add a scoped disable instead of renaming.

In `apps/server/src/infra/conversation/conversation-context.service.ts`, change:

```ts
  async getLastUserMessageTime(_userId: string): Promise<Date | null> {
    return null;
  }
```

to:

```ts
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- interface param, unused by this in-memory test stub
  async getLastUserMessageTime(userId: string): Promise<Date | null> {
    return null;
  }
```

- [x] **Step 4: Merge the duplicate `@langchain/langgraph` import in conversation.graph.ts**

In `apps/server/src/infra/ai/graph/conversation.graph.ts`, lines 2-3 currently read:

```ts
import { Command, END, START, StateGraph } from '@langchain/langgraph';
import type { BaseCheckpointSaver } from '@langchain/langgraph';
```

Merge into a single import statement (keep `type` scoped to just the type-only member via inline `type` modifier, since `Command`/`END`/`START`/`StateGraph` are runtime values):

```ts
import { Command, END, START, StateGraph, type BaseCheckpointSaver } from '@langchain/langgraph';
```

- [x] **Step 5: Verify the file still type-checks**

Run: `cd apps/server && npx tsc --noEmit`
Expected: no new errors introduced by the import merge.

- [x] **Step 6: Verify error count dropped by 3**

Run: `cd apps/server && npm run lint 2>&1 | tail -3`
Expected: error count down to ~22 from Task 2's ~25.

- [x] **Step 7: Commit**

```bash
git add apps/server/src/infra/db/schema.ts apps/server/src/infra/conversation/conversation-context.service.ts apps/server/src/infra/ai/graph/conversation.graph.ts
git commit -m "fix(lint): remove unused imports/params, merge duplicate langgraph import"
```

---

## Task 4: Fix `no-unsafe-assignment` in the two `.catch(err => ...)` callbacks

**Files:**
- Modify: `apps/server/src/infra/ai/graph/conversation.graph.ts` (the `generatePhaseSummary(...).catch(err => ...)` call, near what was line 126 before Task 2's reformatting — search for it)
- Modify: `apps/server/src/infra/ai/graph/nodes/router.node.ts` (the `generatePhaseSummary(...).catch(err => ...)` call, near what was line 56 before Task 2's reformatting — search for it)

**Interfaces:**
- Consumes: Task 3's reduced error set
- Produces: 2 fewer errors; both catch callbacks now type their caught value as `unknown` instead of implicit `any`

- [x] **Step 1: Locate and fix conversation.graph.ts**

Run: `cd apps/server && grep -n 'generatePhaseSummary(contextService, userId, phase, config).catch' src/infra/ai/graph/conversation.graph.ts`

Change:

```ts
    generatePhaseSummary(contextService, userId, phase, config).catch(err =>
      log.error({ err, userId, phase }, 'Background phase summary failed'),
    );
```

to:

```ts
    generatePhaseSummary(contextService, userId, phase, config).catch((err: unknown) =>
      log.error({ err, userId, phase }, 'Background phase summary failed'),
    );
```

- [x] **Step 2: Locate and fix router.node.ts**

Run: `cd apps/server && grep -n "generatePhaseSummary(contextService, userId, 'training', config).catch" src/infra/ai/graph/nodes/router.node.ts`

Change:

```ts
        generatePhaseSummary(contextService, userId, 'training', config).catch(err =>
          log.error({ err, userId }, 'Background phase summary (training→chat) failed'),
        );
```

to:

```ts
        generatePhaseSummary(contextService, userId, 'training', config).catch((err: unknown) =>
          log.error({ err, userId }, 'Background phase summary (training→chat) failed'),
        );
```

- [x] **Step 3: Verify logger accepts `unknown` in the metadata object**

Run: `cd apps/server && npx tsc --noEmit`
Expected: no new type errors. `log.error(meta, msg)` takes an arbitrary metadata object (pino-style), so a field typed `unknown` inside it is fine.

- [x] **Step 4: Verify error count dropped by 2**

Run: `cd apps/server && npm run lint 2>&1 | tail -3`
Expected: error count down to ~20.

- [x] **Step 5: Commit**

```bash
git add apps/server/src/infra/ai/graph/conversation.graph.ts apps/server/src/infra/ai/graph/nodes/router.node.ts
git commit -m "fix(lint): type catch(err) as unknown to satisfy no-unsafe-assignment"
```

---

## Task 5: Fix `prefer-destructuring` in persist.node.unit.test.ts

**Files:**
- Modify: `apps/server/src/infra/ai/graph/nodes/__tests__/persist.node.unit.test.ts`

**Interfaces:**
- Consumes: Task 4's reduced error set
- Produces: 2 fewer errors

- [x] **Step 1: Locate both flagged lines**

Run: `cd apps/server && grep -n 'mock.calls\[0\]\[0\]' src/infra/ai/graph/nodes/__tests__/persist.node.unit.test.ts`

Both are of the form:

```ts
    const record = runService.recordRun.mock.calls[0][0];
```

`prefer-destructuring` flags `[0]` array-index access that could be destructuring. Change each to:

```ts
    const [[record]] = runService.recordRun.mock.calls;
```

- [x] **Step 2: Run the affected test file**

Run: `cd apps/server && npx jest src/infra/ai/graph/nodes/__tests__/persist.node.unit.test.ts`
Expected: all tests in the file still pass — `record` still refers to the same first-call-first-arg object.

- [x] **Step 3: Verify error count dropped by 2**

Run: `cd apps/server && npm run lint 2>&1 | tail -3`
Expected: error count down to ~18.

- [x] **Step 4: Commit**

```bash
git add apps/server/src/infra/ai/graph/nodes/__tests__/persist.node.unit.test.ts
git commit -m "fix(lint): destructure mock.calls access instead of index chaining"
```

---

## Task 6: Fix `max-len` on prompt-template and long-condition lines

**Files:**
- Modify: `apps/server/src/domain/training/services/prompts/session-recommendation.prompt.ts` (line near 118, in the prompt template string)
- Modify: `apps/server/src/domain/training/services/training.service.ts` (three lines near 208, 651, 659 — inside template-literal prompt strings)
- Modify: `apps/server/src/infra/ai/graph/nodes/phase-summary.node.ts` (two lines near 12, 42 — inside the `SUMMARY_SYSTEM_PROMPT` template string and the `userPrompt` construction)
- Modify: `apps/server/src/infra/ai/graph/tools/timezone.tool.ts` (one line near 27, a plain string return)

**Interfaces:**
- Consumes: Task 5's reduced error set
- Produces: 7 fewer errors

All 7 flagged lines are either LLM prompt content (template literals whose exact text is behavior-sensitive — see Global Constraints) or a long single-line string. Do not reflow or rewrap any of them — that changes the string's content/whitespace. Add a scoped disable comment on the line immediately before each flagged line instead.

- [x] **Step 1: Re-run lint to get exact current line numbers**

Line numbers shift after Tasks 2-5's edits. Get fresh locations:

Run: `cd apps/server && npm run lint 2>&1 | grep -B1 "max-len"`

- [x] **Step 2: Add `eslint-disable-next-line max-len` above each of the 7 flagged lines**

For each location found in Step 1, insert the comment line directly above the offending line, matching the file's existing indentation. Example for `timezone.tool.ts`:

```ts
      if (!isValidTimezone(input.timezone)) {
        // eslint-disable-next-line max-len -- error message text, not reflowable without changing the string
        return `Invalid timezone: "${input.timezone}". Please provide a valid IANA timezone like "Europe/Berlin" or "America/New_York".`;
      }
```

Apply the same pattern (disable comment + short reason referencing "prompt content" or "message text, not reflowable") to the other 6 lines in `session-recommendation.prompt.ts`, `training.service.ts` (×3), and `phase-summary.node.ts` (×2).

- [x] **Step 3: Confirm no string content changed**

Run: `cd apps/server && git diff src/domain/training/services/prompts/session-recommendation.prompt.ts src/domain/training/services/training.service.ts src/infra/ai/graph/nodes/phase-summary.node.ts src/infra/ai/graph/tools/timezone.tool.ts`
Expected: every diff hunk adds exactly one comment line, zero changes inside string literals.

- [x] **Step 4: Run the test suite**

Run: `cd apps/server && npm test`
Expected: same pass/fail state as before this task (prompt strings are byte-identical).

- [x] **Step 5: Verify error count dropped by 7**

Run: `cd apps/server && npm run lint 2>&1 | tail -3`
Expected: error count down to ~11.

- [x] **Step 6: Commit**

```bash
git add apps/server/src/domain/training/services/prompts/session-recommendation.prompt.ts apps/server/src/domain/training/services/training.service.ts apps/server/src/infra/ai/graph/nodes/phase-summary.node.ts apps/server/src/infra/ai/graph/tools/timezone.tool.ts
git commit -m "fix(lint): suppress max-len on prompt-content and message-text lines"
```

---

## Task 7: Fix `stamp-baseline.ts` — type the `pg` query results, suppress `no-console`

**Files:**
- Modify: `apps/server/src/infra/db/stamp-baseline.ts`

**Interfaces:**
- Consumes: Task 6's reduced error set
- Produces: 7 fewer errors (4 `no-unsafe-member-access`, 3 `no-console`) — this is the last file with errors, bringing the count to 0

- [x] **Step 1: Read the current state of the function**

Run: `cd apps/server && grep -n "client.query\|console\." src/infra/db/stamp-baseline.ts`

- [x] **Step 2: Add generic row types to the two untyped `client.query` calls**

`pg`'s `Client.query<T>` accepts a generic for the result row shape. Find:

```ts
    const existing = await client.query(`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'drizzle' AND table_name = '__drizzle_migrations'
      ) AS present;
    `);
```

Change to:

```ts
    const existing = await client.query<{ present: boolean }>(`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'drizzle' AND table_name = '__drizzle_migrations'
      ) AS present;
    `);
```

Find:

```ts
      const count = await client.query('SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations;');
```

Change to:

```ts
      const count = await client.query<{ n: number }>('SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations;');
```

Find the third query (the `information_schema.tables` count):

```ts
    const tables = await client.query(`
      SELECT count(*)::int AS n FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name NOT LIKE 'checkpoint%';
    `);
```

Change to:

```ts
    const tables = await client.query<{ n: number }>(`
      SELECT count(*)::int AS n FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name NOT LIKE 'checkpoint%';
    `);
```

This removes all 4 `no-unsafe-member-access` errors: `existing.rows[0].present`, `count.rows[0].n` (×2), `tables.rows[0].n` are now typed instead of `any`.

- [x] **Step 3: Suppress `no-console` on the 3 flagged lines**

This file is a CLI migration-stamping script (invoked by `scripts/stamp-baseline.ts`, outside `src/`) — console output is its intended UX, not a stray debug statement, and it's the only file in `src/` using `console`. Add a scoped disable above each of the 3 `console.log` calls, e.g.:

```ts
        // eslint-disable-next-line no-console -- CLI script progress output
        console.log(`Migration history already present (${count.rows[0].n} rows) — nothing to stamp.`);
```

Apply the same pattern to the other two `console.log` calls in the file (the "Empty database — skipping stamp" line and the "Stamped N migration(s)" line).

- [x] **Step 4: Run the file's unit test**

Run: `cd apps/server && npx jest src/infra/db/__tests__/stamp-baseline.unit.test.ts`
Expected: passes (this test covers `hashMigration`/`migrationsThrough`, not the DB-touching `stampBaseline` function, so the type changes shouldn't affect it — but confirm).

- [x] **Step 5: Type-check**

Run: `cd apps/server && npx tsc --noEmit`
Expected: no new errors.

- [x] **Step 6: Verify error count dropped to 4 (only the boundaries violation left)**

Run: `cd apps/server && npm run lint 2>&1 | tail -3`
Expected: `✖ ... problems (1 errors, ... warnings)` — only the `chat.routes.ts` boundaries violation remains (Task 8).

- [x] **Step 7: Commit**

```bash
git add apps/server/src/infra/db/stamp-baseline.ts
git commit -m "fix(lint): type pg query results, suppress no-console in CLI stamping script"
```

---

## Task 8: Suppress the `boundaries/element-types` violation in chat.routes.ts

**Files:**
- Modify: `apps/server/src/app/routes/chat.routes.ts`

**Interfaces:**
- Consumes: Task 7's reduced error set (down to 1)
- Produces: 0 errors remaining — `npm run lint` exits 0 for errors

- [x] **Step 1: Confirm the violation and its architectural context**

Run: `cd apps/server && grep -n "startRun" src/app/routes/chat.routes.ts src/infra/ai/run-metrics.ts | head -5`

`chat.routes.ts` (an `app`-layer file) imports `startRun` from `@infra/ai/run-metrics` directly. `eslint.config.js`'s `boundaries/element-types` rule forbids `app → infra` (only `app → domain, shared, config` is allowed) — this is a real, intentional architecture rule (ARCHITECTURE.md), not a false positive.

`run-metrics.ts`'s own file header says: *"Temporary home: P3 moves this into the `commit` node's run context"* — it is already documented as a known-temporary module slated for relocation in a future refactor phase. There is a separate, already-recorded backlog finding about this file's contract being duplicated across call sites (`docs/BACKLOG.md` Findings, "The run-metrics binding contract..."). Per this plan's Global Constraints, do not design a new port to fix this now — that decision belongs to whoever picks up the P3/run-metrics backlog item, not to a lint-glob fix.

- [x] **Step 2: Add a scoped, documented suppression**

In `apps/server/src/app/routes/chat.routes.ts`, change:

```ts
import { startRun } from '@infra/ai/run-metrics';
```

to:

```ts
// eslint-disable-next-line boundaries/element-types -- run-metrics.ts is a documented-temporary infra module (see its file header: "Temporary home: P3 moves this into the commit node's run context"); tracked separately in docs/BACKLOG.md Findings ("The run-metrics binding contract...")
import { startRun } from '@infra/ai/run-metrics';
```

- [x] **Step 3: Verify this is the only remaining error**

Run: `cd apps/server && npm run lint 2>&1 | tail -5`
Expected: `✖ NNN problems (0 errors, ~395 warnings)` — exit code reflects errors only (eslint's default exit-on-error behavior means `npm run lint` should now exit 0, since only warnings remain).

- [x] **Step 4: Confirm exit code is 0**

Run: `cd apps/server && npm run lint; echo "exit: $?"`
Expected: `exit: 0`

- [x] **Step 5: Run full test suite one more time**

Run: `cd apps/server && npm test`
Expected: same pass/fail state as the pre-Task-1 baseline — no behavior changed anywhere in this plan, only lint scope and suppressions.

- [x] **Step 6: Commit**

```bash
git add apps/server/src/app/routes/chat.routes.ts
git commit -m "fix(lint): suppress boundaries violation on documented-temporary run-metrics import"
```

---

## Task 9: Update the backlog

**Files:**
- Modify: `docs/BACKLOG.md`

**Interfaces:**
- Consumes: Task 8's clean lint state (0 errors)
- Produces: backlog reflects the promoted item is done; the plan itself is the durable record now

- [x] **Step 1: Delete the promoted Findings entry**

In `docs/BACKLOG.md`, delete the entry starting `- [ ] **\`npm run lint\` inspects ~5% of \`src/\`**:` (currently lines 44-53) — per the backlog skill's promotion rule, a promoted entry's truth now lives in this plan, not the backlog.

- [x] **Step 2: Confirm the separate `evals/` lint-scoping entry is untouched**

Run: `cd /Users/filko/WebstormProjects/fit_coach && grep -n "evals/ is invisible to lint" docs/BACKLOG.md`
Expected: still present — that entry (currently lines ~79-89) covers `apps/server/evals/`, a distinct gap this plan does not address (it only fixes `src/**/*.ts` scoping). Do not delete or modify it.

- [x] **Step 3: Confirm no other backlog entry references the now-fixed 61-errors/650-warnings numbers as current state**

Run: `cd /Users/filko/WebstormProjects/fit_coach && grep -n "61 errors\|650 warnings" docs/BACKLOG.md`
Expected: no output (the only reference was the entry just deleted).

- [x] **Step 4: Commit**

```bash
cd /Users/filko/WebstormProjects/fit_coach
git add docs/BACKLOG.md
git commit -m "docs(backlog): promote lint-glob finding — fixed by plan/lint-glob-fix"
```

---

## Final Verification

- [x] Run: `cd apps/server && npm run lint; echo "exit: $?"` → expect `exit: 0`
- [x] Run: `cd apps/server && npm test` → expect same pass/fail as session start
- [x] Run: `cd apps/server && npx tsc --noEmit` → expect no errors
- [x] Run: `cd apps/server && npm run lint 2>&1 | tail -3` → expect `0 errors`, warning count roughly 395 (down from 650, unchanged since Task 2)
