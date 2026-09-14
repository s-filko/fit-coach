# Orchestration — Delegated Implementation

This document is the single source for how implementation work is delegated from an
orchestrating session to a CLI executor running on a non-Anthropic provider. It extends
`SUPERPOWERS_INTEGRATION.md` (execution layer) and does not change any process rule
defined there: brainstorming, plans, statuses, and the review phase are unchanged. What
changes is *who types the code*.

Verified 2026-09-14 by live probes against the configured provider. Facts recorded below
that came from those probes are marked **[verified]**; anything not so marked is a rule,
not a measurement.

## Roles

| Role | Runs as | Owns |
|---|---|---|
| **Orchestrator** | The interactive session (Claude Desktop / any Anthropic model) | Brainstorming, durable specs, plans, answering the executor's questions, `close-out-review`, `Status:` transitions, `STATE.md`, merge, deploy |
| **Executor** | `claude -p` → z.ai, model `glm-5.3` | Implementing a written plan inside a worktree: code, TDD tests, `verification-before-completion`, ticking plan checkboxes |

The orchestrator delegates **execution of an already-written plan**. It never delegates
judgement: what to build, whether it is right, and whether it is done stay with the
orchestrator.

**Rule:** when an implementation plan is ready and the session is an interactive
(desktop) session, the orchestrator delegates execution per this document rather than
writing the implementation itself. The executor may spawn its own subagents **[verified]**
(they run on `glm-5.3-flash`).

## Why

The orchestrator's model is the expensive, scarce resource; it is spent on planning,
review, and decisions. Implementation — mechanical work against a plan that already
states what to do and how to verify it — goes to a provider whose quota is not the
orchestrator's. `close-out-review` is deliberately **not** delegated: it is the check on
the executor's own work, and its value comes from independent context.

## Provider setup

Credentials live in `~/.claude/glm-cli.env` (mode `600`, never committed, never echoed).
The Bash tool does not run a login shell, so `~/.zshrc` is not loaded — the env file must
be sourced explicitly on every invocation.

```bash
source "$HOME/.claude/glm-cli.env"
export ANTHROPIC_MODEL="glm-5.3"
export ANTHROPIC_DEFAULT_OPUS_MODEL="glm-5.3"
export ANTHROPIC_DEFAULT_SONNET_MODEL="glm-5.3"
export ANTHROPIC_DEFAULT_HAIKU_MODEL="glm-5.3-flash"
export CLAUDE_CODE_SUBAGENT_MODEL="glm-5.3-flash"
```

**Never print `ANTHROPIC_AUTH_TOKEN` or `ANTHROPIC_API_KEY`.** When debugging env, print
`[ -n "$ANTHROPIC_AUTH_TOKEN" ] && echo set` — never the value.

### Known-good noise

- `[claude-code:unrecognized_model] {"model":"glm-5.3",...}` on **stderr** is expected and
  harmless **[verified]**: the run still routes to z.ai and returns
  `modelUsage.glm-5.3` with `canonicalModel: "glm-5.3"`. It is a local model-allowlist
  complaint, not a routing failure. Do not "fix" it by changing the model id.
- The `[1m]` context suffix (`glm-5.3[1m]`) is **not** used: the bare id works **[verified]**.
- `< /dev/null` is required on every invocation, or the CLI emits
  `Warning: no stdin data received in 3s` **[verified]**.

## Isolation: one worktree per plan

The executor runs under `bypassPermissions`, so the only hard boundary around the
orchestrator's working tree is a physical one.

```bash
SLUG=<plan-slug>
git worktree add "../fit_coach-$SLUG" -b "plan/$SLUG"
for f in .env .env.test .env.production; do                              # secrets are linked, never copied
  ln -sfn "$(pwd)/apps/server/$f" "../fit_coach-$SLUG/apps/server/$f"
done
(cd "../fit_coach-$SLUG/apps/server" && npm ci)                          # NOT the worktree root
```

