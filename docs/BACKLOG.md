# Backlog

Permanent parking lot: ideas, findings, wishes — anything worth keeping that is not
yet planned. This file is not tied to any initiative: initiatives come and go, the
backlog stays. Managed via the `backlog` skill (`.claude/skills/backlog/SKILL.md`);
contract: `SUPERPOWERS_INTEGRATION.md` § Backlog.

Rules:
- **Intake is cheap**: one line = the idea + one-sentence context + source/date.
  Discipline arrives at promotion, not at intake.
- **Order = priority**, most important first. Never sorted by date.
- **Only two exits**: *promote* (the entry leaves this file and lives where it was
  promoted to — a plan, a spec, a BUG) or *drop* (delete; git keeps the history).
  Stale entries are never kept.
- **No duplicates**: before adding, verify the item is not already covered by code,
  a spec, an AC, an HB item, a BUG, or another entry below.
- The agent adds or changes entries **only with owner approval**.

## Ideas

- [ ] Connector layer on top of P1's `LlmGateway`: profiles become full connectors —
  each carries its own `API_URL` + `API_KEY` (provider/token pair), so the app talks to
  any provider through one interface with per-task routing (strong model for content,
  cheap model for validations — already half-built by `LLM_PROFILE_*`), plus failover
  chains between connectors (e.g. zai-subscription → google-payg → openrouter) and a
  managed connector set instead of one global `LLM_API_URL`/`LLM_API_KEY`. Extends
  ADR-0013/P1; do not start before P1's gateway lands. Motivation includes the verified
  fact that the Z.AI subscription is only usable via a direct endpoint OpenRouter BYOK
  cannot reach (2026-09-13). Source: owner wish (2026-09-14).
- [ ] Grafana dashboards + alert rules built on `conversation_runs` (after refactor
  P0 ships the table): LLM latency p95 per phase, `outcome='llm_unavailable'` rate,
  budget-exhausted count, token usage over time. Source: ADR-0008 implementation
  tracker review (2026-09-11).
- [ ] Production Docker image hardening — carried by HB-02 of the refactor backlog
  until the initiative closes. Source: tracker review (2026-09-11).
- [ ] Tone directive for the training prompt: no praise of technique/form (cannot be
  assessed without visual feedback), conservative earned praise only, concise during
  training — as a versioned prompt PR after refactor P2, gated on judge criterion
  TR-7 (`PROMPT_EVAL_FRAMEWORK.md`), which exists but is scheduled by no phase.
  Source: TODO coach-tone review (2026-09-11).

## Findings

- [ ] **Decompose `ITrainingService` (16 methods) by role**: rule-3 review (ARCHITECTURE.md,
  recorded as a standing exception) found one contract serving two different consumers —
  HTTP routes (`plan.routes.ts`, `session.routes.ts`) and LLM tools
  (`infra/ai/graph/tools/*`) — with correction commands (`deleteLastSets`, `updateLastSet`)
  used only by the latter. Natural split: planning / session lifecycle / execution-and-
  correction. Touches the `training.service.ts` (7 constructor dependencies; the four legacy
  LLM methods and the `LLMService` dependency were deleted by refactor P1, 2026-09) plus DI
  registration and every consumer, so it needs its own plan; sequence it with P1.
  Source: close-out-review R1 + rule-3 review (2026-09-14); counts reconciled 2026-09-16.
- [ ] **Two unused `ITrainingService` methods**: `addExerciseToSession` and `logSet` have
  zero call sites in `apps/server` — both are superseded by `logSetWithContext` (11 call
  sites) and `ensureCurrentExercise` (9). (A third, `getNextSessionRecommendation`, was
  deleted by refactor P1, 2026-09.) Deleting them removes their contract lines plus their
  implementations. **Before deleting,
  check `apps/webapp` and `apps/bot`** — the measurement covered `apps/server` only. Kept out
  of `ports-layout-consistency`, whose Global Constraints forbid behavioural change. Source:
  rule-3 review (2026-09-14).
