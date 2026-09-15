# Refactor P0 — Harness Episode Seeding and v0 Re-freeze Implementation Plan

- Status: planned
- Branch: plan/refactor-p0-eval-harness-seeding
- After: refactor-p0-eval-baseline

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (delegate per `docs/ORCHESTRATION.md`). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `state.messages` actually reach the model, so multi-turn cases measure prompt behaviour instead of harness blindness, then re-freeze the v0 baseline under the fixed harness.

**Owner ruling (2026-09-15):** a known-broken harness is never accepted as baseline reality — fix it, re-measure. Scope pragmatically: seed what production's context service can express; do not build speculative machinery (no L3 simulator, no new check types, no `EVAL_MODEL` env).

**Root cause (executor finding A, verified):** subgraphs build history from `contextService.getMessagesForPrompt(userId, phase)` (`src/infra/ai/graph/subgraphs/*.subgraph.ts`); the eval stub returns `[]` (`evals/lib/build-stub-deps.ts`), so every L1 case runs with empty episode memory regardless of its `state.messages`. All three recorded v0 failures (PC-0004, PC-0007, SP-0005) require prior turns.

**Spec:** `docs/PROMPT_EVAL_FRAMEWORK.md` §3 (state.messages: "checkpoint seed: episode memory going in"), §4.2. Master plan: P0 item 5 (baseline). This plan also reconciles the spec with implemented reality (executor findings B–E, out-of-scope note) — durable-spec edit, owner-approved by the ruling above; every change is listed in Task 3 and none invents unbuilt behaviour.

**Acceptance criteria (AC-1303 completion):** `RUN_LLM_EVALS=1 npm run evals -- --level L1 --phase all` seeds case history (verified by a unit test asserting the model receives seeded turns) and `--baseline write` re-freezes v0 from the fixed harness.

## Global Constraints

- No prompt wording changes. No new machinery beyond seeding; L3/multi-turn *simulation* stays out of scope.
- `state.messages` roles map to what `ChatMsg` (`src/domain/ai/types.ts:6`) can express: `human → user`, `ai → assistant`. `tool_call`/`tool_result` **cannot** be seeded pre-P4 (the production context service stores user/assistant turns only) — document this in the schema instead of inventing a channel.
- Baseline immutability exception, recorded not implied: v0 is re-frozen **before its first `--baseline compare` use**; the old freeze never gated anything. State this in `evals/baselines/README` (or equivalent committed note) next to the new harness commit pin.
- Verification commands run from `apps/server/`; LLM runs need the direct-Z.AI `.env` already in place.
- Commit messages carry no attribution lines.

---

### Task 1: Seed episode memory in the stub world

**Files:**
- Modify: `apps/server/evals/lib/build-stub-deps.ts` — accept the case's `state.messages`, return them from `getMessagesForPrompt` as `ChatMsg[]` (`human → user`, `ai → assistant`; `tool_call`/`tool_result` skipped)
- Modify: `apps/server/evals/lib/run-case.ts` — pass `testCase.state?.messages` into `buildStubDeps`
- Modify/extend: `apps/server/evals/lib/__tests__/build-stub-deps.unit.test.ts` and `run-case.unit.test.ts`

