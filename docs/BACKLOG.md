# Backlog

Permanent parking lot: ideas, findings, wishes — anything worth keeping that is not
yet planned. This file is not tied to any initiative: initiatives come and go, the
backlog stays. Managed via the `backlog` skill (`.claude/skills/backlog/SKILL.md`);
contract: `SUPERPOWERS_INTEGRATION.md` § Backlog.

Rules:

- **Intake is cheap**: one line = the idea + one-sentence context + source/date.
  Discipline arrives at promotion, not at intake.
- **Order = priority**, most important first. Never sorted by date.
- **Only two exits**: _promote_ (the entry leaves this file and lives where it was
  promoted to — a plan, a spec, a BUG) or _drop_ (delete; git keeps the history).
  Stale entries are never kept.
- **No duplicates**: before adding, verify the item is not already covered by code,
  a spec, an AC, an HB item, a BUG, or another entry below.
- The agent adds or changes entries **only with owner approval**.

## Ideas

- [ ] **User-fact lifecycle: dates, context, expiry, retraction (owner, 2026-09-19).** Today a
      `user_facts` row lives forever: the `## User Facts` block shows only the text (+ muscle), no
      "when stated / last confirmed / how many times"; nothing ages a fact out; nothing removes one
      the user contradicts ("the hernia healed" adds a new row, the old `physical_constraint`
      stays — and the hard validation keeps rejecting exercises for it); the summariser never sees
      the known facts, so it cannot say one is no longer true; `source_turn_id` exists but is not
      filled at extraction. Scope to design: render dates/confirmations as context, a staleness
      rule per category (an injury ages differently from equipment), explicit retraction
      (summariser output and/or user command), deletion vs. soft-archive, and how hard
      validation treats an old constraint. **Direction chosen by the owner 2026-09-20 — standard
      agent memory:** at compaction the summariser sees the known facts and returns operations
      (add / confirm / update / retract); the prompt shows each fact with its date and confirmation
      count; a retracted fact is archived, not deleted; a long-unconfirmed constraint is shown as
      "may be outdated — ask" instead of silently blocking. Details to be checked against the
      standard before planning; needs an ADR-0009 / ADR-0013 amendment. Related: the near-duplicate-facts entry in
      § P6 facts (Group 1) close-out review advisories. Source: owner review of the P6 dev smoke
      (2026-09-19).
- [ ] **Eval cases from real sessions — the safety net for correcting prompts in small strokes (owner,
      2026-09-21).** The owner's way of working on prompts is one small change at a time, "они не станут
      рабочими с одного редактирования, но и не сломать чтобы" — which needs a fixed set to run before
      and after each stroke, otherwise an improvement and a coincidence look alike. First candidate set
      is the 2026-09-21 training session: report sets in `session_planning` → the reply must not claim
      they were logged (BUG-022); "напомни прошлый вес" → the most recent real session, with its date
      (BUG-030); "две планки по 45" → stored as a duration (BUG-023); a correction → delete and re-log
      in one turn (BUG-027); the reply in the user's language with no internal rule numbers (BUG-028).
      Mechanics exist: `npm run evals:export -- --since <date>` produces expectation-less drafts
      (BR-EVAL-003), a human adds the expectations. The same set on two models also answers "is it the
      model or the code" with numbers rather than opinion. Cheaper and more reliable once
      `llm-io-audit-trail` Task 4 stores real requests. Source: owner review of the 2026-09-21 dev
      training session.

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

- [ ] **Direct Google AI Studio is not a drop-in replacement for the OpenRouter route (parked by the
      owner, 2026-09-22).** On 2026-09-21 dev was switched from OpenRouter BYOK to the Google AI
      Studio endpoint directly and rolled back the same evening: the application's own requests came
      back `400`, while the identical route through OpenRouter works. Verified during that attempt,
      so nobody repeats it: the key is valid (the endpoint listed 58 models), the model name is
      accepted both as `gemini-3.8-flash` and as `models/gemini-3.8-flash`, and a direct `curl`
      carrying tools, a strict response schema and a 16 384-token ceiling each returned `200`. So the
      key, the model name and those three request features are all ruled out. **Not established:**
      which field the SDK adds to the request that direct Google rejects and OpenRouter tolerates —
      that is the one open question, and it is answered by probing fields one at a time against the
      live endpoint, never by switching the server. Functionally there is nothing to gain: OpenRouter
      BYOK already calls the owner's own Google key (`usage.is_byok: true`), so the only difference
      is the intermediary's markup. State as verified on 2026-09-22: dev is on
      `LLM_API_URL=https://openrouter.ai/api/v1/`, `google/gemini-3.8-flash`,
      `LLM_REASONING_EFFORT=low`, `LLM_STRUCTURED_OUTPUT_MODE=json_schema`; no `.env.dev` backup on
      the VPS contains a direct-Google URL, i.e. the rollback was complete. Backup names mislead —
      `.env.dev.bak-20260921-aistudio` and `-aistudio2` differ from the live file **only** in
      `LLM_REASONING_EFFORT` and are OpenRouter configs; `-llm` is the Z.AI route (the documented
      fallback) and `-model` predates the model change. Related: the connector-layer idea in
      § Ideas, whose failover chains would make such a switch reversible in one setting.
      Source: orchestrator session 2026-09-21, recovered from its terminal before it was closed.

