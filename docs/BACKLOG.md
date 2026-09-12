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

## Wishes

- [ ] Replace the `§` section sign across `docs/` — owner dislikes the notation; use
      "section N" or named references instead. Touches 10 files, including durable specs
      (`DOCUMENTATION_GUIDE.md`, `adr/0013-llm-core-target-architecture.md`,
      `CONTRIBUTING_AI.md`) and `STATE.md`. The 2026-09-12 mandatory-plan-review spec is
      already written without it; this covers the pre-existing files. Source: spec review
      (2026-09-12).
