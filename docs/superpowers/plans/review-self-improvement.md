# Review Self-Improvement Implementation Plan

- Status: in progress
- Branch: plan/review-self-improvement
- After: mandatory-plan-review

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the `plan-review` phase a way to record what it learns about itself, so a blind spot found once is not rediscovered from scratch every run.

**Architecture:** A `meta` finding type in all four zone prompts, a sixth orchestrator step that files those findings in `docs/REVIEW_FINDINGS.md`, and a repeat counter so a recurring finding rises to the top on its own. Zones only report; the orchestrator is the single writer, which avoids four parallel agents racing on one file. A `meta` finding takes no part in the verdict.

**Tech Stack:** Markdown skill and prompt files, the existing `plan-review` skill, `docs/REVIEW_FINDINGS.md`.

**Spec:** none — this is a bounded extension of `docs/superpowers/specs/2026-09-12-mandatory-plan-review-design.md`, whose section 5 and decision D5 it extends rather than revises. The owner approved the design in conversation on 2026-09-12.

**Written after implementation.** The work was done directly at the owner's instruction ("не перегибай"), then this plan was written so the branch carries the traceability the contract requires and can pass through the review phase it extends. The tasks below describe what shipped; their verification commands were run against the finished branch.

## Global Constraints

- **Docs in this repo are English-only** (root `CLAUDE.md`), skills included.
- **Markdown, not code.** No jest tests for prompt text; verification is greps and file checks (same constraint as `mandatory-plan-review.md`).
- **The shared "Finding format (required)" block stays byte-identical across all four zone files** — each subagent sees only its own file (design spec D1). Verify with an md5 over lines 1-26 of each.
- **Exactly one `Out of zone:` line per zone file.**
- **`meta` never affects a verdict and never blocks a merge** — it is an observation, not work.
- **Two streams stay separate**: owner-raised ideas go to `docs/BACKLOG.md` via the `backlog` skill; the phase's self-observations go to `docs/REVIEW_FINDINGS.md`. Counting repeats belongs only to the second.
- **`docs/SUPERPOWERS_INTEGRATION.md` is durable.** The rule 7 amendment here is the owner's explicit instruction to separate the two streams; no other durable doc changes.

---

### Task 1: The self-observation log

**Files:**
- Create: `docs/REVIEW_FINDINGS.md`

**Interfaces:**
- Produces: three sections — `## Prompt defects`, `## Blind spots`, `## Rule candidates` — and the entry format `- [×N] …` with a `Runs:` line, which Task 3 writes into.

- [x] **Step 1: Write the file** with its purpose, its rules (cheap intake, repeats are the signal, order by count, two exits only), the entry format, and the three sections seeded with `(none)`.

- [x] **Step 2: Verify it states what it is not**

Run: `grep -n "BACKLOG\|plan's ## Review" docs/REVIEW_FINDINGS.md`
Expected: the header distinguishes this log from both the backlog and the plan's own review section, so a future agent does not file findings in the wrong place. This is `AC-1410`.

- [x] **Step 3: Commit**

### Task 2: The `meta` finding type in all four zones

**Files:**
- Modify: `.claude/skills/plan-review/zones/r1-architecture.md`, `r2-duplication.md`, `r3-correctness.md`, `r4-documentation.md` (shared block only)

**Interfaces:**
- Consumes: the section names from Task 1.
- Produces: the line `meta | ZONE | <prompt defect | blind spot | rule candidate> | what you noticed`, which Task 3 parses.

- [x] **Step 1: Append the `meta` paragraph to the shared block** in all four files, identically, stating that a rule candidate must propose wording and a home, and that `meta` never affects the verdict.

- [x] **Step 2: Verify the shared block is still byte-identical**

Run:

```bash
for f in .claude/skills/plan-review/zones/*.md; do sed -n '1,26p' "$f" | md5 -q; done | sort -u | wc -l
grep -c "^Out of zone:" .claude/skills/plan-review/zones/*.md
grep -c "meta | ZONE" .claude/skills/plan-review/zones/*.md
```

