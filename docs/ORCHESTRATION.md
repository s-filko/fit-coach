# Orchestration — Delegated Implementation via Orca

This document is the single source for how implementation work is delegated from an
orchestrating session to worker sessions. It extends `SUPERPOWERS_INTEGRATION.md`
(execution layer) and does not change any process rule defined there: brainstorming,
plans, statuses, and the review phase are unchanged. What changes is *who types the code*.

Delegation runs on **Orca orchestration** (Orca 1.4.205): the orchestrator is an agent
session inside an Orca terminal, workers are Orca-supervised agent sessions in a plan
worktree, and all coordination goes through `orca orchestration …`. The version-matched
command reference is served by the binary: `orca skills get orchestration` (the
`orchestration` skill loads it). This document holds only what is specific to this repo.

Verified 2026-09-19 by live probes in a throwaway worktree. Facts from those probes are
marked **[verified]**; anything not so marked is a rule, not a measurement.

## Roles

| Role | Runs as | Owns |
|---|---|---|
| **Orchestrator** | Opus, in an Orca terminal on the main checkout (`dev`) | Brainstorming, durable specs, plans, choosing the executor, creating the worktree, writing Task specs, answering workers, reviewing each task's diff, `close-out-review`, `Status:` transitions, `STATE.md`, push, merge, deploy |
| **Worker** | An Orca-dispatched session in the plan worktree (GLM by default) | Exactly the Task it was dispatched: code, TDD tests, `verification-before-completion`, ticking plan checkboxes, committing inside the worktree |

Each side knows its role from Orca itself: a worker's prompt starts with Orca's injected
preamble (Task ID, Dispatch ID, the exact `ask` / `worker_done` commands); the
orchestrator is the session that created the Run. A worker never acts as orchestrator —
it does not create Runs, Tasks, worktrees or other workers.

The orchestrator delegates **execution of an already-written plan**. It never delegates
judgement: what to build, whether it is right, and whether it is done stay with the
orchestrator.

**Rule:** when an implementation plan is ready, the orchestrator delegates its execution
per this document rather than writing the implementation itself.

## Why

The orchestrator's model is the expensive, scarce resource; it is spent on planning,
review, and decisions. Implementation — mechanical work against a plan that already
states what to do and how to verify it — goes to a cheaper executor. `close-out-review`
is deliberately **not** delegated: it is the check on the workers' own work, and its
value comes from independent context.

## Executors

Orca launches agents by typing the slot's command into a login `zsh`, so shell functions
from `~/.zshrc` apply **[verified]**. Slots are configured in Orca → Settings → Agents
(command override + default args):

| Executor | `worker-start` flags | Slot config | Provider / profile | Status |
|---|---|---|---|---|
| **glm** (default) | `--agent claude-agent-teams` | command `claude`, args `--model glm-5.3[1m] --permission-mode auto` | z.ai via the `claude()` shell function (sources `~/.claude/glm-cli.env`); config dir `~/.claude` | **[verified]** Bash, `ask`, `worker_done`, no permission prompts |
| **sonnet** | `--agent claude --model sonnet` | command `claude-personal`, args `--permission-mode auto` | Anthropic subscription; `~/.claude-personal` | **[verified]** reported `claude-sonnet-5` |
| **opus** | `--agent claude --model opus` | same slot as sonnet | Anthropic subscription | profile verified; `--model opus` not yet exercised |

- The orchestrator **proposes** an executor per plan (or per task) and the owner confirms;
  with no owner preference it uses **glm**. Anthropic executors spend the owner's
  subscription quota — pick them for tasks where GLM is known to struggle, not by default.
- `--model` works only on the `claude`, `codex` and `cursor` slots. `claude-agent-teams`
  refuses it (`does not support launch-time model selection`) **[verified]** — that is
  why GLM's model is pinned in the slot args and Anthropic lives on the `claude` slot.
- Compare `launch.effective` in the start receipt with what was requested, and trust the
  worker's own report of its model, not the requested flags.
- The `cursor` slot is the corporate profile (`claude-ct`) — never use it for this repo.
- Never print `ANTHROPIC_AUTH_TOKEN` / `ANTHROPIC_API_KEY`. To check env, print
  `[ -n "$ANTHROPIC_AUTH_TOKEN" ] && echo set` — never the value.

## Isolation: one worktree per plan

Workers run in auto mode, so the hard boundary around the orchestrator's checkout is a
physical one: every plan gets its own Orca worktree.

