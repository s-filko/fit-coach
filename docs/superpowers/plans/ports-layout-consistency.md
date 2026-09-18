# Ports Layout Consistency Implementation Plan

- Status: done
- Branch: plan/ports-layout-consistency
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

- [x] **Step 1: Replace the section**

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

- [x] **Step 2: Commit**

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

- [x] **Step 1: Re-verify it is dead before deleting**

Run: `grep -rn "container.ports\|IContainer\|CONTAINER_TOKEN" src tests`
Expected: hits only inside `src/domain/ports/container.ports.ts` itself. **If anything else
appears, STOP** and report — the file is live and needs a `ports/` home instead.

- [x] **Step 2: Delete and verify the build**

```bash
git rm src/domain/ports/container.ports.ts
npm run type-check
```
Expected: clean.

- [x] **Step 3: Commit**

```bash
git commit -m "refactor(domain): remove unused IContainer port"
```

---

### Task 3: Move the conversation graph port into ports/ — ATTEMPTED, REVERTED

**Outcome: the move was made (`53b4e82d`) and reverted during close-out.** The steps below
are kept as the record of what was tried; their ticks mean the work was carried out, not
that the move stands.

Close-out review (R1, R3) found the move traded one rule for a more expensive one:
`conversation.graph.ports.ts` imports `RunnableConfig` from `@langchain/core/runnables` and
transitively depends on `conversation.state.ts` (`@langchain/langgraph`). ADR-0013 §11
forbids `domain/**` importing `@langchain/*` — a recorded INV-CONV-004 violation that D-13
is to repair by relocating those types to `infra/ai`. Moving the contract *into*
`domain/conversation/ports/` placed LangChain types in the surface ADR-0013 reserves for
clean contracts and re-exported them through `index.ts` to every consumer of
`@domain/conversation/ports`. The move also introduced a live ESLint error
(`../graph/conversation.state` against the pre-existing `../**` restriction), masked at the
time by the broken `lint` glob.

Owner decision (2026-09-14): revert the move; the file stays in `graph/` until ADR-0013
D-13. Rule 1 in `ARCHITECTURE.md` now carries the exception clause and names D-13 as the
task that closes it.

`domain/conversation/graph/conversation.graph.ports.ts` violates rule 1. Two files import it.

**Files:**
- Create: `apps/server/src/domain/conversation/ports/conversation-graph.ports.ts`
- Delete: `apps/server/src/domain/conversation/graph/conversation.graph.ports.ts`
- Modify: `apps/server/src/domain/conversation/ports/index.ts`
- Modify: `apps/server/src/app/types/fastify.d.ts:1`, `apps/server/src/main/bootstrap.ts:8`

- [x] **Step 1: Move the file**

`git mv` it to `src/domain/conversation/ports/conversation-graph.ports.ts`. Its import of
`./conversation.state` becomes `../graph/conversation.state`.

- [x] **Step 2: Re-export it**

Add to `src/domain/conversation/ports/index.ts`:

```typescript
export * from './conversation-graph.ports';
```

- [x] **Step 3: Update the two importers**

Both now import `ICompiledConversationGraph` from `@domain/conversation/ports`.

- [x] **Step 4: Verify**

Run: `npm run type-check && npm run test:unit`
Expected: both clean.

- [x] **Step 5: Commit**

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

- [x] **Step 1: Create the four files**

Move each interface verbatim with its doc comments. Carry over only the imports each file
actually needs. If a file still exceeds 50 lines after the split, report it rather than
splitting further on your own judgement — `training-service.ports.ts` is the likely case,
and whether `ITrainingService` itself should be decomposed is a design question for the owner.

- [x] **Step 2: Rewrite index.ts**

```typescript
export * from './embedding.ports';
export * from './exercise.ports';
export * from './training-service.ports';
export * from './workout-plan.ports';
export * from './workout-session.ports';
```

- [x] **Step 3: Fix the two bypassing imports** — three in practice: the unit test
`tests/unit/domain/training/session-planning-context.builder.unit.test.ts:3` also bypassed
the index, and Step 4's grep covers `tests` as well as `src`.

`domain/training/services/session-planning-context.builder.ts:1` and
`domain/training/services/training.service.ts:17` import past `index.ts`. Both become
`@domain/training/ports`.

- [x] **Step 4: Verify nothing else bypasses**

Run: `grep -rn "@domain/[a-z]*/ports/" src tests`
Expected: no output.

- [x] **Step 5: Verify the build**

