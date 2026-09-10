# Superpowers Integration — SDD Contract

This document defines how the Superpowers plugin (process methodology) and this repo's
documentation system (spec governance) work together without conflicts. It complements
`docs/DOCUMENTATION_GUIDE.md` and `docs/CONTRIBUTING_AI.md`; if instructions conflict,
the durable-docs rules (IDs, locations, English-only) win on **content**, Superpowers
skills win on **process**.

## Division of roles

| Layer | Owner | Contents | Lifetime |
|---|---|---|---|
| Durable specs | Repo docs system (`docs/`) | ADRs, domain specs, feature specs (FEAT-####), API_SPEC, `LLM_CORE_REFACTOR_PLAN.md`, `PROMPT_EVAL_FRAMEWORK.md`; IDs INV/BR/S/AC | Long-lived, versioned, the law |
| Process artifacts | Superpowers | `docs/superpowers/specs/YYYY-MM-DD-*-design.md` (brainstorm output), `docs/superpowers/plans/YYYY-MM-DD-*.md` (implementation plans) | Dated working documents |

`docs/superpowers/**` is a recognized process-artifact area: files there are working
documents, not sources of truth. They are superseded, not edited in place.

## Workflow (one change)

```
idea
 └─ superpowers:brainstorming ──▶ design doc in docs/superpowers/specs/
      │                            must reference durable IDs (FEAT-####, BR-*, AC-*)
      │                            or mark "new IDs to be created"
 └─ docs-first gate: durable spec updated FIRST (feature/domain/API/ADR per
      DOCUMENTATION_GUIDE) — code never precedes the durable spec
 └─ superpowers:writing-plans ──▶ plan in docs/superpowers/plans/
      │                            every task references AC-#### it implements
      │                            + verification command (npm scripts / manual check)
 └─ superpowers:executing-plans + test-driven-development
 └─ verification-before-completion, requesting/receiving-code-review
 └─ finishing-a-development-branch
 └─ docs reconcile: touched durable specs re-checked against what shipped
```

## Rules of engagement

1. **Durable content never lives only in `docs/superpowers/`.** A design doc may draft it,
   but anything that survives the change (a business rule, an endpoint, an invariant)
   lands in the durable layer with an ID. Design doc links to it, not vice versa.
2. **Plans carry traceability.** Each task in a superpowers plan cites the AC-#### (or
   plan-phase criterion, e.g. `AC-13xx` from `LLM_CORE_REFACTOR_PLAN.md`) it satisfies
   and the command that verifies it. A task without a verification path is not done.
3. **Escalation, never silent edits.** If execution reveals a durable spec is wrong, the
   agent stops and surfaces the conflict to the owner. Durable specs change through the
   owner, in the open, with IDs preserved.
4. **TDD conventions.** Tests follow `apps/server/TESTING.md`; `describe/it` names keep
   BR/AC references per CONTRIBUTING_AI. Superpowers red-green-refactor discipline
   applies inside those conventions.
5. **Refactor work uses phase criteria.** For `LLM_CORE_REFACTOR_PLAN.md` phases (P0–P7),
   the plan's `AC-13xx` are the acceptance criteria; a superpowers plan for a phase cites
   them per task instead of inventing new ACs.
6. **Language.** Everything in `docs/` (including `docs/superpowers/`) is English-only.

## Plugin notes

- Installed: `superpowers@superpowers-marketplace` v6.3.0, user scope.
- A second copy `superpowers@claude-plugins-official` v5.1.0 (project scope) exists and
  must stay **disabled** — one version, one source of process instructions.
- New sessions load the plugin's skills automatically (SessionStart hook).
