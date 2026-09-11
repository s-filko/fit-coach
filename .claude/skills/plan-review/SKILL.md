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

## Step 2 — Dispatch the four zones

Dispatch **all four in a single parallel batch** — four `Agent` calls in one message.
Each subagent gets one zone file and nothing from the others: cold, isolated contexts are
what make four reviewers better than one (spec D1).

For each of `zones/r1-architecture.md`, `zones/r2-duplication.md`,
`zones/r3-correctness.md`, `zones/r4-documentation.md`, dispatch with:

- the zone file's full text as the instructions,
- the diff command from Step 1 so the subagent collects the diff itself,
- `PLAN_PATH` and `SPEC_PATH` to read,
- nothing about the other zones, and no findings from anyone else.

Never dispatch a fifth agent, never run a zone twice, never substitute your own reading
for a zone that failed — if a subagent returns nothing usable, say so in the summary and
re-dispatch that zone alone.

## Step 3 — Merge and classify

1. **Relay verbatim.** Each finding keeps the wording its subagent used. Their reports are
   invisible to the owner; paraphrase is where findings get quietly softened (spec D6).
2. **Demote unevidenced findings.** A `blocking` finding without both `file:line` and a
   named rule becomes `advisory`. State that you demoted it and why.
3. **Deduplicate.** The same line may surface in two zones — keep one entry, list both
   zones.
4. **Order.** Blocking first, then advisory; within each, R1 → R2 → R3 → R4.

**Verdict:** `blocked` if at least one blocking finding is open, `clean` otherwise.

## Step 4 — Report and route

Show the owner the full list, blocking findings first.

- **Blocking** — report and stop. Do not fix them: you are the reviewer (spec D5). The
  owner decides what happens next.
- **Advisory** — offer to file them in `docs/BACKLOG.md` via the `backlog` skill, which
  classifies before writing. They are not fixed on this branch.

Write the artifact only as described in the next section.

## Step 5 — Write the artifact

Two records, both in the plan file under review. This is the only file this skill writes.

**On `clean`** — add the header line beneath `- After:`:

```
- Review: YYYY-MM-DD | clean | R1,R2,R3,R4
```

Today's date, the verdict, the zones that ran. Keep the format exactly: it is parsed.

**On `blocked`** — write **no header line**. Its absence is what "not reviewed / not
passed" looks like; there is no third value to encode (spec section 5).

**In both cases** — append a `## Review` section at the end of the plan: every blocking
finding and how it was closed, every advisory finding with the backlog entry it became.

After a `blocked` review is fixed and re-run, update the same section rather than adding a
second one, and replace any existing `- Review:` line rather than adding a second — a plan
carries exactly one header line and one `## Review` section, however many times it is
reviewed. Working documents are edited in place
(`SUPERPOWERS_INTEGRATION.md`, Division of roles).