Expected: `1`; then `1` per file; then `1` per file. This is `AC-1411`.

- [x] **Step 3: Commit**

### Task 3: Step 6 — the orchestrator files what it learned

**Files:**
- Modify: `.claude/skills/plan-review/SKILL.md`

**Interfaces:**
- Consumes: `meta` findings from Task 2, the log from Task 1.

- [x] **Step 1: Add the set-aside rule to Step 3** so `meta` findings take no part in the verdict.

- [x] **Step 2: Append Step 6** — the orchestrator is the only writer of the log; it reads the target section first and merges a finding that says the same thing in different words, across earlier runs and between zones in the current one; when unsure it splits; sections stay ordered by count.

- [x] **Step 3: Correct the stale claim** at the top of Step 5 that the plan is "the only file this skill writes" — no longer true once Step 6 exists.

- [x] **Step 4: Verify**

Run:

```bash
grep -n "^## Step" .claude/skills/plan-review/SKILL.md
grep -n "only file this skill writes" .claude/skills/plan-review/SKILL.md
```

Expected: six steps; the second grep returns nothing. This is `AC-1412`.

- [x] **Step 5: Commit**

### Task 4: Repeat counting

**Files:**
- Modify: `docs/REVIEW_FINDINGS.md` (rules + entry format), `.claude/skills/plan-review/SKILL.md` (Step 6 dedup logic)

- [x] **Step 1: Add the counting rules to the log** — repeats are the signal, order by count, merge-vs-split guidance.

- [x] **Step 2: Add the read-before-write rule to Step 6**, covering both earlier runs and cross-zone repeats within one run.

- [x] **Step 3: Migrate the seeded entries** to the `[×N]` format with `Runs:` lines.

- [x] **Step 4: Verify**

Run: `grep -c "^- \[×" docs/REVIEW_FINDINGS.md`
Expected: one counted entry per section plus the format example — no entry left in the old shape. This is `AC-1413`.

- [x] **Step 5: Commit**

### Task 5: Wire the two streams into the contract

**Files:**
- Modify: `docs/SUPERPOWERS_INTEGRATION.md` (rule 7)

- [x] **Step 1: Extend rule 7** to say that findings about the phase itself are `meta`, change no verdict, and go to `docs/REVIEW_FINDINGS.md`, while owner-raised ideas keep going to `docs/BACKLOG.md`.

- [x] **Step 2: Verify**

Run:

```bash
grep -n "REVIEW_FINDINGS" docs/SUPERPOWERS_INTEGRATION.md
node scripts/state.mjs --check
```

Expected: the rule mentions the log; `state check: OK`. This is `AC-1414`.

- [x] **Step 3: Commit**

### Task 6: Review and close out

- [ ] **Step 1: Run `/plan-review` against this branch.** The phase reviews an extension of itself — a second smoke test, not an independent review. Say so in the artifact.

- [ ] **Step 2: Fix every blocking finding; file advisories per AC-1407.**

- [ ] **Step 3: Close out** — tick the boxes, set `Status: done`, `node scripts/state.mjs --write`, verify `--check` is OK, commit.

## Acceptance criteria

IDs continue the `AC-14xx` block opened by `mandatory-plan-review.md`.

- **AC-1410** `docs/REVIEW_FINDINGS.md` exists and states what it is not, so findings are not filed in the backlog or the plan's review section by mistake.
- **AC-1411** All four zone files carry the `meta` type in a byte-identical shared block, each with exactly one `Out of zone:` line.
- **AC-1412** `SKILL.md` has six steps, and no longer claims the plan is the only file it writes.
- **AC-1413** Every log entry carries a `[×N]` count and a `Runs:` line.
- **AC-1414** Contract rule 7 routes `meta` findings to the log and keeps the two streams separate; `node scripts/state.mjs --check` is green.