- [ ] **BOT UX — `plan_creation` makes the user wait minutes in silence (owner priority, 2026-09-19).**
      The owner's position: a bot must answer in seconds, or tell the user it is working. Today it
      does neither — it holds the HTTP connection open and stays silent. Measured on dev
      (`conversation_runs`, n = 25 for this phase): **avg 72 s, p95 317 s, max 393 s**; `chat` by
      comparison averages 19 s. `requestTimeout` was raised 30 s → 420 s (commit `42d4fe8f`) so the
      answer is not truncated — that is a band-aid on the symptom, not the fix, and it should be
      lowered again once the real causes are addressed.
      **Three distinct causes, from the data — they need different fixes:**
      1. **Generation itself dominates, not tools.** The two slowest runs (393 s, 324 s) made
         **zero** tool calls, and `plan_creation` runs with no tools still average **67 s**. The
         model is writing a whole multi-session plan as one long structured answer. Fixes to weigh:
         stream the response, split plan creation into steps the user sees arriving, or shrink what
         one turn must produce.
      2. **No progress signal.** Nothing is sent between "message received" and the final answer —
         no typing action, no "собираю план…" interim message. Telegram's `sendChatAction` is the
         cheap half of this; an interim message is the honest half.
      3. **Tool-call fan-out and schema retries.** One run issued **12 sequential `search_exercises`
         calls** (one per exercise, no batching) and then **two `save_workout_plan` calls that both
         came back `llm_error`** — the model failed the schema twice and retried. Batch the search,
         and treat repeated `llm_error` on the same tool as a prompt/schema defect worth its own
         look.
      **Not scoped as a plan yet** — it spans prompt design, bot UX and tool ergonomics, so it wants
      the owner's call on direction before it becomes one. Source: P5 Task 6 latency calibration +
      owner instruction (2026-09-19).

