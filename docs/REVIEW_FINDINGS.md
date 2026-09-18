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

- [×1] A plan's predicted evidence counts were wrong where the close-out asks the executor to
  record actuals: Task 1 Step 4 predicted "24 snapshots … 6 blocks" but the suite has 23
  (five block `it`s, not six), and the close-out instruction says to record the snapshot
  count — so the recorded number must be re-derived, not copied from the plan's prose.
  Runs: refactor-p2-prompt-modules (2026-09-16).

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
- [×1] Zone briefs named the plan file on `dev` but not the prepared branch worktree, so
  per-file tooling silently failed against the working tree ("No files matching the pattern")
  until the reviewer discovered `../fit_coach-<slug>/` on its own. R3 independently noted the
  inverse half: the brief directs reading the plan's *claimed* verification output, which on
  this run was materially wrong in the executor's favour (it called a branch-introduced lint
  error "pre-existing" and framed the glob defect as cosmetic rather than as the invalidation
  of its own evidence). A reviewer who honoured "verification was run, output pasted" by
  reading would have passed three blocking findings. Briefs should name the worktree path and
  say that claimed output is a claim, not evidence.
  Runs: ports-layout-consistency (2026-09-14).
- [×2] R4's brief says "If the diff edits a durable spec, that is R1's finding, not yours" —
  but ARCHITECTURE.md is itself listed in DOCUMENTATION_GUIDE § AI Execution Order step 4 as
  architectural truth, and the fix diff edits it. R4 judged the edit to be living-layout
  maintenance (the fix R4 itself demanded) rather than a silent law change, so it kept the
  finding. The R1/R4 boundary as written does not distinguish "durable spec's generated/living
  layout block" from "durable spec's normative rules", and on this branch the fix commit
  touched both kinds of block in one file. Third run, independently: R4 could not tell whether
  *incompleteness* of that ARCHITECTURE.md edit (a sibling doc left contradicting the corrected
  tree) was its finding or R1's, and kept it on the grounds that it is staleness left behind
  rather than law silently changed. Third occurrence, same seam from a new angle: this diff
  *edited* ARCHITECTURE.md's rule section (R1's territory) while leaving other parts of the
  same file — the module tree and the DI "Import Strategy" line — contradicting the new rules.
  R4 read those unedited parts as in-zone staleness; the boundary as written does not assign a
  file that is partly edited and partly left behind.
  Runs: refactor-p0-dead-code (2026-09-12, re-run), refactor-p0-dead-code (2026-09-12, third run), ports-layout-consistency (2026-09-14).
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
  same blocking bucket, so the severity call is unanchored judgment. Second occurrence, the
  scope-deadlock variant: R2's zone prompt states DRY "satisfies the blocking test", but a
  duplication whose only clean fix touches files the plan explicitly freezes would deadlock
  the close-out against the plan's own constraints — blocking-eligibility needs an escape
  hatch ("duplication is blocking only when an in-branch fix exists that does not violate
  the plan's scope constraints").
  Runs: refactor-p0-run-log (2026-09-12), refactor-p1-legacy-llm-retirement (2026-09-16).

- [×1] A plan's Files list named `domain/training/ports/service.ports.ts` where the tree has
  `training-service.ports.ts` — the executor coped, but a plan-writing phase that does not
  verify cited paths against the tree turns every such reference into executor guesswork that
  review must then re-verify.
  Runs: refactor-p1-legacy-llm-retirement (2026-09-16).
- [×1] The orchestrator's re-review brief asserted the diff touches no env handling, while
  Task 2 is env parsing by design — zone briefs written from memory of the plan rather than
  from its file list inject errors the zone must notice and route to meta on its own.
  Runs: refactor-p1-legacy-llm-retirement (2026-09-16).

## Blind spots

What fell between the zones — a real problem no zone's mandate covered, usually surfaced by
a wider reader (the final whole-branch review) or noticed after the fact.

- [×1] AC-1322's "within ±2 pp of v0" was proven loosely: run 1 exceeded the threshold on
  three checks and the criterion was closed by "did not reproduce on re-run" (n=3, fresh
  samples each run). The plan's Step 3 protocol authorises exactly this, and the evidence JSON
  honestly notes it is hand-assembled from console output (the comparator writes no
  machine-readable report). Rule candidate: when noise is suspected, require either two full
  runs with a computed delta or a larger n before declaring "within ±2 pp".
  Runs: refactor-p2-context-assembler (2026-09-17).

- [×1] R2's mandate excludes plan-sanctioned shapes, which by design left YAGNI coverage over
  the new `prompts/` tree thin: the repeating ~10-line render-context literal across the five
  subgraphs is plan-prescribed and owned by refactor-p2-context-assembler, so it was not
  filed — but nothing tracks that the exclusion was exercised, only that it existed.
  Runs: refactor-p2-prompt-modules (2026-09-16).

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
- [×1] A zone told to "read for shape" systematically misses violations that a broken
  verification command conceals. R1's decisive facts on two blocking findings were only
  discoverable by *running* eslint against the branch worktree: the diff reads clean, and
  `npm run lint` passes because its unquoted glob lints 7 of 137 files. R3 reached the same
  conclusion from its own side — a verification command counts as evidence only for files it
  demonstrably reads. The skill should say a zone may execute the repo's own lint/type-check
  against the branch tree, and that a passing verification command itself requires verification.
  Runs: ports-layout-consistency (2026-09-14).
- [×2] A type-only refactor plan with no `AC-####` ids slips through R3's "every AC has a test"
  check by having no ACs to check — this plan states four prose clauses instead, and defines no
  tests. `SUPERPOWERS_INTEGRATION.md` rule 2 requires plan tasks to cite the AC they implement;
  nothing catches a plan that cites none. R1 noticed the same absence and flagged it as outside
  its zone, so the gap is visible to reviewers but owned by none. Second occurrence: a promoted
  backlog-finding plan (not a phase-spec task) also carries no ACs by design — R3 correctly
  treated the absence as inapplicable rather than a gap, but the zone brief still gives no
  explicit instruction for this plan shape, so the correct call was judgment, not guidance.
  Runs: ports-layout-consistency (2026-09-14), lint-glob-fix (2026-09-14).
- [×1] R2 has no rule for duplication that is *pre-existing and untouched by the branch* but
  which the branch's own rename broke: the eval stub's comment anchoring a hand-mirrored domain
  type cited `service.ports.ts`, a filename this diff renamed. R2 reported it advisory on the
  reading that severity is earned by the diff's own defects, while noting a reviewer could
  equally argue the rename obliges this branch to fix the citation it broke.
  Runs: ports-layout-consistency (2026-09-14).
- [×1] `npm run test:integration` exits 134 (libc++abi abort in onnxruntime teardown, likely a
  corrupt local all-MiniLM-L6-v2 cache) after all 118 tests pass — the verification command
  fails by exit code in this worktree despite a green suite. Pre-existing and environmental,
  but it means exit codes cannot be treated blindly as the verification gate; a zone or
  executor that checks `$?` alone would report a failure the suite output contradicts. Second
  occurrence, on the plain unit run this time: `npx jest --ci` also exits 134 after an
  all-green summary (proven pre-existing by re-running the base commit in a temp worktree),
  and the orchestrator's known-acceptable-artifacts list covered only the integration variant
  — a reviewer re-running the stated verification command hit a non-zero exit and faced a
  false blocking call.
  Runs: refactor-p0-run-log re-run (2026-09-12), refactor-p2-prompt-modules (2026-09-16).

- [×1] A known-and-accepted carve-out (FEAT-0003's stale LLMService diagram is P7-owned)
  lives only in the master plan's phase map; the review brief's known-and-accepted list is
  assembled ad hoc each round, so the same carve-out must be re-derived or gets re-flagged.
  Runs: refactor-p1-legacy-llm-retirement (2026-09-16).

- [×1] "Every AC has a test" has no procedure for promised test files that simply do not
  exist while the task's broad jest command still passes: the adapter and commit/handler
  test files listed in plan tasks were never written, the old persist.node tests were
  deleted without re-homing, and the suite stayed green because nothing referenced them.
  Proposed companion rule: a plan task's listed test files must exist at close-out, and
  deleting old behavioural tests requires naming where each `it` moved.
  Runs: refactor-p3-run-context-commit (2026-09-17).

- [×1] The zone rule "every AC has a test; a claimed AC with no test is blocking" misfires
  on this plan's two live/budget-gated ACs: AC-1345 is by definition live-DB evidence and
  AC-1344 is owner-gated with a sanctioned pending state. Rule candidate for the zone file
  (or a principle in docs/CONTRIBUTING_AI.md): "An AC whose own text defines live-evidence
  or budget-gated proof is verified by the evidence artifact named in the plan (pasted
  output, ledger row, evidence JSON), not by a test suite; blocking applies only when the
  named artifact is absent." Distinct from the absence-shaped-AC entry above: that one
  discharges by re-executing a stated command, this one by an artifact the plan names.
  Runs: refactor-p4-episode-memory (2026-09-18).

## Rule candidates

A finding a zone wanted to raise as blocking but could not, because no rule in this repo
backs it. Each entry names the proposed wording and where it would live
(`BR-*`/`INV-*` in a domain spec, or a principle in `docs/CONTRIBUTING_AI.md`).

Precedent: YAGNI and DRY lived only in agent culture until 2026-09-12, so R2 could not block
on complexity. Recording them in `CONTRIBUTING_AI.md` made the citation legitimate.

- [×2] A helper extracted into a shared module leaves its pre-existing call sites untouched,
  and no rule says that is unfinished. On this branch Task 2 moved the domain renderers into
  `prompts/blocks/` and only `training/v1.ts` was repointed; `chat/v1.ts`, `plan_creation/v1.ts`
  and `session_planning/v1.ts` kept byte-identical copies for three review passes, each pass
  paying to rediscover them. The plan's own text required the import-back, but a reviewer with
  no plan would have had nothing to cite. Proposed principle for `docs/CONTRIBUTING_AI.md`
  § Principles & Boundaries, next to the DRY bullet: "When a helper is extracted into a shared
  module, every pre-existing call site in the same change is repointed to it. A new shared
  module standing beside surviving copies is a partial extraction, not an accepted intermediate
  state." Second occurrence, the type-level variant, from the fix to the fix: `RenderableBlock<D>`
  and `BudgetBlockInput<D>` were declared field-for-field identically in two modules purely so
  values could cross a module boundary, i.e. a duplication fix that introduced a duplicate type.
  The same bullet should cover it: "Do not declare a second interface that is a structural subset
  of an existing one to decouple two modules; import the canonical type, or narrow it with
  `Pick`/`Omit`." Runs: refactor-p4-context-budget (2026-09-19, R2 second and third passes).
- [×1] BR-LLM-005 says pruning never deletes the latest checkpoint per `(thread_id,
  checkpoint_ns)`, and says nothing about the blobs those checkpoints reference or about
  checkpoints retained by age rather than by being latest. The gap let a correct-looking query
  delete blobs belonging to a younger-than-cutoff, non-latest checkpoint, silently making that
  checkpoint unloadable — the sort of defect a reviewer can only call blocking by citing a rule
  that does not yet exist. Proposed amendment to ADR-0013 §3.3 (escalated to the owner, not
  edited): "Pruning retains every checkpoint younger than the cutoff, not only the latest per
  `(thread_id, checkpoint_ns)`. Blob deletion is scoped by the same retention test: a blob
  version referenced by any retained checkpoint's `channel_versions` is never deleted."
  Runs: refactor-p4-context-budget (2026-09-19, R3).
- [×1] Blocks under `prompts/blocks/` are one-per-file except `training-workout-overview.v1.ts`,
  which holds four. Nothing states the convention, so R1/R2 could only file the inconsistency as
  advisory — and the plan's own Task 2 file list names four separate training files that were
  never created, meaning the plan and the tree disagree with no rule to arbitrate. Proposed
  principle for `docs/CONTRIBUTING_AI.md` § "Adding a context block": "One `ContextBlock` per
  file, named `blocks/<phase>-<section>.vN.ts`. Blocks that share a data shape may share a
  render helper, but each block gets its own module." Runs: refactor-p4-context-budget (2026-09-19, R1/R2).
- [×1] `docs/adr/0013-llm-core-target-architecture.md` §11 names the `domain/** →
  @langchain/*` boundary as an explicit invariant, but not the app→infra boundary that
  `eslint.config.js`'s `boundaries/element-types` rule also enforces (`app` may only import
  `domain, shared, config`). When a diff suppresses a violation of that second boundary with a
  documented `eslint-disable`, R1 has no ADR-citable rule to hang either a `blocking` or a
  confident `advisory` verdict on for that specific edge — it fell back to judging the
  suppression's shape (scoped, dated, cross-referenced) rather than citing a named invariant.
  Proposed: add the app→infra edge to ADR-0013 §11 (or a new `INV-ARCH-###` in
  `ARCHITECTURE.md`) alongside the existing domain/langchain one, so future R1 reviews of an
  app-layer file importing infra have a rule to cite in either direction.
  Runs: lint-glob-fix (2026-09-14).
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
  13:49 preceding the edit at 14:15) — confirming the gap is systemic, not incidental. Third
  run, the standing-delegation variant: the owner delegated an obvious-fix class mid-review and
  it was recorded as a paragraph in rule 3 of SUPERPOWERS_INTEGRATION.md — edited by the very
  branch it authorizes, so a future reader cannot distinguish an owner ruling from
  self-authorization until the branch merges. Same proposal, same fix: the ruling and its
  provenance must be auditable from the branch (plan record + commit), not from a conversation.
  Runs: refactor-p0-dead-code (2026-09-12, re-run), refactor-p0-dead-code (2026-09-12, third run), refactor-p1-legacy-llm-retirement (2026-09-16).
