# Mandatory Plan Review Implementation Plan

- Status: planned
- Branch:
- After:

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a non-skippable review phase between verification and close-out, run by a project skill that dispatches four independent review subagents and blocks `Status: done` until every blocking finding is closed.

**Architecture:** One orchestrator skill (`.claude/skills/plan-review/`) collects the scope — the branch diff against `merge-base` with `dev`, plus the plan and its spec — and dispatches four subagents in a single parallel batch, one per review zone (architecture, duplication, correctness, documentation currency). Each zone lives in its own prompt file so a zone can be edited without touching the orchestrator. The orchestrator merges findings, classifies by severity, and writes the verdict into the plan file. It never edits code.

**Tech Stack:** Markdown skills (`SKILL.md` + prompt files), the Agent tool for subagent dispatch, git for scope collection, `scripts/state.mjs` for the existing close-out gate.

**Spec:** `docs/superpowers/specs/2026-09-12-mandatory-plan-review-design.md`

## Global Constraints

- **Docs in this repo are English-only** (root `CLAUDE.md`), skills included.
- **This work is markdown, not code.** There are no jest tests for prompts. Every task's verification is a grep, a file check, or a live run of the skill — stated explicitly per task. Do not invent unit tests for skill text.
- **Plan filenames carry no date**; the slug is the task ID (`SUPERPOWERS_INTEGRATION.md`, "Overrides in force"). Spec filenames keep the plugin's dated default.
- **Never edit the Superpowers plugin cache** (`~/.claude/plugins/cache/...`): versioned path, lost on upgrade, invisible to git. Extensions go in this repo (`SUPERPOWERS_INTEGRATION.md`, "Extensions, never contradictions").
- **Acceptance criteria are `AC-1401`–`AC-1409`** from the spec, section 8. `AC-0001`–`AC-0009` are taken by `docs/features/`.
- **Durable specs change through the owner** (contract rule 3). `SUPERPOWERS_INTEGRATION.md` is durable; Task 5 edits it under the approval recorded in the spec, section 6 — no further edits to durable docs without asking.
- **The orchestrator never edits code** (spec D5). The only file it writes is the plan under review.

---

### Task 1: Skill skeleton — scope collection and the hard stop

**Files:**
- Create: `.claude/skills/plan-review/SKILL.md`
- Test: manual run, commands given in the steps

**Interfaces:**
- Produces: the skill name `plan-review`, invocable as `/plan-review`; the scope contract every zone prompt consumes — `DIFF` (branch vs `merge-base` with `dev`), `PLAN_PATH`, `SPEC_PATH`.

- [ ] **Step 1: Write the frontmatter and the scope-collection section**

Create `.claude/skills/plan-review/SKILL.md`. Match the frontmatter shape of `.claude/skills/backlog/SKILL.md` (`name` + `description`, no other keys):

```markdown
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
```

- [ ] **Step 2: Verify the skill is discoverable**

Run: `ls .claude/skills/plan-review/SKILL.md && head -4 .claude/skills/plan-review/SKILL.md`
Expected: the file exists and the frontmatter shows `name: plan-review`.

- [ ] **Step 3: Verify the hard stop by hand**

From a branch with no matching plan (e.g. a scratch branch `git switch -c scratch/no-plan`),
read the skill and confirm the instruction reached is the hard stop, not a dispatch.
Then: `git switch - && git branch -D scratch/no-plan`.
Expected: the skill's text leads to the stop message. This is `AC-1403`.

- [ ] **Step 4: Commit**

```bash
git add .claude/skills/plan-review/SKILL.md
git commit -m "feat(review): plan-review skill skeleton with scope collection"
```

---

### Task 2: The four zone prompts

**Files:**
- Create: `.claude/skills/plan-review/zones/r1-architecture.md`
- Create: `.claude/skills/plan-review/zones/r2-duplication.md`
- Create: `.claude/skills/plan-review/zones/r3-correctness.md`
- Create: `.claude/skills/plan-review/zones/r4-documentation.md`
- Test: greps given in the steps

**Interfaces:**
- Consumes: the scope contract from Task 1 (`DIFF`, `PLAN_PATH`, `SPEC_PATH`).
- Produces: four prompt files, each ending in the same finding format the orchestrator parses in Task 3:
  `SEVERITY | ZONE | file:line | rule | finding` where `SEVERITY` is `blocking` or `advisory` and `ZONE` is `R1`–`R4`.

- [ ] **Step 1: Write the shared finding contract into each zone file**

Every zone file opens with this block, verbatim — the orchestrator relies on it and each
subagent sees only its own file (spec D4, D6):

