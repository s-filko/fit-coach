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