Run: `npm run type-check && npm run test:unit && npm run lint`
Expected: all clean.

- [x] **Step 6: Commit** — `training-service.ports.ts` is **129 lines**, over the 50-line
rule; reported to the owner rather than split further (whether `ITrainingService`'s 16
methods should be decomposed is a design question). Task 6 Step 1 must record it as a
known exception or the owner must decide to split it.

```bash
git commit -am "refactor(training): split port files by contract"
```

---

### Task 5: Enforce rule 4 with ESLint

Rule 4 is the one clause a machine can check. Without it the layout drifts back.

**Files:**
- Modify: `apps/server/eslint.config.js`

- [x] **Step 1: Add the restriction**

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

- [x] **Step 2: Prove it fires**

Temporarily change one import back to `@domain/training/ports/exercise.ports`, run
`npm run lint`, confirm the error names rule 4, then revert the change.
Paste the error text into the PR description.

- [x] **Step 3: Verify the repo is clean**

Run: `npm run lint`
Expected: no errors.

- [x] **Step 4: Commit**

```bash
git commit -am "lint: forbid importing ports past the directory index"
```

---

### Task 6: Final consistency sweep

- [x] **Step 1: Assert every acceptance criterion**

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

- [x] **Step 2: Full verification**

Run: `npm run type-check && npm run lint && npm run test:unit`
Expected: all clean.

- [x] **Step 3: Commit any remaining fixes**

---

## Close-out

Follow `superpowers:finishing-a-development-branch`. Before merge: run the `close-out-review`
skill (review subagents on a different model than the implementer), tick every checkbox above,
set `- Status: done`, run `node scripts/state.mjs --write` from the repo root, and commit.
`node scripts/state.mjs --check` must pass. Blocking findings return to the owner for a
decision — the implementing agent does not self-clear them.
## Review

`2026-09-14 | blocked → resolved by owner decision | R1,R2,R3,R4`

Four zones ran on independent models, cold contexts, none seeing the others or the
executor's report. Ten blocking findings; R2 clean. No `- Review:` header line is set:
two findings are closed by decision rather than by fix, and the header encodes only a
clean verdict.

**Blocking — fixed on this branch**

1. *R1: LangChain contract moved into the domain port surface.* Task 3 relocated
   `conversation.graph.ports.ts` into `ports/`, where its `@langchain/core` import
   breaks ADR-0013 §11 / INV-CONV-004 and re-exported LangChain to every consumer of
   `@domain/conversation/ports`. **Reverted** (owner decision); rule 1 now carries an
   exception clause naming ADR-0013 D-13 as the task that closes it. See Task 3.
2. *R1, R3: live ESLint error introduced by the branch.* `../graph/conversation.state`
   violated the pre-existing `../**` restriction; the executor's notes called it
   pre-existing, R3 proved otherwise. **Closed by the same revert** — verified with
   `npx eslint` on the restored file.
3. *R1: 129-line `training-service.ports.ts` violating rule 3 declared in the same
   commit.* **Rule 3 rewritten** (owner-approved): size is a signal obliging a review —
   is it all used, is it all in the right place, one reason to change — with three
   permitted outcomes. The review was performed (see below) and the file is recorded as
   a standing exception naming its closing task.
4. *R3: `npm run test:unit` never loaded the one test the branch modified.* Its
   `--testMatch` patterns missed `tests/unit/**`. **Fixed** (`05448424`): a third
   pattern added to `test:unit`, `test:coverage:unit`, `test:watch:unit`; 40 suites /
   294 tests → 42 / 323, all green.
5. *R4: `ARCHITECTURE.md` Import Strategy contradicted its own rule 4.* **Rewritten** to
   defer to rule 4.
6. *R4: the module tree still taught the superseded layout.* **Updated** — `training/ports/`
   enumerated by contract name, `user/ports/` annotated with why layer names remain legal.
7. *R4: `CONTRIBUTING_AI.md:24` prescribed the layer-named files this branch removed.*
   **Rewritten** to defer to the spec (`bfdfa1e8`).
8. *R4: dead reference to `prompt.ports.ts`,* a file that exists nowhere. **Deleted**
   (`bfdfa1e8`).

**Blocking — accepted, not fixed here (owner decision 2026-09-14)**

9. *R3: `npm run lint` is vacuous.* npm runs scripts under `sh`, where the unquoted
   `src/**/*.ts` expands to 7 of 137 files; quoting it surfaces 61 errors. Every "lint
   clean" claim on this branch proves nothing.