- [ ] **Off-catalog exercises: how should they be created at all? (owner, 2026-09-21).** The catalog has
      no dumbbell calf raise, so three sets done standing with two 25 kg dumbbells were logged against
      **`Standing Calf Raise Machine` at 50 kg** — a machine load is not comparable to dumbbells, and the
      next session will read that 50 kg as a working weight on the machine. The planned
      `Seated Calf Raise Machine` stayed in the session as `skipped`. Today the only paths are
      `exerciseId` (catalog) or `exerciseName` (resolved against the catalog, `ensureCurrentExercise`),
      so anything absent silently lands on the nearest catalog row. To think through: when a user does
      an exercise the catalog lacks, do we create a real catalog entry, a per-user/ad-hoc one, or a
      variant of an existing exercise (same movement, different equipment)? Who approves it, what does it
      carry (equipment, muscles, how the load is expressed), and how do the progression blocks compare
      loads across equipment. May grow into an ADR. Source: owner review of the 2026-09-21 dev training
      session (session `fa293e20`, runs `48d59d0e` / `a5a49e13` / `ef6030d6`).

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
- [x] **ARCHITECTURE.md:48 ChatMsg hedge** ("retired in refactor P1/P4").
      Resolved by refactor-p4-episode-memory (2026-09-18): the comment now states the
      P4 outcome — ChatMsg remains only as the `LlmGateway` call type; graph history
      interleaves as LangChain `BaseMessage`s from the checkpointed `messages` channel.
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
- [x] The run-metrics binding contract ("run identity travels via config metadata because
      LangChain strips configurable from callback options") was prose-duplicated across five
      sites and the drain opt-out was an implicit one-node convention.
      Resolved by refactor-p3-run-context-commit (2026-09-17): the P0 module maps, `startRun`
      and the per-subgraph threading are gone; metrics live in a per-run `RunMetricsCollector`
      carried in run context (`state.ts` RunContext, ADR-0013 §3.2), its callback handler rides
      the invoke config, and `llm-log-handler.ts` is logging-only. The chat route no longer
      imports infra (`chat.routes.ts` calls the `ConversationRunPort` token).
      Source: close-out-review re-run, R1+R2 (2026-09-12); updated by lint-glob-fix close-out
      review, R1 (2026-09-14).
- [ ] `llm-log-handler.ts` reads `loadConfig()` at module scope, freezing `isDebug` and the
      model-name fallback at import time (import order couples to config availability); an
      in-function lazy read keeps the module side-effect-free. Code moved verbatim from
      model.factory.ts, so the smell predates this branch. Source: close-out-review re-run,
      R1 (2026-09-12).
- [x] The phase-summary orphan-accumulator fix (`runId: undefined` spread ordering) had no
      regression test. Obsoleted by refactor-p3-run-context-commit (2026-09-17): the drained
      module accumulator it protected no longer exists (per-run collector in run context), so
      there is nothing to re-open; the legacy phase-summary handler consumes the run's own
      collector via run context.
      Source: close-out-review re-run, R3 (2026-09-12).
- [x] `DrizzleConversationRunService` invented `trigger`/`client` below the port.
      Resolved by refactor-p3-run-context-commit (2026-09-17): both fields are on
      `ConversationRunRecord`, filled from run context by the adapter/commit (verified live in
      the dev smoke — every row carries `user_message`/`telegram`).
      Source: close-out-review, R1 (2026-09-12).
- [x] `ConversationRunRecord.model` was non-null while its only producer legitimately
      yields null. Resolved at the port level by refactor-p3-run-context-commit (2026-09-17,
      D-F): the type is `string | null` and failed runs record null. Remainder: the DB column
      was NOT NULL, so the drizzle service mapped null → `'unknown'` — closed 2026-09-18
      (fix/p3-tails): migration `0003` makes the column nullable, the service passes
      `record.model` through, applied on dev.
      Source: close-out-review, R1 (2026-09-12).
- [x] Run rows were invisible for failed runs. Resolved by refactor-p3-run-context-commit
      (2026-09-17, D-F owner-approved direction): the adapter records `outcome:
'llm_unavailable'` (provider/network error classes) or `'core_error'` (anything else)
      before rethrowing — AC-1301's "exactly one row per POST" is now true on error paths too
      (unit + integration tested).
      Source: close-out-review, R3 (2026-09-12).
- [ ] The hand-added `kind` backfill in `drizzle/0002_conversation_runs.sql` has no
      automated test — its only evidence is a one-off psql check. Consider an integration
      test that applies migrations to a scratch DB and asserts role→kind mapping.
      Source: close-out-review, R3 (2026-09-12).
- [x] The chat route owned the run-metrics lifecycle on top of HTTP handling. Resolved by
      refactor-p3-run-context-commit (2026-09-17): the route is a thin proxy to
      `ConversationRunPort`; runId, metrics and the collector's lifecycle live in the adapter
      (ADR-0013 §11).
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
- [x] **`toFrameRow` twin**: assemble-context.ts:51 = phase-summary.node.ts:34, two identical
      role-narrowing mappings. Resolved by refactor-p4-episode-memory (2026-09-18): both copies
      are deleted — the history frame and the legacy phase-summary node are gone.
      Source: review R2.
- [x] **History mapper duplicates `toLangChain`**: the interleaved-history mapping in
      assemble-context.ts:83 reinvents `toLangChain` (llm.gateway.ts:13, which also handles
      `system`). Resolved by refactor-p4-episode-memory (2026-09-18): the ChatMsg history
      mapper is deleted — history rides the checkpointed `messages` channel as `BaseMessage`s.
      Source: review R2.
- [ ] **BudgetReport test fixtures ×4**: hand-written literals in
      persist.node.unit.test.ts:75, conversation-run.service.unit.test.ts:24,
      run-metrics.unit.test.ts:14, l1.unit.test.ts:18 — and the l1 fixture stamps estimator id
      `'chars/4'` instead of `TOKEN_ESTIMATOR_ID` (`'chars4x1.15'`); one shared fixture keeps them
      in step. Source: review R2.
- [x] **`history_frame` double ternary**: assemble-context.ts:97 builds the message via a
      second ternary over the same condition that produced the text. Resolved by
      refactor-p4-episode-memory (2026-09-18): the `history_frame` mode was removed with the
      per-phase layouts — the assembler emits `BaseMessage`s directly.
      Source: review R3.
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

- [x] **Extend the inline-prompt rails to `infra/ai/messages`**: done by
      refactor-p3-tool-executor Task 3 (2026-09-17) — the ESLint override and the grep
      test now police `src/infra/ai/messages/**` and `src/infra/ai/tools/**` too
      (bite-proofed with a temporary `new SystemMessage('x')`). Source: P2 review R1.
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
- [ ] **Small P2 duplications**: ~~11-line profile block + `=== CLIENT PROFILE ===` wrapper in
      plan_creation/v1.ts:68 = session_planning/v1.ts:212~~ — one shared renderer
      `prompts/blocks/client-profile.v1.ts` since refactor-p4-context-budget (2026-09-19);
      the remaining two items stand: magic timestamp 2026-09-12T08:00Z duplicated between
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

- [ ] Strip the `Co-Authored-By: Claude …` trailer from every commit in history — 215 of 852
      commits carry it (counted 2026-09-25); attribution is now off in both Claude profiles
      (`~/.claude-personal`, `~/.claude` settings `attribution: {commit: "", pr: ""}`). It is a
      full history rewrite (`git filter-repo --message-callback`): every SHA changes, so
      `main`/`dev`/all branches need a force-push, every worktree and Orca session must be
      re-synced, and SHAs cited in plans, `BUGS.md`, `STATE.md`, `COST_LEDGER.md` go stale
      (map old→new via filter-repo's `commit-map`). Run only when no plan is in flight. Source:
      owner request (2026-09-25).
- [ ] Replace the `§` section sign across `docs/` — owner dislikes the notation; use
      "section N" or named references instead. Touches 10 files, including durable specs
      (`DOCUMENTATION_GUIDE.md`, `adr/0013-llm-core-target-architecture.md`,
      `CONTRIBUTING_AI.md`) and `STATE.md`. The 2026-09-12 mandatory-plan-review spec is
      already written without it; this covers the pre-existing files. Source: spec review
      (2026-09-12).

## P3 close-out review advisories (2026-09-18)

- [ ] BR-LLM-010 seam is dead code: the agent node renders prompts with a hard-coded
      `client: 'telegram'` and `PromptContextBase.client` is typed as the literal
      `'telegram'` only, while RunContext already carries `client: 'telegram' | 'webapp'`.
      Widen the render type and pass `ctx.client`. Source: close-out-review, R1+R3 (2026-09-18).
- [ ] `phase-spec.ts` and `conversation.graph.ts` form a type-level cycle through
      `ConversationGraphDeps`, and `loadContext(input, deps)` re-passes the full deps bag
      although specs are built with their deps at the composition root. Move the deps type to
      its own module, drop the second parameter. Source: close-out-review, R1 (2026-09-18).
- [x] `buildRouteNode(phaseNames)` discarded its parameter and the graph listed `'commit'`
      in route's `ends` though only `prepare` can short-circuit there. Dropped both
      (fix/p3-tails, 2026-09-18). Source: close-out-review, R1+R2 (2026-09-18).
- [ ] The PhaseSpec render-data type is erased at the factory boundary
      (`buildPhaseSpecs` returns `PhaseSpec[]`, the agent node casts `loaded.data as
PromptContextFor<D>`). Carry the data type through or document the one cast as the
      boundary. Source: close-out-review, R1 (2026-09-18).
- [x] `userId` extraction was copy-pasted across 11 tool files in two divergent variants;
      `userIdOf(config)` beside `sessionIdOf` in `format-exercise-summary.ts` is the one
      home now (fix/p3-tails, 2026-09-18). Source: close-out-review, R2 (2026-09-18).
- [x] `commit.node.ts` local `messageText()` reinvented `textOf`; replaced with direct
      `textOf(m.content)` calls (fix/p3-tails, 2026-09-18). Source: close-out-review, R2 (2026-09-18).
- [x] `PLAN_CREATION_TOOL_POLICY`/`SESSION_PLANNING_TOOL_POLICY` were byte-identical
      literals; centralised as `SEARCH_DEDUP_POLICY` in tool-policy.ts (fix/p3-tails,
      2026-09-18). Source: close-out-review, R2 (2026-09-18).
- [x] `llm-log-handler.ts` kept dead `runId` locals from the pre-P3 metrics bridge;
      removed (the `_llmRunId` positional arg keeps a scoped disable — the repo config has
      no underscore-ignore pattern) (fix/p3-tails, 2026-09-18). Source: close-out-review, R2 (2026-09-18).
- [x] After a `system_error` the executor skips the remaining batch calls without
      answering their `tool_call_id`s. Resolved by refactor-p4-episode-memory (2026-09-18):
      the executor answers every call in a batch — skipped calls get a `ToolMessage`
      (`llmError('Skipped: an earlier tool in this batch failed with a system error')`)
      before the terminal `AIMessage`; invariant-tested now that messages persist.
      Source: close-out-review, R3 (2026-09-18).
- [x] Run-row semantics drifted beyond the declared trigger/client change: `transition`
      now carries `reason`, and a blocked transition is recorded with `transition` set but
      `phaseOut: null`. Resolved by refactor-p4-episode-memory (2026-09-18): the semantics
      are declared in `CONTRIBUTING_AI.md` § Run a Conversation (one run row per POST).
      Source: close-out-review, R3 (2026-09-18).
- [ ] New agent/catalog/graph test names cite plan decisions (D-B/D-C/D-D) instead of
      BR-_/AC-_ ids. Source: close-out-review, R3 (2026-09-18).
- [x] Stale mechanism pointers in `docs/MANUAL_TEST_PLAN.md` / `docs/BUGS.md`: the test
      plan now names the current files; BUGS.md carries an "as-of" path note at the top
      (fix/p3-tails, 2026-09-18). Source: close-out-review, R4 (2026-09-18).
- [ ] `TOOL_OUTCOME_FORMAT_ID` has zero consumers and no snapshot test enforces the
      "output change = bump" rule in CONTRIBUTING_AI.md. Source: close-out-review, R4 (2026-09-18).
- [ ] ADR-0007/0012 reference sections point at now-deleted files as current homes; adopt
      an "as-of / superseded paths" note convention instead of editing history.
      Source: close-out-review, R4 (2026-09-18).

## P4 close-out review advisories (2026-09-18)

- [ ] `clearContext` calls `graph.getState(...)` through an unchecked cast while
      `ConversationRunnerDeps.graph` declares only `{ invoke }` — the deps interface must
      declare every method the implementation calls (see also the rule candidate in
      `docs/REVIEW_FINDINGS.md` this run). Source: close-out-review, R1 (2026-09-18).
- [x] `new RemoveMessage({ id: m.id ?? '' })` in `compact.node.ts` silently no-ops when a
      history message has no id: removal never lands, the budget trigger refires every run,
      a summary can repeat per episode. Fail loud (drop the fallback or `log.error`).
      Source: close-out-review, R3 (2026-09-18). Fixed: `refactor-p4-context-budget` Task 4
      Step 0 — `log.error` + the whole removal set is skipped (never remove with `''`).
- [ ] `POST /api/bot/chat/clear-context` (chat.routes.ts) is missing from `docs/API_SPEC.md`
      although the branch changed its mechanics and MANUAL_TEST_PLAN S8.4 exercises it.
      Source: close-out-review, R4 (2026-09-18).
- [ ] Pre-P4 context docs still read as live: `docs/features/FEAT-0009-conversation-context.md`
      and `docs/CONVERSATION_CONTEXT_ARCHITECTURE.md` need superseded banners (ADR-0013 :62
      already says the latter should be archived) and `docs/README.md:45` should stop listing
      it as current. Full rewrite at P7. Source: close-out-review, R4 (2026-09-18).
- [ ] `docs/domain/ai.spec.md` still calls ChatMsg's home "temporary until refactor P1/P4" —
      P4 resolved its fate differently (it stays as the `LlmGateway` call type); drop the
      promised retirement. Source: close-out-review, R4 (2026-09-18).
- [ ] Orphan `tool_result` seeds are not skipped in `evals/lib/seed-messages.ts`, contradicting
      the binding contract in `case.schema.ts:72-74` — a `ToolMessage` with an undefined
      `tool_call_id` would reach the provider. Latent (no current dataset has one).
      Source: close-out-review, R3 (2026-09-18).
- [x] The D-E legacy-import branch in `compact.node.ts` returns without consuming a pending
      `state.compactReason` — the flag can survive into the next run after a transition-plus-
      first-message combination. Add to `refactor-p4-context-budget`'s test list.
      Source: close-out-review, R3 (2026-09-18). Fixed: `refactor-p4-context-budget` Task 4
      Step 0 — both the "legacy found" and "no legacy found" returns now set `compactReason: null`.
- [ ] Evals tooling duplication trio: `estimateWeeklyPct` re-parses ledger rows
      `parseLedgerTable` owns; `argValue`/ledger-path are defined twice across `run.ts` /
      `ledger.ts`; `CostRecorder.handleLLMEnd` mirrors `RunMetricsCollector` token extraction
      with a wider accepted shape. One shared row parser / CLI-args module / usage extractor.
      Source: close-out-review, R2 (2026-09-18).
- [ ] `episode.ts` basename collision: `domain/conversation/episode.ts` (domain types) vs
      `infra/ai/graph/episode.ts` (channel helpers) — rename the infra one (e.g.
      `episode-channel.ts`). Source: close-out-review, R1 (2026-09-18).
- [ ] `evals/lib/quota.ts` reads the operator's `~/.claude/settings.json` (with env fallbacks)
      to reach the Z.AI monitor API — repo tooling depends on one machine's home layout;
      consolidate behind the documented env var. Source: close-out-review, R1 (2026-09-18).
- [x] `compact.node.ts` re-declares `LegacySummary` as an inline annotation — import the named
      type from `summary.ports.ts`. Fold into `refactor-p4-context-budget`'s branch (touches
      the same file). Source: close-out-review, R2 (2026-09-18). Fixed: `refactor-p4-context-budget`
      Task 4 Step 0 — imports `LegacySummary` from `@domain/conversation/ports`.


## P4 context-budget close-out review advisories (2026-09-19)

- [ ] `prompts/blocks/training-workout-overview.v1.ts` holds four training blocks
      (`client`, `workout_overview`, `stale_session`, `previous_session`) while every other
      block has its own file — split it, or write the grouping rule down so the exception is
      deliberate (see the matching rule candidate in `docs/REVIEW_FINDINGS.md`).
      Source: close-out-review, R1/R2 (2026-09-19).
- [ ] Domain blocks are rendered twice per run — once by `resolveBudget` to measure tokens,
      once by `assembleContext` to build the text. Pure renderers make this correct but not
      free; a render cache keyed by `(block id, depth)` would halve it. Measure before fixing:
      the cost is unquantified. Source: close-out-review, R2 (2026-09-19).
- [ ] `ModelInputRecorder` only attaches to a real `BaseChatModel`, so on L1 datasets whose
      model is a stub the `no-orphan-tool-message` check silently does not run — a check that
      passes because it never executed. Make the skip loud (log or fail the case).
      Source: close-out-review, R3 (2026-09-19).
- [ ] `src/infra/db/scripts/__tests__/prune-checkpoints.unit.test.ts:6-7` — the module docstring
      and test 5's title still describe the pre-fix blob semantics ("referenced by the SURVIVING
      latest checkpoint"); the code now keeps blobs referenced by any retained checkpoint. The
      test still passes because it only asserts the SQL mentions `channel_versions`.
      Source: close-out-review, R3 (2026-09-19).
- [ ] `renderBlocks`'s injectable `depthOf` and the structural `RenderableBlock<D>` widening were
      built for two callers; Task 3 collapsed them into one real caller (`assembleContext`).
      Either simplify to that caller's needs or leave it as the extension point P6's blocks will
      use — decide when P6 lands, not before. Source: close-out-review, R2 (2026-09-19).
- [ ] `context/budget.ts`'s `renderBlockAt` reimplements `renderBlocks`'s render-and-measure step
      with a different return shape (token count instead of a `RenderedBlock`). Not a clean
      duplicate, but the same operation expressed twice. Source: close-out-review, R2 (2026-09-19).

## P5 close-out review advisories (2026-09-19)

- [ ] `infra/conversation/keyed-mutex.ts:43-52` — a waiter that later times out still holds its
      chain slot until its own settle, so a third caller queues behind a timed-out second caller
      rather than being freed when that waiter's window expires. Behaviourally harmless (each
      waiter races its own timeout), but the chain length is bounded by concurrent callers, not
      by successful completions — worth a comment saying so. Source: close-out-review, R3 (2026-09-19).