- [ ] **Consolidate the LLM text/mapping helpers when P2/P3 rewrite the subgraphs**:
  `textOf()` (llm.gateway.ts) is the 7th copy of the content-block flattening inlined in
  six graph files, and `toLangChain()` duplicates the ChatMsg→LangChain role mapping
  inlined in five subgraphs. The gateway versions are the canonical home; the inline
  copies should import them as the subgraphs are rewritten. Source: refactor-P1
  close-out review R2 (2026-09-16).
- [ ] **Webapp guard test for retired routes**: "webapp never POSTs a retired endpoint" is
  pinned only by plan greps — mirror `legacy-path-retired.unit.test.ts` for
  `apps/webapp/src` (grep apiRequest calls for POST `/plan` and `/session/:id/recommend`)
  so the frozen surface cannot silently reintroduce them. Source: refactor-P1 close-out
  review R3 (2026-09-16).
- [ ] **P1 test-coverage gaps**: parseLlmProfiles boundary values untested (temperature
  edges 0/2, rejections −1/2.1/hex; maxTokens 0); gateway `structured()` retry path for
  `OutputParserException` untested (only ZodError is); model.factory test mutates
  LLM_PROFILE_* env without afterEach restore; AC-1314 maxTokens-default equivalence
  unasserted. Source: refactor-P1 close-out review R3 (2026-09-16).
- [ ] **Share the grep-guard scaffolding** between `single-model-site.unit.test.ts` and
  `legacy-path-retired.unit.test.ts` (execFileSync-grep + path mapping duplicated; both
  new in P1) — a tests/helpers helper, as done for buildSignedInitData. Also fix the
  `--exclude-dir=__tests__` blind spot by building search literals via concatenation
  where possible. Source: refactor-P1 close-out review R2/R3 (2026-09-16).
- [ ] **Document the P1 config surface**: `config/llm-profiles.ts` missing from the
  ARCHITECTURE.md module layout's `config/` entry; optional
  `LLM_PROFILE_<NAME>_{MODEL,TEMPERATURE,MAX_TOKENS}` absent from the env section and
  `apps/server/.env.example`. Source: refactor-P1 close-out review R4 (2026-09-16).
- [ ] **ARCHITECTURE.md:48 ChatMsg hedge** ("retired in refactor P1/P4") — P1 shipped
  with ChatMsg untouched; resolve the hedge to P4-only when P4's plan touches the file.
  Source: refactor-P1 close-out review R4 (2026-09-16).
- [ ] **Registration-era feature specs reference the deleted `LLMService`**:
  FEAT-0004:23 and FEAT-0005:30 (generateResponse never existed; no named downstream
  owner — P7 names only FEAT-0003). Extend the existing FEAT-0006 entry below with its
  LLMService mentions (lines 40, 96-97, 326, 347-348). Source: refactor-P1 close-out
  review R4 (2026-09-16).
- [ ] **API_SPEC §5 debug endpoints are dead copy**: GET `/api/debug/llm` and
  POST `/api/debug/llm/clear` have no routes in apps/server (pre-existing drift, made
  permanent by P1 deleting the service that could have implemented them) — remove or
  implement. Source: refactor-P1 close-out review R4 (2026-09-16).
- [ ] **Prune the archival docs cluster**: MVP_TRAINING_SESSION_MANAGEMENT.md (draft
  posing as a durable spec, references a prompt path that never existed),
  PLAN-implementation.md (executed TODOs reading as live debt), BUGS.md Fixed sections
  citing line numbers in deleted files. Source: refactor-P1 close-out review R4
  (2026-09-16).
