# Review Phase — Self-Observation Log

What the `close-out-review` phase notices about **itself**: prompts that mislead, gaps between
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
- [×1] R2's mandate is "does the new code duplicate something already in the repo", but a
  pure-deletion branch has almost no new code — its R2-relevant risk is the inverse: whether
  deleting one of two duplicate definitions left the surviving copy the wrong one (here, the
  dead training-intent.types.ts had drifted from the live set-data.types.ts, and the branch
  happened to keep the richer copy). Nothing in the prompt directs the reviewer to diff the
  deleted copy against its surviving twin. Suggested addition to the R2 brief: "On a deletion
  branch, when the removed code duplicated something that survives, diff the two copies and
  confirm the survivor is not the poorer one."
  Runs: refactor-p0-dead-code (2026-09-12).

## Blind spots

What fell between the zones — a real problem no zone's mandate covered, usually surfaced by
a wider reader (the final whole-branch review) or noticed after the fact.

- [×2] A zone prompt contradicting the shared severity contract falls between all four zones:
  it is not architecture, duplication, correctness, or docs. The wider final review caught it
  twice in one run (R2's YAGNI citation, R3's verification-evidence citation). Nothing in the
  phase looks at the phase's own consistency. Runs: mandatory-plan-review (2026-09-12, ×2).
- [×1] R4's mandate says "IDs are not reused — check any new AC-####/BR-*/INV-* against the
  repo", but the checked-in `node scripts/state.mjs --check` currently fails on this branch
  ("docs/STATE.md AUTO block is stale"). STATE.md is squarely in R4's layer-discipline
  checklist (AUTO block not hand-edited — it was not touched at all here, which is the
  problem), yet the prompt frames STATE.md only as a hand-edit hazard, never as something
  whose generated freshness the zone should verify. The plan's own Close-out section schedules
  the regen, so this is expected pre-close-out state rather than a defect — but the zone
  description gave no way to tell those two apart, and another reviewer running the same check
  could report it as blocking.
  Runs: refactor-p0-dead-code (2026-09-12).
- [×1] R3's zone asks it to confirm each AC has a test, but AC-1302 is a grep-and-green-checks
  criterion with no test of its own by design — it asserts an absence. There is no written
  guidance on how a reviewer discharges "every AC has a test" for absence-shaped ACs. R3
  treated re-running the grep and the three checks as the equivalent evidence; a line in
  SUPERPOWERS_INTEGRATION.md § Rules of engagement saying that absence-shaped ACs are verified
  by re-execution of their stated command rather than by a test would remove the ambiguity.
  Runs: refactor-p0-dead-code (2026-09-12).

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
- [×1] ADRs are historical decision records ("History is kept only where it is the point of
  the document", DOCUMENTATION_GUIDE:17), so ADR-0002 and ADR-0007 describing `PromptService`
  and `training-intent.types.ts` in the present tense is correct-by-design and R4 did not flag
  it. But ADR-0013:56/309 and LLM_CORE_REFACTOR_PLAN.md:41 are *forward-looking* durable specs
  that list these files as "delete now (zero consumers)" — after this branch the instruction is
  executed, not pending, and nothing in the repo says whether a durable spec's forward-looking
  scope list gets ticked, struck, or left alone once shipped. Proposed principle for
  `docs/CONTRIBUTING_AI.md`: "A durable spec's forward-looking scope list is never edited to
  record completion — completion lives in the plan's `Status:` and `STATE.md` (Status layer,
  rule 4). Reviewers must not flag an executed scope item as stale." Without this written down,
  R4 and R1 can reach opposite verdicts on the same three lines.
  Runs: refactor-p0-dead-code (2026-09-12).
- [×1] AC-1302 is stated as "type-check && lint && test:unit pass with the dead code removed",
  which is satisfiable by a diff that deletes a service AND its only tests — the check cannot
  distinguish preserved coverage from removed coverage. R3 had to diff the test file set
  between base and HEAD itself to establish the 240/240 baseline was like-for-like. Proposed
  principle for `docs/CONTRIBUTING_AI.md` (Testing section): "A deletion PR states the
  test-suite counts before and after; the two must match, or the PR names each removed test and
  why its subject no longer exists." This makes the deletion-vs-coverage distinction auditable
  from the PR rather than by re-deriving it at review time.
  Runs: refactor-p0-dead-code (2026-09-12).
- [×1] ADR-0013 §11 describes the post-refactor module layout, but nothing in the repo states
  how to mark a file that is a deliberate waypoint toward that layout rather than a
  destination. This branch handled it well by convention (a header comment naming the ADR and
  the phase that retires the file), but a reviewer has no written rule to cite either way.
  Proposed principle for `docs/CONTRIBUTING_AI.md`: "A module created as a temporary home
  during a phased refactor must carry a header comment naming the ADR/plan phase that retires
  it. A file in domain/ or infra/ whose path is absent from the target layout in the governing
  ADR and which carries no such comment is treated as an unplanned addition."
  Runs: refactor-p0-dead-code (2026-09-12).
- [×1] Resolved 2026-09-12: YAGNI and DRY are now recorded in `CONTRIBUTING_AI.md`,
  "Principles & Boundaries", so R2 blocks on complexity and on duplication. Kept as the worked
  example of how a rule candidate graduates; drop it once a second entry replaces it.
  Runs: mandatory-plan-review (2026-09-12).