All three env files are gitignored (`.gitignore:26`, `**/.env.*`) and therefore absent
from a fresh worktree. `.env` alone is not enough: the `.husky/pre-commit` hook runs
`lint → format:check → type-check → test:unit`, and the unit suite needs `.env.test`, so
**every commit the executor makes fails without it** **[verified]** — on the first trial
run the executor worked around this by copying the files out of the main checkout itself.
Link all three during prepare so the executor never has to touch secrets.

There is **no root `package.json`** in this repo: the lockfile and dependencies live in
`apps/server/`. Running `npm ci` at the worktree root fails with `EUSAGE … can only
install with an existing package-lock.json` **[verified]**, and leaves an empty
`node_modules` — every plan verification command then fails for the wrong reason. Install
from `apps/server/`.

**Set `- Status: in progress` only after the executor's first commit exists on the
branch.** `scripts/state.mjs` treats a branch with zero commits ahead of `dev` as merged
(`rev-list --count dev..branch` == 0), so an `in progress` plan on a freshly created,
empty branch is reported as **close-out debt** and `--check` fails on a fact that is not
true **[verified]**. Create the worktree, delegate, and flip the status once work has
landed.

A correct prepare installs 558 packages into `apps/server/node_modules`, after which
`npm run type-check` passes on the untouched branch **[verified]** — that clean result is
the baseline the executor's later verification runs are compared against. Confirm it
before delegating: a failure there is a broken worktree, not a broken plan.

`.claude/settings.local.json` and `.claude/skills/` are committed, so a worktree inherits
the project's skills and settings with no extra wiring.

Skills load automatically — `backlog`, `close-out-review`, and the full `superpowers:*`
set were present in the executor's `slash_commands` **[verified]**. No MCP server is
configured for this project (`mcp_servers: []` **[verified]**) and none is needed; the
executor works with the built-in file, search, and Bash tools.

Delete the worktree when the plan is merged or cancelled:
`git worktree remove "../fit_coach-$SLUG"`.

**Never delegate into a worktree holding the orchestrator's uncommitted work.** The
executor commits as the plan's steps require, and a bare `git commit` sweeps in whatever
the orchestrator left staged — on the first trial run this put an orchestrator revert
inside a commit whose message described only a doc edit **[verified]**. The executor
noticed and rebuilt a clean single-file commit, but the fix was luck, not design. Before
handing over: commit or stash your own changes, `git status --short` must be empty in
that worktree. If work must be shared, commit it first and tell the executor it is
already in history.

## Permissions: fast inside, hard stop at the edge

Three layers, in order of strength:

1. **Physical** — the worktree (above).
2. **Technical** — `--permission-mode bypassPermissions` for speed, **plus**
   `--disallowedTools` for the boundary. A denial in `--disallowedTools` overrides
   `bypassPermissions` **[verified]**: the forbidden call is refused even in bypass mode.
3. **Behavioural** — the prompt states *why* the boundary exists and requires the executor
   to stop and report rather than look for a way around it.

Denylist (one comma-separated argument; the prompt must be separated by `--`):

```
Bash(ssh:*),Bash(git push:*),Bash(npm run db:*),Bash(*deploy.sh*),Bash(docker compose*),Bash(rm -rf:*)
```

Reserved to the orchestrator, and therefore never done by the executor: `git push`, any
`ssh filko.dev`, `deploy/deploy.sh`, durable-environment migrations and backups, merge,
editing durable specs (`docs/adr/`, `docs/domain/`, `docs/features/`, `API_SPEC.md`,
`ARCHITECTURE.md`, `LLM_CORE_REFACTOR_PLAN.md`), editing `docs/STATE.md`, and setting
`Status: done`.

**Granting permission, case by case.** A refusal appears in the result event as
`permission_denials[]` with the exact command **[verified]**, and does not end the run
(`is_error: false` **[verified]**). The executor reports it as `state: blocked`. The
orchestrator then either performs the action itself (the normal case — everything on the
reserved list is orchestrator work anyway) or, if the request is legitimate and safe,
resumes the session with a narrowly widened `--allowedTools`. A grant is single-use: it
applies to that resume and is not carried into later invocations.