- [ ] **Inline `setNumericField`** in llm-profiles.ts (one call site; the field parameter
  splits the body in two — the plan's own snippet had the branches inline). Source:
  refactor-P1 close-out review R2 (2026-09-16).
- [ ] **Integration runner exits 134 after an all-green run**: `RUN_DB_TESTS=1
  npm run test:integration` (apps/server) crashes in jest global teardown
  (`src/app/test/teardown.ts`, DB-pool close) with libc++ `mutex lock failed` AFTER
  printing 122/122 passed — the non-zero exit can fail CI/cleanup even when tests pass.
  The plain unit run (`npx jest --ci`) crashes identically after an all-green summary —
  proven pre-existing at the base commit by the P2 review (temp worktree, same crash).
  Reproduced on clean `dev`, pre-existing, not a P2 regression. Source: refactor-P2
  Task 8 verification + close-out review R3 (2026-09-16).
- [ ] L0 eval checks named by `PROMPT_EVAL_FRAMEWORK.md` §4.1 but not implemented in the
  P0 harness: version discipline, message-catalog completeness (section presence shipped
  in refactor-p2-prompt-modules). Both need artefacts the harness does not build yet —
  prompt version identifiers (§6, baseline plan) and the P3 message catalog. Source:
  close-out-review, R4 (2026-09-13).
- [ ] Replace the L0 forbidden-string allowlist with P2's structural check: validate the values
  actually substituted into a prompt instead of scanning the whole rendered string, which
  cannot distinguish an unrendered `undefined` from the word "undefined" in prose. The exact-
  phrase `FORBIDDEN_STRING_ALLOWLIST` (evals/levels/l0.ts) is the owner-approved stopgap and
  should be deleted when the structural check lands. Source: close-out-review, R4 (2026-09-13).
- [ ] `apps/server/evals/` is invisible to lint: the `lint` script is scoped to `src/**/*.ts`
  and `eslint.config.js` declares no `evals/` boundary element or rule override, so
  `npx eslint evals/` reports 15 errors (update from 8 after the eval-L1 branch grew the tree;
  auto-fixable import-order/sort/destructuring issues were fixed in place 2026-09-13). All
  15 remaining are structural: `no-restricted-imports` on relative imports the tree cannot
  avoid — tsconfig `paths` map only under `baseUrl: src`, no alias exists for `evals/` —
  plus `boundaries/no-unknown` warnings because the boundaries plugin does not know the tree,
  and complexity/magic-number warnings on plan-verbatim harness code (e.g. `assertCase`).
  Also `format:check` (prettier) has the same blind spot. Needs an `evals/` override (or an
  `@evals/*` alias decision) plus a decision on whether lint/format scripts should cover it.
  Source: close-out-review, R1 + execution (2026-09-13); updated by eval-L1 review (2026-09-13).
- [ ] The run-metrics binding contract ("run identity travels via config metadata because
  LangChain strips configurable from callback options") is prose-duplicated across five
  sites (chat.routes.ts, chat.subgraph.ts, registration.subgraph.ts, invoke-with-retry.ts,
  llm-log-handler.ts) and the drain opt-out is an implicit one-node convention
  (`runId: undefined` spread in phase-summary.node.ts) — any future invoke site threading
  the graph config without replicating the opt-out silently re-opens a drained accumulator.
  Fix: run-metrics.ts owns the contract (canonical explanation + refuse to re-open a drained
  run, or an unbound-metadata builder); other sites carry one-line pointers. Update
  (2026-09-14): `chat.routes.ts`'s import of `startRun` from this file is an app→infra
  `boundaries/element-types` violation, made visible (not introduced) when `lint-glob-fix`
  fixed lint's scope — currently suppressed with a scoped `eslint-disable` citing this entry.
  Whatever fix lands here should also resolve that suppression (e.g. by moving `startRun`
  behind a domain port, or by the P3 relocation already noted above).
  Source: close-out-review re-run, R1+R2 (2026-09-12); updated by lint-glob-fix close-out
  review, R1 (2026-09-14).
- [ ] `llm-log-handler.ts` reads `loadConfig()` at module scope, freezing `isDebug` and the
  model-name fallback at import time (import order couples to config availability); an
  in-function lazy read keeps the module side-effect-free. Code moved verbatim from
  model.factory.ts, so the smell predates this branch. Source: close-out-review re-run,
  R1 (2026-09-12).
- [ ] The phase-summary orphan-accumulator fix (`runId: undefined` spread ordering) has no
  regression test — nothing pins the spread order the fix depends on; a future reorder would
  silently re-open drained runs. Mechanism was verified live via `ensureConfig` during review.
  Source: close-out-review re-run, R3 (2026-09-12).
- [ ] `DrizzleConversationRunService` invents `trigger`/`client` below the port:
  `ConversationRunRecord` has no fields for them, so the implementation hardcodes
  `trigger: 'user_message'`, `client: 'telegram'` (drizzle-conversation-run.service.ts:13-14)
  — data that silently becomes wrong when ADR-0013's anticipated `client: 'webapp'`
  arrives. Fields belong on the port. Source: close-out-review, R1 (2026-09-12).
- [ ] `ConversationRunRecord.model` is non-null while its only producer legitimately
  yields null, forcing the persist node to fabricate the `'unknown'` sentinel
  (persist.node.ts) — a magic string inside a typed non-null field. Proper fix makes
  the port `string | null` + a DB-level default, which is a migration; P3's commit
  node will re-touch this write anyway. Source: close-out-review, R1 (2026-09-12).
- [ ] Run rows are invisible for failed runs: persist.node writes only on
  `responseMessage`, and `outcome` is hardcoded `'ok'`, so the enum's
  `llm_unavailable`/`core_error`/`budget_exhausted` are unreachable and AC-1301's
  "exactly one row per POST" is untrue on error/timeout paths. Needs an owner ruling
  (AC wording vs plan) and belongs with P3's commit node. Source: close-out-review,
  R3 (2026-09-12).
- [ ] The hand-added `kind` backfill in `drizzle/0002_conversation_runs.sql` has no
  automated test — its only evidence is a one-off psql check. Consider an integration
  test that applies migrations to a scratch DB and asserts role→kind mapping.
  Source: close-out-review, R3 (2026-09-12).
- [ ] The chat route owns the run-metrics lifecycle (generate runId, call `startRun`
  against an infra singleton) on top of HTTP handling; ADR-0013 §11 targets
  `chat.routes.ts → ConversationService`, and this is extra surface P3 must unwind.
  Source: close-out-review, R1 (2026-09-12).
- [ ] `deploy.sh` cannot deploy a feature branch: branch is hardcoded per env
  (`deploy.sh:6` — dev → `dev`, prod → `main`), so a plan branch pushed for
  pre-merge live verification (like refactor-p0-run-log's AC-1304) silently
  deploys `origin/dev` instead — deploy reports OK while the new code never
  ships. Teach the script a branch override (e.g. `deploy.sh dev
  plan/refactor-p0-run-log`) or define the merge-first flow as the contract.
  Source: refactor-p0-run-log Task 6 blocked mid-execution (2026-09-12).
- [ ] Superpowers plugin skills do not load in worktree sessions: project
  `.claude/skills/` reach the worktree (committed in git), but the user-scope
  `superpowers@superpowers-marketplace` plugin (enabled in `~/.claude/settings.json`)
  did not surface its skills in a session started from
  `.worktrees/refactor-p0-run-log`, so plans requiring `superpowers:executing-plans`
  had to be driven by reading SKILL.md from the plugin cache on disk. Diagnose
  (`/plugin`, `/doctor` in a worktree session); durable fix if systematic — vendor
  the skills into the repo so any clone/worktree is self-contained.
  Source: refactor-p0-run-log session start (2026-09-12).
- [ ] No anomaly guard before logging: `log_set` accepts any weight/reps (e.g.
  27.5 kg after three 10 kg sets) with no confirm-first rule and no kg/reps
  unit-confusion check (`training.service.ts` `logSetWithContext` does zero
  validation). Options: tool-level threshold check returning a "confirm with user"
  ToolOutcome, or a prompt rule + eval dataset (`training/anomaly-confirm`).
  Already solved elsewhere: set-number mismatch (DB-derived), exercise ambiguity
  (prompt RULE 0/6). Source: TODO validation review (2026-09-11).
- [ ] Warmup sets are indistinguishable from working sets: `log_set` has no warmup
  flag and warmup sets count toward target set completion in SESSION GUIDE / ACTIVE
  STATUS (`training.node.ts:145,205`). Decide: `isWarmup` field on `log_set` +
  exclusion from set counts, or document "warmups are comments, not sets" as the
  product rule. Source: TODO warmup review (2026-09-11).
- [ ] Abandoned `planning` sessions are never closed by anything (the 2h auto-close
  fires only on `startSession`/`getActiveSession`; the router handles only
  `training`). Needs a one-off/cron cleanup; mid-training staleness stays
  LLM-mediated — do not reintroduce a hard timeout. Verify first with
  `SELECT count(*) FROM workout_sessions WHERE status='planning' AND created_at < now() - interval '1 day'`.
  Source: FEAT-0010 tracker review (2026-09-11).
- [ ] A pure-deletion plan can pass its own acceptance checks while removing behaviour proof:
  AC-1302 is `type-check && lint && test:unit`, none of which can prove the DI container still
  resolves after a registration is dropped (`register-infra-services.ts` is exercised only by
  integration tests, gated behind `RUN_DB_TESTS=1`). R3 verified it manually by invoking
  `registerInfraServices()` against `.env.test`. Consider: deletion plans touching DI name
  `npm run test:integration` in their verification line.
  Source: close-out-review, R3 (2026-09-12).
- [ ] `ARCHITECTURE.md:129` claims "Backward Compatibility: Main `ports.ts` re-exports from
  modular structure", false for every domain — neither `domain/user/ports.ts` nor
  `domain/training/ports.ts` exists; the modular `ports/` directory with an `index.ts` barrel is
  the only structure. One-line fix, no owner downstream.
  Source: close-out-review re-run, R4 (2026-09-12).
- [ ] `docs/features/FEAT-0006-registration-data-collection.md` is marked `Status: ✅ Implemented`
  while describing `PromptService.buildUnifiedRegistrationPrompt(user)` as the live mechanism
  (:20, :38, :77, :83-84, :324, :346, :348). The method was a stub returning `''` before it was
  deleted in refactor-p0-dead-code. P7 scope item 1 names FEAT-0003 but not FEAT-0006, so this
  file has no downstream owner.
  Source: close-out-review, R4 (2026-09-12).
- [ ] `docs/CHAT_PHASE_JSON_FIX.md` is a one-off fix note describing edits to a `prompt.service.ts`
  that no longer exists. It is a root-level `docs/` file governed by no document type in
  `DOCUMENTATION_GUIDE` § Structure and owned by no phase — archive it to `docs/archive/`
  alongside `CONVERSATION_CONTEXT_ARCHITECTURE.md` when P7 runs, or delete it sooner.
  Source: close-out-review, R4 (2026-09-12).
- [ ] `SessionRecommendation` / `RecommendedExercise` (hand-written interfaces in
  `domain/training/types.ts:269,~255`) duplicate `SessionRecommendationSchema` /
  `RecommendedExerciseSchema` (Zod, `domain/training/session-planning.types.ts:33,6`) and must be
  kept in sync by hand. `z.infer` from the schemas would collapse each pair.
  Source: close-out-review, R2 (2026-09-12).
- [ ] The lenient-parse rule for session-planning phase transitions is now recorded nowhere: the
  deleted `parseSessionPlanningResponse` stripped an invalid `phaseTransition` and returned the
  rest rather than losing the user-facing message (flagged via `droppedPhaseTransition`).
  Deleting it was correct — it was dead code — but if P2/P4 reintroduce structured
  phase-transition parsing, the same edge case has to be rediscovered.
  Source: close-out-review, R3 (2026-09-12).
- [ ] `close-out-review` and superpowers' final whole-branch review both sweep the same diff —
  two full review passes per plan, neither deduplicated against the other in
  `SUPERPOWERS_INTEGRATION.md` or the design spec. Decide whether the final review narrows
  to what the four zones do not cover, or whether it is dropped for plans that ran the phase.
  Source: close-out-review first live run, R2 (2026-09-12).
- [ ] `.claude/skills/close-out-review/SKILL.md` now carries two artifact-writing responsibilities
  (Step 5 writes the plan, Step 6 the self-observation log) and will gain a third once the
  `state.mjs` review gate (design spec section 7) lands. Consider splitting orchestration from
  artifact-writing then, not before.
  Source: close-out-review live runs, R1 (2026-09-12, ×2).
- [ ] `stamp-baseline.ts`'s three `client.query<...>` calls repeat the `{ n: number }` row-shape
  generic inline (lines ~43, 51, 60) instead of a shared `type CountRow = { n: number }` —
  minor DRY cleanup, not worth its own task. Source: `lint-glob-fix` close-out review, R2
  (2026-09-14).
- [ ] `docs/ARCHITECTURE.md`'s "enforced by ESLint" / "Violations fail lint" claims (around the
  ports-index rule and import-boundary rules) became true only once `lint-glob-fix` fixed
  `npm run lint`'s glob to actually scan all of `src/` (previously 7 of 137 files) — nothing in
  a durable doc records that the enforcement was newly activated on 2026-09-14; the claim
  itself needs no correction, only a note of when it started being true. Source: `lint-glob-fix`
  close-out review, R4 (2026-09-14).

refactor-p2-context-assembler close-out review batch (2026-09-17):

- [ ] **`messageText` content-stringify trio + boundary under-count**: the
  `typeof m.content === 'string' ? … : JSON.stringify(m.content)` expression now lives in
  `context/assemble-context.ts:56`, `context/tool-results.ts:18` and
  `evals/lib/__tests__/run-case.unit.test.ts:68` — one shared helper in `context/` would give
  it one home; also `messageText` concatenates content and `JSON.stringify(tool_calls)` with
  no separator, so adjacent texts merge and slightly under-count tokens at the boundary
  (report numbers only). Source: review R2/R3.
- [ ] **`toFrameRow` twin**: assemble-context.ts:51 = phase-summary.node.ts:34, two identical
  role-narrowing mappings — the plan ruled the summariser's copy stays for now, but nothing
  schedules the unification. Source: review R2.
- [ ] **History mapper duplicates `toLangChain`**: the interleaved-history mapping in
  assemble-context.ts:83 reinvents `toLangChain` (llm.gateway.ts:13, which also handles
  `system`); unify when P3's PhaseSpec touches this code. Source: review R2.
- [ ] **BudgetReport test fixtures ×4**: hand-written literals in
  persist.node.unit.test.ts:75, conversation-run.service.unit.test.ts:24,
  run-metrics.unit.test.ts:14, l1.unit.test.ts:18 — and the l1 fixture stamps estimator id
  `'chars/4'` instead of `TOKEN_ESTIMATOR_ID` (`'chars4x1.15'`); one shared fixture keeps them
  in step. Source: review R2.
- [ ] **`history_frame` double ternary**: assemble-context.ts:97 builds the message via a
  second ternary over the same condition that produced the text, non-nullness papered over by
  an `as string` cast — if the conditions diverge, a silent `SystemMessage(undefined)`
  results; compute text and message in one branch. Source: review R3.
- [ ] **`budget-report-present` false positive on agent-less eval runs**: the check fails for
  any eval run that completes without an agent model call (router short-circuit,
  `outcome: 'llm_unavailable'` without throwing); no such case exists today — guard it when
  one appears. Source: review R3.
- [ ] **run-metrics orphan accumulators**: `attachBudgetReport` on an unknown runId opens a
  full accumulator; a foreign runId from metadata creates an orphan entry counting against
  MAX_TRACKED_RUNS=500 and can evict a live run's metrics (persist then records
  budget_report = NULL silently). Eviction is inherited P0 behaviour; attach adds the entry
  point. Source: review R3.
- [ ] **AC id missing from new eval test names**: the `budget-report-present` its
  (l1.unit.test.ts:80, run-case.unit.test.ts:77) carry no AC-1323 reference, unlike the
  other new suites — grep-based AC tracing breaks. Source: review R3.

P2 close-out review batch (refactor-p2-prompt-modules, 2026-09-16):

- [ ] **Extend the inline-prompt rails to `infra/ai/messages`**: the ESLint config globs
  and the grep test now police `src/infra/ai/graph/**` + `src/infra/ai/*.ts` +
  `src/infra/ai/context/**` (covered by refactor-p2-context-assembler, 2026-09-17);
  `infra/ai/messages/` (ADR-0013 §11) would still escape both rails once created — cover
  it when P3 creates the directory. Source: P2 review R1.
- [ ] **`User` type imported from a service module**: `prompts/types.ts` (and
  registration/chat/training v1) import `User` from `@domain/user/services/user.service`
  rather than a dedicated domain type module — type-only so the dependency still points
  inward, but the prompt layer couples to a service file's module graph. Source: P2 review R1.
- [ ] **Untested conditional branches in `phases/training/v1`**: `stale_session` /
  `previousSession` render branches moved verbatim but no snapshot exercises them (fixtures
  are never stale; previousSession always null) — add a snapshot with a stale fixture and a
  previousSession to pin those bytes. Source: P2 review R3.
- [ ] **L0 `--phase` filter fails silently on unknown values**: `runL0` with a typo returns
  zero targets and reports "0/0 checks passed" exit 0, where the pre-refactor code threw
  "No L0 renderer wired" — restore the hard error for unknown filters. Source: P2 review R3.
- [ ] **Standalone modules' section-presence check is tautological**: their
  `requiredSections` are computed by rendering fixture[0] itself, so a future version
  dropping a section everywhere still passes; phase modules are unaffected. Fix alongside
  the rails/assembler work. Source: P2 review R3.
- [ ] **`Section.required` is written but never read**: every module sets it; L0 reads
  `PhasePromptEntry.requiredSections` instead. Drop the field or wire the check to it in P4.
  Source: P2 review R2.
- [ ] **Small P2 duplications**: 11-line profile block + `=== CLIENT PROFILE ===` wrapper in
  plan_creation/v1.ts:68 = session_planning/v1.ts:212 (moved verbatim; pairs with
  context-assembler); magic timestamp 2026-09-12T08:00Z duplicated between
  prompt-snapshots.unit.test.ts:32 and prompt-contexts.ts:62 (must stay in sync for
  AC-1321/L0 agreement — export one constant); chat v1 test `makeUser` is the sixth copy of
  the test user factory. Source: P2 review R2.
- [ ] **AC-1322 evidence durability**: evals/reports/ is gitignored, so the plan's pasted
  table is the only surviving evidence of the v1-vs-v0 comparison — commit the compare
  report JSON (or cite it) on future baseline comparisons. Source: P2 review R3.
- [ ] **Record rail-bite proofs**: Task 6 Step 5's "prove the ESLint rail bites" (temp
  inline prompt → lint error → revert) left no recorded evidence — paste the one-line lint
  error into the plan when a plan asks for a bite proof. Source: P2 review R3.
