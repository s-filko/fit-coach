# Executor prompt — refactor-p4-episode-memory

Scratch file (leading `_` = ignored by `scripts/state.mjs`). The orchestrator pastes the
block below as the `claude -p` prompt after preparing the worktree per
`docs/ORCHESTRATION.md` § Isolation and `.claude/skills/delegate-implementation/SKILL.md`
Step 1. Delete this file at close-out.

Pre-flight (orchestrator, before RUN 1):

1. `git status --short` empty on `dev`; `dev` in sync with `origin/dev`.
2. `SLUG=refactor-p4-episode-memory`; worktree + the three env symlinks + `npm ci` from `apps/server/`; `npm run type-check` green in the worktree.
3. Nothing model-backed is on the executor's path. After Task 1 lands, record its SHA under the plan's Task 2 and resume with Task 3 at once. The orchestrator's one run is Task 9 Step 1 (≈10 calls, after all code, to surface errors). Task 2 (5-case mini-freeze) and the compare (`refactor-p4-evals-verify`) run only when the owner says there is budget. The full `v2` sweep is a red-button item — never run it from this plan.
4. `EVALS_WEEKLY_LIMIT` (the plan's weekly cap in the dashboard's units) must be in `apps/server/.env` before the first metered run — owner provides the number; the orchestrator never writes `.env` files directly (owner rule 2026-09-18).
4. Owner has seen the plan's Decisions table (D-A … D-O) — D-L (config defaults) and D-K (`role` derivation) are the two most likely to be overruled.

---

```
You are the implementation executor for the fit_coach repository. Follow the plan
docs/superpowers/plans/refactor-p4-episode-memory.md task by task using the
superpowers:executing-plans skill. Work only inside the worktree
../fit_coach-refactor-p4-episode-memory (branch plan/refactor-p4-episode-memory);
run every verification command from apps/server/.

Read first, in this order: docs/STATE.md, the plan file (all of it, including the
Decisions table — those decisions are settled; do not re-open them), docs/adr/0013-llm-core-target-architecture.md
sections 3, 4.1, 4.2, 8 and 11, docs/CONTRIBUTING_AI.md. The plan names exact files,
symbols and shapes verified against the current tree; when the tree differs from the
plan, stop and report the difference rather than improvising.

Rules:
- TDD is mandatory (superpowers:test-driven-development): failing test first, then the
  implementation, then the verification command named by the task. Test names carry the
  AC-/BR-/INV- id the plan gives them.
- Never change prompt wording in phases/*/v1.ts. New prompt text goes only where the plan
  creates a new module version (summarizer v2, EPISODE_SUMMARIES_V1).
- The message-assembly snapshots are regenerated exactly once, in Task 5, and only after
  you have pasted the enumerated diff into the plan and stopped for review.
- Schema changes go through drizzle-kit generate + the existing migrate scripts only; the
  new migration must be a single 0004_* file. Never add the checkpoints* tables to a
  migration.
- domain/** must not import @langchain/* (ESLint enforces it). The new ports use the
  domain TranscriptMessage type; the mapping lives in infra.
- Do not run any RUN_LLM_EVALS=1 command that reaches a model. L0, unit tests,
  mocked-model integration tests and the local DB integration suite are your whole
  verification surface. The one exception is Task 1's guard check, which must exit
  before any model call. Never set EVALS_FULL_RUN.
- Commit at the end of each task with the message the plan gives. Tick the plan's
  checkboxes as you complete steps. No attribution lines in commits.

Reserved to the orchestrator — stop and report instead of working around them: git push,
ssh, deploy.sh, migrations on dev/prod, npm run db:* against anything but the local
compose DB, editing docs/adr/**, docs/domain/**, docs/features/**, API_SPEC.md,
ARCHITECTURE.md, LLM_CORE_REFACTOR_PLAN.md, docs/STATE.md, and setting Status: done.
These are boundaries, not obstacles; a denial is expected signal.

Stop and return control:
- after finishing each plan task (Task 2 is not yours and does not block you — after
  Task 1 you continue with Task 3 as soon as the orchestrator resumes you),
- after Task 5 Step 1 (snapshot diff review) before committing Task 5,
- on any question about intent the plan does not answer,
- when you hit the reserved boundary,
- when a verification fails and one corrective attempt did not fix it.

Start with Task 1. End every final message with exactly this block:

=== DELEGATE STATUS ===
state: done | blocked | question
task: <plan task>
summary: <what was done>
ask: <question for the orchestrator, when state is not done>
verification: <command run and its result>
```