- [ ] No test exercises `chatQueue.enqueue` wired through `registerBotHandlers` — two rapid
      messages to one chatId producing two sequential HTTP calls. Consistent with D-E's stated
      pure-unit test boundary for the bot, so not an AC gap, but nothing proves that seam
      end-to-end. Source: close-out-review, R3 (2026-09-19).
- [ ] `app/routes/chat.routes.ts` duck-types the thrown error's `code` field instead of using
      `instanceof` against the exported error classes. This is D-B's explicit intent (one shared
      status table, no instanceof chain) and is correct — recorded only so the divergence from
      the usual discriminated-class style is a deliberate choice on record.
      Source: close-out-review, R1 (2026-09-19).
- [ ] `conversation_runs.created_at` is stored **without a timezone, in local time**, while
      Postgres `now()` returns UTC — so `WHERE created_at > now() - interval 'N minutes'`
      silently returns zero rows even when the runs exist (cost a confused query during the P5
      dev smoke, 2026-09-19; the P4 smoke's own SQL in the plan has the same latent flaw).
      Either store it as `timestamptz` (migration) or fix every query and the plans that carry
      them. Source: P5 dev smoke (2026-09-19).

## P6 facts (Group 1) close-out review advisories (2026-09-19)

- [ ] Near-duplicate facts create separate `user_facts` rows — D-C's idempotency key is a
      code-normalised text (`fact_key`), so the same fact in different words is two rows (the
      block caps at 50 and truncates lowest-`confirmations` first). A similarity-based merge
      needs the consolidated eval pass to judge it. Source: plan
      refactor-p6-facts-and-progress-blocks D-C (2026-09-19).
- [ ] Dependency types wider than use: `CompactStepDeps.userFacts`
      (`graph/nodes/compact.node.ts:53`) is the full `IUserFactsService` but only `upsertMany`
      is called; the two tools' deps (`save-workout-plan.tool.ts`,
      `start-training-session.tool.ts`) still declare the full service although the shared
      `rejectOnFactConflict` guard already takes `Pick<IUserFactsService, 'getConstraints'>`.
      Narrowing makes read vs. write visible at the type level. Source: close-out-review, R1 (2026-09-19).