- [ ] **chat v1 describe lacks BR/AC id**: `phases/chat/__tests__/v1.unit.test.ts` names
  ADR-0013 §5 and BUG-009 but no BR-/AC- id unlike every other new suite (plan-prescribed
  name). Source: P2 review R3.
- [ ] **Stale pointers to deleted prompt builders** (fold into the P7 docs sweep):
  MANUAL_TEST_PLAN.md:633 (training.node.ts), FEAT-0003:96-98 + FEAT-0008:31 (builder
  functions as live prompt homes), BACKLOG.md warmup-sets entry (training.node.ts:145,205 —
  wording now in prompts/phases/training/v1*.ts), PLAN-training-phase-fix.md:174,214,
  PLAN-dual-llm-training.md:152, PLAN-muscle-centric-history.md:166-187,
  PLAN-implementation.md:49-83, PLAN-retrospective-subgraph.md:58-80,
  LLM_CORE_REFACTOR_PLAN.md:87, ADR-0007:137,232, ADR-0010:196, ADR-0012:246-247,288,470-471.
  Source: P2 review R4.

## Wishes

- [ ] Replace the `§` section sign across `docs/` — owner dislikes the notation; use
      "section N" or named references instead. Touches 10 files, including durable specs
      (`DOCUMENTATION_GUIDE.md`, `adr/0013-llm-core-target-architecture.md`,
      `CONTRIBUTING_AI.md`) and `STATE.md`. The 2026-09-12 mandatory-plan-review spec is
      already written without it; this covers the pre-existing files. Source: spec review
      (2026-09-12).
