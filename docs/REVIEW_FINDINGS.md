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
- [×2] R2's mandate is "does the new code duplicate something already in the repo", but a
  pure-deletion branch has almost no new code — its R2-relevant risk is the inverse: whether
  deleting one of two duplicate definitions left the surviving copy the wrong one (here, the
  dead training-intent.types.ts had drifted from the live set-data.types.ts, and the branch
  happened to keep the richer copy). Nothing in the prompt directs the reviewer to diff the
  deleted copy against its surviving twin. Suggested addition to the R2 brief: "On a deletion
  branch, when the removed code duplicated something that survives, diff the two copies and
  confirm the survivor is not the poorer one." The third run adds the half that fix does not
  cover: the deletion also *orphaned* exports in the adjacent surviving file
  (`set-data.types.ts`'s `setDataTypeValues`/`SetDataType` lost their last consumer with the
  deleted prompt builder), and nothing directs the reviewer to check the survivor for exports
  the deletion just killed.
  Runs: refactor-p0-dead-code (2026-09-12), refactor-p0-dead-code (2026-09-12, third run).
- [×2] R4's brief says "If the diff edits a durable spec, that is R1's finding, not yours" —
  but ARCHITECTURE.md is itself listed in DOCUMENTATION_GUIDE § AI Execution Order step 4 as
  architectural truth, and the fix diff edits it. R4 judged the edit to be living-layout
  maintenance (the fix R4 itself demanded) rather than a silent law change, so it kept the
  finding. The R1/R4 boundary as written does not distinguish "durable spec's generated/living
  layout block" from "durable spec's normative rules", and on this branch the fix commit
  touched both kinds of block in one file. Third run, independently: R4 could not tell whether
  *incompleteness* of that ARCHITECTURE.md edit (a sibling doc left contradicting the corrected
  tree) was its finding or R1's, and kept it on the grounds that it is staleness left behind
  rather than law silently changed.
  Runs: refactor-p0-dead-code (2026-09-12, re-run), refactor-p0-dead-code (2026-09-12, third run).
- [×1] R3's brief asserted that "the current checkout is dev with the branch already merged, so
  HEAD reflects the post-change state", and R3 ran all verification against HEAD rather than the
  branch tip under review. Here the two differ by one merge commit that touches nothing R3 reads,
  so the results transfer — but the brief *asserts* the equivalence instead of asking the reviewer
  to establish it, and on a branch merged after divergent commits on dev the same instruction
  would silently produce verification output that is not evidence about the reviewed diff at all.
  The brief should say: confirm `git diff <branch-tip> HEAD` is empty for the paths you verify, or
  check out the branch tip.
  Runs: refactor-p0-dead-code (2026-09-12, third run).
- [×1] R4's brief lists "IDs are not reused — check any new AC-####/BR-*/INV-* against the repo"
  as an R4 duty, but a pure-deletion branch mints no IDs and the inverse risk is the live one:
  whether deleting code orphaned an existing ID whose only implementation lived in the deleted
  files. Suggested addition to the R4 brief: "On a deletion branch, check whether any BR-*/INV-*
  in docs/domain/ lost its only implementation."
  Runs: refactor-p0-dead-code (2026-09-12, third run).
- [×1] R2's brief makes any YAGNI/DRY hit blocking-eligible purely by naming the rule, with no
  severity gradient — a one-key dead object literal and a real architectural flaw land in the
  same blocking bucket, so the severity call is unanchored judgment.
  Runs: refactor-p0-run-log (2026-09-12).

## Blind spots

What fell between the zones — a real problem no zone's mandate covered, usually surfaced by
a wider reader (the final whole-branch review) or noticed after the fact.

- [×2] A zone prompt contradicting the shared severity contract falls between all four zones:
  it is not architecture, duplication, correctness, or docs. The wider final review caught it
  twice in one run (R2's YAGNI citation, R3's verification-evidence citation). Nothing in the
  phase looks at the phase's own consistency. Runs: mandatory-plan-review (2026-09-12, ×2).
- [×2] R3's zone asks it to confirm each AC has a test, but AC-1302 is a grep-and-green-checks
  criterion with no test of its own by design — it asserts an absence. There is no written
  guidance on how a reviewer discharges "every AC has a test" for absence-shaped ACs. R3
  treated re-running the grep and the three checks as the equivalent evidence; a line in
  SUPERPOWERS_INTEGRATION.md § Rules of engagement saying that absence-shaped ACs are verified
  by re-execution of their stated command rather than by a test would remove the ambiguity.
  Runs: refactor-p0-dead-code (2026-09-12), refactor-p0-dead-code (2026-09-12, third run).
