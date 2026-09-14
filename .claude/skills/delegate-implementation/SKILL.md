---
name: delegate-implementation
description: Use when an implementation plan is ready to execute in this repo — delegates the coding to a `claude -p` executor on the GLM/z.ai provider instead of implementing it in this session, then supervises the stop/answer/resume cycle until the plan is done. Also use when the owner asks to hand a plan to the executor or to resume a stopped executor session.
---

# Delegate implementation to the CLI executor

The full contract — provider setup, isolation, permissions, failure table — is
`docs/ORCHESTRATION.md`. Read it before the first delegation in a session. This skill is
the procedure; the contract is the law. Do not restate the contract's rules here.

**Announce at start:** "Using delegate-implementation to hand `<slug>` to the executor."

## When this applies

An implementation plan in `docs/superpowers/plans/` is ready to execute. Implementation
work is delegated; judgement is not. If there is no plan yet, this is the wrong skill —
go to `superpowers:brainstorming` / `superpowers:writing-plans` first.

**Never delegate:** `close-out-review` (its worth comes from context independent of the
executor's), `Status:` transitions, `STATE.md`, durable specs, merge, deploy. See the
reserved list in the contract.

## Step 1 — Prepare the worktree

```bash
SLUG=<plan-slug>
git worktree add "../fit_coach-$SLUG" -b "plan/$SLUG"
for f in .env .env.test .env.production; do        # all three: pre-commit runs test:unit
  ln -sfn "$(pwd)/apps/server/$f" "../fit_coach-$SLUG/apps/server/$f"
done
(cd "../fit_coach-$SLUG/apps/server" && npm ci)   # NOT the worktree root — no root package.json
```

Verify the baseline before delegating: `(cd ../fit_coach-$SLUG/apps/server && npm run type-check)`
must pass. Missing `.env.test` makes every executor commit fail in the pre-commit hook
(contract § Isolation).

Set the plan's `- Branch:` header now. **Leave `- Status: planned` until the executor's
first commit lands** — an `in progress` plan on an empty branch is misreported as
close-out debt (contract § Isolation). Flip the status and run
`node scripts/state.mjs --write` after the first returned batch of work, not before.

## Step 2 — Write the executor prompt

The prompt is the executor's whole briefing; it starts cold. It must contain:

1. The plan path and the instruction to follow `superpowers:executing-plans`.
2. The working directory (the worktree).
3. The reserved list, with the reason: these are the orchestrator's, stop rather than
   work around them.
4. The stop rule: after each plan task, on a question the plan does not answer, on
   hitting the boundary, on a second failed verification.
5. TDD is required (`superpowers:test-driven-development`); verification commands come
   from the plan.
6. The exact `DELEGATE STATUS` block to end its final message with.

Keep it specific and short. The executor reads the plan itself — do not paste the plan
into the prompt.

## Step 3 — Run

Use the invocation from the contract (env block, `bypassPermissions`,
`--disallowedTools` as **one comma-separated argument**, prompt after `--`,
`< /dev/null`, JSON to a file). Save `session_id` from the result event — the whole
supervision cycle depends on it.

Run it in the background when the plan task is substantial, so the owner can interject.

## Step 4 — Read the result

Parse the event array, take `type == "result"`, then read in this order:

1. `is_error` and whether a `result` event exists at all.
2. `permission_denials[]` — the boundary, if hit.
3. `modelUsage` — confirm `glm-5.3`; if the run went elsewhere, stop and say so.
4. The `DELEGATE STATUS` block.

Never infer the executor's state from prose when the block is missing — resume and ask
for it.

## Step 5 — Decide

| state | Orchestrator does |
|---|---|
| `done` (task) | Review the diff against the plan task; resume for the next task |
| `done` (plan) | Verify, then run `close-out-review` yourself |
| `question` | Answer it — decide, do not relay it to the owner unless it is an owner-level call (scope, a durable spec, a trade-off the plan does not settle) |
| `blocked` | Perform the reserved action yourself, or grant narrowly (single-use `--allowedTools`) and resume |

Resume with `claude -p --resume <session_id> -- "<answer>" < /dev/null`, same env and
flags. The session keeps its history, so the answer can be short.

Escalate to the owner — never to the executor — when a durable spec looks wrong
(`SUPERPOWERS_INTEGRATION.md`: escalation, never silent edits).

## Step 6 — Close

When the plan is done: review, `close-out-review`, `Status: done`, `state.mjs --write`,
then merge and remove the worktree. The executor has no part in this step.

## Red flags

| Thought | Reality |
|---|---|
| "Faster if I just write this code myself" | Then the delegation contract buys nothing. Delegate; spend this session on judgement. |
| "I'll let the executor run close-out-review, it has the context" | That context is exactly the problem. The review is independent or it is theatre. |
| "It only needs one small `ssh` / `push`" | That is the reserved list. Do it yourself. |
| "No status block, but I can tell it finished" | Guessing the state is how a half-done plan gets marked done. Ask. |
| "It hit a denial, so the run is broken" | Denials are expected signal, not failure. Read them and decide. |
| "I'll re-run from scratch to fix a small misunderstanding" | Resume. A fresh run re-pays the context warm-up. |
