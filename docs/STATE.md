# Project State

Single orientation point for any working session: what is in progress, what is next,
what is in scope. Read this file first; update it on every status change (event-driven,
not end-of-session). Conventions are defined in `docs/SUPERPOWERS_INTEGRATION.md` § Status layer.

The block between the AUTO markers below is generated from
`docs/superpowers/plans/` + git facts by `node scripts/state.mjs --write` — never hand-edit it.
Everything below the block is hand-written: only facts no generator can derive.

<!-- AUTO:status BEGIN — regen: node scripts/state.mjs --write -->
_Generated 2026-09-13 from docs/superpowers/plans/ + git. Never hand-edit; regen with `node scripts/state.mjs --write`._

**In progress**
— none —

**Planned**
- `ports-layout-consistency.md` — Ports Layout Consistency Implementation Plan
- `refactor-p0-eval-baseline.md` — Refactor P0 — Remaining Datasets and v0 Baseline Implementation Plan
- `refactor-p0-eval-l1-chat-training.md` — Refactor P0 — L1 Runner and Chat/Training Datasets Implementation Plan
- `refactor-p0-transcript-export.md` — Refactor P0 — Transcript Export Implementation Plan

**Done**
- `mandatory-plan-review.md` — Mandatory Plan Review Implementation Plan
- `migration-discipline.md` — Migration Discipline (HB-01) Implementation Plan
- `refactor-p0-dead-code.md` — Refactor P0 — Dead Code Removal Implementation Plan
- `refactor-p0-eval-harness.md` — Refactor P0 — Eval Harness (L0) Implementation Plan
- `refactor-p0-run-log.md` — Refactor P0 — Run Log Implementation Plan
- `review-self-improvement.md` — Review Self-Improvement Implementation Plan

**Close-out debt (merged but plan not done)**
— none —
<!-- AUTO:status END -->

## Scope now

- **LLM core refactor** — the governing initiative. Master plan: `LLM_CORE_REFACTOR_PLAN.md`
  (phases P0–P7, acceptance criteria `AC-13xx`), target architecture `docs/adr/0013-llm-core-target-architecture.md`,
  quality gate `PROMPT_EVAL_FRAMEWORK.md`. No phase has started yet.
- **Architecture/hygiene backlog** — `PLAN-architecture-refactor-backlog.md` (`HB-##` items).
- **Global backlog** — `BACKLOG.md`: permanent parking lot of unplanned ideas/findings/
  wishes; top entries are candidates for *Next* below (intake via the `backlog` skill).
- **Bugs** — `BUGS.md` (`BUG-###` entries with their own Status fields).

## Next (dispatch order)

1. **Refactor P0** — safety net and measurement (`AC-1301`–`AC-1304`), decomposed into six
   plans executed in `- After:` order. `refactor-p0-dead-code` (scope item 4),
   `refactor-p0-run-log` (scope items 1–3, AC-1301) and `refactor-p0-eval-harness`
   (L0 half of AC-1303) are done; next is **`refactor-p0-eval-l1-chat-training`**,
   then `refactor-p0-eval-baseline` → `refactor-p0-transcript-export`, which closes P0.
2. Then P1 → P2 → P3 → P4/P5 → P6 → P7 per the master plan phase map.
3. **`ports-layout-consistency`** — one rule for port file layout in `ARCHITECTURE.md`,
   the code aligned to it, ESLint keeping it that way. Independent of the P0 chain;
   can run alongside it.
4. **HB-02** (production Docker image) — its own plan, sequenced after HB-01;
   note it must keep `scripts/stamp-baseline.ts` runnable (see the HB-02 note
   in that script's plan).

## Blocked / waiting on owner

- Nothing blocked right now. OQ-3 (judge profile) has a recommended default
  (Gemini 3 Flash PAYG) that P0's eval harness will assume until ruled otherwise.
- ADR-0002 divergence **resolved 2026-09-13** by owner call: ADR-0002's Decision section
  is historical context; the live interface-layout rule is `ARCHITECTURE.md`
  § Interface Organization Principles. Both files now say so.

## Notes

- Owner rule: refactor phase execution uses Superpowers plans
  (`docs/superpowers/plans/`) with `Status:` header lines tracked here.
- Task identity = plan slug; hard dependencies via `- After: <slug>` header lines;
  dispatch rules and lifecycle: `SUPERPOWERS_INTEGRATION.md` § Task lifecycle & sequencing.
- Statuses live only in plan headers and this file — durable specs
  (`LLM_CORE_REFACTOR_PLAN.md` etc.) stay forward-looking and never carry progress markers.
