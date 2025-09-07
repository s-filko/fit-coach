# Documentation Guide

This guide defines how documentation is written, structured, and maintained. It extends the existing docs‑first workflow and does not change any architectural content. Architectural truth remains in `ARCHITECTURE.md`.

## Principles
- English only. One concept = one term (no synonyms).
- Docs‑first: update documentation before code changes.
- No duplication — reference by ID.
- Every PR must include updated docs.

## Structure
```
docs/
  API_SPEC.md
  DOCUMENTATION_GUIDE.md
  README.md
  adr/
    000X-*.md            # Architecture Decision Records
  domain/
    <domain>.spec.md     # Domain invariants, business rules, ports
  features/
    FEAT-####-*.md       # Feature specifications
  templates/
    domain.spec.template.md
    feature.spec.template.md
    adr.template.md
```

## Document Types & Rules
- Feature change → Feature Spec under `docs/features/`.
- Business rule change → Domain Spec under `docs/domain/`.
- API change → `docs/API_SPEC.md`.
- Architecture change → ADR under `docs/adr/`.

All rules, invariants, scenarios, and acceptance criteria must have unique IDs.

## ID Conventions
- Invariants: `INV-<DOMAIN>-###`
- Business Rules: `BR-<DOMAIN>-###`
- Scenarios: `S-####`
- Acceptance Criteria: `AC-####`

IDs must appear in docs, code comments (JSDoc near ports/services), and tests (describe/it names).

## Domain Spec
- One file per domain (≤ 50 lines).
- Must reflect existing ports in `apps/server/src/domain/*/ports/*.ts` (or `ports.ts`).
- Format:
  - Domain
  - Terms (single‑line definitions)
  - Invariants (INV-<DOMAIN>-###)
  - Business Rules (BR-<DOMAIN>-###)
  - Ports (InterfaceName (TOKEN) and methods with [BR refs])

## Feature Spec
- One file per feature.
- Must contain: User Story, Scenarios, Acceptance Criteria, API Mapping, Domain Rules Reference.
- Cover happy and negative paths. Always link to business rules.

## API Spec
- Each endpoint includes path, method, request/response schemas.
- Must reference Feature ID via `x-feature: FEAT-####`.
- Must stay in sync with Fastify Zod schemas.

## ADR
- Only for fundamental or breaking changes.
- Number sequentially as `000X`.

## Process
1) Update docs first.
2) Review docs.
3) Implement code.
4) CI checks (to be wired):
   - Feature PR includes Feature Spec.
   - Domain Spec matches `domain/*/ports/*.ts`.
   - API_SPEC validates against route schemas and has `x-feature`.
   - IDs are unique and consistent across docs.

## AI Execution Order
1) Feature Spec
2) Domain Spec
3) API_SPEC.md
4) ARCHITECTURE.md
5) ADRs

