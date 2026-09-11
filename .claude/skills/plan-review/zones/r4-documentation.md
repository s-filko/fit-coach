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