```bash
SLUG=<plan-slug>
REPO=id:88b171fc-bda9-4c6c-b6f3-82b7fb04ae88            # fit_coach in `orca repo list`
orca worktree create --repo "$REPO" --name "$SLUG" --base-branch dev --setup skip --json
WT=/Users/filko/orca/workspaces/fit_coach/$SLUG           # result.worktree.path
git -C "$WT" branch -m "plan/$SLUG"                       # Orca names it s-filko/<name>
for f in .env .env.test .env.production; do                # secrets are linked, never copied
  ln -sfn "$PWD/apps/server/$f" "$WT/apps/server/$f"
done
(cd "$WT/apps/server" && npm ci && npm run type-check)    # NOT the worktree root
```

- Orca places the worktree under `/Users/filko/orca/workspaces/fit_coach/<name>` and names
  the branch `s-filko/<name>` **[verified]**. Renaming it to `plan/<slug>` right after
  creation is picked up by Orca (`worktree show` reports the new branch) **[verified]**.
  Keep the selector `id:<repo-id>::<path>` from `result.worktree.id` — every
  `worker-start` for this plan uses it as `--worktree`.
- The repo's Orca setup script is empty, hence `--setup skip` and the manual prepare
  above. Moving the prepare into the setup hook is possible but not yet done.
- All three env files are gitignored and absent from a fresh worktree. `.env` alone is
  not enough: `.husky/pre-commit` runs `lint → format:check → type-check → test:unit`, and
  the unit suite needs `.env.test`, so **every worker commit fails without it**
  **[verified 2026-09-14]**.
- The lockfile and dependencies live in `apps/server/`, not the root: `npm ci` at the
  worktree root fails with `EUSAGE` **[verified 2026-09-14]**. A clean `type-check` on the
  untouched branch is the baseline; a failure there is a broken worktree, not a broken plan.
- `.claude/settings.local.json` and `.claude/skills/` are committed, so workers inherit
  the project's skills, settings and hooks.
- **Set `- Status: in progress` only after the first worker commit exists on the branch.**
  `scripts/state.mjs` treats a branch with zero commits ahead of `dev` as merged, so an
  `in progress` plan on an empty branch is reported as close-out debt **[verified 2026-09-14]**.
- **Never dispatch into a worktree holding the orchestrator's uncommitted work.** A bare
  `git commit` by the worker sweeps in whatever was staged **[verified 2026-09-14]**.
  `git status --short` in the worktree must be empty before each dispatch.
- **One editing worker per worktree at a time.** The pre-commit hook type-checks and tests
  the whole tree, so a second editor's half-done changes break the first one's commits.
  Additional sessions in the same worktree are read-only (research, review); parallel
  implementation means parallel plans, each in its own worktree.
- **Branch and worktree deletion is owner-gated** — `CLAUDE.md` § Rules (single source).
  This includes `orca worktree rm`. After merge or cancellation, report the worktree and
  its branch as ready to clean up and delete nothing.

## Boundary: what workers never do

Reserved to the orchestrator: `git push`, any `ssh filko.dev`, `deploy/deploy.sh`,
`npm run db:*` and durable-environment migrations/backups, `docker compose`, merge,
deleting branches or worktrees, editing durable specs (`docs/adr/`, `docs/domain/`,
`docs/features/`, `API_SPEC.md`, `ARCHITECTURE.md`, `LLM_CORE_REFACTOR_PLAN.md`), editing
`docs/STATE.md`, and setting `Status: done`.

Layers, in order of strength:

1. **Physical** — the worktree (above).
2. **Technical** — auto mode's action classifier, plus the owner-gate hook for deletions.
   A role-aware hook that refuses the reserved commands for dispatched workers is **not
   built yet**; until it is, the reserved list is not technically enforced for workers.
3. **Behavioural** — every Task spec states the reserved list and why, and requires the
   worker to send an `escalation` instead of looking for a way around it.

When a worker escalates for a reserved action, the orchestrator performs it itself (the
normal case) or replies with narrowly scoped permission for that one action.

## The cycle

```
plan ready (orchestrator)
 └─ executor chosen (owner confirms, default glm)
 └─ worktree prepared (above)
 └─ run-create --objective "<slug>"            one Run per plan
 └─ worker-start --spec "<plan task N>" --worktree <sel> --agent … --task-title "<slug> task N"
 └─ check --wait --types worker_done,escalation,question
      ├─ question    → reply --id <msg> --body "<answer>"
      ├─ escalation  → act as orchestrator, then reply / send
      └─ worker_done → validate against the Dispatch, review the task's commits
            ├─ succeeded → next task in the same terminal (reuse), or release
            └─ failed    → decide: fix the plan, retry (--retry-of), or take over
 └─ repeat until all plan tasks are done → close-out-review (orchestrator's own)
```

Commands (see `orca skills get orchestration` for full semantics):

