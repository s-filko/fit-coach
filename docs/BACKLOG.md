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
- [ ] `plan-review` and superpowers' final whole-branch review both sweep the same diff —
  two full review passes per plan, neither deduplicated against the other in
  `SUPERPOWERS_INTEGRATION.md` or the design spec. Decide whether the final review narrows
  to what the four zones do not cover, or whether it is dropped for plans that ran the phase.
  Source: plan-review first live run, R2 (2026-09-12).
- [ ] `zones/r3-correctness.md` carries a "describe/it names carry BR/AC references" bullet
  that is inert on markdown-only diffs yet reads as a checklist item to satisfy on every run.
  Scope it to code-bearing diffs. Source: plan-review first live run, R3 (2026-09-12).
- [ ] `.claude/skills/plan-review/SKILL.md` will hold a sixth responsibility once the
  `state.mjs` review gate (design spec section 7) lands; consider splitting orchestration
  from artifact-writing at that point, not before.
  Source: plan-review first live run, R1 (2026-09-12).

## Wishes

- [ ] Replace the `§` section sign across `docs/` — owner dislikes the notation; use
      "section N" or named references instead. Touches 10 files, including durable specs
      (`DOCUMENTATION_GUIDE.md`, `adr/0013-llm-core-target-architecture.md`,
      `CONTRIBUTING_AI.md`) and `STATE.md`. The 2026-09-12 mandatory-plan-review spec is
      already written without it; this covers the pre-existing files. Source: spec review
      (2026-09-12).
