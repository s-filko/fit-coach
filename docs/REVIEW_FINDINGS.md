# Review Phase — Self-Observation Log

What the `plan-review` phase notices about **itself**: prompts that mislead, gaps between
zones, rules it wanted to cite but could not. Not about any branch under review — findings
about the reviewed code go to the plan's `## Review` section, and owner-raised ideas go to
`docs/BACKLOG.md`.

Written by the orchestrator after a run, in one block. Zones only report; they never write
here. A `meta` finding never affects a verdict and never blocks a merge.

Rules:
- **Intake is cheap**: one line = what was noticed + which run + date. Judgment comes at
  triage, not at intake.
- **Two exits only**: *act on it* (the entry leaves — a prompt edit, a backlog entry, a
  durable rule) or *drop it* (delete; git keeps the history). Nothing lingers as sediment.
- Reviewed periodically by the owner. The agent adds entries; it removes them only with
  owner approval.

## Prompt defects

Wording in a zone prompt or in `SKILL.md` that misleads, contradicts the severity contract,
or is inert for the kind of diff under review.

- R3's "describe/it names carry BR/AC references" bullet is inert on markdown-only diffs yet
  reads as a checklist item to satisfy on every run. Scope it to code-bearing diffs.
  Run: mandatory-plan-review (2026-09-12).

## Blind spots

What fell between the zones — a real problem no zone's mandate covered, usually surfaced by
a wider reader (the final whole-branch review) or noticed after the fact.

- A zone prompt contradicting the shared severity contract fell between all four zones: it is
  not architecture, duplication, correctness, or docs. The wider final review caught it twice
  (R2's YAGNI citation, R3's verification-evidence citation). Nothing in the phase looks at
  the phase's own consistency. Run: mandatory-plan-review (2026-09-12).

## Rule candidates

A finding a zone wanted to raise as blocking but could not, because no rule in this repo
backs it. Each entry names the proposed wording and where it would live
(`BR-*`/`INV-*` in a domain spec, or a principle in `docs/CONTRIBUTING_AI.md`).

Precedent: YAGNI and DRY lived only in agent culture until 2026-09-12, so R2 could not block
on complexity. Recording them in `CONTRIBUTING_AI.md` made the citation legitimate.

- Resolved 2026-09-12: YAGNI and DRY are now recorded in `CONTRIBUTING_AI.md`, "Principles &
  Boundaries", so R2 blocks on complexity and on duplication. Kept here as the worked example
  of how a rule candidate graduates; drop it once a second entry replaces it as the example.