```markdown
## Finding format (required)

One line per finding:

`SEVERITY | ZONE | file:line | rule | finding`

- `SEVERITY` is `blocking` or `advisory`.
- **`blocking` requires `file:line` AND a named rule** — an AC-####, BR-*, INV-*, a rule
  from `docs/SUPERPOWERS_INTEGRATION.md`, or an ADR. A finding without both is
  `advisory` by definition. No exceptions: severity is earned by evidence, not by how
  serious it feels.
- `advisory` is an improvement that violates nothing. It will not be fixed on this
  branch — it goes to `docs/BACKLOG.md`. Do not argue for fixing it here.

Report findings only. Do not edit any file. Do not propose a diff.
Stay inside your zone: findings outside it belong to another reviewer and will be discarded.
```

- [ ] **Step 2: Write `zones/r1-architecture.md`**

After the shared block, the zone body:

```markdown
# Zone R1 — Architectural integrity

Read the diff plus the structure of the layers it touches. You are reading for *shape*;
function bodies matter only where they reveal a boundary being crossed.

Check:

- **One reason to change** per new or modified module.
- **Dependency direction**: dependencies point inward, toward the domain. A domain module
  importing infrastructure is a finding.
- **Interface fit**: an interface does not force implementations to carry what they do not
  need.
- **Declared boundaries**: `docs/adr/0013-llm-core-target-architecture.md` describes the
  target architecture. Blurring a boundary it names is blocking, cited as `ADR-0013`.
- **File purpose**: a file that has grown past having a single purpose.

**Always blocking:** a durable spec (`docs/` outside `docs/superpowers/`) edited in this
diff in place of escalating to the owner — `SUPERPOWERS_INTEGRATION.md` Rules of
engagement, rule 3. Cite the spec file and the rule.

Out of zone: duplication (R2), logic bugs (R3), doc currency (R4).
```

- [ ] **Step 3: Write `zones/r2-duplication.md`**

```markdown
# Zone R2 — Duplication and unnecessary complexity

You are the only reviewer required to search **outside** the diff. A finding that the new
code duplicates something already in the repo is your primary output.

Search before judging:

```bash
# for each new function/type/constant name in the diff:
grep -rn "<name>" apps/ scripts/ --include="*.ts" --include="*.mjs" | grep -v node_modules
# and for the behaviour, not just the name — try two or three phrasings
```

Check:

- **Duplication**: copy-paste, and reinvention of something that already exists under
  another name. Cite both sites as `file:line`.
- **Abstraction with one call site** — an interface, factory, or wrapper used once.
- **A layer that adds no value** — pass-through that only forwards arguments.
- **A flag where two functions belong** — a boolean parameter that splits the body in two.

YAGNI is the rule you cite for the last three.

Out of zone: overall architecture and layer boundaries (R1), logic bugs (R3), docs (R4).
```

- [ ] **Step 4: Write `zones/r3-correctness.md`**

```markdown
# Zone R3 — Correctness and proof

Read the diff for behaviour, then check that the behaviour is proven.

Check:

- **Logic and edge cases**: empty input, boundary values, error paths, concurrent or
  repeated execution where relevant.
- **Every AC has a test.** For each `AC-####` the plan claims, find the test that covers
  it. A claimed AC with no test is blocking, cited by its AC id.
- **Test naming**: `describe/it` names carry BR/AC references per
  `docs/CONTRIBUTING_AI.md`.
- **Verification commands were run.** The plan states a verification command per task.
  Confirm it was actually executed with output — not judged by reading. If the evidence
  is absent, that is blocking.
- **Thin-test zones** get heightened attention, because tests there are weak by nature:
  `drizzle/` migrations, `deploy/deploy.sh`, env handling, `docker-compose.yml`.

Out of zone: architecture (R1), duplication (R2), doc currency (R4).
```

- [ ] **Step 5: Write `zones/r4-documentation.md`**

```markdown
# Zone R4 — Documentation and spec currency

You read **from code to docs** — the reverse of every other zone. Start from what the diff
changed, then ask what the documentation now claims that is no longer true.

Check three classes of rot:

- **Stale**: docs describe what the code no longer does. Precedent: `drizzle-kit push` was
  removed from every code path, so any doc still presenting it as a live mechanism is
  false.
- **Distractors**: dead references to IDs that do not exist; the same rule stated in two
  places with a divergence; leftover TODO/TBD; drafts posing as durable specs.
- **Gaps**: the change added something to code but not to the durable layer — an endpoint
  missing from `docs/API_SPEC.md`, a business rule without a `BR-*`, an architectural
  decision without an ADR.

Also check layer discipline:

- Statuses have not leaked into durable docs (`SUPERPOWERS_INTEGRATION.md`, Status layer,
  rule 4).
