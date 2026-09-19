---
name: delegate-implementation
description: Use when an implementation plan is ready to execute in this repo — the orchestrator (you) creates the plan worktree and dispatches Orca-supervised worker sessions (GLM by default, Sonnet/Opus when agreed) to implement it task by task, answering their questions and reviewing each task until the plan is done. Also use when the owner asks to hand a plan to a worker or to resume a stalled worker.
---

# Delegate implementation to Orca workers

The full contract — roles, executors, isolation, boundary, failure table — is
`docs/ORCHESTRATION.md`. Read it before the first delegation in a session. This skill is
the procedure; the contract is the law. Do not restate the contract's rules here.

Load the `orchestration` skill (Orca's version-matched guide) before the first
`orca orchestration` command. You are the **coordinator**; you never act as a worker.

**Announce at start:** "Using delegate-implementation to hand `<slug>` to Orca workers."

## When this applies

An implementation plan in `docs/superpowers/plans/` is ready to execute. Implementation
work is delegated; judgement is not. If there is no plan yet, this is the wrong skill —
go to `superpowers:brainstorming` / `superpowers:writing-plans` first.

**Never delegate:** `close-out-review`, `Status:` transitions, `STATE.md`, durable specs,
push, merge, deploy. See the reserved list in the contract.

## Step 1 — Choose the executor

Propose one to the owner (contract § Executors): **glm** by default; **sonnet** / **opus**
only with a reason. Use the owner's choice; with no answer, use glm.

## Step 2 — Prepare the worktree

Run the prepare block from contract § Isolation (`orca worktree create`, rename to
`plan/<slug>`, link the three env files, `npm ci` + `type-check` in `apps/server`). Keep
the `id:<repo-id>::<path>` selector. Set the plan's `- Branch: plan/<slug>` header now;
**leave `- Status: planned` until the first worker commit lands**.

## Step 3 — Create the Run and dispatch task 1

```bash
orca orchestration run-create --objective "<slug>: <plan title>" --json
orca orchestration worker-start --spec "<spec>" --task-title "<slug> task 1" \
  --worktree "<selector>" <executor flags> --json
```

Write the spec per contract § Task spec — all six parts, short, the plan is not pasted.
Check the receipt: exit 0, `launch.effective` matches the executor.

## Step 4 — Supervise

`check --wait --types worker_done,escalation,question`, then per message:

| Message | Orchestrator does |
|---|---|
| `question` | Answer with `reply` — decide yourself unless it is an owner-level call (scope, a durable spec, a trade-off the plan does not settle) |
| `escalation` | Perform the reserved action yourself, or grant narrowly in the reply |
| `worker_done succeeded` | Review the task's commits against the plan task and its AC; run its verification if in doubt; if it touches conversation / graph / memory / phases / training tools, re-run `npm run test:scenarios` yourself (contract § Scenario self-check) |
| `worker_done failed` | Decide: fix the plan, answer and retry (`--retry-of`), or take the task over |

After the first returned commit: flip `- Status: in progress`, `node scripts/state.mjs --write`.

If nothing arrives and the worker looks idle, read its transcript (`worker-read --source
auto`) instead of waiting — contract § Waiting without stalling.

## Step 5 — Next task

Dispatch the next plan task into the same terminal so the worker keeps its context:
`worker-start --task <id> --terminal <agent_terminal_handle> --worktree "<selector>"`
(or `--spec` for a new Task). Repeat Step 4. Release each worker you will not reuse.

## Step 6 — Close

When all plan tasks are done: verify (incl. `npm run test:scenarios` where § Scenario self-check applies), run `close-out-review` yourself, `Status: done`,
`state.mjs --write`, push, merge. Release the remaining workers
(`worker-list --run <run_id> --terminal-state reclaimable` must return none). Report the
worktree and `plan/<slug>` branch as **ready to clean up — delete nothing** (owner gate,
`CLAUDE.md` § Rules). Workers have no part in this step.

## Red flags

| Thought | Reality |
|---|---|
| "Faster if I just write this code myself" | Then delegation buys nothing. Dispatch; spend this session on judgement. |
| "Let the worker run close-out-review, it has the context" | That context is exactly the problem. The review is independent or it is theatre. |
| "It only needs one small `ssh` / `push`" | That is the reserved list. Do it yourself. |
| "Idle and no `worker_done`, but I can tell it finished" | Read the transcript; a turn without `worker_done` is a stall, not a success. |
| "I'll keep waiting on `check --wait`" | Inspect first (`worker-list`, `worker-read`); the owner is waiting too. |
| "Two workers in one worktree will be faster" | Only one editor per worktree — the pre-commit hook checks the whole tree. |
| "I'll clean up the worktree after merge" | Owner-gated. Report it, delete nothing. |