```bash
orca orchestration run-create --objective "<slug>: <plan title>" --json
orca orchestration worker-start --spec "<spec>" --task-title "<slug> task N" \
  --worktree "id:<repo-id>::<path>" --agent claude-agent-teams --json
orca orchestration check --wait --types "worker_done,escalation,question" --timeout-ms 900000 --json
orca orchestration reply --id <message_id> --body "<answer>" --json
orca orchestration check --ack <delivery_id> --json
orca orchestration worker-start --task <next_task_id> --worktree "id:<repo-id>::<path>" \
  --terminal <agent_terminal_handle> --json          # reuse: keeps the worker's context
orca orchestration worker-release --dispatch <dispatch_id> --json
orca orchestration worker-list --run <run_id> --json
orca orchestration worker-read --dispatch <dispatch_id> --source auto --json
```

- **One Orca Task per plan task.** `worker_done` after each task is the orchestrator's
  review checkpoint (the old "stop after each task" rule). The next task goes to the same
  proven terminal with `--terminal`, so context is paid once per plan — this is the
  intended pattern from Orca's guide, not yet exercised in this repo.
- The orchestrator runs in an Orca terminal and omits `--terminal` on `check`.
- Every message in a delivery is processed before `--ack`. `worker_done` settles the Task
  and Dispatch; do not follow it with `task-update`.
- After an accepted `worker_done`: reuse, `worker-retain` (owner asked to keep it), or
  `worker-release`. Release closes only that worker's terminal and archives its output
  **[verified]**; it never touches the worktree. If the owner typed into a worker's
  terminal, Orca marks it `user_takeover` and release keeps it open **[verified]**.

### Waiting without stalling

- Do not sit in long blind `check --wait` loops while the owner is active. Inspect first:
  `worker-list --run <run_id>` (fleet liveness), `worker-read --dispatch <id> --source
  auto` (transcript).
- **A worker can end its turn without `worker_done`.** Orca then shows it idle, and no
  message ever arrives **[verified]**: a GLM worker concluded it had no Bash after
  `ToolSearch` found nothing and stopped with a prose report. The transcript is the
  evidence; a final agent turn with no `worker_done` is the positive proof that
  authorizes `worker-abandon` / `worker-stop` and a retry.
- `unverifiable` liveness or a timeout is absence, not failure — it authorizes nothing.

## Task spec

The spec is the worker's whole briefing on top of Orca's preamble; it starts cold. Keep it
short — the worker reads the plan itself. Every spec names:

1. **Target:** the worktree path and the plan file; the plan task number it implements
   and its AC-#### references.
2. **Change:** "implement task N of the plan following `superpowers:executing-plans` and
   `superpowers:test-driven-development`".
3. **Constraints:** the reserved list above with its reason (the orchestrator owns these;
   escalate instead of working around them); commit inside the worktree only; do not
   touch other plan tasks.
4. **Ownership:** which files/modules this task may edit.
5. **Observable acceptance:** the task's verification command from the plan, and its
   result quoted in the `worker_done` summary.
6. **Worker notes:** "Bash, Read, Edit and Write are built-in tools — call them directly,
   never look them up with ToolSearch" (the GLM stall above); questions about intent go
   through the preamble's `ask`, never a local prompt; send `worker_done --outcome
   failed` after a second failed verification rather than looping.

## Failure handling

| Symptom | Reading | Action |
|---|---|---|
| `worker-start` exits non-zero | Launch failed | Read `failedStage` / `residualResources`; do not relaunch blindly (`orca skills get orchestration --reference references/recovery-and-cleanup.md`) |
| Worker idle, no message | Turn ended without `worker_done` | `worker-read` the transcript; abandon/stop on positive proof, fix the spec, retry with `--retry-of` |
| `worker_done --outcome failed` | Verification failed twice, or blocked | Orchestrator decides: fix the plan, answer, or take the task over |
| `escalation` for a reserved action | Boundary hit | Do it as orchestrator, or grant narrowly in the reply |
| Worker reports an unexpected model/provider | Slot misconfigured | Stop; check Orca → Settings → Agents; tell the owner |
| Auth / quota error from the provider | Token or quota | Stop; tell the owner. Do not switch executors silently |

## Scope

This contract applies to **this repository only**. Other projects have their own rules.

## Not yet verified / not yet built

- The role-aware boundary hook for dispatched workers (see Boundary).
- `--model opus` on the `claude` slot; terminal reuse across plan tasks with `--terminal`.
- A full plan executed end-to-end through Orca (the probes were read-only).
- Several plans executed in parallel, each in its own worktree.
- Moving worktree prepare (env links, `npm ci`) into the repo's Orca setup hook.
