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

**Findings about the review phase itself** — a prompt that misled you, a gap your mandate does
not cover, a rule you wanted to cite as blocking but could not find written down anywhere in
this repo — are a separate kind. Mark them `meta` in place of a severity:

`meta | ZONE | <prompt defect | blind spot | rule candidate> | what you noticed`

For a rule candidate, propose the wording and say where it would live (`BR-*`/`INV-*` in a
domain spec, or a principle in `docs/CONTRIBUTING_AI.md`). A `meta` finding never affects the
verdict and never blocks a merge; the orchestrator files it in `docs/REVIEW_FINDINGS.md`.

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

YAGNI is the rule you cite for the last three, and DRY for duplication — both are recorded
in `docs/CONTRIBUTING_AI.md`, "Principles & Boundaries", so both satisfy the blocking test
above. Cite that section by name, and for duplication cite both sites as `file:line`.

Out of zone: overall architecture and layer boundaries (R1), logic bugs (R3), docs (R4).
