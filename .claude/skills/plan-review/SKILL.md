---
name: plan-review
description: Use before close-out of any plan — the mandatory review phase. Dispatches four independent review subagents (architecture, duplication, correctness, documentation currency) over the branch diff and its plan, then records the verdict in the plan file. Blocking findings prevent Status: done. Also use when the owner asks to review a branch against its plan.
---

# Plan review — the mandatory phase

Runs between `verification-before-completion` and `finishing-a-development-branch`.
`Status: done` is not set until this phase records `clean`
(`docs/SUPERPOWERS_INTEGRATION.md`, Rules of engagement).

**Announce at start:** "Using plan-review to run the four-zone review."

## Step 1 — Collect the scope

```bash
BASE=$(git merge-base HEAD dev)
git diff "$BASE"...HEAD          # the diff under review
git diff --stat "$BASE"...HEAD   # orientation
```

Find the plan: the file in `docs/superpowers/plans/` whose slug matches the branch
(`plan/<slug>`), or whose `- Branch:` header names the current branch. Read it in full,
together with the spec its `**Spec:**` line points to.

**No plan is a hard stop.** Without a plan there is no AC list and no declared
verification path, so zones R3 and R4 have nothing to check against. Stop and say so:

> "No plan matches this branch. Review needs a plan in `docs/superpowers/plans/` —
> either the branch is misnamed or the plan is missing. Not producing a verdict."

Produce no verdict, dispatch no subagents, write nothing.
