# Ports Layout Consistency Implementation Plan

- Status: planned
- Branch:
- After: refactor-p0-eval-harness

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One rule for port file layout, one source for it, the code aligned to it, and a lint rule that keeps it that way.

**Architecture:** The rule is stated once, in `docs/ARCHITECTURE.md` § Interface Organization Principles (owner-approved 2026-09-13). ADR-0002 stays historical. Three of four domains already follow the rule; this plan removes the four outliers and makes the one machine-checkable clause (entry point via `index.ts`) enforced by ESLint rather than by review.

**Spec:** `docs/ARCHITECTURE.md` § Interface Organization Principles (rewritten in Task 1). ADR-0002 is historical context only.

**Acceptance criteria:** No `*.ports.ts` outside a `ports/` directory; every `ports/` directory has an `index.ts`; no port file over 50 lines; no import reaches past `index.ts`; `npm run lint` fails if any of the last clause is violated.

## Global Constraints

- **Type-only refactor.** No behavioural change. Every moved interface keeps its name and shape; only file paths and import specifiers change.
- **`domain/ai/ports.ts` is out of scope** — `ARCHITECTURE.md:45` marks it `TODO: remove in refactor P1`. Rewriting it now only to delete it in P1 is waste. Task 1's rule text notes it as a known, time-boxed exception.
- Verification commands run from `apps/server/`.
- Commit messages carry no attribution lines.

---

### Task 1: Write the rule as the single source

The rule text below is owner-approved verbatim. Replace the existing section; do not paraphrase.

**Files:**
- Modify: `docs/ARCHITECTURE.md` § Interface Organization Principles

- [ ] **Step 1: Replace the section**

Replace the whole `### Interface Organization Principles` section with:

```markdown
### Interface Organization Principles

This section is the single source of this rule. ADR-0002 records why the monolithic
`ports.ts` was split; its Decision section is historical and is not the current spec.

1. **Location.** Every domain port lives in `domain/<domain>/ports/`. No port file
   exists outside that directory — including sub-packages such as `graph/`.
2. **Naming by contract, not by layer.** A file name answers "a contract for what":
   `embedding.ports.ts`, `conversation-run.ports.ts`, `workout-plan.ports.ts`.
   Layer names (`repository.ports.ts`, `service.ports.ts`) are allowed only while a
   domain has exactly one such contract; once there are several, split by meaning.
3. **Size.** A port file stays under 50 lines. Outgrowing that is the signal that it
   holds more than one contract — split it per rule 2.
4. **One entry point.** Every `ports/` directory has an `index.ts` re-exporting its
   files, and imports always address the directory (`@domain/training/ports`).
   Importing a file past `index.ts` is forbidden and is enforced by ESLint.
5. **No flat `ports.ts`.** A single contract still gets a directory with an `index.ts`.

Known exception: `domain/ai/ports.ts` is scheduled for removal in refactor P1
(`ARCHITECTURE.md` § LLM layer) and is deliberately left flat until then.
```

- [ ] **Step 2: Commit**

```bash
git add ../../docs/ARCHITECTURE.md
git commit -m "docs(architecture): make the ports layout rule the single source"
```

---

### Task 2: Delete the dead container port

`domain/ports/container.ports.ts` exports `IContainer` and `CONTAINER_TOKEN`. Neither is
imported anywhere in `src/` or `tests/` — verified 2026-09-13. It is dead code, and rule 1
would otherwise require giving a dead file an `index.ts`.

**Files:**
- Delete: `apps/server/src/domain/ports/container.ports.ts` (and the now-empty `domain/ports/`)

- [ ] **Step 1: Re-verify it is dead before deleting**

Run: `grep -rn "container.ports\|IContainer\|CONTAINER_TOKEN" src tests`
Expected: hits only inside `src/domain/ports/container.ports.ts` itself. **If anything else
appears, STOP** and report — the file is live and needs a `ports/` home instead.

- [ ] **Step 2: Delete and verify the build**