10. *R3: rule 4 is documented as ESLint-enforced but no project command exercises it* —
    a consequence of finding 9.

    Both go to `docs/BACKLOG.md` as one task: fixing the glob means clearing 61
    pre-existing errors, which is not this plan's scope (the same reasoning that kept
    finding 9 out of the branch). Until it lands, rule 4 is enforced only by per-file
    runs and the IDE.

**Rule 3 review of `ITrainingService`** (the first application of the new rule)

19 methods, not the 16 the executor's notes claimed. *Is all of it used?* Three methods —
`getNextSessionRecommendation`, `addExerciseToSession`, `logSet` — have zero call sites in
`apps/server`; the latter two are superseded by `logSetWithContext` (11 sites) and
`ensureCurrentExercise` (9). *Is it all in the right place?* The methods split by consumer:
HTTP routes call the planning and lifecycle half, LLM tools call execution and the
correction commands (`deleteLastSets`, `updateLastSet`) that routes never touch — two APIs
in one contract. Outcome: exception recorded, decomposition by role and the dead-method
removal filed in `docs/BACKLOG.md` (the latter gated on checking `apps/webapp` and
`apps/bot`, which this measurement did not cover). Not done here: Global Constraints forbid
behavioural change.

**Advisory** — 5 findings, filed to `docs/BACKLOG.md` (lint coverage, `ITrainingService`
decomposition, dead methods) or left as observations: the eval stub hand-mirrors
`AutoCompletedExercise` and its anchor comment cites the pre-rename filename (both
pre-existing, in `evals/lib/build-stub-deps.ts`); `domain/training.spec.md` lists 7 of the
19 methods (drift predating this branch); the ESLint pattern guards the alias form only, so
a sibling file inside `ports/` could still bypass the index relatively.

**Meta** — 9 findings filed to `docs/REVIEW_FINDINGS.md`; four new, five raising the count
of existing entries. Three recurrences confirm systemic seams: the R1/R4 boundary for a
file partly edited and partly left stale, a fix that manufactures new doc rot, and a layout
rule colliding with a dependency invariant. Two concern this run's own conduct — zone briefs
named the plan on `dev` but not the prepared worktree, and a reviewer told to "read for
shape" cannot see violations a broken verification command conceals.

**Process note.** Implementation was delegated to a `claude -p` executor on GLM/z.ai
(`docs/ORCHESTRATION.md`); review was deliberately not delegated. The executor followed its
plan and reported honestly, but trusted the plan's verification commands — and those were
broken. Findings 4, 9 and 10 were invisible to both the executor and the orchestrator's
re-check, because both used the same commands; only zones running the tools directly found
them. During the doc-sweep run the executor's commit swept the orchestrator's staged revert
into itself, noticed, and rebuilt a clean single-file commit, restoring the staged set
byte-for-byte — verified here (history, scope, staged/unstaged state, type-check, 323 tests).

## Execution notes

- Task 4 / Task 6 Step 1: `src/domain/training/ports/training-service.ports.ts` measures **129 lines**.
  Written when rule 3 was a hard 50-line limit; the rule was rewritten during close-out (size is a
  signal obliging review). `ITrainingService` has **19** methods, not the 16 recorded here — see
  `## Review` § Rule 3 review for the corrected count and the review's outcome. The file was
  deliberately not split further; it is now a standing exception naming its closing task.
- Task 5 Step 2: rule 4 fires (verified by temporarily importing `@domain/training/ports/exercise.ports`):
  `error '@domain/training/ports/exercise.ports' import is restricted from being used by a pattern. Import ports through the directory index (@domain/<domain>/ports), not a file inside it — ARCHITECTURE.md § Interface Organization Principles rule 4  no-restricted-imports`
- Task 5 discovery: the `lint` script (`eslint src/**/*.ts`, unquoted) relies on shell globbing where
  `**` collapses to `*` — `npm run lint` only checks `src/<dir>/<file>.ts` (two levels). Corrected
  during close-out: npm runs scripts under `sh`, where the glob expands to exactly **7 of 137**
  `.ts` files, and quoting it surfaces **61 errors / 650 warnings** — not the ~352 estimated here,
  which was measured with a temporary bypass in place. The `../graph/conversation.state` error this
  note calls pre-existing was in fact **introduced by Task 3** (R3 verified the pre-move file was
  clean); it is gone with that task's revert. Left as-is on this branch by owner decision; filed in
  `docs/BACKLOG.md`. Rule 4 is enforced on any file eslint actually lints (per-file runs, IDE, and
  once the glob is fixed).