- [×1] The AC/BR-in-test-name convention is real (confirmed by training.subgraph.unit.test.ts
  precedent) but is not written down anywhere central — CONTRIBUTING_AI.md states it in prose
  ("IDs must appear... in tests") while apps/server/TESTING.md, the doc CONTRIBUTING_AI.md defers
  to for "test rules and structure," shows zero examples of it and CONTRIBUTING_AI.md's own
  precedence clause says TESTING.md should win on conflict. Recommend TESTING.md §2 (Naming and
  Structure) add an explicit example/rule: "when a test covers a BR-*/AC-*/ADR-* item, name the
  describe/it block to include that ID," removing the ambiguity that made me have to search actual
  test files to confirm the norm rather than reading one authoritative line.
  Runs: refactor-p0-eval-harness (2026-09-13).
- [×1] When a plan claims to extend a spec section "rather than revise" it, nothing requires
  the spec to gain a forward-pointer — so the spec can be left stating something the code no
  longer does. Proposed rule for `SUPERPOWERS_INTEGRATION.md` rule 3: an extension claim must
  be backed by a pointer in the extended section, or it is a documentation gap. Second
  occurrence, the deferred-check variant: a plan that *ships* a spec's deferred check
  (PROMPT_EVAL_FRAMEWORK §4.1 "section presence is deferred") falsifies the deferring
  sentence in the same branch, yet its docs-reconciliation file list named only the docs it
  intended to touch — nothing makes the plan own the spec sentence it invalidated.
  Runs: review-self-improvement (2026-09-12), refactor-p2-prompt-modules (2026-09-16).
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
  Second occurrence, sharpened: here a *layout* rule and a *dependency* invariant gave opposite
  instructions for one file, and nothing said which wins — obeying rule 1 moved a LangChain-typed
  contract into the domain's clean port surface. Proposed clause on rule 1 in `ARCHITECTURE.md`
  § Interface Organization Principles: "A contract that cannot yet satisfy the domain's dependency
  invariants (e.g. INV-CONV-004) is not relocated into `ports/` merely to satisfy rule 1; it stays
  where it is, annotated with the ADR that will retire it." Adopted on this branch (2026-09-14);
  kept here because the general form — layout rule versus invariant — will recur.
  Runs: refactor-p0-dead-code (2026-09-12), ports-layout-consistency (2026-09-14).
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
- [×2] A doc-rot fix can legitimately manufacture new doc rot, and no rule makes that blocking.
  This branch's fix commit corrected `registration.validation.ts`'s location in ARCHITECTURE.md's
  module tree but left `FEAT-0006:115` stating the old `validation/` path — a divergence created
  *by the fix*. DOCUMENTATION_GUIDE § Context hygiene ("One current, unambiguous version of
  everything") reads as a principle, not an obligation attached to an edit. Proposed principle for
  `docs/CONTRIBUTING_AI.md`: "When a fix corrects a file path or module location in one document,
  grep the repo for that path and correct or backlog every other occurrence in the same commit. A
  fix that leaves a sibling statement of the same fact uncorrected has created a divergence, and a
  reviewer flags it as blocking on the fix commit."
  Second occurrence, the rename variant: three of R4's four blocking findings on this branch
  were one failure mode — the diff renamed files and the durable docs citing those paths were
  not swept. Proposed wording, for the same `CONTRIBUTING_AI.md` § Docs-First Workflow: "When a
  change renames, moves, or deletes a file that durable docs cite by path, `grep -rn
  '<old-basename>' docs/` and update every hit in the same change; a stale path in a durable doc
  is a defect, not a leftover." This makes the sweep a checkable close-out step rather than
  reviewer judgement. Third run, both halves at once: a deletion branch's reconciliation commit
  fixed exactly the named findings in exactly the named files instead of re-running the class
  sweep — the next review round found two more same-class hits (LOGGING_GUIDE, CONTRIBUTING_AI)
  that a class grep over the deleted identifiers would have caught in the same commit; and the
  R4-round-1 meta ("a task that deletes a file must grep all durable docs for the deleted
  identifiers, not just the lines the plan names") was itself the missing written rule.
  Runs: refactor-p0-dead-code (2026-09-12, third run), ports-layout-consistency (2026-09-14), refactor-p1-legacy-llm-retirement (2026-09-16).
  Fourth occurrence, the replace variant: a plan's docs-reconcile step enumerated the files to
  fix by name and missed a bystander durable doc (ARCHITECTURE.md still describing the registry
  as "PHASE_PROMPTS (+ blocks per phase)" after the branch replaced `blocks` with
  `layout`+`blocksForLayout`) — R4's meta proposes the same mechanical cure: a pre-close-out
  grep sweep over docs/ for the names the diff moved, not a hand-written file list.
  Runs: refactor-p2-context-assembler (2026-09-17).
- [×1] Nothing in the repo says an advisory recorded in a plan's `## Review` section must not also
  be copied into `docs/BACKLOG.md` verbatim — this branch stores all six of its advisories twice
  in near-identical prose with no ID linking the pair, so the two copies must be kept in sync or
  diverge. Proposed principle for `docs/CONTRIBUTING_AI.md` (Documentation System): "A review
  advisory has one durable home — `docs/BACKLOG.md`. The plan's `## Review` section records the
  verdict and the *count* of advisories filed, not their text; reproducing the prose in both
  places creates two copies that drift." This would make the finding blocking-or-clean instead of
  ambiguous.
  Runs: refactor-p0-dead-code (2026-09-12, third run).
- [×1] Nothing requires a verification command to be *proven to cover the changed files*, so a
  plan can cite a command that reads none of them and report it green. Both defects found here
  are of that shape: `npm run lint`'s unquoted glob reaches 7 of 137 files, and
  `npm run test:unit`'s `--testMatch` patterns never load `tests/unit/**`, the location of the
  only test the branch modified. Proposed principle for `docs/CONTRIBUTING_AI.md` (Testing):
  "A verification command counts as evidence only for files it demonstrably reads. Before citing
  `npm run lint` or `npm run test:unit` as a task's verification, confirm the changed files appear
  in its file list (`--listTests` for jest, explicit paths for eslint). Shell-glob scripts are
  presumed not to recurse." This would have caught both at execution time rather than at review.
  Runs: ports-layout-consistency (2026-09-14).
- [×1] No rule forbids hand-mirroring a domain type in test/eval fixtures instead of importing
  it, which is why the strongest duplication R2 found could only be advisory. Proposed wording for
  `docs/CONTRIBUTING_AI.md` § Principles & Boundaries: "Test and eval fixtures import the domain
  type they stand in for; they never restate its field list. When a fixture must build a
  structural stub, it is typed against the port (`satisfies`/`: T`) so drift fails type-check
  rather than silently diverging." That would make this class machine-detectable.
  Runs: ports-layout-consistency (2026-09-14).
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
- [×1] Plans that "lift" a helper into `tests/helpers/` should also instruct deleting or
  importing-over the source copy — this run's executor faithfully created the duplicate the
  plan text prescribed. Proposed plan-writing rule (SUPERPOWERS_INTEGRATION § writing-plans or
  the skill): a lift step names the source copy's fate.
  Runs: refactor-p1-legacy-llm-retirement (2026-09-16).
- [×1] The English-only rule does not state whether quoted data is exempt, yet durable specs
  necessarily contain Russian eval/user-message strings and UI copy inside code blocks; each
  review decides the prose-vs-quoted-data boundary ad hoc. Proposed clarification in root
  CLAUDE.md / CONTRIBUTING_AI.md language rules.
  Runs: refactor-p1-legacy-llm-retirement (2026-09-16).
- [×1] A PROPOSED-status ADR can internally conflict (ADR-0013 §7's "AIMessage, no ChatMsg"
  port wording vs its own D-13/§11/INV-CONV-004), forcing the plan to adjudicate the ADR
  against itself. Proposed convention for CONTRIBUTING_AI.md (ADRs): PROPOSED ADRs may carry a
  dated errata note when a later section contradicts an earlier one, so executors cite the
  errata instead of re-deriving the adjudication.
  Runs: refactor-p1-legacy-llm-retirement (2026-09-16).
- [×1] The close-out checklist (plan "Close-out" section) runs `state.mjs --write` but never
  mentions reconciling the hand-written STATE.md "Next" items the plan invalidated — here the
  P2 item still claimed the fixed detector cases PC-0007/SP-0005 "must clear at 3/3 as part of
  the prompt rework" although the plan's zero-wording-change constraint makes that impossible
  and the AC-1322 result records the opposite. Proposed standing close-out step: after
  `--write`, read every hand-written STATE.md claim the plan's outcome falsified and fix it.
  Runs: refactor-p2-prompt-modules (2026-09-16).
- [×1] Endpoint-retiring plans should require a caller inventory cross-check — grep every
  `apiRequest`/fetch method+path in all client apps against the server route table — not a
  per-feature keyword grep; the keyword approach ("recommend") is exactly how a POST /plan
  caller survived the analysis and cost a review round. Proposed for the writing-plans skill
  or CONTRIBUTING_AI.md (process).
  Runs: refactor-p1-legacy-llm-retirement (2026-09-16).
- [×1] Positive result worth codifying: mid-review scope changes handled as an "Extension"
  paragraph in the plan's Global Constraints (ruling + scope + limits, committed before the
  fix) made the fix testable and the review decisive — propose it as the standard mechanism
  for owner-ruling scope extensions during plan execution.
  Runs: refactor-p1-legacy-llm-retirement (2026-09-16).
- [×1] A plan's Global Constraint said "run context is provided by the caller, never mutated
  by nodes" while the same plan's decisions and the shipped code deliberately mutate the
  metrics collector riding in run context (`ctx.metrics.attachBudgetReport`, `finalText`) —
  intent clear from code, contradicted by the constraint's wording; a future reviewer citing
  the constraint could raise the sanctioned accumulator as blocking. Proposed wording for the
  ADR-0013 §3.2 amendment text (already on the escalate list): "run-context identity fields
  (runId, userId, user, now, client, trigger) are caller-provided and immutable inside the
  graph; the `metrics` collector is the one mutable accumulator, written only via its methods."
  Runs: refactor-p3-run-context-commit (2026-09-17).
- [×1] Ticked verification steps can claim evidence that does not exist ("table pasted" with
  no table, a JSON path never written) and nothing makes the checkbox falsifiable. Proposed
  wording for `SUPERPOWERS_INTEGRATION.md` rules of engagement: "A ticked verification step
  must point at its evidence — pasted output in the plan or a file under
  `docs/superpowers/plans/evidence/`; a checkbox whose stated evidence does not exist is not
  done." Related to the ports-layout entry on claimed-vs-real output but distinct: that one
  governs the reviewer's brief, this one the executor's checkbox.
  Runs: refactor-p3-run-context-commit (2026-09-17).
- [×2] A docs-reconcile task's checklist written from the author's memory left five durable
  docs drifted (API_SPEC.md, three FEAT-* specs, BUGS.md/MANUAL_TEST_PLAN pointers) while
  every enumerated step was ticked done. Proposed sentence for the factual-bucket definition
  in `SUPERPOWERS_INTEGRATION.md` rule 3: a docs-reconcile step's file list must be derived
  mechanically — for every file/symbol the branch deletes or moves, paste
  `git grep -l -e <deleted-path-stem> -e <renamed-symbol> -- docs` into the plan and tick
  items only against that list. Second occurrence adds a sharper variant: the drift hit
  docs that the same branch's own edits cited — CONTRIBUTING_AI's rewritten section still
  pointed readers at `conversation.spec.md` for verification two lines after declaring the
  mechanism deleted — so the checklist author did not notice even while editing an adjacent
  paragraph about it.
  Runs: refactor-p3-run-context-commit (2026-09-17), refactor-p4-episode-memory (2026-09-18).
- [×1] A deps interface narrowing what the implementation may use, hiding real needs behind
  `as`-casts: `ConversationRunnerDeps.graph` declares only `{ invoke }` while `clearContext`
  calls `graph.getState(...)` through an unchecked cast. Proposed wording for
  `docs/CONTRIBUTING_AI.md` (code rules section): "A dependency interface declares every
  method the implementation calls; widening a dependency through a type cast instead of
  extending the interface is a review finding."
  Runs: refactor-p4-episode-memory (2026-09-18).