- [×2] The plan's normative step code and Architecture prose are not reconciled against the
  shipped implementation by any zone: refactor-p0-run-log's plan still showed the
  `configurable`-channel handler that live verification had proved dead (fixed only in the
  Task 6 deviation prose), so a future agent re-executing the plan text verbatim would
  reintroduce the zero-token bug. No zone's mandate covers "plan step-code vs shipped code"
  consistency.
  Runs: refactor-p0-run-log (2026-09-12, R1+R2).
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
- [×1] Re-running a zone after a fix commit gives the reviewer no defined baseline. The prompt
  supplied the original base SHA, so R1's diff spanned the whole branch and re-reviewed five
  commits already cleared by the first run, while the actual new material was one commit.
  There is no instruction on whether a re-run re-opens settled ground (and may reach a
  different verdict on unchanged code than the first run did) or reviews only the delta since
  the previous verdict. Suggested addition to the close-out-review skill: a re-run states both
  SHAs — the original base for context and the previous verdict's HEAD as the review boundary
  — and re-reports a prior-run finding only if the fix commit changed the code it cited.
  Runs: refactor-p0-dead-code (2026-09-12, re-run).
- [×1] The re-run mandate asked R4 to verify three closures plus "any new documentation rot the
  fix introduced", but gave no instruction on the previous run's advisories. A fix commit can
  silently alter or resolve an advisory line, which would change what should reach
  `docs/BACKLOG.md`. R4 re-verified all eight by grep on its own initiative; a re-run brief
  should state explicitly whether prior advisories are in scope.
  Runs: refactor-p0-dead-code (2026-09-12, re-run).
- [×1] The AC-1302 coverage hole is structural, not incidental: the plan's verification set
  cannot reach the one line in the diff that changes runtime behaviour (the dropped DI
  registration), and no zone has a mandate to construct the missing proof. R3 had to write a
  throwaway probe test outside the repo's own suites to satisfy itself that
  `registerInfraServices()` still resolves, then delete it — a reviewer who declined to do that
  would have returned "clean" on an unverified DI change. The zone brief should state whether R3
  is expected to build missing proof or only to report its absence.
  Runs: refactor-p0-dead-code (2026-09-12, third run).
- [×1] R1 owns "declared boundaries" against ADR-0013 §11, but §11 is a *target-state* layout, so
  on a phased refactor every intermediate commit necessarily deviates from it. Nothing tells the
  reviewer how to distinguish a sanctioned waypoint from an unplanned addition. This branch
  handled it by convention (a header comment on `domain/ai/types.ts` naming the ADR and the
  retiring phase), which R1 accepted — but with no rule to cite in either direction, a stricter
  reviewer could have called the same file a boundary blur.
  Runs: refactor-p0-dead-code (2026-09-12, third run).
- [×1] `npm run test:integration` exits 134 (libc++abi abort in onnxruntime teardown, likely a
  corrupt local all-MiniLM-L6-v2 cache) after all 118 tests pass — the verification command
  fails by exit code in this worktree despite a green suite. Pre-existing and environmental,
  but it means exit codes cannot be treated blindly as the verification gate; a zone or
  executor that checks `$?` alone would report a failure the suite output contradicts.
  Runs: refactor-p0-run-log re-run (2026-09-12).

## Rule candidates

A finding a zone wanted to raise as blocking but could not, because no rule in this repo
backs it. Each entry names the proposed wording and where it would live
(`BR-*`/`INV-*` in a domain spec, or a principle in `docs/CONTRIBUTING_AI.md`).

Precedent: YAGNI and DRY lived only in agent culture until 2026-09-12, so R2 could not block
on complexity. Recording them in `CONTRIBUTING_AI.md` made the citation legitimate.

- [×2] R1's "always blocking" rule treats any `docs/` edit outside `docs/superpowers/` as
  blocking unless escalated, but gives the reviewer no positive test for what a *discharged*
  escalation looks like in the diff. Judging the fix commit required evidence that lives
  outside the diff entirely — the owner's instruction, in a conversation the reviewer cannot
  see — and the only in-repo trace is prose in the plan's `## Review` section. Proposed wording
  for `SUPERPOWERS_INTEGRATION.md` rule 3: "A durable-spec edit made on an execution branch is
  legitimate only when the plan's `## Review` (or `## Execution notes`) section records, before
  the edit's commit, the finding that prompted it and the owner's instruction to fix; the commit
  message references that record. A reviewer treats such an edit as discharged escalation, not a
  silent edit. An edit with no such record is blocking regardless of how correct it is." This
  makes the distinction auditable from the branch alone. Independently re-derived by the third
  run's R1, which had to reconstruct legitimacy from commit timestamps (escalation record at
  13:49 preceding the edit at 14:15) — confirming the gap is systemic, not incidental.
  Runs: refactor-p0-dead-code (2026-09-12, re-run), refactor-p0-dead-code (2026-09-12, third run).
- [×1] When a plan claims to extend a spec section "rather than revise" it, nothing requires
  the spec to gain a forward-pointer — so the spec can be left stating something the code no
  longer does. Proposed rule for `SUPERPOWERS_INTEGRATION.md` rule 3: an extension claim must
  be backed by a pointer in the extended section, or it is a documentation gap.
  Runs: review-self-improvement (2026-09-12).