```bash
git rm src/domain/ports/container.ports.ts
npm run type-check
```
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git commit -m "refactor(domain): remove unused IContainer port"
```

---

### Task 3: Move the conversation graph port into ports/

`domain/conversation/graph/conversation.graph.ports.ts` violates rule 1. Two files import it.

**Files:**
- Create: `apps/server/src/domain/conversation/ports/conversation-graph.ports.ts`
- Delete: `apps/server/src/domain/conversation/graph/conversation.graph.ports.ts`
- Modify: `apps/server/src/domain/conversation/ports/index.ts`
- Modify: `apps/server/src/app/types/fastify.d.ts:1`, `apps/server/src/main/bootstrap.ts:8`

- [ ] **Step 1: Move the file**

`git mv` it to `src/domain/conversation/ports/conversation-graph.ports.ts`. Its import of
`./conversation.state` becomes `../graph/conversation.state`.

- [ ] **Step 2: Re-export it**

Add to `src/domain/conversation/ports/index.ts`:

```typescript
export * from './conversation-graph.ports';
```

- [ ] **Step 3: Update the two importers**

Both now import `ICompiledConversationGraph` from `@domain/conversation/ports`.

- [ ] **Step 4: Verify**

Run: `npm run type-check && npm run test:unit`
Expected: both clean.

- [ ] **Step 5: Commit**

```bash
git commit -am "refactor(conversation): move the graph port into ports/"
```

---

### Task 4: Split training's oversized port files by contract

`training/ports/repository.ports.ts` (105 lines, 6 exports) and `service.ports.ts`
(129 lines, 7 exports) break rules 2 and 3. Split by meaning; `index.ts` keeps every
existing import working unchanged.

**Files:**
- Create: `workout-plan.ports.ts`, `exercise.ports.ts`, `workout-session.ports.ts`, `training-service.ports.ts` under `apps/server/src/domain/training/ports/`
- Delete: `repository.ports.ts`, `service.ports.ts`
- Modify: `apps/server/src/domain/training/ports/index.ts`

Target split — keep each interface verbatim, move only:

| New file | Takes |
|---|---|
| `workout-plan.ports.ts` | `IWorkoutPlanRepository` |
| `exercise.ports.ts` | `ExerciseSearchFilters`, `IExerciseRepository` |
| `workout-session.ports.ts` | `IWorkoutSessionRepository`, `ISessionExerciseRepository`, `ISessionSetRepository` |
| `training-service.ports.ts` | `ITrainingService` and its result types (`CompletedSetDetail`, `AutoCompletedExercise`, `EnsureExerciseResult`, `DeletedSetDetail`, `DeletedSetsResult`, `UpdateSetResult`) |

`embedding.ports.ts` already complies — leave it alone.

- [ ] **Step 1: Create the four files**

Move each interface verbatim with its doc comments. Carry over only the imports each file
actually needs. If a file still exceeds 50 lines after the split, report it rather than
splitting further on your own judgement — `training-service.ports.ts` is the likely case,
and whether `ITrainingService` itself should be decomposed is a design question for the owner.

- [ ] **Step 2: Rewrite index.ts**

```typescript
export * from './embedding.ports';
export * from './exercise.ports';
export * from './training-service.ports';
export * from './workout-plan.ports';
export * from './workout-session.ports';
```

- [ ] **Step 3: Fix the two bypassing imports**

`domain/training/services/session-planning-context.builder.ts:1` and
`domain/training/services/training.service.ts:17` import past `index.ts`. Both become
`@domain/training/ports`.

- [ ] **Step 4: Verify nothing else bypasses**

Run: `grep -rn "@domain/[a-z]*/ports/" src tests`
Expected: no output.

- [ ] **Step 5: Verify the build**

Run: `npm run type-check && npm run test:unit && npm run lint`
Expected: all clean.

- [ ] **Step 6: Commit**

```bash
git commit -am "refactor(training): split port files by contract"
```

---

### Task 5: Enforce rule 4 with ESLint

Rule 4 is the one clause a machine can check. Without it the layout drifts back.

**Files:**
- Modify: `apps/server/eslint.config.js`

- [ ] **Step 1: Add the restriction**

Add to the existing `no-restricted-imports` configuration (do not create a second block —
follow how the import-boundary rules are already expressed there):

```javascript
{
  group: ['@domain/*/ports/*', '**/domain/*/ports/*'],
  message: 'Import ports through the directory index (@domain/<domain>/ports), not a file inside it — ARCHITECTURE.md § Interface Organization Principles rule 4.',
},
```

Make sure the pattern does not match the `index.ts` re-exports inside `ports/` itself;
if it does, scope the rule so files under `domain/*/ports/` are exempt.

- [ ] **Step 2: Prove it fires**

Temporarily change one import back to `@domain/training/ports/exercise.ports`, run
`npm run lint`, confirm the error names rule 4, then revert the change.
Paste the error text into the PR description.

- [ ] **Step 3: Verify the repo is clean**

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git commit -am "lint: forbid importing ports past the directory index"
```

---

### Task 6: Final consistency sweep

- [ ] **Step 1: Assert every acceptance criterion**

```bash
# no port file outside a ports/ directory
find src -name '*.ports.ts' -not -path '*/ports/*'
# every ports/ directory has an index.ts
for d in $(find src -type d -name ports); do test -f "$d/index.ts" || echo "MISSING index.ts: $d"; done
# no port file over 50 lines
find src -path '*/ports/*.ts' -not -name index.ts -exec sh -c 'n=$(wc -l < "$1"); [ "$n" -gt 50 ] && echo "$1: $n lines"' _ {} \;
# nothing bypasses index.ts
grep -rn "@domain/[a-z]*/ports/" src tests
```

Expected: the first, second and fourth produce no output. The third may name
`training-service.ports.ts` only — record the measured line count in the plan's
Execution notes as a known, owner-visible exception; `src/domain/ai/ports.ts` is
excluded by the rule's stated P1 exception.

- [ ] **Step 2: Full verification**

Run: `npm run type-check && npm run lint && npm run test:unit`
Expected: all clean.

- [ ] **Step 3: Commit any remaining fixes**

---

## Execution notes

- Task 4 / Task 6 Step 1: `src/domain/training/ports/training-service.ports.ts` measures **129 lines** —
  over the 50-line rule 3. Whether `ITrainingService` (16 methods) itself should be decomposed is an
  open owner design question; the file was deliberately not split further. Owner-pending exception.
- Task 5 Step 2: rule 4 fires (verified by temporarily importing `@domain/training/ports/exercise.ports`):
  `error '@domain/training/ports/exercise.ports' import is restricted from being used by a pattern. Import ports through the directory index (@domain/<domain>/ports), not a file inside it — ARCHITECTURE.md § Interface Organization Principles rule 4  no-restricted-imports`
- Task 5 discovery: the `lint` script (`eslint src/**/*.ts`, unquoted) relies on shell globbing where
  `**` collapses to `*` — `npm run lint` only checks `src/<dir>/<file>.ts` (two levels). Quoting the glob
  surfaces ~352 pre-existing errors repo-wide (including `../graph/conversation.state` in
  `conversation-graph.ports.ts` — the Task 3 import — against the pre-existing `../**` restriction).
  Left as-is; fixing the script is an owner decision. Rule 4 is enforced on any file eslint actually
  lints (per-file runs, IDE, and once the glob is fixed).

## Close-out

Follow `superpowers:finishing-a-development-branch`. Before merge: run the `close-out-review`
skill (review subagents on a different model than the implementer), tick every checkbox above,
set `- Status: done`, run `node scripts/state.mjs --write` from the repo root, and commit.
`node scripts/state.mjs --check` must pass. Blocking findings return to the owner for a
decision — the implementing agent does not self-clear them.
