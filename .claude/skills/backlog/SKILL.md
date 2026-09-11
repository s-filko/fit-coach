---
name: backlog
description: Use when an idea, finding, or wish surfaces that is not part of the current work — before writing anything, classify whether it belongs in docs/BACKLOG.md at all, then add/update/drop entries per its rules. Also use when the owner asks to review, triage, or promote backlog items.
---

# Backlog intake & triage

The backlog (`docs/BACKLOG.md`) is the project's permanent parking lot for unplanned
ideas, findings, and wishes. Its quality bar is not at intake but at **classification**:
most things people want to "just write down" are already covered, belong to another
entity, or are in scope of current work. Run the classification below before writing.

## Step 1 — Classify (mandatory, in order)

```
IDEA / FINDING / WISH
 │
 ├─ 1. Already covered? Search code, specs, AC-13xx, HB-##, BUG-###, existing
 │     backlog entries, STATE.md.
 │     → DO NOT add. Reference the existing item where the discussion happens.
 │       Duplicates are context pollution.
 │
 ├─ 2. A bug (behavior contradicts a spec)?
 │     → BUGS.md entry (BUG-###), not the backlog.
 │
 ├─ 3. In scope of the refactor initiative (docs/LLM_CORE_REFACTOR_PLAN.md)?
 │     ├─ fits a phase's AC-13xx → propose refining that phase to the owner;
 │     │  NOT a backlog item.
 │     ├─ surfaced during plan execution → owner chooses: expand the plan
 │     │  (owner's decision, never silent) or park it in backlog → Findings.
 │     └─ infrastructure/hygiene around the initiative (like HB-01/HB-02) →
 │        docs/PLAN-architecture-refactor-backlog.md, not the global backlog.
 │
 ├─ 4. An architectural decision (a choice with lasting consequences)?
 │     → ADR candidate — escalate to the owner. Not a backlog item.
 │
 └─ 5. Everything else → docs/BACKLOG.md, section Ideas / Findings / Wishes.
```

## Step 2 — Write (after owner approval)

One line per entry, in the chosen section:

```
- [ ] <the idea> — <one-sentence context>. Source: <where it came from> (<date>).
```

- Insert by **priority**, most important first — never append by date.
- After writing, check whether `docs/STATE.md` hand sections need a pointer
  (e.g. a new high-priority item worth surfacing in *Next*).

## Step 3 — Maintain (on review/triage/promote requests)

- **Promote**: when an entry becomes planned (a superpowers plan exists for it, or it
  lands in a spec/BUG), DELETE it from the backlog — its truth now lives elsewhere.
  Link the new location in the PR/plan that promoted it, not in this file.
- **Drop**: stale or rejected entries are deleted outright (git keeps history).
  Never strike through, never keep "maybe later" sediment.
- The agent never adds, reorders, promotes, or drops entries without owner approval.

## What never goes into the backlog

Bugs (BUGS.md), acceptance criteria (phase plans), architectural decisions (ADRs),
current work (superpowers plans with Status), durable content (specs with IDs).