**Steps:**
- [ ] Failing test: `buildStubDeps` with `state.messages = [{role:'human',text:'сделал 80 на 8'},{role:'ai',text:'Принято!'}]` → `deps.contextService.getMessagesForPrompt(...)` resolves to `[{role:'user',...},{role:'assistant',...}]`; a `tool_call` entry is skipped, not thrown on.
- [ ] Failing test in `run-case.unit.test.ts`: with the scripted mock model, assert the messages array the model receives contains the seeded turn(s) before the current `userMessage` (spy on the mock `invoke`'s argument).
- [ ] Implement both changes (signature: `buildStubDeps(fixture, messages?)` or take the whole case — executor's choice, keep it minimal).
- [ ] `npm run test:unit -- build-stub-deps run-case` green; full suite green.
- [ ] Commit: `fix(evals): seed case state.messages into the episode memory the model sees`

Task 1 implements AC: seeding correctness. Verification: the two unit tests above.

### Task 2: Re-measure and re-freeze v0

**Files:**
- Rewrite: `apps/server/evals/baselines/v0/*.json` (all five phases)
- Modify: the baseline commit-note/README documenting the re-freeze: harness commit of this branch, direct-Z.AI route, 3 samples, ⌈n/2⌉, and the immutability exception (first freeze never used by a compare)

**Steps:**
- [x] `RUN_LLM_EVALS=1 npm run evals -- --level L1 --phase all --baseline write` (exact command per the runner's implemented flags; if write targets a different path than `baselines/v0/`, adjust so v0 is overwritten, not duplicated). Executed as five per-phase runs (`--phase <phase> --baseline write`) — the write path targets `baselines/v0/<phase>.json` directly, so v0 was overwritten in place; per-phase runs bound memory and checkpoint each file.
- [x] Record the before/after delta of the three previously-failing cases (PC-0004, PC-0007, SP-0005) and any newly appearing failures in the plan file under this task — that diff is the point of the whole fix.
- [ ] Commit: `feat(evals): re-freeze v0 baseline on the seeded harness`

**Before/after delta (2026-09-15, seeded harness commit `2049f0f3`, direct Z.AI `glm-5.3`, 3 samples, ⌈n/2⌉ gate):**

| Check | Before (blind harness) | After (seeded harness) |
|---|---|---|
| PC-0004 `tools.must:search_exercises` | FAIL 0/3 | **PASS 3/3** |
| PC-0007 `tools.must:save_workout_plan` | FAIL 0/3 | FAIL 0/3 (unchanged) |
| SP-0005 `tools.must:start_training_session` | FAIL 0/3 | FAIL **1/3** (improved, still below the ⌈3/2⌉=2 gate) |

Phase summaries after re-freeze: registration 52/52, chat 60/60, plan_creation 50/51, session_planning 51/52, training 52/52. **No newly appearing failures** — the only failing checks are the two residual ones above, both genuine prompt-behaviour gaps the model still exhibits with its episode memory present.

Verification: `--baseline compare` (or JSON inspection) shows the new numbers; summary lines recorded in this plan file.

### Task 3: Reconcile PROMPT_EVAL_FRAMEWORK.md with implemented reality

**Files:**
- Modify: `docs/PROMPT_EVAL_FRAMEWORK.md` (durable spec — the exact edits are enumerated below, nothing else)

**Steps — each corresponds to an executor finding; make the spec describe what IS (after Task 1), marking deferrals explicitly:**
- [x] §3 schema block: seeding is expressed via `state.messages` consumed by the harness's stubbed context service (now true after Task 1); remove `state.episodeSummaries` and nested `fixture.user.profile` (not in the implemented schema — flat user fields); note `tool_call`/`tool_result` roles are accepted but not seedable pre-P4.
- [x] §4.2: replace the `graph.updateState` seeding claim with the actual mechanism (stub `getMessagesForPrompt`); replace the `EVAL_MODEL` claim with "model comes from the app config; the baseline JSON pins what was used".
- [x] §4.1: mark the three unimplemented L0 checks (section presence, git-diff version discipline, message-catalog completeness) as deferred — cross-reference the existing backlog entries rather than promising them here.
- [x] §4.2 named checks: mark `no_redundant_search` and the structural checks (`outcome`, `budgetReport`, orphan ToolMessage) as not-yet-implemented deferrals.
- [x] §6: correct the baseline layout to the implemented `evals/baselines/<version>/<phase>.json` and amend "never written by a PR" with the bootstrap/re-freeze exception (recorded once, before first compare use).
- [ ] Commit: `docs(eval-framework): reconcile spec with implemented harness (findings A-E)`

Verification: every edit maps 1:1 to a finding; no new promises added.

---

## Close-out

Follow the standard flow; checkboxes = done + verified. `node scripts/state.mjs --check` must pass after `Status: done`.
