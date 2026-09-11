# Review Phase — Self-Observation Log

What the `plan-review` phase notices about **itself**: prompts that mislead, gaps between
zones, rules it wanted to cite but could not. Not about any branch under review — findings
about the reviewed code go to the plan's `## Review` section, and owner-raised ideas go to
`docs/BACKLOG.md`.

Written by the orchestrator after a run, in one block. Zones only report; they never write
here. A `meta` finding never affects a verdict and never blocks a merge.

Rules: intake discipline follows `docs/BACKLOG.md` — cheap intake, no sediment, entries leave
only by being acted on or dropped, and the agent removes nothing without owner approval. Two
rules differ here, and they are the reason this is a separate file:

- **Repeats are the signal.** Before adding, read the section and decide whether an existing
  entry describes the same thing in different words. If it does, raise its count and append
  the run — do not open a second line. When unsure, treat them as separate: a false merge
  hides a finding, a false split only adds noise. In the backlog a repeat means the owner
  forgot they had already filed it, so there it is deduplicated rather than counted; here a
  repeat is evidence that the blindness is systemic.
- **Order = count**, highest first — not priority. What keeps recurring rises to the top on
  its own; a finding seen three times across unrelated branches is not incidental.

Entry format:

```
- [×N] what was noticed, in the zone's own words.
  Runs: <plan-slug> (YYYY-MM-DD), <plan-slug> (YYYY-MM-DD).
```

## Prompt defects

Wording in a zone prompt or in `SKILL.md` that misleads, contradicts the severity contract,
or is inert for the kind of diff under review.

- [×2] R3's "describe/it names carry BR/AC references" bullet — and its thin-test-zone list
  (`drizzle/`, `deploy.sh`, `docker-compose.yml`) — are inert on markdown-only diffs yet read
  as checklist items to satisfy on every run. Scope both to code-bearing diffs.
  Runs: mandatory-plan-review (2026-09-12), review-self-improvement (2026-09-12).

## Blind spots

What fell between the zones — a real problem no zone's mandate covered, usually surfaced by
a wider reader (the final whole-branch review) or noticed after the fact.

- [×2] A zone prompt contradicting the shared severity contract falls between all four zones:
  it is not architecture, duplication, correctness, or docs. The wider final review caught it
  twice in one run (R2's YAGNI citation, R3's verification-evidence citation). Nothing in the
  phase looks at the phase's own consistency. Runs: mandatory-plan-review (2026-09-12, ×2).

## Rule candidates

A finding a zone wanted to raise as blocking but could not, because no rule in this repo
backs it. Each entry names the proposed wording and where it would live
(`BR-*`/`INV-*` in a domain spec, or a principle in `docs/CONTRIBUTING_AI.md`).

Precedent: YAGNI and DRY lived only in agent culture until 2026-09-12, so R2 could not block
on complexity. Recording them in `CONTRIBUTING_AI.md` made the citation legitimate.

- [×1] When a plan claims to extend a spec section "rather than revise" it, nothing requires
  the spec to gain a forward-pointer — so the spec can be left stating something the code no
  longer does. Proposed rule for `SUPERPOWERS_INTEGRATION.md` rule 3: an extension claim must
  be backed by a pointer in the extended section, or it is a documentation gap.
  Runs: review-self-improvement (2026-09-12).
- [×1] Resolved 2026-09-12: YAGNI and DRY are now recorded in `CONTRIBUTING_AI.md`,
  "Principles & Boundaries", so R2 blocks on complexity and on duplication. Kept as the worked
  example of how a rule candidate graduates; drop it once a second entry replaces it.
  Runs: mandatory-plan-review (2026-09-12).