- [ ] `domain/user/services/fact-conflicts.ts` works entirely over exercise muscle involvement
      (the fact only supplies the constrained muscle) — its substantive domain is "which
      exercises are safe", arguably `domain/training/services/`. Not a boundary violation
      (lint-clean, domain→domain imports are existing practice). Source: close-out-review, R1 (2026-09-19).
- [ ] `evals/schema/case.schema.ts` `FixtureFactSchema.muscleGroup` is `z.string()`, not the
      `MuscleGroup` enum — a typo in a dataset (`shoulder_front`) would silently make a
      `physical_constraint` fixture bind nothing. Validate against the enum. Source:
      orchestrator review of P6 Task 6 (2026-09-19).

## structured-output-fenced-json close-out review advisories (2026-09-19)

- [ ] `extractJsonPayload` (`infra/ai/structured-json.ts`) looks at the first Markdown fence
      only, and its brace-span fallback spans the whole text — an answer with two fenced blocks
      (a discarded draft plus the real payload) is not recovered and not tested. Iterate every
      fence before falling back. Source: close-out-review, R3 (2026-09-19).
- [ ] `infra/ai/structured-json.ts` holds two independent reasons to change: the JSON-recovery
      heuristics (BUG-017's fix) and the `response_format` builder whose `String`-object `type`
      exists only to dodge a `@langchain/openai` internal routing check. Split if either grows;
      the routing workaround is the one a library upgrade will touch. Source: close-out-review, R1 (2026-09-19).
- [ ] The scripted-model `jest.mock('@infra/ai/model.factory', …)` double is now near-copied in
      three graph test files (`episode-memory.integration`, `conversation.graph`,
      `user-facts.scenario`); `graph/__tests__/graph-test-support.ts` (added at this close-out
      for `USER` / `ctxConfig`) is the natural home for one builder — and for
      `conversation.graph.unit.test.ts`'s own local `USER` / positional `ctxConfig`, which predate
      this branch and were left alone. Source: close-out-review, R2 (2026-09-19). Fourth copy
      added 2026-09-20: `tests/integration/scenarios/scripted-model.ts` `installScriptedModel()`
      re-implements the same shape as `user-facts.scenario.unit.test.ts:118-148` — extract one
      shared builder (e.g. `tests/support/scripted-chat-model.ts`). Source: training-journey-scenarios close-out, R2.
- [ ] No test proves that a `RunMetricsCollector` attached through the invoke config still
      receives the LLM callbacks for `structured()` calls — the switch from
      `withStructuredOutput(...)` to `withConfig({ response_format })` is believed equivalent
      (both bind the same `ChatOpenAI`) but that is inference; a dev smoke run row's token
      counts for a compaction would settle it cheaply. Source: close-out-review, R3 (2026-09-19).
- [ ] `docs/ARCHITECTURE.md`'s module-layout tree omits `domain/user/services/fact-conflicts.ts`,
      `domain/user/services/fact-key.ts` and `infra/ai/structured-json.ts` (the tree is
      illustrative and was already non-exhaustive). Source: close-out-review, R4 (2026-09-19).
- [ ] No test drives a raw `SyntaxError` from the provider/transport layer through
      `structured()` to pin that it now propagates without a retry (the blanket `SyntaxError`
      retry was removed as dead for format errors; a transport-level one is a non-format error
      by the plan's AC and propagates — correct, but unpinned). Source: close-out-review, R3 (2026-09-19).

## training-journey-scenarios close-out review advisories (2026-09-20)

- [ ] Session timestamps come from two clocks: `workout_sessions` rows created mid-journey get
      the DB's `defaultNow()` while the app runs on its own `now` (fake clock in scenarios), so
      the scenario runner re-stamps new sessions (`evals/lib/run-scenario.ts:136-160`,
      `stampNewSessions`). Production has the same split (DB time vs app time) — pass `now`
      explicitly on insert and drop the harness patch. Source: Task 4 worker + close-out review, R1 (2026-09-20).

## chat-continuity close-out review advisories (2026-09-20)

- [ ] The inactivity test "gap since the previous message ≥ `EPISODE_GAP_HOURS`" is written out twice
      against the same `gapMs` — `agent.node.ts:96-97` (time-gap note) and `compact.ts:52` (compaction
      trigger). One shared `isPastGap(now, last, gapMs)` would keep the two from drifting.
      Source: close-out-review, R2 (2026-09-20).
- [ ] Long pauses read as hours in the time-gap note (`time-gap.v1.ts`: two weeks → "336 h"); days
      would be friendlier to the model once the note is tuned in the consolidated eval pass.
      Source: orchestrator at Task 2 acceptance (2026-09-20).

## reply-latency close-out review advisories (2026-09-20)

- [ ] The per-phase `outputReserve` values (`infra/ai/context/budget.ts`, ADR-0013 §3.4 table, 1.5k–4k)
      were sized against the retired 4096-token output cap; the cap is now `LLM_MAX_TOKENS` (16384) and
      reasoning spends the same budget. Re-tune them with the consolidated eval pass.
      Source: close-out-review, R3 (2026-09-20).
- [ ] No test pins `finish_reason: 'length'` arriving together with tool calls — the skip-retry branch
      cannot fire there (`isEmptyAIResponse` requires no tool calls), but that is verified by reading,
      not by a test. Source: close-out-review, R3 (2026-09-20).

## fact-lifecycle (wave A) close-out review advisories (2026-09-21)

- [ ] The AC-FL-3 end-to-end scenario test uses an in-memory fake of `IUserFactsService` that
      re-implements the stale-evidence rule itself, so the test would still pass if the real repository
      diverged. The real path is covered by the DB integration suite, but the two rules are written
      twice. Source: orchestrator, Task 3 acceptance (2026-09-21).
- [ ] `USER_FACTS_V1` is now unused in production code (v2 renders every block) and is kept only by the
      repo's prompt-version convention plus its own unit test — unlike the phase `v1.ts` files, no
      snapshot test pins it. Decide whether the convention should require a snapshot or allow removal.
      Source: orchestrator, Task 1 acceptance (2026-09-21).
- [ ] The SQL visibility filter and `isActiveForPrompt` are now twins by construction (both check
      status, durability and expiry) but still live in two languages. If a third read path appears,
      give them one shared description instead of a third copy.
      Source: close-out-review, R2 (2026-09-21), partially addressed in `38f84746`.
- [ ] **Model behaviour, not code (evidence for wave B):** in the 2026-09-21 dev smoke the coach
      answered a failed tool call with a confident claim that the action had been performed — twice,
      including "факт помечен как неприменимый" while the row was still `active`. The tool could not be
      called at all then (BUG-020), but nothing in the run forced the model to either retry or admit the
      failure. This is the exact case the wave-B course-check layer exists for; it is also the
      BUG-014/BUG-015 family. Worth one deterministic check in the consolidated eval pass: a tool that
      returns an error must never be followed by a success claim.
      Source: orchestrator dev smoke (2026-09-21).

## Recurrence → `physiological_pattern` promotion is unimplemented (2026-09-21)

- [ ] The owner's durability model (2026-09-20) says a short state that keeps recurring is promoted to
      a `physiological_pattern` fact — "that is how the archive turns into knowledge instead of
      garbage". **Nothing performs that promotion.** Verified 2026-09-21 by the wave-B Task 3 worker and
      confirmed by the orchestrator: `recur|promot` matches only two *comments*
      (`user-facts.repository.ts`, `user-facts.ports.ts`, both saying "wave B's recurrence promotion
      counts exactly that archive"); there is no detector, no writer, the course-check prompt sees only
      ACTIVE facts and never the archive, and summariser v4's operations (`add|confirm|update|retract`)
      have no `pattern` op.
      What DOES exist and makes it possible: a closed key re-stated later creates a new row linked by
      `supersedes_id` while the old row keeps its archive, so N occurrences leave an N-row chain that a
      promotion could count. Journey (d) of `course-check-and-constraints` Task 3 asserts that chain and
      stops there, with an `it.todo` marking the missing ending.
      **Three owner decisions before this can be planned:** (1) who promotes — code at the Nth
      occurrence, or a course-check directive telling the coach to save it through `manage_fact`;
      (2) identity — `fact_key` is normalised text, so three differently-worded statements of the same
      ache do not share a key (category + `muscle_group` grouping is cheap but coarse; model-judged
      identity is accurate but costs a call); (3) the threshold and the window (3 within N days?).
      Source: wave-B Task 3 `ask` + orchestrator decision to keep it out of that plan (2026-09-21).

## course-check (wave B) close-out review advisories (2026-09-21)

- [ ] `user-facts.repository.ts` `expiredAt(now)` re-expresses `isExpired`'s clause (active + short +
      `expires_at <= now`) as raw SQL — a second statement of the rule that owns its numbers in
      `domain/user/services/fact-lifecycle.ts`, next to the existing `visibleAt` / `isActiveForPrompt`
      twin. SQL cannot call the TS predicate, so this is structural, but a change to the `<=` edge will
      not fail to compile if the SQL drifts — only fail behaviourally.
      Source: close-out-review, R2 (2026-09-21).
- [ ] `tests/integration/scenarios/scripted-model.ts` routes a structured call to the course-check
      answer queue by matching the literal opening sentence of `prompts/course-check/v1.ts`. Reword that
      sentence and every FL journey misroutes its course-check call into the summariser's queue (a loud
      schema failure, not a silent one, but nothing ties the two strings together). Route by schema name
      instead. Source: close-out-review, R2+R3 (2026-09-21).
- [ ] The course-check prompt forbids putting an expiry check-in into the general `questions` list
      instead of the dedicated field, but code cannot tell the two apart — a model that ignores the
      instruction would have its expiry question persisted like an ordinary one, so it would be asked
      more than once. Worth one deterministic check in the consolidated eval pass.
      Source: wave-B Task 3b worker note, accepted by the orchestrator (2026-09-21).
- [ ] The new optional field in the course-check structured schema follows the summariser's precedent
      for optional fields under strict `json_schema`, but only a live provider run proves the provider
      accepts it. Worth confirming on the first live course-check run.
      Source: wave-B Task 3b worker note (2026-09-21).

## coach-baseline close-out review advisories (2026-09-25)

- [ ] Move embedding-session teardown into the DI container: `embedding.service.ts` keeps a module-level `liveInstances` registry and `disposeAllEmbeddingServices()` whose only caller is `src/app/test/setup.ts`, so DI-created instances are tracked outside the container; a container shutdown/dispose hook would own the lifecycle and also serve graceful shutdown. Source: coach-baseline close-out review R1 (2026-09-25).
- [ ] Document the `forceExit: false` failure mode: a future leaked handle now makes jest hang (reported by `detectOpenHandles`, ended only by a CI timeout) instead of exiting — the intended trade-off for AC-CB-1, but nowhere written down for whoever meets the hang. Source: coach-baseline close-out review R3 (2026-09-25).
- [ ] Harden `overlapping-load.repro.test.ts` Red 1 before U3 turns it green: `toContain('Overhead Press')` could pass without the level-2 block (e.g. a substitutes list); tie the exercise name to yesterday's date. Source: coach-baseline close-out review R3 (2026-09-25).
- [ ] Two `SeedSession` types of different shapes: `recent-history-status.integration.test.ts:31` and `tests/integration/scenarios/session-seed.ts:12`; the separate seeding loop is justified (the shared seeder cannot express `skipped`/`planning` or custom timestamps), the duplicate type name is a trap — rename one or widen the shared seeder. Source: coach-baseline close-out review R2 (2026-09-25).

## smoke-test close-out review advisories (2026-09-25)

- [ ] One runtime source for the exercise category list and involvement values: `['compound','isolation','cardio','functional','mobility']` is typed by hand in `evals/schema/scenario.schema.ts:139`, `search-exercises.tool.ts:36` (`CATEGORIES`), `src/domain/training/types.ts:64` and `infra/db/seeds/exercises.seed.ts:15`; `InvolvementSchema`'s values are only type-checked against `Involvement`. Same class `db6c0a94` fixed for muscle groups and exercise types (whose two production copies in `save-workout-plan.tool.ts:22` / `search-exercises.tool.ts:13` also remain). Source: smoke-test close-out review R2 (2026-09-25).
- [ ] Type `evals/lib/scenario-world.ts` `toSetData` against the domain `SetData` / `setDataTypes` (`src/domain/training/set-data.types.ts`) instead of `Record<string, unknown>` with literal type strings, so a domain setData change breaks the seeder at compile time. Source: smoke-test close-out review R2 (2026-09-25).