**What this does not do.** The denylist matches command shape, so a deliberate workaround
(`bash -c "ssh …"`, a wrapper script) would not be caught. It is a guard against
inertia — the executor reaching for a documented `npm run` script — not a sandbox. Real
containment is the worktree plus the rule that irreversible actions are the orchestrator's.

## The cycle

```
plan ready (orchestrator)
 └─ worktree prepared
 └─ RUN 1: claude -p …  → save session_id
 └─ executor works, stops at a checkpoint
 └─ orchestrator reads the result event → DELEGATE STATUS block
      ├─ done      → verify, then close-out-review (orchestrator's own)
      ├─ question  → answer → claude -p --resume <sid> "<answer>"
      ├─ blocked   → orchestrator acts, or grants narrowly, then resumes
      └─ is_error / no block → diagnose, re-run
 └─ repeat until done
```

`--resume <session_id>` continues the same session with its history intact **[verified]**.
Context warm-up is paid once: the first run cost ~21.5k input tokens, the resume read
~22.9k from cache **[verified]**. This is why a whole plan is delegated per session
rather than one task per invocation — every fresh invocation re-pays the warm-up.

The executor must stop and return control:

- after finishing each plan task,
- when it has a question about intent that the plan does not answer,
- when it hits the reserved boundary,
- when verification fails and one corrective attempt did not fix it.

## Invocation

```bash
claude -p --output-format json \
  --permission-mode bypassPermissions \
  --disallowedTools "Bash(ssh:*),Bash(git push:*),Bash(npm run db:*),Bash(*deploy.sh*),Bash(docker compose*),Bash(rm -rf:*)" \
  --add-dir "../fit_coach-$SLUG" \
  -- "<prompt>" < /dev/null > run.json 2> run.err
```

`--disallowedTools` takes **one comma-separated argument**, and the prompt must follow
`--`. Passing several space-separated patterns makes the CLI swallow the prompt as another
pattern and the run fails with `Error: Input must be provided…` **[verified]**.

## Reading the result

`stdout` is a **JSON array of events**, not a single object **[verified]**. The final
event has `type == "result"` and carries `session_id`, `result` (the executor's final
text), `is_error`, `permission_denials[]`, and `modelUsage` — check
`modelUsage.glm-5.3` to confirm the run went to the intended provider.

The executor's prompt requires its final text to end with:

```
=== DELEGATE STATUS ===
state: done | blocked | question
task: <plan task>
summary: <what was done>
ask: <question for the orchestrator, when state is not done>
verification: <command run and its result>
```

A fixed block is used rather than `--json-schema` deliberately: it adds no new field to
the provider request. This endpoint has already rejected an extra request field once
(`output_config` → `400 [1210]`, the reason `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` is
set in the env file), and a missing block degrades to readable prose instead of a parse
error.

## Failure handling

| Symptom | Reading | Action |
|---|---|---|
| `is_error: true`, or no `result` event | Run died | Read `run.err`; re-run the same prompt |
| Auth / balance error from the provider | Token or quota | Stop; tell the owner. Do not switch providers silently |
| `permission_denials[]` non-empty | Boundary hit | Act as orchestrator, or grant narrowly and resume |
| No `DELEGATE STATUS` block | Executor drifted | Resume asking for the block; do not guess its state |
| Verification failed twice | Plan or code is wrong | Orchestrator decides: fix the plan, or take it over |

## Scope

This contract applies to **this repository only**. Other projects have their own rules.

## Not yet verified

- Running several executors in parallel on independent plans. The mechanism (one worktree
  and one session each) implies it works, but it has not been exercised. Do not present it
  as proven.
- Any watchdog or supervisor loop. Restart is a decision the orchestrator makes after
  reading output, not an automatic retry.