- [×1] ADR-0002 is the case the "forward-looking scope list" candidate below does not cover.
  That candidate handles a durable spec listing work to be done; this is a durable spec stating
  a live prescriptive rule that the code has now outgrown, where the same rule is also mirrored
  in ARCHITECTURE.md. Fixing one and not the other is a divergence R4 must flag but cannot
  resolve, and R1 sees no violation because the branch did not touch the spec. Proposed
  principle for `docs/CONTRIBUTING_AI.md`: "When a prescriptive rule is stated in both
  ARCHITECTURE.md and its source ADR, a change that narrows the rule in ARCHITECTURE.md must be
  accompanied by an owner-approved ADR amendment or a backlog entry naming the divergence; a
  reviewer flags the unamended ADR as advisory, never blocking."
  Runs: refactor-p0-dead-code (2026-09-12, re-run).
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
- [×1] Nothing requires a plan's ticked checkbox to correspond to an action actually taken when
  the step turns out to be vacuous: this plan's Task 3 Step 3 ("Remove the parser's tests") is
  ticked, but no test at base ever referenced the parser, so the step was a no-op — and the
  Execution notes, which disclose two other survey/reality divergences, do not mention it.
  Proposed principle for `docs/CONTRIBUTING_AI.md` (Testing/process section) or
  `SUPERPOWERS_INTEGRATION.md` § Status layer: "A step whose prescribed action proves unnecessary
  is ticked only with a note — in the step or in Execution notes — saying it was a no-op and why.
  An unannotated tick asserts the action was performed." This matters for deletion plans
  specifically, where 'removed the tests' and 'there were no tests' have identical end states but
  very different implications for coverage.
  Runs: refactor-p0-dead-code (2026-09-12, third run).
- [×1] A doc-rot fix can legitimately manufacture new doc rot, and no rule makes that blocking.
  This branch's fix commit corrected `registration.validation.ts`'s location in ARCHITECTURE.md's
  module tree but left `FEAT-0006:115` stating the old `validation/` path — a divergence created
  *by the fix*. DOCUMENTATION_GUIDE § Context hygiene ("One current, unambiguous version of
  everything") reads as a principle, not an obligation attached to an edit. Proposed principle for
  `docs/CONTRIBUTING_AI.md`: "When a fix corrects a file path or module location in one document,
  grep the repo for that path and correct or backlog every other occurrence in the same commit. A
  fix that leaves a sibling statement of the same fact uncorrected has created a divergence, and a
  reviewer flags it as blocking on the fix commit."
  Runs: refactor-p0-dead-code (2026-09-12, third run).
- [×1] Nothing in the repo says an advisory recorded in a plan's `## Review` section must not also
  be copied into `docs/BACKLOG.md` verbatim — this branch stores all six of its advisories twice
  in near-identical prose with no ID linking the pair, so the two copies must be kept in sync or
  diverge. Proposed principle for `docs/CONTRIBUTING_AI.md` (Documentation System): "A review
  advisory has one durable home — `docs/BACKLOG.md`. The plan's `## Review` section records the
  verdict and the *count* of advisories filed, not their text; reproducing the prose in both
  places creates two copies that drift." This would make the finding blocking-or-clean instead of
  ambiguous.
  Runs: refactor-p0-dead-code (2026-09-12, third run).
- [×1] The plan's per-task verification commands are evidenced only by ticked checkboxes;
  Task 6 was the only task with pasted command output. Proposed rule for
  `SUPERPOWERS_INTEGRATION.md` close-out: a plan records one line of actual command output
  (e.g. the Jest suite summary) per task, so R3's "verification was run" check reads evidence
  instead of trusting ticks.
  Runs: refactor-p0-run-log (2026-09-12).
- [×1] `SUPERPOWERS_INTEGRATION.md` enumerates durable specs (ADRs, domain/feature specs,
  API_SPEC, LLM_CORE_REFACTOR_PLAN, PROMPT_EVAL_FRAMEWORK) — DB_SETUP.md and ARCHITECTURE.md
  are not on the list, so their currency is enforced only by DOCUMENTATION_GUIDE prose; the
  refactor-p0-run-log run's four blocking R4 findings all accumulated in exactly that gap.
  Proposed: add both files to the enumerated list (or a "living layer" companion list with the
  same reconcile duty).
  Runs: refactor-p0-run-log (2026-09-12).
- [×1] Resolved 2026-09-12: YAGNI and DRY are now recorded in `CONTRIBUTING_AI.md`,
  "Principles & Boundaries", so R2 blocks on complexity and on duplication. Kept as the worked
  example of how a rule candidate graduates; drop it once a second entry replaces it.
  Runs: mandatory-plan-review (2026-09-12).