- English-only (root `CLAUDE.md`).
- The `docs/STATE.md` AUTO block is not hand-edited (Status layer, rule 5).
- IDs are not reused — check any new `AC-####`/`BR-*`/`INV-*` against the repo:
  `grep -rhoE "AC-[0-9]{4}" docs/ | sort -u`.

**R1 vs R4:** R1 catches a spec *silently changed* — code rewrote the law behind the
owner's back, a process violation. You catch a spec *left behind* — the law stands, the
code moved. If the diff edits a durable spec, that is R1's finding, not yours.

Out of zone: architecture (R1), duplication (R2), logic bugs (R3).
```

- [ ] **Step 6: Verify all four exist and share the contract**

Run:

```bash
ls .claude/skills/plan-review/zones/ | wc -l
grep -l "SEVERITY | ZONE | file:line" .claude/skills/plan-review/zones/*.md | wc -l
grep -c "Out of zone" .claude/skills/plan-review/zones/*.md
```

Expected: `4`, `4`, and each file reporting `1`. The last one guards against zone bleed
(spec risk R-4).

- [ ] **Step 7: Commit**

```bash
git add .claude/skills/plan-review/zones/
git commit -m "feat(review): four zone prompts with shared finding contract"
```

---

### Task 3: Dispatch, merge, verdict

**Files:**
- Modify: `.claude/skills/plan-review/SKILL.md` (append Steps 2–4 after the scope section from Task 1)
- Test: greps given in the steps

**Interfaces:**
- Consumes: the scope contract (Task 1) and the four zone files (Task 2).
- Produces: the verdict values `clean` / `blocked` that Task 4 writes into the plan.

- [ ] **Step 1: Append the dispatch section**

```markdown
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
```

- [ ] **Step 2: Append the merge and verdict section**

```markdown
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
```

- [ ] **Step 3: Verify the dispatch rules are unambiguous**

Run:

```bash
grep -n "single parallel batch\|Never dispatch a fifth\|Relay verbatim\|blocked. if at least one" .claude/skills/plan-review/SKILL.md
```

Expected: four matches — the rules behind `AC-1402`, `AC-1405`, `AC-1406` and spec D6 are
each present as an instruction, not an aside.

- [ ] **Step 4: Verify the demotion rule is stated as an action**

The evidence rule appears in two places and must be actionable in both: the zone prompts
define it, the orchestrator enforces it.

Run:

```bash
grep -c "advisory. by definition" .claude/skills/plan-review/zones/*.md
grep -n "Demote unevidenced findings" .claude/skills/plan-review/SKILL.md
```

Expected: each zone file reports `1`, and the orchestrator has the demotion step. Together
these are `AC-1404` — a finding claimed as blocking without `file:line` plus a named rule
is reclassified, not argued about.

- [ ] **Step 5: Commit**

```bash
git add .claude/skills/plan-review/SKILL.md
git commit -m "feat(review): parallel dispatch, verdict logic and routing"
```

---

### Task 4: The artifact in the plan file

**Files:**
- Modify: `.claude/skills/plan-review/SKILL.md` (append Step 5)
- Test: greps given in the steps

**Interfaces:**
- Consumes: the verdict from Task 3.
- Produces: the `- Review:` header line and the `## Review` section — the format a future
  `state.mjs` gate will parse (spec section 7).

- [ ] **Step 1: Append the artifact section**

```markdown
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
second one — working documents are edited in place
(`SUPERPOWERS_INTEGRATION.md`, Division of roles).
```

- [ ] **Step 2: Verify the two branches are distinct**

Run:

```bash
grep -n "On .clean.\|On .blocked.\|no header line" .claude/skills/plan-review/SKILL.md
```

Expected: three matches — the skill states both branches and the absence rule explicitly.
This is `AC-1406`.

- [ ] **Step 3: Confirm the format is parseable**

Run this against the line the skill prescribes, to prove a future gate can read it:

```bash
echo "- Review: 2026-09-12 | clean | R1,R2,R3,R4" | \
  grep -qE '^- Review: [0-9]{4}-[0-9]{2}-[0-9]{2} \| (clean|blocked) \| R[0-9,R]*$' && echo PARSEABLE
```

Expected: `PARSEABLE`.

- [ ] **Step 4: Commit**

```bash
git add .claude/skills/plan-review/SKILL.md
git commit -m "feat(review): record the verdict in the plan file"
```

---

### Task 5: Wire the phase into the contract

**Files:**
- Modify: `docs/SUPERPOWERS_INTEGRATION.md` — Workflow block, Rules of engagement, Status layer
- Test: greps + `node scripts/state.mjs --check`

**Interfaces:**
- Consumes: the skill from Tasks 1–4.
- Produces: the contractual block — the rule that makes the phase non-skippable.

This is a **durable doc**. The owner approved these four changes in the spec, section 6.
Make exactly those; anything further needs a fresh ask (contract rule 3).

- [ ] **Step 1: Add the phase to the workflow block**

In the ```` ``` ```` block under `## Workflow (one change)`, replace this line:

```
 └─ verification-before-completion, requesting/receiving-code-review
```

with:

```
 └─ verification-before-completion
 └─ plan-review (MANDATORY) ──▶ four zones: architecture, duplication,
      │                          correctness, documentation currency.
      │                          All four block. Uses requesting/receiving-code-review
      │                          as technique. Records `- Review:` in the plan.
```

- [ ] **Step 2: Add the blocking rule to Rules of engagement**

Append as a new numbered rule (it becomes rule 7, after the existing six):

```markdown
7. **Review precedes close-out.** `Status: done` is not set until the `plan-review` phase
   records `- Review: <date> | clean | <zones>` in the plan. All four zones block,
   documentation included: a durable spec that has drifted from the code actively misleads
   the next agent. Blocking findings are fixed; advisory findings leave the branch for
   `docs/BACKLOG.md`. Review precedes close-out, and close-out precedes merge.
```

- [ ] **Step 3: Document the line in the Status layer table**

In the "Where status lives" table, add a row directly beneath the `- Status:` row:

```markdown
| Plan header line `- Review: <date> \| clean \| <zones>` | the review phase passed (written only on a clean verdict; its absence means not reviewed) | plan-review skill |
```

- [ ] **Step 4: Verify the three edits landed**

Run:

```bash
grep -n "plan-review (MANDATORY)" docs/SUPERPOWERS_INTEGRATION.md
grep -n "Review precedes close-out" docs/SUPERPOWERS_INTEGRATION.md
grep -n "Review: <date>" docs/SUPERPOWERS_INTEGRATION.md
node scripts/state.mjs --check
```

Expected: one match each, then `state check: OK`. This is `AC-1409`.

- [ ] **Step 5: Commit**

```bash
git add docs/SUPERPOWERS_INTEGRATION.md
git commit -m "docs(contract): make plan-review a mandatory phase before close-out"
```

---

### Task 6: Prove it on a live branch

**Files:**
- Modify: `docs/superpowers/plans/mandatory-plan-review.md` (this plan — it receives the artifact)
- Test: the run itself

The first subject is this plan's own branch. Note the limit honestly: the skill reviewing
its own implementation is a smoke test of the machinery, not an independent review. Say so
in the summary.

- [ ] **Step 1: Run the skill against this branch**

Invoke `/plan-review`. Confirm as it runs:

- four subagents dispatched in one batch (`AC-1402`),
- each reported findings in the `SEVERITY | ZONE | file:line | rule | finding` format,
- no subagent edited a file (`AC-1408`).

- [ ] **Step 2: Check the working tree was untouched**

Run: `git status --short`
Expected: only `docs/superpowers/plans/mandatory-plan-review.md` modified, if anything.
Any other modified file means the reviewer edited code — a violation of `AC-1408`; stop and
report it.

- [ ] **Step 3: Route the findings**

Fix every blocking finding, re-run the skill, repeat until the verdict is `clean`. File
advisory findings in `docs/BACKLOG.md` via the `backlog` skill (`AC-1407`) — do not fix
them here.

- [ ] **Step 4: Confirm the artifact**

Run:

```bash
grep -E '^- Review: ' docs/superpowers/plans/mandatory-plan-review.md
grep -n '^## Review' docs/superpowers/plans/mandatory-plan-review.md
```

Expected: the header line present with `clean`, and a `## Review` section listing what was
found. This is `AC-1406`.

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/plans/mandatory-plan-review.md
git commit -m "docs(review): record the first plan-review verdict"
```

---

### Task 7: Close out

- [ ] **Step 1: Tick every checkbox in this plan** that is genuinely done.

- [ ] **Step 2: Set the status**

Set `- Status: done` and `- Branch: <branch>` in this plan's header.

- [ ] **Step 3: Regenerate STATE.md**

Run: `node scripts/state.mjs --write`

- [ ] **Step 4: Verify the gate**

Run: `node scripts/state.mjs --check`
Expected: `state check: OK`.

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/plans/mandatory-plan-review.md docs/STATE.md
git commit -m "docs: close out mandatory-plan-review"
```

Close-out happens **before** merge (`SUPERPOWERS_INTEGRATION.md`, Status layer). Then hand
over to `superpowers:finishing-a-development-branch`.
