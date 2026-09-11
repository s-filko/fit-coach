# Design — Mandatory plan review phase

Add a non-skippable review phase between verification and close-out, executed by a
project-specific orchestrator skill that dispatches four independent review subagents.

- Governs: every plan in `docs/superpowers/plans/` from adoption onward
- Contract changed: `docs/SUPERPOWERS_INTEGRATION.md` (workflow, rules of engagement,
  status layer)
- Out of scope here: a machine gate in `scripts/state.mjs` (see section 7 — the artifact
  format is designed so that gate can be added later without touching existing plans)

## 1. Problem

The contract already names a review step (`verification-before-completion`,
`requesting/receiving-code-review`), but it is advisory prose: nothing distinguishes a
plan that was reviewed from one that was not, and nothing prevents `Status: done` on
unreviewed work. Three consequences:

1. **No record.** Review quality is invisible after the fact — there is no artifact in
   git saying what was checked, by whom, or with what verdict.
2. **Single-reader blur.** One agent reviewing its own (or another's) work switches
   between incompatible reading modes — architecture, duplication, correctness,
   documentation — and does all of them shallowly. Reviewing one's own work adds
   confirmation bias on top.
3. **Documentation rot is structurally favoured.** This repo declares durable specs to
   be law (`DOCUMENTATION_GUIDE.md`, "Context hygiene"). A law that has drifted from the
   code is worse than no law: it actively misleads the next agent. Yet doc drift is the
   cheapest thing to defer, so without a blocking check it is always deferred.

The owner's standard for this phase: **every merge is as clean, working and verified as
we can make it.**

## 2. Decisions

- **D1 — Four zones, not one reviewer.** Review is split by *mode of reading*, not by
  severity. Architecture reads shape and ignores function bodies; correctness does the
  opposite; duplication must search outside the diff entirely; documentation reads
  code-to-docs in reverse. These do not compose inside one context. Each zone is a
  separate subagent with a cold, independent context, dispatched in parallel; no
  subagent sees another's findings.
- **D2 — All four zones block.** A blocking finding in any zone prevents `Status: done`,
  and therefore prevents merge (close-out precedes merge per the existing contract).
  Documentation is blocking for the reason in section 1, point 3.
- **D3 — Two severities, one of which blocks.** `blocking` = a violation of a stated
  rule. `advisory` = an improvement that violates nothing. Advisory findings are **not**
  fixed on the branch; they go to `docs/BACKLOG.md` via the `backlog` skill. This keeps
  the bar high without making the phase unclosable.
- **D4 — Evidence, not impression.** A blocking finding must cite `file:line` **and** the
  rule it violates (AC-####, BR-*, INV-*, a contract rule, or an ADR). A finding without
  such a citation is advisory by definition. This is what stops the phase from
  degenerating into taste.
- **D5 — The reviewer does not fix.** The orchestrator reports; it never edits code.
  Fixes are a separate, owner-approved action. A reviewer that also implements loses the
  independence that justifies it.
- **D6 — Findings are relayed verbatim.** Subagent reports are not visible to the owner
  directly, only through the orchestrator's summary. The orchestrator must relay each
  finding in the subagent's own words. Paraphrase is where findings get quietly softened.
- **D7 — Enforcement is contractual, not mechanical** (owner's choice). The block lives
  in the contract and in the skill; no script verifies that the review happened. The
  known cost is stated in section 7.
- **D8 — Model is not pinned.** The skill inherits the invoking session's model; the
  owner may override per invocation. Independence comes from context isolation, not from
  a specific model.

## 3. Scope of a review

Input is the branch under review:

- **Diff**: the branch against its `merge-base` with `dev`.
- **Plan**: the plan file whose slug matches the branch (`plan/<slug>`), or whose
  `- Branch:` header names it — read in full, together with the spec it references.
- **Absent plan is a hard stop.** Without a plan there is no AC list and no declared
  verification path, so zones R3 and R4 have nothing to check against. The orchestrator
  stops and says so rather than producing a weaker review silently.

## 4. The four zones

Priority order below is also the order of cost-to-fix-after-merge.

### R1 — Architectural integrity

Reads the diff plus the structure of the layers it touches.

- SOLID in substance: one reason to change per new module; dependencies point inward
  toward the domain; interfaces do not force implementations to carry what they do not
  need.
- Boundaries declared in `docs/adr/0013-llm-core-target-architecture.md` are not blurred.
- A file that has grown past having a single purpose.
- **Always blocking:** a durable spec edited silently, in place of escalating to the
  owner (contract rule 3).

Out of zone: duplication (R2), logic bugs (R3).

### R2 — Duplication and unnecessary complexity

The only zone required to search **outside** the diff.

- Greps the codebase for an existing equivalent of the new code — copy-paste and
  reinvention both count.
- Abstraction with a single call site; a layer that adds no value; a flag where two
  honest functions belong. YAGNI as a checkable criterion.

Out of zone: overall architecture (R1).

### R3 — Correctness and proof

- Logic and edge cases over the diff.
- Every AC-#### in the plan has a test; `describe/it` names carry BR/AC references per
  CONTRIBUTING_AI.
- The plan's verification commands were **actually run**, with output — not judged by
  reading.
- Heightened attention to this repo's thin-test zones: `drizzle/` migrations,
  `deploy/deploy.sh`, env handling, `docker-compose.yml`.

### R4 — Documentation and spec currency

Reads **from code to docs**, the reverse of every other zone.

- **Stale:** docs describe what the code no longer does. (Precedent: `drizzle-kit push`
  was removed from every code path; any doc still presenting it as a live mechanism is
  now false.)
- **Distractors:** dead references to non-existent IDs; the same rule stated twice, in
  two places, with a divergence; leftover TODO/TBD; drafts posing as durable specs.
- **Gaps:** the change added something to code but not to the durable layer — an
  endpoint missing from `API_SPEC.md`, a business rule without a `BR-*`, an
  architectural decision without an ADR.
- **Layer discipline:** statuses have not leaked into durable docs (Status layer rule 4);
  English-only; the `STATE.md` AUTO block is not hand-edited; IDs are not reused.

**R1 vs R4:** R1 catches a spec *silently changed* (code rewrote the law behind the
owner's back — a process violation). R4 catches a spec *left behind* (the law stands, the
code moved — documentation rot). Different faults, different zones.

## 5. Artifact

Two records, both in the plan file, both in git.

> Extended 2026-09-12 by `docs/superpowers/plans/review-self-improvement.md`: the phase also
> writes `docs/REVIEW_FINDINGS.md`, a log of what it notices about itself. Those `meta`
> findings take no part in the verdict, so the two records below remain the artifact of a
> review; the log is a third file the skill writes.

**Header line**, alongside `- Status:` / `- Branch:` / `- After:`:

```
- Review: 2026-09-12 | clean | R1,R2,R3,R4
```

Date, verdict, zones covered. Machine-readable by design (section 7).

**`## Review` section** at the end of the plan: each blocking finding and how it was
closed; each advisory finding with a link to the backlog entry it became.

**The line is written only on a `clean` verdict.** While any blocking finding is open the
line is absent entirely — so its absence honestly means "not reviewed / not passed",
and no third state has to be encoded.

## 6. Contract changes (`docs/SUPERPOWERS_INTEGRATION.md`)

1. **Workflow diagram** — a mandatory `plan-review` phase between
   `verification-before-completion` and `finishing-a-development-branch`.
2. **Rules of engagement** — a new rule: `Status: done` is not set until `- Review:`
   records `clean`. Review precedes close-out; close-out precedes merge.
3. **Status layer** — `- Review:` documented beside `- Status:` in the "Where status
   lives" table, with its format and its write condition.
4. **Existing review skills are subordinated.** `requesting/receiving-code-review`
   remain, as techniques used inside the phase; `plan-review` is the phase itself.

## 7. Known limitation of contractual enforcement (D7)

Nothing in the repo verifies that a review occurred: `- Review: … | clean` is a claim the
agent makes about itself, and it can be written without doing the work. The owner accepted
this trade (no infrastructure, immediate adoption).

The artifact format in section 5 is chosen so that this can be closed later by a single check in
`scripts/state.mjs` — *"`Status: done` without a parseable `- Review: … | clean` line
fails `--check`"* — requiring no migration of plans written under this design, since they
already carry the line.

## 8. Acceptance criteria

IDs use the free `AC-14xx` block (per-initiative numbering, as `AC-13xx` is the LLM core
refactor's). `AC-0001`-`AC-0009` are taken by `docs/features/`.

1. **AC-1401 — Skill exists and is invocable.** `.claude/skills/plan-review/SKILL.md`
   exists; `/plan-review` on a branch with a plan produces a verdict.
2. **AC-1402 — Four subagents, parallel, isolated.** One invocation dispatches exactly
   four review subagents in a single parallel batch; no subagent's prompt contains another's
   findings.
3. **AC-1403 — No plan is a hard stop.** Invoked on a branch with no matching plan, the
   skill stops with an explicit message and produces no verdict.
4. **AC-1404 — Severity is enforced by evidence.** A finding presented as blocking without
   `file:line` plus a rule citation is reclassified advisory.
5. **AC-1405 — Verdict logic.** `blocked` if and only if at least one blocking finding is
   open; `clean` otherwise.
6. **AC-1406 — Artifact written only when clean.** The `- Review:` line appears only on a
   `clean` verdict; a blocked review leaves no header line and adds the `## Review`
   section with open findings.
7. **AC-1407 — Advisory routing.** Advisory findings are offered to `docs/BACKLOG.md` via
   the `backlog` skill and are not fixed on the branch.
8. **AC-1408 — Reviewer does not edit.** The skill performs no code edits; a run against a
   branch with blocking findings leaves the working tree unchanged apart from the plan file.
9. **AC-1409 — Contract updated.** `docs/SUPERPOWERS_INTEGRATION.md` carries all four
   changes in section 6; `node scripts/state.mjs --check` is green.

## 9. Risks

- **R-1 — Ritualisation.** A phase that always finds something gets routed around. Mitigated
  by D3/D4: only rule-violations block, everything else leaves the branch as backlog.
- **R-2 — Self-certification.** Per section 7, accepted deliberately; closable later by one check.
- **R-3 — Cost.** Four cold-context subagents per plan is the heaviest step in the workflow.
  Accepted: it runs once per plan, at the point where mistakes are most expensive to undo.
- **R-4 — Zone bleed.** Subagents drifting into each other's zones reproduce the single-reader
  blur. Mitigated by explicit "out of zone" clauses in each prompt.

## 10. Durable-doc impact

- `docs/SUPERPOWERS_INTEGRATION.md` — section 6 above. This is the durable law being changed;
  the change is owner-approved through this design.
- `docs/STATE.md` — no structural change; the AUTO block is untouched by this design.
- No ADR: this governs process, not runtime architecture.
